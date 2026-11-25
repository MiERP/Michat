/**
 * KnowledgeService
 * Knowledge base facade: document management, chunking, embedding, retrieval
 *
 * The implementation is split into cohesive collaborators under `rag/`:
 * ingestion, index writing, index maintenance, retrieval, document records
 * and auto-sync. This class preserves the existing public API and wires the
 * shared service instances together.
 */

import { app } from 'electron'
import { join } from 'path'
import type { Chunk, Document } from '../db/schema'
import { EmbeddingService } from './EmbeddingService'
import { ChunkingService, type ChunkOptions, type ChunkStructureContext } from './ChunkingService'
import { FileParserService } from './FileParserService'
import { ParserWorkerClient } from './import/ParserWorkerClient'
import { SectionIndexService } from './rag/SectionIndexService'
import { MarkdownNormalizer } from './MarkdownNormalizer'
import { RerankService } from './RerankService'
import { ApiClient } from '../ai/apiClient'
import { DocumentMetadataIndexService } from './DocumentMetadataIndexService'
import type { DocumentMetadata } from './DocumentMetadataExtractionService'
import { WebFetchService } from './WebFetchService'
import { KnowledgeFileStore } from './rag/KnowledgeFileStore'
import { KnowledgeEmbeddingRuntime } from './rag/KnowledgeEmbeddingRuntime'
import {
  KnowledgeDocumentIndexer,
  type KnowledgeDocumentIndexerDeps
} from './rag/KnowledgeDocumentIndexer'
import { KnowledgeIngestionService } from './rag/KnowledgeIngestionService'
import { KnowledgeIndexMaintenance } from './rag/KnowledgeIndexMaintenance'
import { KnowledgeRetrievalService, computeMemoryDecay } from './rag/KnowledgeRetrievalService'
import { KnowledgeDocumentService } from './rag/KnowledgeDocumentService'
import { KnowledgeAutoSyncService } from './rag/KnowledgeAutoSyncService'
import type { MetadataAwareSearchResult } from '../../shared/types/retrieval'
import type {
  AddDocumentOptions,
  AutoSyncPayload,
  BatchIndexResult,
  DocumentPageContent,
  IncrementalReindexResult,
  IndexProgressCallback,
  SearchOptions,
  SearchResult
} from './rag/KnowledgeServiceTypes'

export type {
  AddDocumentOptions,
  AutoSyncPayload,
  BatchIndexResult,
  DocumentPageContent,
  IncrementalReindexResult,
  IndexProgressCallback,
  SearchMetadataFilter,
  SearchOptions,
  SearchResult
} from './rag/KnowledgeServiceTypes'

export type { DocumentStructureLike } from './rag/DocumentRetrievalMetadata'

export { buildFtsMatchQuery } from './rag/KnowledgeRetrievalService'

export class KnowledgeService {
  private embeddingService: EmbeddingService
  private webFetchService: WebFetchService
  private parserWorker: ParserWorkerClient
  private fileStore: KnowledgeFileStore
  private embeddingRuntime: KnowledgeEmbeddingRuntime
  private documentIndexer: KnowledgeDocumentIndexer
  private ingestionService: KnowledgeIngestionService
  private indexMaintenance: KnowledgeIndexMaintenance
  private retrievalService: KnowledgeRetrievalService
  private documentService: KnowledgeDocumentService
  private autoSyncService: KnowledgeAutoSyncService

