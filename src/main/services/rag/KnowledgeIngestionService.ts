/**
 * Ingestion workflows for the knowledge base: text, files, URLs, folders,
 * notes, session memory and note re-sync. The module owns source acquisition
 * and document-record creation; the actual index writes live in
 * `KnowledgeDocumentIndexer`.
 */

import { createHash, randomUUID } from 'crypto'
import { basename, extname, join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { documents, notes, type NewDocument } from '../../db/schema'
import type { FileParserService } from '../FileParserService'
import type { ParserWorkerClient } from '../import/ParserWorkerClient'
import type { MarkdownNormalizer } from '../MarkdownNormalizer'
import type { WebFetchService } from '../WebFetchService'
import type { KnowledgeDocumentIndexer } from './KnowledgeDocumentIndexer'
import type { KnowledgeFileStore } from './KnowledgeFileStore'
import type {
  AddDocumentOptions,
  AutoSyncPayload,
  BatchIndexResult,
  IndexProgressCallback
} from './KnowledgeServiceTypes'
import {
  buildChunkStructureContext,
  buildCompactStructureMetadata
} from './DocumentRetrievalMetadata'
import { validateImportableFile } from '../import/fileValidation'
import Logger from '../../../shared/utils/logger'

export interface KnowledgeIngestionServiceDeps {
  documentIndexer: KnowledgeDocumentIndexer
  fileStore: KnowledgeFileStore
  fileParserService: FileParserService
  parserWorker: ParserWorkerClient
  markdownNormalizer: MarkdownNormalizer
  webFetchService: WebFetchService
  emitAutoSync: (payload: AutoSyncPayload) => void
}

export class KnowledgeIngestionService {
  constructor(private readonly deps: KnowledgeIngestionServiceDeps) {}

  async addDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${randomUUID()}`
    const now = new Date()
    const normalized = this.deps.markdownNormalizer.normalize({
      content: options.content,
      mimeType: options.mimeType ?? 'text/plain'
    })
    const normalizedContent = normalized.content
    const structureMetadata = buildCompactStructureMetadata(normalized.structure)
    const contentHash = createHash('md5').update(options.content).digest('hex')
    const contentMdHash = createHash('md5').update(normalizedContent).digest('hex')

    try {
      onProgress?.('creating_document', 0)

      const newDoc: NewDocument = {
        id: documentId,
        notebookId,
        title: options.title,
        type: options.type,
        sourceUri: options.sourceUri,
        sourceNoteId: options.sourceNoteId,
        memoryOfSessionId: options.memoryOfSessionId,
        content: normalizedContent,
        contentHash,
        contentMdHash,
        mimeType: options.mimeType,
        fileSize: options.fileSize,
        metadata: { ...(options.metadata || {}), ...(structureMetadata || {}) },
        status: 'processing',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      }
      db.insert(documents).values(newDoc).run()

      await this.deps.documentIndexer.indexContent(
        documentId,
        notebookId,
        normalizedContent,
        options.chunkOptions,
        buildChunkStructureContext(normalized.structure),
        onProgress
      )
      return documentId
    } catch (error) {
      await this.deps.documentIndexer.cleanupDocumentIndex(notebookId, documentId)
      db.update(documents)
        .set({ status: 'failed', errorMessage: (error as Error).message, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
        .run()
      Logger.error('KnowledgeService', 'Failed to add document:', error)
      throw error
    }
  }

  async addDocumentFromFile(
    notebookId: string,
    filePath: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${randomUUID()}`
    let localFilePath: string | undefined
    const now = new Date()

    try {
      onProgress?.('parsing_file', 0)
      const importInfo = await validateImportableFile(filePath)
      localFilePath = await this.deps.fileStore.copyToDir(
        importInfo.path,
        documentId,
        importInfo.extension
      )

      db.insert(documents)
        .values({
          id: documentId,
          notebookId,
          title: basename(filePath) || 'Untitled',
          type: 'file',
          sourceUri: filePath,
          localFilePath,
          status: 'processing',
          chunkCount: 0,
          createdAt: now,
          updatedAt: now
        })
        .run()

      const parseResult = await this.deps.parserWorker.parseFile(filePath)
      const normalizedResult = this.deps.markdownNormalizer.normalize(parseResult)
      const normalizedContent = normalizedResult.content
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const contentMdHash = createHash('md5').update(normalizedContent).digest('hex')
      const fileInfo = await stat(filePath).catch(() => undefined)
      const fileBytes = await readFile(filePath).catch(() => undefined)
      const fileMd5 = fileBytes ? createHash('md5').update(fileBytes).digest('hex') : undefined

      const docType =
        parseResult.mimeType === 'text/plain' || parseResult.mimeType === 'text/markdown'
          ? 'text'
          : 'file'

      const structureMetadata = buildCompactStructureMetadata(normalizedResult.structure)
      const chunkOptions = this.deps.documentIndexer.chunkOptionsForMimeType(parseResult.mimeType)
      if (chunkOptions) {
        Logger.info(
          'KnowledgeService',
          `Using spreadsheet-safe chunk profile for ${basename(filePath)}: ${JSON.stringify(chunkOptions)}`
        )
      }

      onProgress?.('creating_document', 5)
      db.update(documents)
        .set({
          title: parseResult.title || basename(filePath) || 'Untitled',
          type: docType,
          content: normalizedContent,
          contentHash,
          contentMdHash,
          mimeType: parseResult.mimeType,
          fileSize: (parseResult.metadata?.fileSize as number | undefined) ?? fileInfo?.size,
          metadata: {
            ...(parseResult.metadata || {}),
            ...(structureMetadata || {}),
            ...(fileMd5 ? { fileMd5 } : {})
          },
          updatedAt: now
        })
        .where(eq(documents.id, documentId))
        .run()

      await this.deps.documentIndexer.indexContent(
        documentId,
        notebookId,
        normalizedContent,
        chunkOptions,
        buildChunkStructureContext(normalizedResult.structure),
        onProgress
      )
      return documentId
    } catch (error) {
      if (localFilePath) await this.deps.fileStore.deleteLocalFile(localFilePath)
      await this.deps.documentIndexer.cleanupDocumentIndex(notebookId, documentId)
      db.update(documents)
        .set({
          status: 'failed',
          localFilePath: null,
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()
      Logger.error('KnowledgeService', 'Failed to add document from file:', error)
      throw error
    }
  }

  /** Fetches a public web page, converts it to canonical Markdown, then sends it
   * through the same structure/chunk/vector/FTS pipeline as uploaded files. */
  async addDocumentFromUrl(
    notebookId: string,
    url: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    onProgress?.('fetching_url', 0)
    const fetched = await this.deps.webFetchService.fetchUrl(url, {
      extractMainContent: true,
      convertToMarkdown: true
    })
    if (!fetched.content.trim()) throw new Error('Web page has no indexable content')

    const parsedUrl = new URL(fetched.url)
    return this.addDocument(
      notebookId,
      {
        title: fetched.title?.trim() || parsedUrl.hostname,
        type: 'url',
        content: fetched.content,
        sourceUri: fetched.url,
        mimeType: 'text/markdown',
        metadata: {
          ...(fetched.metadata || {}),
          sourceMimeType: fetched.mimeType,
          ...(fetched.description ? { description: fetched.description } : {})
        }
      },
      onProgress
    )
  }

  async addDocumentsFromFolder(
    notebookId: string,
    folderPath: string,
    onProgress?: IndexProgressCallback
  ): Promise<BatchIndexResult> {
    onProgress?.('scanning_folder', 0)
    const files = await this.collectSupportedFilesRecursively(folderPath)
    const failedFiles: Array<{ filePath: string; error: string }> = []
    const indexedDocumentIds: string[] = []

    if (files.length === 0) {
      onProgress?.('completed', 100)
      return {
        totalFiles: 0,
        indexedFiles: 0,
        failedFiles: [],
        indexedDocumentIds: []
      }
    }

    let indexedFiles = 0

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      const fileBaseProgress = Math.round((i / files.length) * 100)
      onProgress?.('batch_indexing', fileBaseProgress)

      try {
        const documentId = await this.addDocumentFromFile(
          notebookId,
          filePath,
          (stage, progress) => {
            const localProgress = progress / files.length
            const overallProgress = Math.min(
              99,
              Math.round((i / files.length) * 100 + localProgress)
            )
            onProgress?.(`batch:${stage}`, overallProgress)
          }
        )
        indexedDocumentIds.push(documentId)
        indexedFiles++
      } catch (error) {
        failedFiles.push({ filePath, error: (error as Error).message })
      }
    }

    onProgress?.('completed', 100)
    return {
      totalFiles: files.length,
      indexedFiles,
      failedFiles,
      indexedDocumentIds
    }
  }

  async addNoteToKnowledge(
    notebookId: string,
    noteId: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const note = db.select().from(notes).where(eq(notes.id, noteId)).get()
    if (!note) throw new Error(`Note ${noteId} not found`)

    const trimmedContent = note.content.trim()
    if (!trimmedContent)
      throw new Error('Note content is empty. Cannot add empty note to knowledge base.')

    return this.addDocument(
      notebookId,
      { title: note.title, type: 'note', content: note.content, sourceNoteId: noteId },
      onProgress
    )
  }

  /**
   * Save a conversation session summary into the KB as a document with
   * type='memory' (embedded). Called by SessionAutoSwitchService after a
   * session summary is produced.
   */
  async storeSessionMemory(
    notebookId: string,
    sessionId: string,
    summary: string,
    sessionTitle: string
  ): Promise<string | null> {
    const trimmed = summary.trim()
    if (!trimmed) return null

    try {
      const documentId = await this.addDocument(notebookId, {
        title: `🧠 Ký ức: ${sessionTitle}`,
        type: 'memory',
        content: trimmed,
        memoryOfSessionId: sessionId,
        metadata: {
          memorySource: 'session-summary',
          sessionId,
          sessionTitle
        }
      })
      Logger.info('KnowledgeService', `Session memory stored: ${documentId} (session ${sessionId})`)
      return documentId
    } catch (error) {
      Logger.error('KnowledgeService', `Failed to store session memory for ${sessionId}:`, error)
      return null
    }
  }

  /**
   * Sync an edited note into the KB (called from noteHandlers after
   * update-note).
   */
  async syncNoteToKnowledge(noteId: string): Promise<void> {
    const db = getDatabase()
    const linkedDocs = db.select().from(documents).where(eq(documents.sourceNoteId, noteId)).all()

    if (linkedDocs.length === 0) return

    const note = db.select().from(notes).where(eq(notes.id, noteId)).get()
    if (!note) return

    for (const doc of linkedDocs) {
      try {
        const trimmedContent = note.content.trim()
        if (!trimmedContent) continue

        const normalized = this.deps.markdownNormalizer.normalize({
          content: note.content,
          mimeType: 'text/plain'
        })
        const content = normalized.content
        const structureMetadata = buildCompactStructureMetadata(normalized.structure)
        const docMetadata = { ...((doc.metadata as Record<string, unknown> | null) || {}) }
        delete docMetadata.structure
        if (structureMetadata) Object.assign(docMetadata, structureMetadata)

        db.update(documents)
          .set({
            title: note.title,
            content,
            contentHash: createHash('md5').update(note.content).digest('hex'),
            contentMdHash: createHash('md5').update(content).digest('hex'),
            metadata: docMetadata,
            updatedAt: new Date()
          })
          .where(eq(documents.id, doc.id))
          .run()

        const result = await this.deps.documentIndexer.reindexDocumentIncremental(
          doc.id,
          doc.notebookId,
          content,
          undefined,
          buildChunkStructureContext(normalized.structure),
          undefined
        )
        Logger.info('KnowledgeService', `Note ${noteId} synced to KB doc ${doc.id}:`, result)
        this.deps.emitAutoSync({
          documentId: doc.id,
          documentTitle: note.title,
          reason: 'note-updated',
          result
        })
      } catch (error) {
        Logger.error('KnowledgeService', `Failed to sync note ${noteId} to KB:`, error)
        this.deps.emitAutoSync({
          documentId: doc.id,
          documentTitle: note.title,
          reason: 'note-updated',
          error: (error as Error).message
        })
      }
    }
  }

  private async collectSupportedFilesRecursively(folderPath: string): Promise<string[]> {
    const entries = await readdir(folderPath, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      const fullPath = join(folderPath, entry.name)

      if (entry.isDirectory()) {
        const nestedFiles = await this.collectSupportedFilesRecursively(fullPath)
        files.push(...nestedFiles)
        continue
      }

      if (!entry.isFile()) continue
      const extension = extname(entry.name).toLowerCase().replace(/^\./, '')
      if (!extension) continue

      if (this.deps.fileParserService.isSupported(extension)) {
        files.push(fullPath)
      }
    }

    return files
  }
}
