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
import { RerankService } from './RerankService'
import {
  buildLegalChunkPrefix,
  buildLegalDocumentProfile,
  getLegalContextAt,
  parseLegalStructure,
  type LegalDocumentStructure
} from './LegalStructureService'
import {
  buildLegalDocumentMetadata,
  getCanonicalLegalWorkKey,
  getLegalDocumentMetadata,
  type LegalDocumentMetadata
} from './LegalComparisonService'
import {
  extractLegalMetadataFromDocument,
  materializeLegalDocumentMetadata,
  mergeLegalMetadataInspector,
  type LegalMetadataInspector
} from './LegalMetadataExtractionService'
import { vectorStoreManager } from '../vectorstore'
import { ProviderManager } from '../providers/ProviderManager'
import Logger from '../../shared/utils/logger'
import { isPathInsideDirectory } from '../security/guards'
import type { LegalGraphDocumentStatus } from '../../shared/types/legalReasoning'
import type { LegalGraphRepository } from './legalGraph/LegalGraphRepository'
import { findLegalModalityHints } from './legalGraph/LegalModalityService'
import { expandVietnameseLegalQuery } from './VietnameseLegalQueryService'

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
  documentMetadata?: Record<string, unknown>
}

export interface DocumentPageContent {
  documentId: string
  documentTitle: string
  pageNumber: number
  content: string
  sourceUri?: string
  highlightText?: string
}

export function buildFtsMatchQuery(query: string): string {
  const terms = query.normalize('NFC').match(/[\p{L}\p{N}_]+/gu) || []
  return terms.map((term) => '"' + term + '"').join(' OR ')
}

export function collapseCanonicalSearchResults(
  results: SearchResult[],
  topK: number
): SearchResult[] {
  const ownerByCoordinate = new Map<string, string>()
  const collapsed: SearchResult[] = []

  for (const result of results.slice().sort((left, right) => right.score - left.score)) {
    const canonicalKey =
      typeof result.documentMetadata?.canonicalLegalWorkKey === 'string'
        ? result.documentMetadata.canonicalLegalWorkKey
        : getCanonicalLegalWorkKey(getLegalDocumentMetadata(result.documentMetadata))
    if (canonicalKey) {
      const legalContext = result.metadata?.legalContext as Record<string, string> | undefined
      const coordinateKey = [
        canonicalKey,
        legalContext?.articleNumber || '',
        legalContext?.clauseNumber || '',
        legalContext?.pointNumber || ''
      ].join(':')
      const ownerDocumentId = ownerByCoordinate.get(coordinateKey)
      if (ownerDocumentId && ownerDocumentId !== result.documentId) continue
      ownerByCoordinate.set(coordinateKey, result.documentId)
    }
    collapsed.push(result)
    if (collapsed.length >= topK) break
  }

  return collapsed
}

export type IndexProgressCallback = (stage: string, progress: number) => void

