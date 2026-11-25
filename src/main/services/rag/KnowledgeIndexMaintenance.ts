/**
 * Durable index maintenance: vector rebuilds, FTS backfill, metadata
 * backfill and crash reconciliation. These jobs repair derived rows only and
 * never change the source document content.
 */

import { randomUUID } from 'crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { executeCheckpoint, getDatabase, getSqlite } from '../../db'
import { chunks, documents, embeddings, sections } from '../../db/schema'
import { documentVectorStore, sectionVectorStore, vectorStoreManager } from '../../vectorstore'
import { markActive } from '../../utils/activityTracker'
import { isShuttingDown } from '../../utils/shutdownState'
import {
  beginEmbeddingRebuild,
  endEmbeddingRebuild,
  isEmbeddingRebuildActive,
  isIndexingActive,
  waitForIndexingToFinish
} from './embeddingRebuildState'
import type { EmbeddingService } from '../EmbeddingService'
import type { KnowledgeDocumentIndexer } from './KnowledgeDocumentIndexer'
import type { KnowledgeEmbeddingRuntime } from './KnowledgeEmbeddingRuntime'
import type { SectionIndexService } from './SectionIndexService'
import {
  extractLegalMetadata,
  extractRetrievalMetadata,
  readDocumentMetadataProjection,
  withRetrievalMetadata,
  type RetrievalMetadataProjection
} from './DocumentRetrievalMetadata'
import Logger from '../../../shared/utils/logger'

/** Detect markdown heading content (the condition for section backfill). */
const HEADING_MARKER_REGEX = /^#{1,6}\s+\S/m

export interface KnowledgeIndexMaintenanceDeps {
  embeddingService: EmbeddingService
  embeddingRuntime: KnowledgeEmbeddingRuntime
  documentIndexer: KnowledgeDocumentIndexer
  sectionIndex: SectionIndexService
}

export class KnowledgeIndexMaintenance {
  constructor(private readonly deps: KnowledgeIndexMaintenanceDeps) {}

  /**
   * True when at least one stored vector was produced by an embedding model
   * other than the one currently configured. Vectors from different models
   * share the same 1024 dimensions but not the same space, so searching them
   * together silently returns irrelevant chunks.
   */
  async hasStaleEmbeddingModel(notebookId: string): Promise<boolean> {
    const [currentModel, currentSignature] = await Promise.all([
      this.deps.embeddingService.getDefaultModel(),
      this.deps.embeddingService.getSignature()
    ])
    if (!currentModel) return false

    const sqlite = getSqlite()
    if (!sqlite) return false

    // A chunk without a vector means an earlier upsert was interrupted. The
    // metadata may still look current, so check completeness explicitly.
    // While a document index is active its chunks are temporarily incomplete;
    // skip only this check, never the model/signature comparison above.
    if (!isIndexingActive(notebookId)) {
      const missingVector = sqlite
        .prepare(
          `SELECT id FROM chunks WHERE notebook_id = ?
           EXCEPT
           SELECT chunk_id FROM vec_embeddings WHERE notebook_id = ?
           LIMIT 1`
        )
        .get(notebookId, notebookId)
      if (missingVector) return true
    }

    const rows = sqlite
      .prepare('SELECT model, dimensions FROM embeddings WHERE notebook_id = ?')
      .all(notebookId) as Array<{ model: string; dimensions: number }>

    if (rows.length === 0) return false

    // The `model` column stores `model@endpoint` when the provider exposes a
    // signature. Legacy rows contain only the model name, which intentionally
    // does not match a signature and triggers one rebuild.
    const expected = currentSignature ?? currentModel
    return rows.some((row) => row.model !== expected || row.dimensions !== 1024)
  }

