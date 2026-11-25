/**
 * Write side of the knowledge index.
 *
 * Owns the shared chunk/section/embedding/FTS pipeline used by ingestion and
 * reindexing, plus the cleanup primitives shared with maintenance. Reads and
 * retrieval stay out of this module so the write path has a single owner.
 */

import { createHash, randomUUID } from 'crypto'
import { readFile, stat } from 'fs/promises'
import { eq, inArray } from 'drizzle-orm'
import { executeCheckpoint, getDatabase, getSqlite } from '../../db'
import {
  chunks,
  documents,
  embeddings,
  sections,
  type Chunk,
  type NewChunk,
  type NewEmbedding
} from '../../db/schema'
import { documentVectorStore, sectionVectorStore, vectorStoreManager } from '../../vectorstore'
import { beginIndexing, endIndexing, isEmbeddingRebuildActive } from './embeddingRebuildState'
import type { ChunkingService, ChunkOptions, ChunkStructureContext } from '../ChunkingService'
import type { EmbeddingService } from '../EmbeddingService'
import type { SectionIndexService } from './SectionIndexService'
import type { MarkdownNormalizer } from '../MarkdownNormalizer'
import type { ParserWorkerClient } from '../import/ParserWorkerClient'
import type { DocumentMetadataIndexService } from '../DocumentMetadataIndexService'
import type { KnowledgeFileStore } from './KnowledgeFileStore'
import type { KnowledgeEmbeddingRuntime } from './KnowledgeEmbeddingRuntime'
import type { IncrementalReindexResult, IndexProgressCallback } from './KnowledgeServiceTypes'
import {
  buildChunkStructureContext,
  buildCompactStructureMetadata,
  buildDocumentIndexText,
  legalMetadataIndexText,
  readDocumentMetadataProjection,
  retrievalMetadataIndexText,
  withRetrievalMetadata,
  type RetrievalMetadataProjection
} from './DocumentRetrievalMetadata'
import {
  extractDocumentMetadata,
  isOriginalLegalDocument,
  mergeDocumentMetadataInspector,
  metadataFromInspector,
  type DocumentMetadataInspector
} from '../DocumentMetadataExtractionService'
import Logger from '../../../shared/utils/logger'

export interface KnowledgeDocumentIndexerDeps {
  embeddingService: EmbeddingService
  embeddingRuntime: KnowledgeEmbeddingRuntime
  chunkingService: ChunkingService
  sectionIndex: SectionIndexService
  metadataIndexService: DocumentMetadataIndexService
  markdownNormalizer: MarkdownNormalizer
  parserWorker: ParserWorkerClient
  fileStore: KnowledgeFileStore
}

export class KnowledgeDocumentIndexer {
  constructor(private readonly deps: KnowledgeDocumentIndexerDeps) {}

  /**
   * Text fed to FTS5. Heading paths are prepended so BM25 can match section
   * names, while chunk.content stays untouched.
   */
  buildFtsIndexText(content: string, metadata?: Record<string, unknown> | null): string {
    const headingPath = metadata?.headingPath
    const path =
      Array.isArray(headingPath) && headingPath.length > 0
        ? headingPath.filter((part) => typeof part === 'string' && part.trim()).join(' > ')
        : ''

    const legal = metadata?.documentMetadata as Record<string, string> | undefined
    const legalText = legalMetadataIndexText(legal)
    const retrieval = metadata?.retrievalMetadata as RetrievalMetadataProjection | undefined
    const retrievalText = retrieval ? retrievalMetadataIndexText(retrieval) : ''
    const header = [path, legalText, retrievalText].filter((part) => part.length > 0).join(' > ')

    return header ? `${header}\n${content}` : content
  }

  /**
   * Update the document-level vector (tier 1 of hierarchical retrieval).
   * Support step: failures are logged and never break the main index flow.
   */
  async updateDocumentVector(
    documentId: string,
    notebookId: string,
    throwOnError = false
  ): Promise<void> {
    try {
      const db = getDatabase()
      const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
      if (!doc) return

      const text = buildDocumentIndexText(doc)
      if (!text) return

      const [result] = await this.deps.embeddingService.embedBatch([text], { dimensions: 1024 })
      if (!result) return
      if (result.dimensions !== 1024) {
        const message = `Document vector for ${documentId} has ${result.dimensions} dimensions; 1024 required`
        if (throwOnError) throw new Error(message)
        Logger.warn('KnowledgeService', message)
        return
      }

      documentVectorStore.upsert(notebookId, [
        { id: `docvec_${documentId}`, documentId, vector: result.embedding }
      ])
    } catch (error) {
      Logger.warn('KnowledgeService', `Failed to update document vector for ${documentId}:`, error)
      if (throwOnError) throw error
    }
  }

