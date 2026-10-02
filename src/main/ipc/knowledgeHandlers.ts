/**
 * Knowledge IPC Handlers
 * 知识库相关的 IPC 处理函数
 */

import { ipcMain, IpcMainInvokeEvent, dialog, shell } from 'electron'
import { stat } from 'fs/promises'
import { KnowledgeService } from '../services/KnowledgeService'
import { LlamaService } from '../services/LlamaService'
import Logger from '../../shared/utils/logger'
import { KnowledgeSchemas, validate } from './validation'
import { normalizeFsPath } from '../security/guards'

/**
 * 注册知识库相关 IPC Handlers
 */
export function registerKnowledgeHandlers(
  knowledgeService: KnowledgeService,
  llamaService: LlamaService
) {
  const approvedFilePaths = new Set<string>()
  const approvedFolderPaths = new Set<string>()

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
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error reindexing document:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

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

  // 打开文件选择对话框
  ipcMain.handle('knowledge:select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'ppt', 'txt', 'md']
        },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx', 'doc'] },
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'PowerPoint', extensions: ['pptx', 'ppt'] },
        { name: 'Text', extensions: ['txt', 'md'] },
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
  ipcMain.handle('knowledge:select-folder', async () => {
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