  constructor(apiClient: ApiClient) {
    this.embeddingService = new EmbeddingService(apiClient)
    const chunkingService = new ChunkingService()
    const fileParserService = new FileParserService()
    this.parserWorker = new ParserWorkerClient()
    const rerankService = new RerankService()
    const sectionIndex = new SectionIndexService((texts) =>
      this.embeddingService.embedBatch(texts, { dimensions: 1024 })
    )
    const markdownNormalizer = new MarkdownNormalizer()
    const metadataIndexService = new DocumentMetadataIndexService()
    this.webFetchService = new WebFetchService()
    this.fileStore = new KnowledgeFileStore(join(app.getPath('userData'), 'knowledge-files'))
    this.embeddingRuntime = new KnowledgeEmbeddingRuntime(this.embeddingService)

    const documentIndexerDeps: KnowledgeDocumentIndexerDeps = {
      embeddingService: this.embeddingService,
      embeddingRuntime: this.embeddingRuntime,
      chunkingService,
      sectionIndex,
      metadataIndexService,
      markdownNormalizer,
      parserWorker: this.parserWorker,
      fileStore: this.fileStore
    }
    this.documentIndexer = new KnowledgeDocumentIndexer(documentIndexerDeps)

    this.autoSyncService = new KnowledgeAutoSyncService({
      fileStore: this.fileStore,
      reindexDocument: (documentId) => this.documentIndexer.reindexDocument(documentId)
    })

    this.ingestionService = new KnowledgeIngestionService({
      documentIndexer: this.documentIndexer,
      fileStore: this.fileStore,
      fileParserService,
      parserWorker: this.parserWorker,
      markdownNormalizer,
      webFetchService: this.webFetchService,
      emitAutoSync: (payload) => this.autoSyncService.emit(payload)
    })

    this.indexMaintenance = new KnowledgeIndexMaintenance({
      embeddingService: this.embeddingService,
      embeddingRuntime: this.embeddingRuntime,
      documentIndexer: this.documentIndexer,
      sectionIndex
    })

    this.retrievalService = new KnowledgeRetrievalService({
      embeddingService: this.embeddingService,
      embeddingRuntime: this.embeddingRuntime,
      rerankService,
      metadataIndexService
    })

    this.documentService = new KnowledgeDocumentService({
      documentIndexer: this.documentIndexer,
      fileStore: this.fileStore,
      metadataIndexService
    })

    this.fileStore.ensureDir()
  }

  /**
   * Verify that the embedding API is configured before indexing/searching.
   */
  async ensureEmbeddingReady(): Promise<void> {
    await this.embeddingRuntime.ensureReady()
  }

  /**
   * Actual embedding dimensions of the configured model. Used by the UI to
   * verify a selection before keeping a new model.
   */
  async probeEmbeddingDimensions(): Promise<number> {
    return this.embeddingRuntime.probeDimensions()
  }

  /**
   * Drop cached query embeddings and the memoized dimension probe. Must be
   * called after an API configuration change so the next rebuild validates
   * the new model/endpoint instead of trusting the old probe.
   */
  clearEmbeddingCache(): void {
    this.embeddingService.clearCache()
  }

  isManagedLocalFilePath(filePath: string): boolean {
    return this.fileStore.isManagedPath(filePath)
  }

  /**
   * Tears down the isolated parser process. Called from the app shutdown
   * barrier so a quit does not leave a utility process behind.
   */
  disposeFileParser(): void {
    this.parserWorker.dispose()
  }

  /**
   * Refresh the document-level vector (used after enrichment has a new
   * summary).
   */
  async refreshDocumentVector(documentId: string): Promise<void> {
    return this.documentIndexer.refreshDocumentVector(documentId)
  }

  /**
   * Re-embed chunks that do not have a vector yet (after the vector table was
   * rebuilt, or vectors were lost for any reason).
   */
  async rebuildMissingVectors(
    notebookId: string,
    limit = 200
  ): Promise<{ rebuilt: number; remaining: number; ftsRebuilt: number }> {
    return this.indexMaintenance.rebuildMissingVectors(notebookId, limit)
  }

  /**
   * Documents needing backfill: missing document vector, missing section
   * structure while content has headings, or sections without section rows.
   */
  findDocumentsNeedingBackfill(notebookId: string, limit = 5): string[] {
    return this.indexMaintenance.findDocumentsNeedingBackfill(notebookId, limit)
  }