  /**
   * Refresh the document-level vector (used after enrichment produces a new
   * summary).
   */
  async refreshDocumentVector(documentId: string, throwOnError = false): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) {
      if (throwOnError) throw new Error(`Document ${documentId} not found`)
      return
    }

    await this.updateDocumentVector(documentId, doc.notebookId, throwOnError)
  }

  /**
   * Delete document-level vectors when documents are removed.
   */
  removeDocumentVectors(documentIds: string[]): void {
    try {
      documentVectorStore.deleteByDocumentIds(documentIds)
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to remove document vectors:', error)
    }
  }

  async cleanupDocumentIndex(notebookId: string, documentId: string): Promise<void> {
    const db = getDatabase()
    const docChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    // Document-level vectors must go too, even when no chunks remain.
    this.removeDocumentVectors([documentId])

    // Sections are written before chunk embeddings. A failure in the
    // embedding phase must not leave orphan section rows behind: they would
    // make the section-vector coverage check fail for later searches.
    try {
      sectionVectorStore.deleteByDocumentIds([documentId])
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to remove section vectors during cleanup:', error)
    }
    db.delete(sections).where(eq(sections.documentId, documentId)).run()

    if (docChunks.length === 0) return

    const chunkIds = docChunks.map((chunk) => chunk.id)
    const vectorStore = await vectorStoreManager.getStore(notebookId)
    await vectorStore.deleteByChunkIds(chunkIds)
    this.deleteFtsChunkIds(chunkIds)
    db.delete(embeddings).where(inArray(embeddings.chunkId, chunkIds)).run()
    db.delete(chunks).where(eq(chunks.documentId, documentId)).run()
  }

  async indexContent(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<void> {
    if (isEmbeddingRebuildActive(notebookId)) {
      throw new Error('Embedding index rebuild in progress; retry the import when it finishes')
    }

    beginIndexing(notebookId)
    try {
      await this.indexContentUnlocked(
        documentId,
        notebookId,
        content,
        chunkOptions,
        structure,
        onProgress
      )
    } finally {
      endIndexing(notebookId)
    }
  }

  /**
   * Shared indexing pipeline: chunk content, persist chunks and sections,
   * embed, write embeddings and vector rows, then finalize document status.
   */
  private async indexContentUnlocked(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<void> {
    const { chunkingService, sectionIndex, embeddingService } = this.deps
    await this.deps.embeddingRuntime.ensureReady()
    await this.deps.embeddingRuntime.assertDimensions()
    const db = getDatabase()
    const now = new Date()
    this.refreshDocumentContentMetadata(documentId, content)
    const metadataProjection = readDocumentMetadataProjection(documentId)

    // 1. Chunk
    onProgress?.('chunking', 10)
    const chunkResults = chunkingService.chunk(content, chunkOptions, structure)
    if (chunkResults.length === 0) throw new Error('No chunks generated from document')
    Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

    // 1.5 Sections — middle tier of hierarchical retrieval. Split section
    // records from the flat structure and assign sectionId by start offset.
    const sectionPlan = sectionIndex.buildRecords(
      notebookId,
      documentId,
      content,
      structure?.sections
    )
    db.delete(sections).where(eq(sections.documentId, documentId)).run()
    if (sectionPlan.records.length > 0) {
      db.insert(sections).values(sectionPlan.records).run()
    }

    // 2. Save chunks
    onProgress?.('saving_chunks', 20)
    const chunkIds: string[] = []
    const chunkContents: string[] = []

    for (const chunk of chunkResults) {
      const chunkId = `chunk_${randomUUID()}`
      chunkIds.push(chunkId)
      chunkContents.push(chunk.content)
      const chunkMetadata = withRetrievalMetadata(chunk.metadata, metadataProjection)

      const newChunk: NewChunk = {
        id: chunkId,
        documentId,
        notebookId,
        content: chunk.content,
        contentHash: createHash('md5').update(chunk.content).digest('hex'),
        chunkIndex: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        metadata: chunkMetadata,
        tokenCount: chunk.tokenCount,
        sectionId: sectionPlan.assign(chunk.startOffset) ?? undefined,
        createdAt: now
      }
      db.insert(chunks).values(newChunk).run()

      // Also insert into the FTS5 virtual table for hybrid search.
      const sqlite = getSqlite()
      if (sqlite) {
        sqlite
          .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
          .run(chunkId, notebookId, this.buildFtsIndexText(chunk.content, chunkMetadata))
      }
    }

    // 3. Generate embeddings
    onProgress?.('generating_embeddings', 30)
    const embeddingResults = await embeddingService.embedBatch(
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

    // 4. Save embeddings + add to the vector store
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
        // The `model` column stores the model + endpoint signature so a
        // later endpoint change is detectable without a schema migration.
        model: embResult.signature ?? embResult.model,
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

    // 6. Document-level vector (tier 1) — best-effort
    await this.updateDocumentVector(documentId, notebookId)

    // 6.5 Section-level vector (tier 2) — best-effort
    await sectionIndex.updateVectors(notebookId, documentId, sectionPlan.records)
    sectionIndex.updateChunkCounts(documentId)

    executeCheckpoint('PASSIVE')
    onProgress?.('completed', 100)
    Logger.info(
      'KnowledgeService',
      `Document indexed: ${documentId}, ${chunkResults.length} chunks`
    )
  }

  chunkOptionsForMimeType(mimeType: string | undefined): ChunkOptions | undefined {
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      // Spreadsheet rows can be token-dense; use tighter chunking for stable
      // local embeddings.
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

  /**
   * Reparse and reindex an existing document without creating a new record.
   * When chunks already exist, use an incremental contentHash diff.
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc || !doc.content) throw new Error(`Document ${documentId} not found or has no content`)
    if (isEmbeddingRebuildActive(doc.notebookId)) {
      throw new Error('Embedding index rebuild in progress; retry the reindex when it finishes')
    }

    const localFile =
      doc.localFilePath && this.deps.fileStore.isManagedPath(doc.localFilePath)
        ? await stat(doc.localFilePath).catch(() => undefined)
        : undefined
    const parsed = localFile
      ? await this.deps.parserWorker.parseFile(doc.localFilePath!)
      : undefined
    const rawContent = parsed?.content ?? doc.content
    const normalized = this.deps.markdownNormalizer.normalize({
      content: rawContent,
      mimeType: parsed?.mimeType ?? doc.mimeType ?? 'text/plain',
      structure: parsed?.structure
    })
    const content = normalized.content
    const structureContext = buildChunkStructureContext(normalized.structure)

    const oldChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    // Update metadata/chunk options before indexing. Always persist the
    // section structure from normalized content — even for documents without
    // an original file (text/note) — otherwise backfill loops forever because
    // metadata.structure is always missing.
    const metadata = { ...((doc.metadata as Record<string, unknown> | null) || {}) }
    delete metadata.structure
    const structureMetadata = buildCompactStructureMetadata(normalized.structure)
    if (structureMetadata) Object.assign(metadata, structureMetadata)

    if (parsed) {
      Object.assign(metadata, parsed.metadata)
      if (doc.localFilePath) {
        const localBytes = await readFile(doc.localFilePath).catch(() => undefined)
        if (localBytes) metadata.fileMd5 = createHash('md5').update(localBytes).digest('hex')
      }
    }
    db.update(documents)
      .set({
        status: 'processing',
        content,
        contentHash: createHash('md5').update(rawContent).digest('hex'),
        contentMdHash: createHash('md5').update(content).digest('hex'),
        mimeType: parsed?.mimeType ?? doc.mimeType,
        fileSize: localFile?.size ?? doc.fileSize,
        metadata,
        updatedAt: new Date()
      })
      .where(eq(documents.id, documentId))
      .run()

    if (oldChunks.length > 0) {
      // Incremental: only re-embed chunks that changed.
      await this.reindexDocumentIncremental(
        documentId,
        doc.notebookId,
        content,
        parsed ? this.chunkOptionsForMimeType(parsed.mimeType) : undefined,
        structureContext,
        onProgress
      )
      return
    }

    // No previous chunks: nothing to delete, go straight to re-indexing.
    await this.indexContent(
      documentId,
      doc.notebookId,
      content,
      parsed ? this.chunkOptionsForMimeType(parsed.mimeType) : undefined,
      structureContext,
      onProgress
    )
  }

  async reindexDocumentIncremental(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<IncrementalReindexResult> {
    if (isEmbeddingRebuildActive(notebookId)) {
      throw new Error('Embedding index rebuild in progress; retry the reindex when it finishes')
    }

    beginIndexing(notebookId)
    try {
      return await this.reindexDocumentIncrementalUnlocked(
        documentId,
        notebookId,
        content,
        chunkOptions,
        structure,
        onProgress
      )
    } finally {
      endIndexing(notebookId)
    }
  }

  /**
   * Incremental reindex: diff new chunks by contentHash against old chunks.
   *  - Matching hash: keep id/embedding, update index/offsets
   *  - New chunk: embed and insert
   *  - Removed chunk: delete from chunks + embeddings + vec + FTS
   */
  private async reindexDocumentIncrementalUnlocked(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<IncrementalReindexResult> {
    const { chunkingService, sectionIndex, embeddingService } = this.deps
    await this.deps.embeddingRuntime.ensureReady()
    const db = getDatabase()
    const now = new Date()
    // Extract metadata BEFORE building chunks/FTS so new metadata reaches the index.
    this.refreshDocumentContentMetadata(documentId, content)
    const metadataProjection = readDocumentMetadataProjection(documentId)

    onProgress?.('diffing', 10)
    const chunkResults = chunkingService.chunk(content, chunkOptions, structure)
    if (chunkResults.length === 0) throw new Error('No chunks generated from document')

    // Rebuild section records and assign sectionId by offset (same as full
    // index) so section structure stays aligned when content changes.
    const sectionPlan = sectionIndex.buildRecords(
      notebookId,
      documentId,
      content,
      structure?.sections
    )
    db.delete(sections).where(eq(sections.documentId, documentId)).run()
    if (sectionPlan.records.length > 0) {
      db.insert(sections).values(sectionPlan.records).run()
    }

    const oldChunks = db.select().from(chunks).where(eq(chunks.documentId, documentId)).all()
    const oldByHash = new Map<string, Chunk>()
    for (const old of oldChunks) {
      if (old.contentHash) oldByHash.set(old.contentHash, old)
    }

    const toReuse: Array<{
      oldChunk: Chunk
      chunkIndex: number
      startOffset: number | null
      endOffset: number | null
      metadata?: Record<string, unknown>
      tokenCount: number | null
      sectionId: string | null
    }> = []
    const toCreate: Array<Chunk & { content: string; contentHash: string }> = []
    const reusedOldIds = new Set<string>()

    for (const chunk of chunkResults) {
      const hash = createHash('md5').update(chunk.content).digest('hex')
      const old = oldByHash.get(hash)
      if (old && !reusedOldIds.has(old.id)) {
        reusedOldIds.add(old.id)
        toReuse.push({
          oldChunk: old,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          metadata: withRetrievalMetadata(chunk.metadata, metadataProjection),
          tokenCount: chunk.tokenCount,
          sectionId: sectionPlan.assign(chunk.startOffset)
        })
      } else {
        toCreate.push({
          id: `chunk_${randomUUID()}`,
          documentId,
          notebookId,
          content: chunk.content,
          contentHash: hash,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          metadata: withRetrievalMetadata(chunk.metadata, metadataProjection) ?? null,
          tokenCount: chunk.tokenCount,
          sectionId: sectionPlan.assign(chunk.startOffset) ?? null,
          createdAt: now
        })
      }
    }

    const toRemove = oldChunks.filter((c) => !reusedOldIds.has(c.id))
    Logger.info(
      'KnowledgeService',
      `Incremental diff: ${toReuse.length} reuse, ${toCreate.length} create, ${toRemove.length} remove`
    )

    // 1. Delete chunks that no longer match
    if (toRemove.length > 0) {
      const removeIds = toRemove.map((c) => c.id)
      const vectorStore = await vectorStoreManager.getStore(notebookId)
      await vectorStore.deleteByChunkIds(removeIds)
      this.deleteFtsChunkIds(removeIds)
      db.delete(embeddings).where(inArray(embeddings.chunkId, removeIds)).run()
      db.delete(chunks).where(inArray(chunks.id, removeIds)).run()
    }

    // 2. Update positions + structural metadata on reused chunks (content is
    //    unchanged, so embeddings stay). FTS is refreshed so the new
    //    headingPath reaches the index — this also backfills old chunks.
    //    Wrapped in one transaction so a large document cannot stop halfway
    //    (metadata changed but FTS not refreshed).
    const reuseSqlite = getSqlite()

    const applyReuse = (): void => {
      for (const item of toReuse) {
        db.update(chunks)
          .set({
            chunkIndex: item.chunkIndex,
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            metadata: item.metadata ?? null,
            tokenCount: item.tokenCount,
            sectionId: item.sectionId ?? null
          })
          .where(eq(chunks.id, item.oldChunk.id))
          .run()

        if (reuseSqlite) {
          this.deleteFtsChunkIds([item.oldChunk.id])
          reuseSqlite
            .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
            .run(
              item.oldChunk.id,
              notebookId,
              this.buildFtsIndexText(item.oldChunk.content, item.metadata)
            )
        }
      }
    }

    if (reuseSqlite && toReuse.length > 1) {
      reuseSqlite.transaction(applyReuse)()
    } else {
      applyReuse()
    }

    // 3. Embed + insert new chunks
    if (toCreate.length > 0) {
      onProgress?.('generating_embeddings', 30)
      const embeddingResults = await embeddingService.embedBatch(
        toCreate.map((c) => c.content),
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

      onProgress?.('saving_embeddings', 85)
      const sqlite = getSqlite()
      const vectorItems: Array<{
        id: string
        chunkId: string
        vector: Float32Array
        metadata?: Record<string, unknown>
      }> = []

      for (let i = 0; i < toCreate.length; i++) {
        const chunkRow = toCreate[i]
        const embResult = embeddingResults[i]
        db.insert(chunks).values(chunkRow).run()

        if (sqlite) {
          sqlite
            .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
            .run(
              chunkRow.id,
              notebookId,
              this.buildFtsIndexText(chunkRow.content, chunkRow.metadata)
            )
        }

        const embeddingId = `emb_${randomUUID()}`
        db.insert(embeddings)
          .values({
            id: embeddingId,
            chunkId: chunkRow.id,
            notebookId,
            model: embResult.signature ?? embResult.model,
            dimensions: embResult.dimensions,
            createdAt: now
          })
          .run()

        vectorItems.push({
          id: embeddingId,
          chunkId: chunkRow.id,
          vector: embResult.embedding,
          metadata: { model: embResult.signature ?? embResult.model, documentId }
        })
      }

      const vectorStore = await vectorStoreManager.getStore(
        notebookId,
        undefined,
        detectedDimensions
      )
      await vectorStore.upsert(vectorItems)
    }

    // 4. Document status (metadata was refreshed at the start of the diff)
    db.update(documents)
      .set({ status: 'indexed', chunkCount: chunkResults.length, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 5. Document-level vector (tier 1) — best-effort
    await this.updateDocumentVector(documentId, notebookId)

    // 5.5 Section-level vector (tier 2) — best-effort
    await sectionIndex.updateVectors(notebookId, documentId, sectionPlan.records)
    sectionIndex.updateChunkCounts(documentId)

    executeCheckpoint('PASSIVE')
    onProgress?.('completed', 100)
    return { created: toCreate.length, reused: toReuse.length, removed: toRemove.length }
  }

  /**
   * Extract + persist document metadata based on new content (shared by full
   * and incremental indexing).
   */
  refreshDocumentContentMetadata(documentId: string, content: string): void {
    const db = getDatabase()
    const document = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!document) return

    const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
    const extracted = extractDocumentMetadata({ title: document.title, content })
    const inspector = isOriginalLegalDocument(content)
      ? mergeDocumentMetadataInspector(
          extracted.inspector,
          rootMetadata.documentMetadataInspector as DocumentMetadataInspector | undefined
        )
      : extracted.inspector

    db.update(documents)
      .set({
        metadata: {
          ...rootMetadata,
          documentMetadata: metadataFromInspector(inspector),
          documentMetadataInspector: inspector
        },
        updatedAt: new Date()
      })
      .where(eq(documents.id, documentId))
      .run()
    const updated = db.select().from(documents).where(eq(documents.id, documentId)).get()
    this.deps.metadataIndexService.sync(updated!)
  }

  private deleteFtsChunkIds(chunkIds: string[]): void {
    if (chunkIds.length === 0) return
    const sqlite = getSqlite()
    if (!sqlite) return

    const placeholders = chunkIds.map(() => '?').join(',')
    sqlite.prepare(`DELETE FROM fts_chunks WHERE chunk_id IN (${placeholders})`).run(...chunkIds)
  }
}
