/**
 * Knowledge IPC Handlers
 * 知识库相关的 IPC 处理函数
 */

import { ipcMain, IpcMainInvokeEvent, dialog, shell } from 'electron'
import { stat } from 'fs/promises'
import { KnowledgeService } from '../services/KnowledgeService'
import { KnowledgeLinkService } from '../services/KnowledgeLinkService'
import { BackgroundJobService } from '../services/BackgroundJobService'
import { NotebookSummaryService } from '../services/NotebookSummaryService'
import { LlamaService } from '../services/LlamaService'
import { ProviderManager } from '../providers/ProviderManager'
import Logger from '../../shared/utils/logger'
import { KnowledgeSchemas, validate, validateWithEvent } from './validation'
import { registerNoArgHandler } from './handlerRegistry'
import { isAllowedExternalOpenUrl, normalizeFsPath } from '../security/guards'

/**
 * 注册知识库相关 IPC Handlers
 */
export function registerKnowledgeHandlers(
  providerManager: ProviderManager,
  knowledgeService: KnowledgeService,
  llamaService: LlamaService,
  backgroundJobService: BackgroundJobService,
  notebookSummaryService: NotebookSummaryService
) {
  const approvedFilePaths = new Set<string>()
  const approvedFolderPaths = new Set<string>()
  const linkService = new KnowledgeLinkService(providerManager)

  const ensureEmbeddingServiceReady = async (): Promise<string | null> => {
    try {
      const embeddingReady = await llamaService.ensureEmbeddingStarted()
      if (embeddingReady) return null
      return 'Embedding server is unavailable. Please import/select an embedding model (e.g. bge/e5) and try again.'
    } catch (error) {
      Logger.error('KnowledgeHandlers', 'Failed to ensure embedding server readiness:', error)
      return 'Embedding server startup failed. Please verify llama binary/model configuration and try again.'
    }
  }

  // 添加文档（文本内容）
  ipcMain.handle('knowledge:add-document', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.addDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'add-document:', {
        notebookId: params.notebookId,
        title: params.options.title
      })

      try {
        if (params.options.type !== 'text') {
          return {
            success: false,
            error: 'Direct document creation only supports pasted text content'
          }
        }

        if (params.options.sourceUri || params.options.sourceNoteId) {
          return {
            success: false,
            error: 'Direct text import cannot set sourceUri or sourceNoteId'
          }
        }

        const embeddingReadyError = await ensureEmbeddingServiceReady()
        if (embeddingReadyError) {
          return {
            success: false,
            error: embeddingReadyError
          }
        }

        const documentId = await knowledgeService.addDocument(
          params.notebookId,
          params.options,
          (stage, progress) => {
            // 发送进度更新
            event.sender.send('knowledge:index-progress', {
              notebookId: params.notebookId,
              stage,
              progress
            })
          }
        )
        // Auto-link: sinh liên kết tri thức nền cho document mới
        backgroundJobService.enqueueGenerateLinks(documentId, params.notebookId)
        backgroundJobService.enqueueEnrich(documentId, params.notebookId)
        return { success: true, documentId }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error adding document:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // 从文件添加文档
  ipcMain.handle(
    'knowledge:add-document-from-file',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addDocumentFromFile, async (params) => {
        Logger.debug('KnowledgeHandlers', 'add-document-from-file:', params)

        try {
          const normalizedFilePath = normalizeFsPath(params.filePath)
          if (!approvedFilePaths.has(normalizedFilePath)) {
            return {
              success: false,
              error: 'File path must be selected via the system file picker'
            }
          }

          const embeddingReadyError = await ensureEmbeddingServiceReady()
          if (embeddingReadyError) {
            return {
              success: false,
              error: embeddingReadyError
            }
          }

          approvedFilePaths.delete(normalizedFilePath)

          const documentId = await knowledgeService.addDocumentFromFile(
            params.notebookId,
            normalizedFilePath,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )
          // Auto-link: sinh liên kết tri thức nền cho document mới
          backgroundJobService.enqueueGenerateLinks(documentId, params.notebookId)
          backgroundJobService.enqueueEnrich(documentId, params.notebookId)
          return { success: true, documentId }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding document from file:', error)
          return { success: false, error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 从文件夹批量添加文档
  ipcMain.handle(
    'knowledge:add-documents-from-folder',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addDocumentsFromFolder, async (params) => {
        Logger.debug('KnowledgeHandlers', 'add-documents-from-folder:', params)

        try {
          const normalizedFolderPath = normalizeFsPath(params.folderPath)
          if (!approvedFolderPaths.has(normalizedFolderPath)) {
            return {
              success: false,
              error: 'Folder path must be selected via the system folder picker'
            }
          }

          const embeddingReadyError = await ensureEmbeddingServiceReady()
          if (embeddingReadyError) {
            return {
              success: false,
              error: embeddingReadyError
            }
          }

          approvedFolderPaths.delete(normalizedFolderPath)

          const result = await knowledgeService.addDocumentsFromFolder(
            params.notebookId,
            normalizedFolderPath,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )

          // Mỗi tài liệu vừa index đều được xếp hàng làm giàu + sinh liên kết nền
          for (const documentId of result.indexedDocumentIds) {
            backgroundJobService.enqueueGenerateLinks(documentId, params.notebookId)
            backgroundJobService.enqueueEnrich(documentId, params.notebookId)
          }

          return { success: true, result }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding documents from folder:', error)
          return { success: false, error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 从 URL 添加文档
  ipcMain.handle(
    'knowledge:add-document-from-url',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addDocumentFromUrl, async (params) => {
        try {
          const embeddingReadyError = await ensureEmbeddingServiceReady()
          if (embeddingReadyError) return { success: false, error: embeddingReadyError }

          const documentId = await knowledgeService.addDocumentFromUrl(
            params.notebookId,
            params.url,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )
          backgroundJobService.enqueueGenerateLinks(documentId, params.notebookId)
          backgroundJobService.enqueueEnrich(documentId, params.notebookId)
          return { success: true, documentId }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding document from URL:', error)
          return { success: false, error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 从 Note 添加到知识库
  ipcMain.handle('knowledge:add-note', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.addNote, async (params) => {
      Logger.debug('KnowledgeHandlers', 'add-note:', params)

      try {
        const embeddingReadyError = await ensureEmbeddingServiceReady()
        if (embeddingReadyError) {
          return {
            success: false,
            error: embeddingReadyError
          }
        }

        const documentId = await knowledgeService.addNoteToKnowledge(
          params.notebookId,
          params.noteId,
          (stage, progress) => {
            event.sender.send('knowledge:index-progress', {
              notebookId: params.notebookId,
              stage,
              progress
            })
          }
        )
        return { success: true, documentId }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error adding note:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // 搜索知识库
  ipcMain.handle(
    'knowledge:search',
    validate(KnowledgeSchemas.search, async (params) => {
      Logger.debug('KnowledgeHandlers', 'search:', params)

      try {
        const embeddingReadyError = await ensureEmbeddingServiceReady()
        if (embeddingReadyError) {
          return { success: false, error: embeddingReadyError, results: [] }
        }

        const results = await knowledgeService.search(
          params.notebookId,
          params.query,
          params.options
        )
        return { success: true, results }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error searching:', error)
        return { success: false, error: (error as Error).message, results: [] }
      }
    })
  )

  // 获取文档列表
  ipcMain.handle(
    'knowledge:get-documents',
    validate(KnowledgeSchemas.getDocuments, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-documents:', params.notebookId)

      try {
        const docs = knowledgeService.getDocuments(params.notebookId)
        return docs
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting documents:', error)
        return []
      }
    })
  )

  // 获取单个文档
  ipcMain.handle(
    'knowledge:get-document',
    validate(KnowledgeSchemas.getDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-document:', params.documentId)

      try {
        const doc = knowledgeService.getDocument(params.documentId)
        return doc || null
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting document:', error)
        return null
      }
    })
  )

  // 获取文档的 chunks
  ipcMain.handle(
    'knowledge:update-document-metadata',
    validate(KnowledgeSchemas.updateDocumentMetadata, async (params) => {
      try {
        const document = knowledgeService.updateDocumentMetadata(params.documentId, params.metadata)
        return { success: true, document }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error updating document metadata:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  ipcMain.handle(
    'knowledge:get-document-chunks',
    validate(KnowledgeSchemas.getDocumentChunks, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-document-chunks:', params.documentId)

      try {
        const chunks = knowledgeService.getDocumentChunks(params.documentId)
        return chunks
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting document chunks:', error)
        return []
      }
    })
  )

  // 获取指定页面内容（用于 citation 预览）
  ipcMain.handle(
    'knowledge:get-document-page',
    validate(KnowledgeSchemas.getDocumentPage, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-document-page:', params)

      try {
        const page = knowledgeService.getDocumentPageContent(
          params.documentId,
          params.pageNumber,
          params.highlightText
        )
        return page || null
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting document page:', error)
        return null
      }
    })
  )

  // 删除文档
  ipcMain.handle(
    'knowledge:delete-document',
    validate(KnowledgeSchemas.deleteDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'delete-document:', params.documentId)

      try {
        await knowledgeService.deleteDocument(params.documentId)
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error deleting document:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // 重建索引
  ipcMain.handle('knowledge:reindex-document', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.reindexDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'reindex-document:', params.documentId)

      try {
        const embeddingReadyError = await ensureEmbeddingServiceReady()
        if (embeddingReadyError) {
          return { success: false, error: embeddingReadyError }
        }

        await knowledgeService.reindexDocument(params.documentId, (stage, progress) => {
          event.sender.send('knowledge:index-progress', {
            documentId: params.documentId,
            stage,
            progress
          })
        })
        // Nội dung đã thay đổi → làm giàu lại + sinh lại liên kết (chạy nền)
        backgroundJobService.enqueueEnrich(params.documentId)
        backgroundJobService.enqueueGenerateLinks(params.documentId)
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error reindexing document:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // Làm giàu tài liệu thủ công (tóm tắt + mục + keyword/entity) — chạy ngay
  ipcMain.handle(
    'knowledge:enrich-document',
    validateWithEvent(KnowledgeSchemas.enrichDocument, async (event, params) => {
      Logger.debug('KnowledgeHandlers', 'enrich-document:', params.documentId)

      try {
        const chatProvider = await providerManager.getActiveChatProvider()
        if (!chatProvider) {
          return {
            success: false,
            error:
              'Chưa cấu hình model chat. Hãy chọn model chat trong Cài đặt để làm giàu tài liệu.'
          }
        }

        const enrichment = await backgroundJobService.runEnrichNow(params.documentId)
        const doc = knowledgeService.getDocument(params.documentId)
        event.sender.send('knowledge:documents-changed', {
          documentId: params.documentId,
          notebookId: doc?.notebookId
        })

        // Tóm tắt tài liệu mới → tổng hợp lại tóm tắt notebook (nền).
        if (doc) backgroundJobService.enqueueSummarizeNotebook(doc.notebookId)

        return { success: true, enrichment }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error enriching document:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // Tóm tắt THỐNG NHẤT cấp notebook — hiển thị ngay khi mở notebook, không
  // cần click vào từng tài liệu. Nếu thiếu/cũ thì tự xếp hàng tạo lại nền.
  ipcMain.handle(
    'knowledge:get-notebook-summary',
    validate(KnowledgeSchemas.notebookSummary, async (params) => {
      const stored = notebookSummaryService.getStored(params.notebookId)
      const fresh = notebookSummaryService.isFresh(params.notebookId)

      if (stored && fresh) {
        return { success: true, summary: stored, pending: false }
      }

      backgroundJobService.enqueueSummarizeNotebook(params.notebookId)
      return { success: true, summary: stored ?? null, pending: true }
    })
  )

  // Tổng hợp lại tóm tắt notebook ngay lập tức (nút xoáy trong khung chat).
  ipcMain.handle(
    'knowledge:regenerate-notebook-summary',
    validate(KnowledgeSchemas.notebookSummary, async (params) => {
      try {
        const chatProvider = await providerManager.getActiveChatProvider()
        if (!chatProvider) {
          return {
            success: false,
            error: 'Chưa cấu hình model chat để tổng hợp tóm tắt notebook.'
          }
        }

        const summary = await backgroundJobService.runSummarizeNow(params.notebookId)
        return {
          success: true,
          summary: { summary, generatedAt: new Date().toISOString() }
        }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error summarizing notebook:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  ipcMain.handle(
    'knowledge:refresh-document-metadata',
    validate(KnowledgeSchemas.refreshDocumentMetadata, async (params) => {
      try {
        knowledgeService.refreshDocumentMetadata(params.documentId)
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error refreshing document metadata:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // Feedback loop: ghi nhận đánh giá/sửa của người dùng lên chunk
  ipcMain.handle(
    'knowledge:record-feedback',
    validate(KnowledgeSchemas.recordFeedback, async (params) => {
      Logger.debug('KnowledgeHandlers', 'record-feedback:', {
        chunkId: params.chunkId,
        kind: params.kind
      })
      try {
        knowledgeService.recordChunkFeedback(
          params.notebookId,
          params.chunkId,
          params.kind,
          params.note
        )
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error recording feedback:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // Lifecycle: đánh dấu draft/verified/outdated
  ipcMain.handle(
    'knowledge:set-document-lifecycle',
    validate(KnowledgeSchemas.setDocumentLifecycle, async (params) => {
      Logger.debug('KnowledgeHandlers', 'set-document-lifecycle:', params)
      try {
        const document = knowledgeService.setDocumentLifecycle(params.documentId, params.state)
        return { success: true, document }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error setting document lifecycle:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // Knowledge links: xem liên kết của document
  ipcMain.handle(
    'knowledge:get-links',
    validate(KnowledgeSchemas.getLinks, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-links:', params.documentId)
      try {
        const links = linkService.getLinks(params.notebookId, params.documentId)
        return { success: true, links }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting links:', error)
        return { success: false, error: (error as Error).message, links: [] }
      }
    })
  )

  // Knowledge links: sinh liên kết cho document (LLM trích keyword + FTS)
  ipcMain.handle(
    'knowledge:generate-links',
    validate(KnowledgeSchemas.generateLinks, async (params) => {
      Logger.debug('KnowledgeHandlers', 'generate-links:', params.documentId)
      try {
        const count = await linkService.generateLinksForDocument(params.documentId)
        return { success: true, linkCount: count }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error generating links:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // 获取知识库统计信息
  ipcMain.handle(
    'knowledge:get-stats',
    validate(KnowledgeSchemas.getStats, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-stats:', params.notebookId)

      try {
        const stats = knowledgeService.getStats(params.notebookId)
        return stats
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting stats:', error)
        return { documentCount: 0, chunkCount: 0, embeddingCount: 0 }
      }
    })
  )

  // Kiểm tra số chiều embedding của model đang cấu hình (chặn model không khớp schema).
  registerNoArgHandler('knowledge:probe-embedding-dimensions', async () => {
    try {
      return {
        success: true,
        dimensions: await knowledgeService.probeEmbeddingDimensions()
      }
    } catch (error) {
      Logger.error('KnowledgeHandlers', 'Probe embedding dimensions failed:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // 打开文件选择对话框
  registerNoArgHandler('knowledge:select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'txt', 'md', 'html', 'htm']
        },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx', 'doc'] },
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'PowerPoint', extensions: ['pptx'] },
        { name: 'Text', extensions: ['txt', 'md'] },
        { name: 'Web page', extensions: ['html', 'htm'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled) {
      return []
    }

    const selectedPaths = result.filePaths.map((filePath) => normalizeFsPath(filePath))
    selectedPaths.forEach((filePath) => approvedFilePaths.add(filePath))
    return selectedPaths
  })

  // 打开文件夹选择对话框
  registerNoArgHandler('knowledge:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedFolderPath = normalizeFsPath(result.filePaths[0])
    approvedFolderPaths.add(selectedFolderPath)
    return selectedFolderPath
  })

  // 打开文档源文件
  ipcMain.handle(
    'knowledge:open-source',
    validate(KnowledgeSchemas.openSource, async (params) => {
      Logger.debug('KnowledgeHandlers', 'open-source:', params.documentId)

      try {
        const doc = knowledgeService.getDocument(params.documentId)
        if (!doc) {
          return { success: false, error: 'Document not found' }
        }

        // 根据文档类型处理
        if (doc.type === 'file') {
          const filePathToOpen = doc.localFilePath
          if (!filePathToOpen) {
            return { success: false, error: 'No file path available' }
          }

          if (!knowledgeService.isManagedLocalFilePath(filePathToOpen)) {
            return { success: false, error: 'Refusing to open unmanaged local file path' }
          }

          const exists = await stat(filePathToOpen)
            .then(() => true)
            .catch(() => false)

          if (!exists) {
            return {
              success: false,
              error:
                'Source file is missing from knowledge-files. It may have been deleted or moved. Please re-import the document if needed.'
            }
          }

          const openPathError = await shell.openPath(filePathToOpen)
          if (openPathError) {
            return {
              success: false,
              error: openPathError
            }
          }
        } else if (doc.type === 'url' && doc.sourceUri) {
          if (!isAllowedExternalOpenUrl(doc.sourceUri)) {
            return { success: false, error: 'Refusing to open a non-public URL' }
          }
          await shell.openExternal(doc.sourceUri)
        } else {
          return {
            success: false,
            error:
              'Source file is only available for imported files. Notes and text snippets have no file to open.'
          }
        }

        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error opening source:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  Logger.info('KnowledgeHandlers', 'Knowledge handlers registered')
}
