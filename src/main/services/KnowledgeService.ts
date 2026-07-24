/**
 * KnowledgeService
 * Knowledge base core service: document management, chunking, embedding, retrieval
 *
 * Refactored: Extracted shared _indexContent() method to eliminate duplication (Q-01)
 * Fixed: reindexDocument no longer creates duplicate records (BUG-02)
 */

import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { app } from 'electron'
import { join, basename, extname } from 'path'
import { mkdir, copyFile, unlink, stat, readdir } from 'fs/promises'
import { getDatabase, executeCheckpoint, getSqlite } from '../db'
import { documents, chunks, embeddings, notes } from '../db/schema'
import type { Document, Chunk, NewDocument, NewChunk, NewEmbedding } from '../db/schema'
import { and, eq, desc, inArray, sql } from 'drizzle-orm'
import { EmbeddingService } from './EmbeddingService'
import { ChunkingService, type ChunkOptions } from './ChunkingService'
import { FileParserService } from './FileParserService'
import {
  extractDocumentMetadata,
  inspectorFromMetadata,
  mergeDocumentMetadataInspector,
  metadataFromInspector,
  type DocumentMetadata,
  type DocumentMetadataInspector
} from './DocumentMetadataExtractionService'
import { RerankService } from './RerankService'
import { vectorStoreManager } from '../vectorstore'
import { ProviderManager } from '../providers/ProviderManager'
import Logger from '../../shared/utils/logger'
import { isPathInsideDirectory } from '../security/guards'

export interface AddDocumentOptions {
  title: string
  type: 'file' | 'note' | 'url' | 'text'
  content: string
  sourceUri?: string
  sourceNoteId?: string
  mimeType?: string
  fileSize?: number
  metadata?: Record<string, unknown>
  chunkOptions?: ChunkOptions
}

export interface SearchOptions {
  topK?: number
  threshold?: number
  includeContent?: boolean
  metadataFilter?: {
    documentIds?: string[]
    documentTypes?: Array<'file' | 'note' | 'url' | 'text'>
    sourceUriContains?: string
  }
  rerank?: {
    enabled?: boolean
    topN?: number
    model?: string
    heuristicFallback?: boolean
  }
}

export interface SearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  sourceUri?: string
  pageNumber?: number
  content: string
  matchedContent?: string
  score: number
  chunkIndex: number
  metadata?: Record<string, unknown>
}

export interface DocumentPageContent {
  documentId: string
  documentTitle: string
  pageNumber: number
  content: string
  sourceUri?: string
  highlightText?: string
}

export type IndexProgressCallback = (stage: string, progress: number) => void

export interface BatchIndexResult {
  totalFiles: number
  indexedFiles: number
  failedFiles: Array<{ filePath: string; error: string }>
}

export class KnowledgeService {
  private embeddingService: EmbeddingService
  private chunkingService: ChunkingService
  private fileParserService: FileParserService
  private rerankService: RerankService
  private knowledgeFilesDir: string

  constructor(providerManager: ProviderManager) {
    this.embeddingService = new EmbeddingService(providerManager)
    this.chunkingService = new ChunkingService()
    this.fileParserService = new FileParserService()
    this.rerankService = new RerankService(providerManager)
    this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
    this.ensureKnowledgeFilesDir()
  }

  private async ensureKnowledgeFilesDir(): Promise<void> {
    try {
      await mkdir(this.knowledgeFilesDir, { recursive: true })
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to create knowledge files directory:', error)
    }
  }

  private async copyFileToKnowledgeDir(
    sourceFilePath: string,
    documentId: string
  ): Promise<string> {
    await this.ensureKnowledgeFilesDir()
    const extension = sourceFilePath.split('.').pop() || 'bin'
    const localFilePath = join(this.knowledgeFilesDir, `${documentId}.${extension}`)
    await copyFile(sourceFilePath, localFilePath)
    Logger.info('KnowledgeService', `File copied: ${sourceFilePath} -> ${localFilePath}`)
    return localFilePath
  }

  private async deleteLocalFile(localFilePath: string): Promise<void> {
    try {
      const exists = await stat(localFilePath)
        .then(() => true)
        .catch(() => false)
      if (exists) {
        await unlink(localFilePath)
        Logger.info('KnowledgeService', `Local file deleted: ${localFilePath}`)
      }
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to delete local file:', error)
    }
  }