  /**
   * Infer filter metadata from the question (number, type, issuer) and
   * compare it with stored metadata. Only returns an unambiguous filter.
   */
  detectMetadataFilter(notebookId: string, query: string): Record<string, string> | undefined {
    return this.retrievalService.detectMetadataFilter(notebookId, query)
  }

  /**
   * Rebuild the notebook when its stored vectors were produced by a different
   * embedding model than the one currently configured.
   */
  async ensureEmbeddingModelConsistency(
    notebookId: string
  ): Promise<{ rebuilt: boolean; documents: number }> {
    return this.indexMaintenance.ensureEmbeddingModelConsistency(notebookId)
  }

  /** True when stored vectors belong to a model other than the current one. */
  async hasStaleEmbeddingModel(notebookId: string): Promise<boolean> {
    return this.indexMaintenance.hasStaleEmbeddingModel(notebookId)
  }

  /**
   * Repairs durable indexes after an unexpected process stop.
   */
  async reconcileNotebookIndexes(
    notebookId: string
  ): Promise<{ interruptedDocuments: number; ftsRebuilt: number }> {
    return this.indexMaintenance.reconcileNotebookIndexes(notebookId)
  }

  /**
   * Add extracted legal metadata to chunk.metadata + FTS for documents
   * indexed before metadata-aware retrieval.
   */
  async backfillLegalMetadataToIndex(
    notebookId?: string
  ): Promise<{ documents: number; chunks: number }> {
    return this.indexMaintenance.backfillLegalMetadataToIndex(notebookId)
  }

  /**
   * Legal documents that lost metadata because of the old parser.
   */
  findDocumentsNeedingLegalMetadataReindex(limit = 10): string[] {
    return this.indexMaintenance.findDocumentsNeedingLegalMetadataReindex(limit)
  }