const MIN_PROVIDER_RERANK_SCORE = 0.2
const MIN_HEURISTIC_RERANK_SCORE = 0.15

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
  private notebookSourcesChangedListener?: (notebookId: string) => void
  private legalGraphRepository?: LegalGraphRepository

  constructor(providerManager: ProviderManager, legalGraphRepository?: LegalGraphRepository) {
    this.embeddingService = new EmbeddingService(providerManager)
    this.chunkingService = new ChunkingService()
    this.fileParserService = new FileParserService()
    this.rerankService = new RerankService(providerManager)
    this.legalGraphRepository = legalGraphRepository
    this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
    this.ensureKnowledgeFilesDir()
    this.backfillCanonicalLegalIdentity()
  }

  private backfillCanonicalLegalIdentity(): void {
    const db = getDatabase()
    const indexedDocuments = db
      .select()
      .from(documents)
      .all()
      .filter((document) => document.status === 'indexed')
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    const canonicalGroups = new Map<string, Array<{ document: Document; metadata: Record<string, unknown> }>>()

    for (const document of indexedDocuments) {
      const metadata = { ...((document.metadata as Record<string, unknown> | null) || {}) }
      if (!metadata.legalStructure && !metadata.legalDocument && !metadata.legalMetadataInspector) {
        continue
      }
      const chunkContent = db
        .select({ content: chunks.content })
        .from(chunks)
        .where(eq(chunks.documentId, document.id))
        .all()
        .map((chunk) => chunk.content)
        .join('\n')
      const extracted = extractLegalMetadataFromDocument({
        title: document.title,
        content: document.content || chunkContent,
        structure: metadata.legalStructure as LegalDocumentStructure | undefined
      })
      const inspector = mergeLegalMetadataInspector(
        extracted.inspector,
        metadata.legalMetadataInspector as LegalMetadataInspector | undefined
      )
      const legalDocument = materializeLegalDocumentMetadata(
        inspector,
        getLegalDocumentMetadata(metadata)
      )
      const canonicalLegalWorkKey = getCanonicalLegalWorkKey(legalDocument)
      if (!canonicalLegalWorkKey) continue

      metadata.legalMetadataInspector = inspector
      metadata.legalDocument = legalDocument
      metadata.canonicalLegalWorkKey = canonicalLegalWorkKey
      metadata.duplicateGroup = canonicalLegalWorkKey
      const groupKey = `${document.notebookId}:${canonicalLegalWorkKey}`
      const group = canonicalGroups.get(groupKey) || []
      group.push({ document, metadata })
      canonicalGroups.set(groupKey, group)
    }

    for (const group of canonicalGroups.values()) {
      const canonicalDocumentId = group[0].document.id
      for (const entry of group) {
        entry.metadata.canonicalGraphDocumentId = canonicalDocumentId
        db.update(documents)
          .set({ metadata: entry.metadata })
          .where(eq(documents.id, entry.document.id))
          .run()
        if (entry.document.id !== canonicalDocumentId && this.legalGraphRepository) {
          this.legalGraphRepository.deleteDocumentGraph(entry.document.id)
        }
      }
    }
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

  private findLegalProfileResults(
    notebookId: string,
    filteredChunkIds: string[] | null,
    topK: number
  ): SearchResult[] {
    const db = getDatabase()
    const profileChunks = db
      .select()
      .from(chunks)
      .where(and(eq(chunks.notebookId, notebookId), eq(chunks.chunkIndex, -1)))
      .all()
      .filter((chunk) => {
        if (filteredChunkIds && !filteredChunkIds.includes(chunk.id)) return false
        return (chunk.metadata as Record<string, unknown> | null)?.kind === 'legal-profile'
      })
      .slice(0, topK)

    if (profileChunks.length === 0) return []

    const documentMap = new Map(
      db
        .select()
        .from(documents)
        .where(
          inArray(
            documents.id,
            profileChunks.map((chunk) => chunk.documentId)
          )
        )
        .all()
        .map((document) => [document.id, document])
    )

    return profileChunks.map((chunk) => {
      const document = documentMap.get(chunk.documentId)
      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: document?.title || 'Unknown',
        documentType: document?.type || 'unknown',
        sourceUri: document?.sourceUri || undefined,
        content: chunk.content,
        matchedContent: chunk.content,
        score: 1,
        chunkIndex: chunk.chunkIndex,
        metadata: (chunk.metadata as Record<string, unknown>) || undefined,
        documentMetadata: (document?.metadata as Record<string, unknown>) || undefined
      }
    })
  }

  private findLegalArticleResults(
    notebookId: string,
    filteredChunkIds: string[] | null,
    articleNumbers: string[]
  ): SearchResult[] {
    const db = getDatabase()
    const articleOrder = new Map(articleNumbers.map((number, index) => [number, index]))
    const articleChunks = db
      .select()
      .from(chunks)
      .where(eq(chunks.notebookId, notebookId))
      .all()
      .filter((chunk) => {
        if (filteredChunkIds && !filteredChunkIds.includes(chunk.id)) return false
        const metadata = chunk.metadata as Record<string, any> | null
        const legalContext = metadata?.legalContext as Record<string, string> | undefined
        const articleNumber = legalContext?.articleNumber
        return (
          metadata?.kind === 'legal-content' && !!articleNumber && articleOrder.has(articleNumber)
        )
      })
      .sort((left, right) => {
        const leftContext = (left.metadata as Record<string, any>).legalContext as Record<
          string,
          string
        >
        const rightContext = (right.metadata as Record<string, any>).legalContext as Record<
          string,
          string
        >
        const articleDifference =
          (articleOrder.get(leftContext.articleNumber) || 0) -
          (articleOrder.get(rightContext.articleNumber) || 0)
        return articleDifference || left.chunkIndex - right.chunkIndex
      })

    if (articleChunks.length === 0) return []

    const documentMap = new Map(
      db
        .select()
        .from(documents)
        .where(
          inArray(
            documents.id,
            articleChunks.map((chunk) => chunk.documentId)
          )
        )
        .all()
        .map((document) => [document.id, document])
    )

    return articleChunks.map((chunk) => {
      const document = documentMap.get(chunk.documentId)
      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: document?.title || 'Unknown',
        documentType: document?.type || 'unknown',
        sourceUri: document?.sourceUri || undefined,
        content: chunk.content,
        matchedContent: chunk.content,
        score: 1,
        chunkIndex: chunk.chunkIndex,
        metadata: (chunk.metadata as Record<string, unknown>) || undefined,
        documentMetadata: (document?.metadata as Record<string, unknown>) || undefined
      }
    })
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
    const vectorDimensions = db
      .select({ dimensions: embeddings.dimensions })
      .from(embeddings)
      .where(inArray(embeddings.chunkId, chunkIds))
      .all()
    for (const dimensions of new Set(vectorDimensions.map((row) => row.dimensions))) {
      const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, dimensions)
      await vectorStore.deleteByChunkIds(chunkIds)
    }
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
    if (!document) throw new Error(`Document ${documentId} not found`)
    const legalStructure = parseLegalStructure(content)
    const documentMetadata = {
      ...((document.metadata as Record<string, unknown>) || {})
    }
    delete documentMetadata.legalStructure

    const extractedLegalMetadata = extractLegalMetadataFromDocument({
      title: document.title,
      content,
      structure: legalStructure
    })
    const hasExtractedFields = Object.values(extractedLegalMetadata.inspector.fields).some(Boolean)
    const shouldStoreLegalMetadata =
      legalStructure || hasExtractedFields || !!documentMetadata.legalMetadataInspector
    if (shouldStoreLegalMetadata) {
      const inspector = mergeLegalMetadataInspector(
        extractedLegalMetadata.inspector,
        documentMetadata.legalMetadataInspector as LegalMetadataInspector | undefined
      )
      documentMetadata.legalMetadataInspector = inspector
      const legalDocument = materializeLegalDocumentMetadata(
        inspector,
        getLegalDocumentMetadata(documentMetadata)
      )
      documentMetadata.legalDocument = legalDocument
      const canonicalLegalWorkKey = getCanonicalLegalWorkKey(legalDocument)
      if (canonicalLegalWorkKey) {
        const canonicalDocument = db
          .select()
          .from(documents)
          .where(eq(documents.notebookId, notebookId))
          .all()
          .find((candidate) => {
            if (candidate.id === documentId) return false
            const metadata = (candidate.metadata as Record<string, unknown>) || {}
            return (
              metadata.canonicalLegalWorkKey === canonicalLegalWorkKey ||
              getCanonicalLegalWorkKey(getLegalDocumentMetadata(metadata)) === canonicalLegalWorkKey
            )
          })
        const canonicalMetadata =
          (canonicalDocument?.metadata as Record<string, unknown> | undefined) || {}
        documentMetadata.canonicalLegalWorkKey = canonicalLegalWorkKey
        documentMetadata.duplicateGroup = canonicalLegalWorkKey
        documentMetadata.canonicalGraphDocumentId =
          (canonicalMetadata.canonicalGraphDocumentId as string | undefined) ||
          canonicalDocument?.id ||
          documentId
      }
    }

    if (
      legalStructure ||
      'legalStructure' in ((document.metadata as Record<string, unknown>) || {}) ||
      shouldStoreLegalMetadata
    ) {
      db.update(documents)
        .set({
          metadata: {
            ...documentMetadata,
            ...(legalStructure ? { legalStructure } : {})
          },
          updatedAt: now
        })
        .where(eq(documents.id, documentId))
        .run()
      this.resolveDeclaredLegalRelations(notebookId)
    }

    // 1. Chunk
    onProgress?.('chunking', 10)
    const rawChunkResults = legalStructure
      ? this.chunkLegalContent(content, chunkOptions, legalStructure)
      : this.chunkingService.chunk(content, chunkOptions)
    const chunkResults = this.addLegalStructureToChunks(
      rawChunkResults,
      document.title,
      legalStructure
    )
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
      undefined,
      (completed, total) => {
        onProgress?.('generating_embeddings', Math.round(30 + (completed / total) * 50))
      }
    )

    const detectedDimensions = embeddingResults.length > 0 ? embeddingResults[0].dimensions : 1024
    if (embeddingResults.length > 0) {
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

    const canonicalGraphDocumentId = documentMetadata.canonicalGraphDocumentId as
      | string
      | undefined
    if (
      legalStructure &&
      this.legalGraphRepository &&
      (!canonicalGraphDocumentId || canonicalGraphDocumentId === documentId)
    ) {
      try {
        this.legalGraphRepository.enqueueDocument(documentId, notebookId)
      } catch (error) {
        Logger.warn('KnowledgeService', 'Failed to enqueue legal graph extraction:', error)
      }
    }

    executeCheckpoint('PASSIVE')
    onProgress?.('completed', 100)
    Logger.info(
      'KnowledgeService',
      `Document indexed: ${documentId}, ${chunkResults.length} chunks`
    )
  }

  private addLegalStructureToChunks(
    chunkResults: ReturnType<ChunkingService['chunk']>,
    documentTitle: string,
    legalStructure: LegalDocumentStructure | undefined
  ): ReturnType<ChunkingService['chunk']> {
    if (!legalStructure) return chunkResults

    const profileContent = buildLegalDocumentProfile(documentTitle, legalStructure)
    const profileChunk = {
      content: profileContent,
      index: -1,
      startOffset: 0,
      endOffset: 0,
      tokenCount: Math.ceil(profileContent.length / 4),
      metadata: {
        kind: 'legal-profile',
        legalStructure
      }
    }

    return [
      profileChunk,
      ...chunkResults.map((chunk) => {
        const legalContext = getLegalContextAt(legalStructure, chunk.startOffset)
        legalContext.modalities = findLegalModalityHints(chunk.content, chunk.startOffset)
        const prefix = buildLegalChunkPrefix(legalContext)
        const content = prefix ? `${prefix}\n\n${chunk.content}` : chunk.content

        return {
          ...chunk,
          content,
          tokenCount: Math.ceil(content.length / 4),
          metadata: {
            ...(chunk.metadata || {}),
            kind: 'legal-content',
            legalContext
          }
        }
      })
    ]
  }

  private chunkLegalContent(
    content: string,
    chunkOptions: ChunkOptions | undefined,
    legalStructure: LegalDocumentStructure
  ): ReturnType<ChunkingService['chunk']> {
    const legalChunks: ReturnType<ChunkingService['chunk']> = []

    for (let articleIndex = 0; articleIndex < legalStructure.articles.length; articleIndex++) {
      const article = legalStructure.articles[articleIndex]
      const nextArticle = legalStructure.articles[articleIndex + 1]
      const articleEndOffset = nextArticle?.startOffset ?? content.length
      const articleContent = content.slice(article.startOffset, articleEndOffset)
      const articleChunks = this.chunkingService.chunk(articleContent, {
        ...chunkOptions,
        minChunkSize: 1
      })

      for (const articleChunk of articleChunks) {
        legalChunks.push({
          ...articleChunk,
          index: legalChunks.length,
          startOffset: article.startOffset + articleChunk.startOffset,
          endOffset: article.startOffset + articleChunk.endOffset
        })
      }
    }

    return legalChunks
  }

  setNotebookSourcesChangedListener(listener: (notebookId: string) => void): void {
    this.notebookSourcesChangedListener = listener
  }

  private markNotebookOverviewStale(notebookId: string): void {
    try {
      this.notebookSourcesChangedListener?.(notebookId)
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to mark notebook overview stale:', error)
    }
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
      this.markNotebookOverviewStale(notebookId)
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
      this.markNotebookOverviewStale(notebookId)
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

    const articleNumbers = this.getLegalArticleNumbers(query)
    const directResults: SearchResult[] = []

    if (this.isLegalStructureQuery(query)) {
      const profileLimit = articleNumbers.length > 0 ? 1 : topK
      directResults.push(
        ...this.findLegalProfileResults(notebookId, filteredChunkIds, profileLimit)
      )
    }

    if (articleNumbers.length > 0) {
      directResults.push(
        ...this.findLegalArticleResults(
          notebookId,
          filteredChunkIds,
          articleNumbers
        )
      )
    }

    if (directResults.length > 0) {
      return collapseCanonicalSearchResults(
        directResults,
        Math.max(topK, directResults.length)
      )
    }

    // 1. Vector Search
    const queryEmbedding = await this.embeddingService.embed(query)
    const vectorStore = await vectorStoreManager.getStore(
      notebookId,
      undefined,
      queryEmbedding.dimensions
    )
    const vectorResults = await vectorStore.query(queryEmbedding.embedding, {
      topK: retrievalCandidateLimit,
      threshold,
      filter: filteredChunkIds ? { chunkIds: filteredChunkIds } : undefined
    }) // Fetch more for RRF

    // 2. FTS5 BM25 Search (Keyword search)
    let ftsResults: Array<{ chunk_id: string; rank: number }> = []
    if (sqlite) {
      try {
        const ftsQuery = expandVietnameseLegalQuery(query)
          .map(buildFtsMatchQuery)
          .filter(Boolean)
          .join(' OR ')
        if (ftsQuery) {
          let sqlText = `
            SELECT chunk_id, rank 
            FROM fts_chunks 
            WHERE notebook_id = ? AND fts_chunks MATCH ? 
          `
          const ftsParams: any[] = [notebookId, ftsQuery]

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

    if (rerankCandidateIds.length > 0) {
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
        localOnly: !rerankEnabled,
        topN: rerankTopN,
        model: rerankModel,
        heuristicFallback: rerankEnabled ? rerankHeuristicFallback : true
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

    const minimumRerankScore =
      rerankMethod === 'provider'
        ? MIN_PROVIDER_RERANK_SCORE
        : rerankMethod === 'heuristic'
          ? MIN_HEURISTIC_RERANK_SCORE
          : undefined
    const relevantRankedChunkIds =
      minimumRerankScore == null
        ? finalRankedChunkIds
        : finalRankedChunkIds.filter(
            (chunkId) =>
              (rerankScores.get(chunkId) ?? Number.NEGATIVE_INFINITY) >= minimumRerankScore
          )
    const fusedChunkIds = relevantRankedChunkIds.slice(0, Math.max(topK, topK * 3))
    if (fusedChunkIds.length === 0) return []

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
      if (doc?.metadata) result.documentMetadata = doc.metadata as Record<string, unknown>
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
      retainedCandidates: fusedChunkIds.length,
      returned: results.length,
      latencyMs: Date.now() - startedAt,
      filtered: !!filteredChunkIds
    })

    return collapseCanonicalSearchResults(results, topK)
  }

  private isLegalStructureQuery(query: string): boolean {
    const normalized = query.normalize('NFC').toLowerCase()
    const legalUnit = /\b(chương|mục|điều)\b/u.test(normalized)
    const countQuestion = /\b(bao\s+nhiêu|mấy|số\s+lượng|tổng\s+số)\b/u.test(normalized)
    const outlineQuestion = /\b(mục\s*lục|cấu\s*trúc|bố\s*cục|danh\s*mục)\b/u.test(normalized)

    return legalUnit && (countQuestion || outlineQuestion)
  }

  private getLegalArticleNumbers(query: string): string[] {
    const articleNumbers = new Set<string>()
    const pattern = /(?:^|[^\p{L}\p{N}_])điều\s+(\d+[a-z]?)(?=$|[^\p{L}\p{N}_])/giu

    for (const match of query.normalize('NFC').matchAll(pattern)) {
      articleNumbers.add(match[1].toUpperCase())
    }

    return Array.from(articleNumbers)
  }

  getLegalGraphStatus(documentId: string): LegalGraphDocumentStatus {
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)
    const metadata = document.metadata as Record<string, unknown> | null
    const graphDocumentId =
      (metadata?.canonicalGraphDocumentId as string | undefined) || documentId
    return (
      this.legalGraphRepository?.getDocumentGraphStatus(graphDocumentId) ?? {
        status: 'unavailable',
        attempts: 0,
        sourceUnitCount: 0,
        processedUnitCount: 0,
        nodeCount: 0,
        relationCount: 0
      }
    )
  }

  retryLegalGraph(documentId: string): void {
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)
    if (!this.legalGraphRepository) throw new Error('Legal graph service is unavailable')
    const metadata = document.metadata as Record<string, unknown> | null
    if (!metadata?.legalStructure) throw new Error('Document has no legal structure')
    const graphDocumentId =
      (metadata.canonicalGraphDocumentId as string | undefined) || documentId

    if (this.legalGraphRepository.getDocumentGraphStatus(graphDocumentId).status === 'unavailable') {
      this.legalGraphRepository.enqueueDocument(graphDocumentId, document.notebookId)
      return
    }
    this.legalGraphRepository.retryDocument(graphDocumentId)
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

  updateLegalDocumentMetadata(documentId: string, metadata: LegalDocumentMetadata): Document {
    const db = getDatabase()
    const document = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!document) throw new Error(`Document ${documentId} not found`)

    const currentMetadata = (document.metadata as Record<string, unknown>) || {}
    const currentLegalDocument = getLegalDocumentMetadata(currentMetadata)
    const legalDocument = buildLegalDocumentMetadata(metadata)
    const currentInspector = currentMetadata.legalMetadataInspector as
      | LegalMetadataInspector
      | undefined
    const inspector: LegalMetadataInspector = currentInspector || {
      version: 1,
      extractedAt: new Date().toISOString(),
      fields: {},
      declaredRelations: []
    }
    const fields = { ...inspector.fields }
    const editableFields: Array<
      [keyof LegalMetadataInspector['fields'], string | undefined, string | undefined]
    > = [
      ['documentNumber', currentLegalDocument.documentNumber, legalDocument.documentNumber],
      ['documentType', currentLegalDocument.documentType, legalDocument.documentType],
      ['issuer', currentLegalDocument.issuer, legalDocument.issuer],
      ['documentTitle', currentLegalDocument.documentTitle, legalDocument.documentTitle],
      ['legalBases', currentLegalDocument.legalBases, legalDocument.legalBases],
      ['issuedAt', currentLegalDocument.issuedAt, legalDocument.issuedAt],
      ['effectiveFrom', currentLegalDocument.effectiveFrom, legalDocument.effectiveFrom],
      ['effectiveTo', currentLegalDocument.effectiveTo, legalDocument.effectiveTo],
      ['status', currentLegalDocument.status, legalDocument.status],
      ['scope', currentLegalDocument.scope, legalDocument.scope],
      ['sourceAuthority', currentLegalDocument.sourceAuthority, legalDocument.sourceAuthority],
      [
        'officialSourceUrl',
        currentLegalDocument.officialSourceUrl,
        legalDocument.officialSourceUrl
      ],
      ['verifiedAt', currentLegalDocument.verifiedAt, legalDocument.verifiedAt],
      ['verifiedBy', currentLegalDocument.verifiedBy, legalDocument.verifiedBy]
    ]
    for (const [name, previousValue, nextValue] of editableFields) {
      if (nextValue === previousValue || !nextValue) continue
      Object.assign(fields, {
        [name]: {
          value: nextValue,
          status: 'user_corrected',
          confidence: 1
        }
      })
    }
    db.update(documents)
      .set({
        metadata: {
          ...currentMetadata,
          legalDocument,
          legalMetadataInspector: { ...inspector, fields }
        },
        updatedAt: new Date()
      })
      .where(eq(documents.id, documentId))
      .run()

    this.resolveDeclaredLegalRelations(document.notebookId)

    const updated = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!updated) throw new Error(`Document ${documentId} disappeared during metadata update`)
    return updated
  }

  private resolveDeclaredLegalRelations(notebookId: string): void {
    const db = getDatabase()
    const notebookDocuments = db
      .select()
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .all()
    const documentIdsByNumber = new Map<string, string | null>()

    for (const document of notebookDocuments) {
      const number = getLegalDocumentMetadata(document.metadata).documentNumber?.toLocaleUpperCase(
        'vi-VN'
      )
      if (!number) continue
      documentIdsByNumber.set(number, documentIdsByNumber.has(number) ? null : document.id)
    }

    const metadataByDocumentId = new Map(
      notebookDocuments.map((document) => [
        document.id,
        { ...((document.metadata as Record<string, unknown>) || {}) }
      ])
    )

    for (const [documentId, metadata] of metadataByDocumentId) {
      const legalDocument = getLegalDocumentMetadata(metadata)
      metadata.legalDocument = {
        ...legalDocument,
        amendsDocumentIds: [],
        replacesDocumentIds: [],
        repealedByDocumentIds: []
      }
      metadataByDocumentId.set(documentId, metadata)
    }

    for (const sourceDocument of notebookDocuments) {
      const sourceMetadata = metadataByDocumentId.get(sourceDocument.id)!
      const inspector = sourceMetadata.legalMetadataInspector as LegalMetadataInspector | undefined
      if (!inspector?.declaredRelations.length) continue
      const sourceLegalDocument = getLegalDocumentMetadata(sourceMetadata)

      for (const relation of inspector.declaredRelations) {
        const targetDocumentId = documentIdsByNumber.get(
          relation.targetDocumentNumber.toLocaleUpperCase('vi-VN')
        )
        if (!targetDocumentId || targetDocumentId === sourceDocument.id) continue

        if (relation.type === 'amends') {
          sourceLegalDocument.amendsDocumentIds = [
            ...new Set([...sourceLegalDocument.amendsDocumentIds, targetDocumentId])
          ]
        } else if (relation.type === 'replaces') {
          sourceLegalDocument.replacesDocumentIds = [
            ...new Set([...sourceLegalDocument.replacesDocumentIds, targetDocumentId])
          ]
        } else {
          const targetMetadata = metadataByDocumentId.get(targetDocumentId)!
          const targetLegalDocument = getLegalDocumentMetadata(targetMetadata)
          targetLegalDocument.repealedByDocumentIds = [
            ...new Set([...targetLegalDocument.repealedByDocumentIds, sourceDocument.id])
          ]
          targetMetadata.legalDocument = targetLegalDocument
        }
      }

      sourceMetadata.legalDocument = sourceLegalDocument
    }

    for (const document of notebookDocuments) {
      const metadata = metadataByDocumentId.get(document.id)!
      if (JSON.stringify(metadata) === JSON.stringify(document.metadata || {})) continue
      db.update(documents)
        .set({ metadata, updatedAt: new Date() })
        .where(eq(documents.id, document.id))
        .run()
    }
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

    this.legalGraphRepository?.deleteDocumentGraph(documentId)

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
    this.markNotebookOverviewStale(doc.notebookId)
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
    let content = doc.content
    let chunkOptions: ChunkOptions | undefined

    // ponytail: content reindex invalidates graph because citations change; add staged chunk versions only if zero-gap graph availability becomes required.
    this.legalGraphRepository?.deleteDocumentGraph(documentId)

    if (doc.localFilePath) {
      const parseResult = await this.fileParserService.parseFile(doc.localFilePath)
      const structureMetadata = this.buildCompactStructureMetadata(
        parseResult.structure as
          | {
              type: 'flat' | 'pages' | 'sections'
              pages?: Array<{ pageNumber: number; startOffset: number; endOffset: number }>
            }
          | undefined
      )
      content = parseResult.content
      chunkOptions = this.buildChunkOptionsForMimeType(parseResult.mimeType)
      db.update(documents)
        .set({
          title: parseResult.title || doc.title,
          content,
          contentHash: createHash('md5').update(content).digest('hex'),
          mimeType: parseResult.mimeType,
          metadata: {
            ...((doc.metadata as Record<string, unknown>) || {}),
            ...(parseResult.metadata || {}),
            ...(structureMetadata || {})
          },
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()
    }

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
    await this._indexContent(documentId, doc.notebookId, content, chunkOptions, onProgress)
    this.markNotebookOverviewStale(doc.notebookId)
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