  isManagedLocalFilePath(filePath: string): boolean {
    return isPathInsideDirectory(filePath, this.knowledgeFilesDir)
  }

  private buildCompactStructureMetadata(
    structure:
      | {
          type: 'flat' | 'pages' | 'sections'
          pages?: Array<{ pageNumber: number; startOffset: number; endOffset: number }>
        }
      | undefined
  ): Record<string, unknown> | undefined {
    if (!structure || structure.type !== 'pages' || !structure.pages?.length) {
      return undefined
    }

    return {
      structure: {
        type: 'pages',
        pages: structure.pages.map((p) => ({
          pageNumber: p.pageNumber,
          startOffset: p.startOffset,
          endOffset: p.endOffset
        }))
      }
    }
  }

  private getPageNumberForChunk(
    documentMetadata: Record<string, unknown> | null | undefined,
    startOffset: number | null,
    endOffset: number | null
  ): number | undefined {
    if (
      !documentMetadata ||
      startOffset === null ||
      startOffset === undefined ||
      endOffset === null ||
      endOffset === undefined
    ) {
      return undefined
    }

    const structure = (documentMetadata as any).structure
    if (!structure || structure.type !== 'pages' || !Array.isArray(structure.pages)) {
      return undefined
    }

    const page = structure.pages.find((p: any) => {
      if (
        typeof p?.startOffset !== 'number' ||
        typeof p?.endOffset !== 'number' ||
        typeof p?.pageNumber !== 'number'
      ) {
        return false
      }

      return startOffset < p.endOffset && endOffset >= p.startOffset
    })

    return page?.pageNumber
  }

  private resolveFilteredDocumentIds(
    notebookId: string,
    metadataFilter: SearchOptions['metadataFilter']
  ): string[] | null {
    if (!metadataFilter) return null
    if (
      !metadataFilter.documentIds?.length &&
      !metadataFilter.documentTypes?.length &&
      !metadataFilter.sourceUriContains?.trim()
    ) {
      return null
    }

    const filters = [eq(documents.notebookId, notebookId)]

    if (metadataFilter.documentIds?.length) {
      filters.push(inArray(documents.id, metadataFilter.documentIds))
    }

    if (metadataFilter.documentTypes?.length) {
      filters.push(inArray(documents.type, metadataFilter.documentTypes))
    }

    const db = getDatabase()
    const docs = db
      .select({ id: documents.id })
      .from(documents)
      .where(and(...(filters as any)))
      .all()

    const normalizedSource = metadataFilter.sourceUriContains?.trim().toLowerCase()
    if (!normalizedSource) {
      return docs.map((d) => d.id)
    }

    const docIdSet = new Set(docs.map((d) => d.id))
    if (docIdSet.size === 0) return []

    const sourceFilteredDocs = db
      .select({ id: documents.id, sourceUri: documents.sourceUri })
      .from(documents)
      .where(inArray(documents.id, Array.from(docIdSet)))
      .all()
      .filter((d) => (d.sourceUri || '').toLowerCase().includes(normalizedSource))
      .map((d) => d.id)

    return sourceFilteredDocs
  }

  private resolveFilteredChunkIds(
    notebookId: string,
    metadataFilter: SearchOptions['metadataFilter']
  ): string[] | null {
    const filteredDocumentIds = this.resolveFilteredDocumentIds(notebookId, metadataFilter)
    if (filteredDocumentIds === null) return null
    if (filteredDocumentIds.length === 0) return []

    const db = getDatabase()
    return db
      .select({ id: chunks.id })
      .from(chunks)
      .where(
        and(eq(chunks.notebookId, notebookId), inArray(chunks.documentId, filteredDocumentIds))
      )
      .all()
      .map((c) => c.id)
  }

  private buildChunkOptionsForMimeType(mimeType: string | undefined): ChunkOptions | undefined {
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      // Spreadsheet rows can be token-dense; use tighter chunking for stable local embedding.
      return {
        chunkSize: 220,
        chunkOverlap: 20,
        minChunkSize: 30,
        maxChunkTokens: 96,
        maxTableRowsPerChunk: 3
      }
    }