  /**
   * Re-embed every vector tier in place when the embedding model changes.
   * Chunks, FTS rows, sections, and chunk IDs stay intact, so existing
   * citations keep working; only vectors from the incompatible model space
   * are replaced.
   */
  async rebuildAllEmbeddings(notebookId: string): Promise<number> {
    if (isEmbeddingRebuildActive(notebookId)) return 0
    beginEmbeddingRebuild(notebookId)

    try {
      if (isShuttingDown()) return 0

      // Drain an import/auto-sync reindex that was already writing before this
      // rebuild clears the vector tiers. New writes are rejected by the gate.
      const settled = await waitForIndexingToFinish(notebookId, 120_000)
      if (!settled) {
        throw new Error('Document indexing did not settle before the embedding rebuild')
      }
      if (!(await this.hasStaleEmbeddingModel(notebookId))) return 0

      await this.deps.embeddingRuntime.ensureReady()
      await this.deps.embeddingRuntime.assertDimensions()

      const db = getDatabase()
      const sqlite = getSqlite()
      if (!sqlite) return 0

      const docs = db
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
        .all()

      // Drop only the vector tiers and their metadata. The relational index
      // (chunks, FTS, sections) is preserved so citations remain valid. While
      // the rebuild runs, hierarchical retrieval skips the empty document and
      // section tiers instead of mixing them with the new model space.
      const allDocumentIds = db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.notebookId, notebookId))
        .all()
        .map((doc) => doc.id)