  async addDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    return this.ingestionService.addDocument(notebookId, options, onProgress)
  }

  async addDocumentFromFile(
    notebookId: string,
    filePath: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    return this.ingestionService.addDocumentFromFile(notebookId, filePath, onProgress)
  }

  /** Fetches a public web page, converts it to canonical Markdown, then sends it
   * through the same structure/chunk/vector/FTS pipeline as uploaded files. */
  async addDocumentFromUrl(
    notebookId: string,
    url: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    return this.ingestionService.addDocumentFromUrl(notebookId, url, onProgress)
  }

  async addDocumentsFromFolder(
    notebookId: string,
    folderPath: string,
    onProgress?: IndexProgressCallback
  ): Promise<BatchIndexResult> {
    return this.ingestionService.addDocumentsFromFolder(notebookId, folderPath, onProgress)
  }

  async addNoteToKnowledge(
    notebookId: string,
    noteId: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    return this.ingestionService.addNoteToKnowledge(notebookId, noteId, onProgress)
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
    return this.ingestionService.storeSessionMemory(notebookId, sessionId, summary, sessionTitle)
  }

  /**
   * Memory decay formula: 30-day half-life. Older memories carry less weight
   * during search.
   */
  static memoryDecay(updatedAt: Date | null, now: Date = new Date()): number {
    return computeMemoryDecay(updatedAt, now)
  }

  /**
   * Record user feedback on a chunk (feedback loop).
   * kind: citation_good (+15%), citation_bad (-30%), user_correction (-50%)
   */
  recordChunkFeedback(
    notebookId: string,
    chunkId: string,
    kind: 'citation_good' | 'citation_bad' | 'user_correction',
    note?: string
  ): void {
    this.documentService.recordChunkFeedback(notebookId, chunkId, kind, note)
  }

  /**
   * Mark the document lifecycle (draft/verified/outdated) — affects retrieval
   * weight (outdated ×0.4, verified ×1.1).
   */
  setDocumentLifecycle(documentId: string, state: 'draft' | 'verified' | 'outdated'): Document {
    return this.documentService.setDocumentLifecycle(documentId, state)
  }

  /**
   * Metadata-aware orchestration. Explicit scope and a uniquely identified
   * document are hard constraints; all other inferred metadata gets a
   * preferred pass followed by a broad pass, preserving recall.
   */
  async searchMetadataAware(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<MetadataAwareSearchResult<SearchResult>> {
    return this.retrievalService.searchMetadataAware(notebookId, query, options)
  }

  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    return this.retrievalService.search(notebookId, query, options)
  }

  getDocuments(notebookId: string): Document[] {
    return this.documentService.getDocuments(notebookId)
  }

  /**
   * Read indexed content (documents + chunks) for derivative pipelines.
   */
  getIndexedDocumentsWithChunks(
    notebookId: string,
    options: {
      documentIds?: string[]
      docsLimit?: number
      chunksPerDoc?: number
      spreadChunks?: boolean
    } = {}
  ): Array<{ id: string; title: string; chunks: Array<{ id: string; content: string }> }> {
    return this.documentService.getIndexedDocumentsWithChunks(notebookId, options)
  }

  getDocument(documentId: string): Document | undefined {
    return this.documentService.getDocument(documentId)
  }

  /**
   * Sync the retrieval metadata projection into the relational table, chunk
   * metadata and FTS. Called after every metadata/enrichment change.
   */
  syncDocumentRetrievalMetadata(documentId: string): void {
    this.documentService.syncDocumentRetrievalMetadata(documentId)
  }

  updateDocumentMetadata(documentId: string, metadata: DocumentMetadata): Document {
    return this.documentService.updateDocumentMetadata(documentId, metadata)
  }

  refreshDocumentMetadata(documentId: string): Document {
    return this.documentService.refreshDocumentMetadata(documentId)
  }

  getDocumentPageContent(
    documentId: string,
    pageNumber: number,
    highlightText?: string
  ): DocumentPageContent | undefined {
    return this.documentService.getDocumentPageContent(documentId, pageNumber, highlightText)
  }

  getDocumentChunks(documentId: string): Chunk[] {
    return this.documentService.getDocumentChunks(documentId)
  }

  async deleteDocument(documentId: string): Promise<void> {
    return this.documentService.deleteDocument(documentId)
  }

  /**
   * Reparse and reindex an existing document without creating a new record.
   * When chunks exist, use an incremental contentHash diff.
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    return this.documentIndexer.reindexDocument(documentId, onProgress)
  }

  /**
   * Incremental reindex: chunk diff by contentHash against existing chunks.
   */
  async reindexDocumentIncremental(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<IncrementalReindexResult> {
    return this.documentIndexer.reindexDocumentIncremental(
      documentId,
      notebookId,
      content,
      chunkOptions,
      structure,
      onProgress
    )
  }

  /**
   * Sync an edited note into the KB (called from noteHandlers after
   * update-note).
   */
  async syncNoteToKnowledge(noteId: string): Promise<void> {
    return this.ingestionService.syncNoteToKnowledge(noteId)
  }

  /**
   * Delete KB documents linked to a deleted note.
   */
  async deleteDocumentsBySourceNote(noteId: string): Promise<void> {
    return this.documentService.deleteDocumentsBySourceNote(noteId)
  }

  // ==================== Auto-sync (watcher) ====================

  /**
   * Enable auto-sync: watch knowledge-files/ plus the original source file of
   * each file document. When a file changes → incremental reindex.
   */
  startAutoSync(callback?: (payload: AutoSyncPayload) => void): void {
    this.autoSyncService.startAutoSync(callback)
  }

  stopAutoSync(): void {
    this.autoSyncService.stopAutoSync()
  }

  /**
   * Attach a watcher to the original source file (when the user edits the
   * file outside the app).
   */
  watchSourceFile(doc: Document): void {
    this.autoSyncService.watchSourceFile(doc)
  }

  /**
   * Aggregate stats for a notebook.
   */
  getStats(notebookId: string): {
    documentCount: number
    chunkCount: number
    embeddingCount: number
  } {
    return this.documentService.getStats(notebookId)
  }
}