    return undefined
  }

  private deleteFtsChunkIds(chunkIds: string[]): void {
    if (chunkIds.length === 0) return
    const sqlite = getSqlite()
    if (!sqlite) return

    const placeholders = chunkIds.map(() => '?').join(',')
    sqlite.prepare(`DELETE FROM fts_chunks WHERE chunk_id IN (${placeholders})`).run(...chunkIds)
  }

  private async cleanupDocumentIndex(notebookId: string, documentId: string): Promise<void> {
    const db = getDatabase()
    const docChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    if (docChunks.length === 0) return

    const chunkIds = docChunks.map((chunk) => chunk.id)
    const vectorStore = await vectorStoreManager.getStore(notebookId)
    await vectorStore.deleteByChunkIds(chunkIds)
    this.deleteFtsChunkIds(chunkIds)
    db.delete(embeddings).where(inArray(embeddings.chunkId, chunkIds)).run()
    db.delete(chunks).where(eq(chunks.documentId, documentId)).run()
  }

  /**
   * Q-01 Fix: Shared indexing logic extracted from addDocument and addDocumentFromFile.
   * BUG-02 Fix: reindexDocument now calls this directly, avoiding creation of a new document record.
   *
   * Steps: chunk content → save chunks → embed → save embeddings → update vector store → finalize document status
   */
  private async _indexContent(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    onProgress?: IndexProgressCallback
  ): Promise<void> {
    const db = getDatabase()
    const now = new Date()
    const document = db.select().from(documents).where(eq(documents.id, documentId)).get()

    if (document) {
      const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
      const extracted = extractDocumentMetadata({ title: document.title, content })
      const inspector = mergeDocumentMetadataInspector(
        extracted.inspector,
        rootMetadata.documentMetadataInspector as DocumentMetadataInspector | undefined
      )

      if (Object.values(inspector.fields).some(Boolean)) {
        db.update(documents)
          .set({
            metadata: {
              ...rootMetadata,
              documentMetadata: metadataFromInspector(inspector),
              documentMetadataInspector: inspector
            },
            updatedAt: now
          })
          .where(eq(documents.id, documentId))
          .run()
      }
    }

    // 1. Chunk
    onProgress?.('chunking', 10)
    const chunkResults = this.chunkingService.chunk(content, chunkOptions)
    if (chunkResults.length === 0) throw new Error('No chunks generated from document')
    Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

    // 2. Save chunks
    onProgress?.('saving_chunks', 20)
    const chunkIds: string[] = []
    const chunkContents: string[] = []

    for (const chunk of chunkResults) {
      const chunkId = `chunk_${randomUUID()}`
      chunkIds.push(chunkId)
      chunkContents.push(chunk.content)

      const newChunk: NewChunk = {
        id: chunkId,
        documentId,
        notebookId,
        content: chunk.content,
        chunkIndex: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        metadata: chunk.metadata,
        tokenCount: chunk.tokenCount,
        createdAt: now
      }
      db.insert(chunks).values(newChunk).run()

      // Also insert into FTS5 virtual table for Hybrid Search
      const sqlite = getSqlite()
      if (sqlite) {
        sqlite
          .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
          .run(chunkId, notebookId, chunk.content)
      }
    }

    // 3. Generate embeddings
    onProgress?.('generating_embeddings', 30)
    const embeddingResults = await this.embeddingService.embedBatch(
      chunkContents,
      { dimensions: 1024 },
      (completed, total) => {
        onProgress?.('generating_embeddings', Math.round(30 + (completed / total) * 50))
      }
    )

    const detectedDimensions = embeddingResults.length > 0 ? embeddingResults[0].dimensions : 1024
    if (embeddingResults.length > 0 && detectedDimensions !== 1024) {
      throw new Error(
        `Unsupported embedding dimensions: ${detectedDimensions}. Current sqlite-vec schema requires 1024 dimensions.`
      )
    }
    if (embeddingResults.length > 0) {
      vectorStoreManager.setDefaultDimensions(1024)
      Logger.debug('KnowledgeService', `Detected embedding dimensions: ${detectedDimensions}`)
    }

    // 4. Save embeddings + add to vector store
    onProgress?.('saving_embeddings', 85)
    const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, detectedDimensions)
    const vectorItems: Array<{
      id: string
      chunkId: string
      vector: Float32Array
      metadata?: Record<string, unknown>
    }> = []

    for (let i = 0; i < chunkIds.length; i++) {
      const embeddingId = `emb_${randomUUID()}`
      const embResult = embeddingResults[i]

      const newEmbedding: NewEmbedding = {
        id: embeddingId,
        chunkId: chunkIds[i],
        notebookId,
        model: embResult.model,
        dimensions: embResult.dimensions,
        createdAt: now
      }
      db.insert(embeddings).values(newEmbedding).run()

      vectorItems.push({
        id: embeddingId,
        chunkId: chunkIds[i],
        vector: embResult.embedding,
        metadata: { model: embResult.model, documentId }
      })
    }

    await vectorStore.upsert(vectorItems)

    // 5. Update document status
    onProgress?.('finalizing', 95)
    db.update(documents)
      .set({ status: 'indexed', chunkCount: chunkResults.length, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    executeCheckpoint('PASSIVE')
    onProgress?.('completed', 100)
    Logger.info(
      'KnowledgeService',
      `Document indexed: ${documentId}, ${chunkResults.length} chunks`
    )
  }

  async addDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${randomUUID()}`
    const now = new Date()
    const contentHash = createHash('md5').update(options.content).digest('hex')

    try {
      onProgress?.('creating_document', 0)

      const newDoc: NewDocument = {
        id: documentId,
        notebookId,
        title: options.title,
        type: options.type,
        sourceUri: options.sourceUri,
        sourceNoteId: options.sourceNoteId,
        content: options.content,
        contentHash,
        mimeType: options.mimeType,
        fileSize: options.fileSize,
        metadata: options.metadata,
        status: 'processing',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      }
      db.insert(documents).values(newDoc).run()

      await this._indexContent(
        documentId,
        notebookId,
        options.content,
        options.chunkOptions,
        onProgress
      )
      return documentId
    } catch (error) {
      await this.cleanupDocumentIndex(notebookId, documentId)
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
      localFilePath = await this.copyFileToKnowledgeDir(filePath, documentId)

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

      const parseResult = await this.fileParserService.parseFile(filePath)
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const fileInfo = await stat(filePath).catch(() => undefined)

      const docType =
        parseResult.mimeType === 'text/plain' || parseResult.mimeType === 'text/markdown'
          ? 'text'
          : 'file'

      const structureMetadata = this.buildCompactStructureMetadata(
        parseResult.structure as
          | {
              type: 'flat' | 'pages' | 'sections'
              pages?: Array<{ pageNumber: number; startOffset: number; endOffset: number }>
            }
          | undefined
      )
      const chunkOptions = this.buildChunkOptionsForMimeType(parseResult.mimeType)
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
          content: parseResult.content,
          contentHash,
          mimeType: parseResult.mimeType,
          fileSize: (parseResult.metadata?.fileSize as number | undefined) ?? fileInfo?.size,
          metadata: {
            ...(parseResult.metadata || {}),
            ...(structureMetadata || {})
          },
          updatedAt: now
        })
        .where(eq(documents.id, documentId))
        .run()

      await this._indexContent(
        documentId,
        notebookId,
        parseResult.content,
        chunkOptions,
        onProgress
      )
      return documentId
    } catch (error) {
      if (localFilePath) await this.deleteLocalFile(localFilePath)
      await this.cleanupDocumentIndex(notebookId, documentId)
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

      if (this.fileParserService.isSupported(extension)) {
        files.push(fullPath)
      }
    }

    return files
  }

  async addDocumentsFromFolder(
    notebookId: string,
    folderPath: string,
    onProgress?: IndexProgressCallback
  ): Promise<BatchIndexResult> {
    onProgress?.('scanning_folder', 0)
    const files = await this.collectSupportedFilesRecursively(folderPath)
    const failedFiles: Array<{ filePath: string; error: string }> = []

    if (files.length === 0) {
      onProgress?.('completed', 100)
      return {
        totalFiles: 0,
        indexedFiles: 0,
        failedFiles: []
      }
    }

    let indexedFiles = 0

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      const fileBaseProgress = Math.round((i / files.length) * 100)
      onProgress?.('batch_indexing', fileBaseProgress)

      try {
        await this.addDocumentFromFile(notebookId, filePath, (stage, progress) => {
          const localProgress = progress / files.length
          const overallProgress = Math.min(99, Math.round((i / files.length) * 100 + localProgress))
          onProgress?.(`batch:${stage}`, overallProgress)
        })
        indexedFiles++
      } catch (error) {
        failedFiles.push({ filePath, error: (error as Error).message })
      }
    }

    onProgress?.('completed', 100)
    return {
      totalFiles: files.length,
      indexedFiles,
      failedFiles
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

  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const startedAt = Date.now()
    const { topK = 5, threshold = 0.5, includeContent = true, metadataFilter, rerank } = options
    const rerankEnabled = rerank?.enabled ?? false
    const rerankTopN = Math.min(Math.max(rerank?.topN ?? topK * 2, 1), 100)
    const rerankModel = rerank?.model?.trim() || undefined
    const rerankHeuristicFallback = rerank?.heuristicFallback ?? true
    const retrievalCandidateLimit = Math.max(topK * 2, rerankEnabled ? rerankTopN : topK)
    const sqlite = getSqlite()
    const filteredChunkIds = this.resolveFilteredChunkIds(notebookId, metadataFilter)
    if (filteredChunkIds && filteredChunkIds.length === 0) {
      Logger.debug('KnowledgeService', 'Search returned 0 results due to metadata filter')
      return []
    }

    // 1. Vector Search
    const queryEmbedding = await this.embeddingService.embed(query)
    if (queryEmbedding.dimensions !== 1024) {
      throw new Error(
        `Unsupported query embedding dimensions: ${queryEmbedding.dimensions}. Current sqlite-vec schema requires 1024 dimensions.`
      )
    }

    const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, 1024)
    const vectorResults = await vectorStore.query(queryEmbedding.embedding, {
      topK: retrievalCandidateLimit,
      threshold,
      filter: filteredChunkIds ? { chunkIds: filteredChunkIds } : undefined
    }) // Fetch more for RRF

    // 2. FTS5 BM25 Search (Keyword search)
    let ftsResults: Array<{ chunk_id: string; rank: number }> = []
    if (sqlite) {
      try {
        // Simple sanitization for FTS match query (remove special chars that break FTS syntax)
        const safeQuery = query.replace(/["'*]/g, ' ').trim()
        if (safeQuery) {
          let sqlText = `
            SELECT chunk_id, rank 
            FROM fts_chunks 
            WHERE notebook_id = ? AND fts_chunks MATCH ? 
          `
          const ftsParams: any[] = [notebookId, `"${safeQuery}" OR ${safeQuery}`]

          if (filteredChunkIds && filteredChunkIds.length > 0) {
            const placeholders = filteredChunkIds.map(() => '?').join(',')
            sqlText += ` AND chunk_id IN (${placeholders}) `
            ftsParams.push(...filteredChunkIds)
          }

          sqlText += ' ORDER BY rank LIMIT ?'
          ftsParams.push(retrievalCandidateLimit)

          ftsResults = sqlite.prepare(sqlText).all(...ftsParams) as any
        }
      } catch (error) {
        Logger.warn('KnowledgeService', 'FTS Search failed (likely syntax):', error)
      }
    }

    // 3. Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map<string, number>()
    const k = 60 // RRF constant

    // Add vector scores
    vectorResults.forEach((vr, index) => {
      const rank = index + 1
      rrfScores.set(vr.chunkId, 1 / (k + rank))
    })

    // Add FTS scores
    ftsResults.forEach((fr, index) => {
      const rank = index + 1
      const currentScore = rrfScores.get(fr.chunk_id) || 0
      rrfScores.set(fr.chunk_id, currentScore + 1 / (k + rank))
    })

    if (rrfScores.size === 0) return []

    const fusedRankedChunkIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1]) // highest score first
      .map(([chunkId]) => chunkId)

    const db = getDatabase()
    const rerankCandidateIds = fusedRankedChunkIds.slice(
      0,
      Math.min(rerankTopN, fusedRankedChunkIds.length)
    )
    let rerankMethod: 'provider' | 'heuristic' | 'none' = 'none'
    let rerankScores = new Map<string, number>()
    let finalRankedChunkIds = fusedRankedChunkIds

    if (rerankEnabled && rerankCandidateIds.length > 1) {
      const rerankRows = db
        .select({ id: chunks.id, content: chunks.content })
        .from(chunks)
        .where(inArray(chunks.id, rerankCandidateIds))
        .all()
      const rerankContentMap = new Map(rerankRows.map((row) => [row.id, row.content]))

      const rerankCandidates = rerankCandidateIds.map((chunkId) => ({
        id: chunkId,
        text: rerankContentMap.get(chunkId) || '',
        baseScore: rrfScores.get(chunkId) || 0
      }))

      const rerankOutcome = await this.rerankService.rerank(query, rerankCandidates, {
        enabled: true,
        topN: rerankTopN,
        model: rerankModel,
        heuristicFallback: rerankHeuristicFallback
      })
      rerankMethod = rerankOutcome.method
      rerankScores = rerankOutcome.scores

      const uniqueOrderedIds: string[] = []
      const seen = new Set<string>()
      for (const id of rerankOutcome.orderedIds) {
        if (!seen.has(id)) {
          uniqueOrderedIds.push(id)
          seen.add(id)
        }
      }

      for (const id of fusedRankedChunkIds) {
        if (!seen.has(id)) {
          uniqueOrderedIds.push(id)
          seen.add(id)
        }
      }

      finalRankedChunkIds = uniqueOrderedIds
    }

    const fusedChunkIds = finalRankedChunkIds.slice(0, topK)

    // 4. Fetch Expanded Context (Parent-Child Strategy)
    const chunkDetails = db.select().from(chunks).where(inArray(chunks.id, fusedChunkIds)).all()
    const documentIds = [...new Set(chunkDetails.map((c) => c.documentId))]
    const documentDetails = db
      .select()
      .from(documents)
      .where(inArray(documents.id, documentIds))
      .all()
    const documentMap = new Map(documentDetails.map((d) => [d.id, d]))

    // Get all chunks for these documents to support context expansion
    const allDocChunks = db
      .select()
      .from(chunks)
      .where(inArray(chunks.documentId, documentIds))
      .orderBy(chunks.chunkIndex)
      .all()

    const chunkListByDoc = new Map<string, (typeof chunks.$inferSelect)[]>()
    allDocChunks.forEach((c) => {
      if (!chunkListByDoc.has(c.documentId)) chunkListByDoc.set(c.documentId, [])
      chunkListByDoc.get(c.documentId)!.push(c)
    })

    const results: SearchResult[] = []

    // Create results mapping maintaining Fused Order
    for (const chunkId of fusedChunkIds) {
      const currentChunk = chunkDetails.find((c) => c.id === chunkId)
      if (!currentChunk) continue

      const doc = documentMap.get(currentChunk.documentId)
      const docChunks = chunkListByDoc.get(currentChunk.documentId) || []

      // Context expansion: Grab Prev + Current + Next chunk
      let expandedContent = currentChunk.content
      if (includeContent) {
        const cIndex = currentChunk.chunkIndex
        const prevChunk = docChunks.find((c) => c.chunkIndex === cIndex - 1)
        const nextChunk = docChunks.find((c) => c.chunkIndex === cIndex + 1)

        const contents: string[] = []
        if (prevChunk) contents.push(prevChunk.content)
        contents.push(currentChunk.content)
        if (nextChunk) contents.push(nextChunk.content)

        expandedContent = contents.join('\n...\n')
      }

      const result: SearchResult = {
        chunkId: currentChunk.id,
        documentId: currentChunk.documentId,
        documentTitle: doc?.title || 'Unknown',
        documentType: doc?.type || 'unknown',
        sourceUri: doc?.sourceUri || undefined,
        pageNumber: this.getPageNumberForChunk(
          (doc?.metadata as Record<string, unknown>) || undefined,
          currentChunk.startOffset,
          currentChunk.endOffset
        ),
        content: expandedContent,
        matchedContent: currentChunk.content,
        score: rerankScores.get(chunkId) ?? rrfScores.get(chunkId) ?? 0,
        chunkIndex: currentChunk.chunkIndex
      }
      if (currentChunk.metadata) result.metadata = currentChunk.metadata as Record<string, unknown>
      results.push(result)
    }

    Logger.debug('KnowledgeService', 'search_metrics', {
      notebookId,
      queryLength: query.length,
      topK,
      threshold,
      vectorCandidates: vectorResults.length,
      ftsCandidates: ftsResults.length,
      fusedCandidates: fusedRankedChunkIds.length,
      rerankEnabled,
      rerankMethod,
      rerankCandidates: rerankCandidateIds.length,
      returned: results.length,
      latencyMs: Date.now() - startedAt,
      filtered: !!filteredChunkIds
    })

    return results
  }

  getDocuments(notebookId: string): Document[] {
    const db = getDatabase()
    return db
      .select()
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .orderBy(desc(documents.updatedAt))
      .limit(50)
      .all()
  }

  getDocument(documentId: string): Document | undefined {
    const db = getDatabase()
    return db.select().from(documents).where(eq(documents.id, documentId)).get()
  }

  updateDocumentMetadata(documentId: string, metadata: DocumentMetadata): Document {
    const db = getDatabase()
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)

    const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
    db.update(documents)
      .set({
        metadata: {
          ...rootMetadata,
          documentMetadata: metadata,
          documentMetadataInspector: inspectorFromMetadata(metadata)
        },
        updatedAt: new Date()
      })
      .where(eq(documents.id, documentId))
      .run()

    return this.getDocument(documentId)!
  }

  getDocumentPageContent(
    documentId: string,
    pageNumber: number,
    highlightText?: string
  ): DocumentPageContent | undefined {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc || !doc.content) return undefined

    let pageContent = doc.content

    const structure = (doc.metadata as any)?.structure
    if (structure?.type === 'pages' && Array.isArray(structure.pages)) {
      const page = structure.pages.find((p: any) => p?.pageNumber === pageNumber)
      if (
        page &&
        typeof page.startOffset === 'number' &&
        typeof page.endOffset === 'number' &&
        page.endOffset > page.startOffset
      ) {
        pageContent = doc.content.slice(page.startOffset, page.endOffset)
      }
    }

    return {
      documentId: doc.id,
      documentTitle: doc.title,
      pageNumber,
      content: pageContent,
      sourceUri: doc.sourceUri || undefined,
      highlightText: highlightText?.trim() || undefined
    }
  }

  getDocumentChunks(documentId: string): Chunk[] {
    const db = getDatabase()
    return db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .orderBy(chunks.chunkIndex)
      .all()
  }

  async deleteDocument(documentId: string): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return

    const docChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    if (docChunks.length > 0) {
      const chunkIds = docChunks.map((c) => c.id)
      const vectorStore = await vectorStoreManager.getStore(doc.notebookId)
      await vectorStore.deleteByChunkIds(chunkIds)

      // Also delete from FTS5
      const sqlite = getSqlite()
      if (sqlite) {
        const placeholders = chunkIds.map(() => '?').join(',')
        sqlite
          .prepare(`DELETE FROM fts_chunks WHERE chunk_id IN (${placeholders})`)
          .run(...chunkIds)
      }
    }

    if (doc.localFilePath) await this.deleteLocalFile(doc.localFilePath)

    db.delete(documents).where(eq(documents.id, documentId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('KnowledgeService', `Document deleted: ${documentId}`)
  }

  /**
   * BUG-02 Fix: reindexDocument no longer calls addDocument (which would create a new document record).
   * It instead: deletes old chunks/embeddings, then calls _indexContent with the EXISTING documentId.
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc || !doc.content) throw new Error(`Document ${documentId} not found or has no content`)

    // 1. Delete old chunks from vector store
    const oldChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    if (oldChunks.length > 0) {
      const vectorStore = await vectorStoreManager.getStore(doc.notebookId)
      await vectorStore.deleteByChunkIds(oldChunks.map((c) => c.id))
      this.deleteFtsChunkIds(oldChunks.map((c) => c.id))
    }

    // 2. Delete old chunks + embeddings from DB
    db.delete(chunks).where(eq(chunks.documentId, documentId)).run()
    if (oldChunks.length > 0) {
      db.delete(embeddings)
        .where(
          inArray(
            embeddings.chunkId,
            oldChunks.map((c) => c.id)
          )
        )
        .run()
    }

    // 3. Reset status on EXISTING document record (no new record created!)
    db.update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 4. Re-index using existing documentId via shared _indexContent
    await this._indexContent(documentId, doc.notebookId, doc.content, undefined, onProgress)
  }

  /**
   * P-01 Fix: Optimized to a single aggregated query instead of 3 separate COUNT queries
   */
  getStats(notebookId: string): {
    documentCount: number
    chunkCount: number
    embeddingCount: number
  } {
    const db = getDatabase()

    const docCount = db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .get()

    const chunkCount = db
      .select({ count: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.notebookId, notebookId))
      .get()

    const embCount = db
      .select({ count: sql<number>`count(*)` })
      .from(embeddings)
      .where(eq(embeddings.notebookId, notebookId))
      .get()

    return {
      documentCount: docCount?.count || 0,
      chunkCount: chunkCount?.count || 0,
      embeddingCount: embCount?.count || 0
    }
  }
}