      const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, 1024)
      await vectorStore.clear()
      documentVectorStore.deleteByDocumentIds(allDocumentIds)
      sectionVectorStore.deleteByDocumentIds(allDocumentIds)

      // Reuse the tested batch/adaptive-split path. Keep marking activity so
      // the idle-only background queue does not touch the same rows.
      let rebuiltChunks = 0
      let remaining = 1
      while (remaining > 0) {
        if (isShuttingDown()) throw new Error('Application is shutting down')
        markActive()
        const result = await this.rebuildMissingVectors(notebookId, 200)
        rebuiltChunks += result.rebuilt
        remaining = result.remaining
        if (result.rebuilt === 0 && remaining > 0) {
          throw new Error(`Could not rebuild ${remaining} chunk vector(s)`)
        }
      }

      let rebuiltDocuments = 0
      for (const doc of docs) {
        if (isShuttingDown()) throw new Error('Application is shutting down')
        try {
          markActive()
          await this.deps.documentIndexer.refreshDocumentVector(doc.id, true)
          await this.deps.sectionIndex.refreshDocumentVectors(notebookId, doc.id)
          rebuiltDocuments++
        } catch (error) {
          Logger.error(
            'KnowledgeService',
            `Failed to rebuild document/section vectors for ${doc.title} (${doc.id}):`,
            error
          )
        }
      }

      Logger.info(
        'KnowledgeService',
        `Rebuilt ${rebuiltChunks} chunk vector(s) and ${rebuiltDocuments}/${docs.length} document/section index(es) in notebook ${notebookId}`
      )
      if (rebuiltDocuments < docs.length) {
        throw new Error(
          `Document/section vector rebuild incomplete: ${rebuiltDocuments}/${docs.length}`
        )
      }
      return rebuiltDocuments
    } finally {
      endEmbeddingRebuild(notebookId)
    }
  }

  /** Rebuild only when the stored vectors belong to another model. */
  async ensureEmbeddingModelConsistency(
    notebookId: string
  ): Promise<{ rebuilt: boolean; documents: number }> {
    if (!(await this.hasStaleEmbeddingModel(notebookId))) {
      return { rebuilt: false, documents: 0 }
    }

    Logger.warn(
      'KnowledgeService',
      `Embedding model changed for notebook ${notebookId}; rebuilding all document indexes`
    )
    const documents = await this.rebuildAllEmbeddings(notebookId)
    return { rebuilt: true, documents }
  }

  /**
   * Re-embed chunks that do not have a vector yet. Runs in batches so a
   * background job can stop mid-way and still make progress.
   */
  async rebuildMissingVectors(
    notebookId: string,
    limit = 200
  ): Promise<{ rebuilt: number; remaining: number; ftsRebuilt: number }> {
    if (isShuttingDown()) throw new Error('Application is shutting down')
    await this.deps.embeddingRuntime.ensureReady()

    const db = getDatabase()
    const sqlite = getSqlite()
    const ftsRebuilt = this.backfillMissingFtsRows(notebookId)

    const existingChunkIds = new Set<string>(
      sqlite
        ? (
            sqlite
              .prepare('SELECT chunk_id FROM vec_embeddings WHERE notebook_id = ?')
              .all(notebookId) as Array<{ chunk_id: string }>
          ).map((row) => row.chunk_id)
        : []
    )

    const allChunkIds = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.notebookId, notebookId))
      .all()

    const missingIds = allChunkIds
      .filter((row) => !existingChunkIds.has(row.id))
      .map((row) => row.id)

    if (missingIds.length === 0) return { rebuilt: 0, remaining: 0, ftsRebuilt }

    const batchIds = missingIds.slice(0, Math.max(limit, 1))
    const batchRows = db
      .select({ id: chunks.id, documentId: chunks.documentId, content: chunks.content })
      .from(chunks)
      .where(inArray(chunks.id, batchIds))
      .all()

    const embeddingResults = await this.deps.embeddingService.embedBatch(
      batchRows.map((row) => row.content),
      { dimensions: 1024 }
    )
    if (isShuttingDown()) throw new Error('Application is shutting down')

    const now = new Date()
    const vectorItems: Array<{
      id: string
      chunkId: string
      vector: Float32Array
      metadata?: Record<string, unknown>
    }> = []

    for (let i = 0; i < batchRows.length; i++) {
      const row = batchRows[i]
      const embResult = embeddingResults[i]
      if (!embResult || embResult.dimensions !== 1024) {
        throw new Error(
          `Embedding model returned ${embResult?.dimensions ?? 0}-dimensional vectors; ` +
            'MiChat requires 1024. No vectors were written for this batch.'
        )
      }
      const vectorModel = embResult.signature ?? embResult.model

      // The `embeddings` table may still hold a metadata row from before, so
      // reuse its id to keep the 1-1 relation with the vector. Updating the
      // model/dimensions in place is what makes an interrupted model switch
      // detectable and retryable.
      const metaRow = db
        .select({ id: embeddings.id })
        .from(embeddings)
        .where(eq(embeddings.chunkId, row.id))
        .get()

      const embeddingId = metaRow?.id ?? `emb_${randomUUID()}`

      if (!metaRow) {
        db.insert(embeddings)
          .values({
            id: embeddingId,
            chunkId: row.id,
            notebookId,
            model: vectorModel,
            dimensions: embResult.dimensions,
            createdAt: now
          })
          .run()
      } else {
        db.update(embeddings)
          .set({ model: vectorModel, dimensions: embResult.dimensions })
          .where(eq(embeddings.id, metaRow.id))
          .run()
      }

      vectorItems.push({
        id: embeddingId,
        chunkId: row.id,
        vector: embResult.embedding,
        metadata: { model: embResult.model, documentId: row.documentId }
      })
    }

    if (vectorItems.length > 0) {
      const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, 1024)
      await vectorStore.upsert(vectorItems)
      executeCheckpoint('PASSIVE')
    }

    const remaining = missingIds.length - batchIds.length
    Logger.info(
      'KnowledgeService',
      `Rebuilt ${vectorItems.length} chunk vectors for notebook ${notebookId} (remaining: ${remaining})`
    )

    return { rebuilt: vectorItems.length, remaining, ftsRebuilt }
  }

  /**
   * Documents needing backfill: missing document-level vector, missing
   * section structure while the content has headings (old documents indexed
   * before headingPath), or sections present but no section row/vector.
   *
   * Only return documents where reindexing can actually improve the index.
   */
  findDocumentsNeedingBackfill(notebookId: string, limit = 5): string[] {
    const db = getDatabase()
    const sqlite = getSqlite()

    const documentIdsWithVector = new Set<string>(
      sqlite
        ? (
            sqlite
              .prepare('SELECT document_id FROM vec_documents WHERE notebook_id = ?')
              .all(notebookId) as Array<{ document_id: string }>
          ).map((row) => row.document_id)
        : []
    )

    const documentIdsWithSections = new Set<string>(
      db
        .select({ documentId: sections.documentId })
        .from(sections)
        .where(eq(sections.notebookId, notebookId))
        .all()
        .map((row) => row.documentId)
    )
    const documentIdsWithSectionVectors = new Set<string>(
      sqlite
        ? (
            sqlite
              .prepare('SELECT DISTINCT document_id FROM vec_sections WHERE notebook_id = ?')
              .all(notebookId) as Array<{ document_id: string }>
          ).map((row) => row.document_id)
        : []
    )

    const rows = db
      .select({ id: documents.id, content: documents.content, metadata: documents.metadata })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .all()

    const needs: string[] = []

    for (const row of rows) {
      if (needs.length >= Math.max(limit, 1)) break

      if (!documentIdsWithVector.has(row.id)) {
        needs.push(row.id)
        continue
      }

      const structure = (row.metadata as Record<string, unknown> | null)?.structure as
        | { sections?: unknown[] }
        | undefined
      const hasSections = Array.isArray(structure?.sections) && structure!.sections!.length > 0

      if (!hasSections && HEADING_MARKER_REGEX.test(row.content || '')) {
        needs.push(row.id)
        continue
      }

      // Sections exist but no section records (indexed before the section
      // index) or no section vectors (for example an interrupted re-embed)
      // → rebuild the tier for hierarchical retrieval.
      if (
        hasSections &&
        (!documentIdsWithSections.has(row.id) || !documentIdsWithSectionVectors.has(row.id))
      ) {
        needs.push(row.id)
      }
    }

    return needs
  }

  /**
   * Repairs durable indexes after an unexpected process stop. A document left
   * in `processing` cannot be trusted: its relational rows, FTS rows and vec0
   * rows may represent different partial writes. Remove those derived rows,
   * preserve the source record for retry, and rebuild any missing FTS rows for
   * otherwise indexed documents.
   */
  async reconcileNotebookIndexes(
    notebookId: string
  ): Promise<{ interruptedDocuments: number; ftsRebuilt: number }> {
    const db = getDatabase()
    const interrupted = db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'processing')))
      .all()

    for (const document of interrupted) {
      await this.deps.documentIndexer.cleanupDocumentIndex(notebookId, document.id)
      db.update(documents)
        .set({
          status: 'failed',
          errorMessage: 'Indexing interrupted before completion. Retry the document to rebuild it.',
          chunkCount: 0,
          updatedAt: new Date()
        })
        .where(eq(documents.id, document.id))
        .run()
    }

    const ftsRebuilt = this.backfillMissingFtsRows(notebookId)
    if (interrupted.length > 0 || ftsRebuilt > 0) {
      Logger.warn(
        'KnowledgeService',
        `Reconciled notebook ${notebookId}: interrupted=${interrupted.length}, fts=${ftsRebuilt}`
      )
    }
    return { interruptedDocuments: interrupted.length, ftsRebuilt }
  }

  /**
   * Add already-extracted legal metadata to chunk.metadata + FTS for documents
   * indexed before metadata-aware retrieval existed. Chunk content and
   * embeddings are untouched, so this is cheap.
   */
  async backfillLegalMetadataToIndex(
    notebookId?: string
  ): Promise<{ documents: number; chunks: number }> {
    const db = getDatabase()
    const sqlite = getSqlite()
    if (!sqlite) return { documents: 0, chunks: 0 }

    const conditions = [eq(documents.status, 'indexed')]
    if (notebookId) conditions.push(eq(documents.notebookId, notebookId))

    const rows = db
      .select({
        id: documents.id,
        notebookId: documents.notebookId,
        metadata: documents.metadata
      })
      .from(documents)
      .where(and(...conditions))
      .all()

    let documentsUpdated = 0
    let chunksUpdated = 0

    for (const doc of rows) {
      const rootMetadata = doc.metadata as Record<string, unknown> | null
      const projection = {
        legalMetadata: extractLegalMetadata(rootMetadata),
        retrievalMetadata: extractRetrievalMetadata(rootMetadata)
      }
      if (
        !projection.legalMetadata &&
        !Object.values(projection.retrievalMetadata).some((values) => values.length > 0)
      )
        continue

      const chunkRows = db
        .select({ id: chunks.id, content: chunks.content, metadata: chunks.metadata })
        .from(chunks)
        .where(eq(chunks.documentId, doc.id))
        .all()

      const missing = chunkRows.filter((row) => {
        const metadata = row.metadata as Record<string, unknown> | null
        return !metadata?.documentMetadata && !metadata?.retrievalMetadata
      })
      if (missing.length === 0) continue

      try {
        const insert = sqlite.prepare(
          'INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)'
        )
        const remove = sqlite.prepare('DELETE FROM fts_chunks WHERE chunk_id = ?')
        const run = sqlite.transaction(() => {
          for (const row of missing) {
            const metadata = withRetrievalMetadata(
              row.metadata as Record<string, unknown> | null,
              projection
            )
            db.update(chunks).set({ metadata }).where(eq(chunks.id, row.id)).run()
            remove.run(row.id)
            insert.run(
              row.id,
              doc.notebookId,
              this.deps.documentIndexer.buildFtsIndexText(row.content, metadata)
            )
          }
        })
        run()

        documentsUpdated++
        chunksUpdated += missing.length
        // The document-level vector should also include number/type/issuer.
        await this.deps.documentIndexer.updateDocumentVector(doc.id, doc.notebookId)
      } catch (error) {
        Logger.warn(
          'KnowledgeService',
          `Failed to backfill legal metadata for document ${doc.id}:`,
          error
        )
      }
    }

    if (chunksUpdated > 0) {
      Logger.info(
        'KnowledgeService',
        `Backfilled legal metadata into ${chunksUpdated} chunks across ${documentsUpdated} documents`
      )
    }

    return { documents: documentsUpdated, chunks: chunksUpdated }
  }

  /**
   * Legal documents that lost metadata because of the old parser (DOCX used
   * to lose the header/number table). Only return documents with an original
   * file so the content can be reindexed.
   */
  findDocumentsNeedingLegalMetadataReindex(limit = 10): string[] {
    const rows = getDatabase()
      .select({
        id: documents.id,
        localFilePath: documents.localFilePath,
        metadata: documents.metadata,
        content: documents.content
      })
      .from(documents)
      .where(eq(documents.status, 'indexed'))
      .all()

    const ids: string[] = []
    for (const row of rows) {
      if (ids.length >= limit) break
      if (!row.localFilePath) continue
      if (extractLegalMetadata(row.metadata as Record<string, unknown> | null)) continue

      const raw = (row.content || '').trimStart()
      // Marker the old DOCX parser used to replace the opening table.
      if (!/^\[Table:\s*\d+\s+rows\]/i.test(raw)) continue

      const opening = raw.slice(0, 6000)
      const looksLegal =
        /(?:^|\n)\s*(?:LUẬT|NGHỊ\s+ĐỊNH|THÔNG\s+TƯ|QUYẾT\s+ĐỊNH|NGHỊ\s+QUYẾT|CHỈ\s+THỊ)\b/iu.test(
          opening
        ) && /(?:CỘNG\s+HÒA|Quốc\s+hội|Chính\s+phủ)/iu.test(opening)
      if (looksLegal) ids.push(row.id)
    }

    return ids
  }

  /**
   * Rebuild missing `fts_chunks` rows (the FTS table was dropped/recreated,
   * or a previous insert failed mid-way). Independent of vector state.
   */
  private backfillMissingFtsRows(notebookId: string): number {
    const sqlite = getSqlite()
    if (!sqlite) return 0

    try {
      const existing = new Set(
        (
          sqlite
            .prepare('SELECT chunk_id FROM fts_chunks WHERE notebook_id = ?')
            .all(notebookId) as Array<{ chunk_id: string }>
        ).map((row) => row.chunk_id)
      )

      const missingRows = getDatabase()
        .select({
          id: chunks.id,
          content: chunks.content,
          metadata: chunks.metadata,
          documentId: chunks.documentId
        })
        .from(chunks)
        .where(eq(chunks.notebookId, notebookId))
        .all()
        .filter((row) => !existing.has(row.id))

      if (missingRows.length === 0) return 0

      const projectionByDocument = new Map<
        string,
        { legalMetadata?: Record<string, string>; retrievalMetadata: RetrievalMetadataProjection }
      >()
      for (const documentId of new Set(missingRows.map((row) => row.documentId))) {
        projectionByDocument.set(documentId, readDocumentMetadataProjection(documentId))
      }

      const insert = sqlite.prepare(
        'INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)'
      )
      const run = sqlite.transaction((rows: typeof missingRows) => {
        for (const row of rows) {
          const metadata = withRetrievalMetadata(
            row.metadata as Record<string, unknown> | null,
            projectionByDocument.get(row.documentId) ?? {
              retrievalMetadata: { keywords: [], entities: [], tags: [] }
            }
          )
          insert.run(
            row.id,
            notebookId,
            this.deps.documentIndexer.buildFtsIndexText(row.content, metadata)
          )
        }
      })
      run(missingRows)

      Logger.info(
        'KnowledgeService',
        `Backfilled ${missingRows.length} FTS rows for notebook ${notebookId}`
      )
      return missingRows.length
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to backfill FTS rows:', error)
      return 0
    }
  }
}
