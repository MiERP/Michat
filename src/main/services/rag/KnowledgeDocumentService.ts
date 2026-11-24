/**
 * Document records and their retrieval metadata.
 *
 * Owns document reads, metadata/lifecycle updates, feedback, deletion and
 * aggregate stats. Index writes are delegated to the document indexer.
 */

import { randomUUID } from 'crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { executeCheckpoint, getDatabase, getSqlite, vacuumDatabase } from '../../db'
import {
  chunks,
  chunkFeedback,
  documents,
  embeddings,
  sections,
  type Chunk,
  type Document,
  type NewChunkFeedback
} from '../../db/schema'
import { sectionVectorStore, vectorStoreManager } from '../../vectorstore'
import type { DocumentMetadataIndexService } from '../DocumentMetadataIndexService'
import type { KnowledgeDocumentIndexer } from './KnowledgeDocumentIndexer'
import type { KnowledgeFileStore } from './KnowledgeFileStore'
import type { DocumentPageContent } from './KnowledgeServiceTypes'
import { readDocumentMetadataProjection, withRetrievalMetadata } from './DocumentRetrievalMetadata'
import {
  inspectorFromMetadata,
  metadataFromInspector,
  type DocumentMetadata,
  type DocumentMetadataInspector
} from '../DocumentMetadataExtractionService'
import Logger from '../../../shared/utils/logger'

interface PageOffset {
  pageNumber?: number
  startOffset?: number
  endOffset?: number
}

interface PageStructure {
  type?: string
  pages?: PageOffset[]
}

export interface KnowledgeDocumentServiceDeps {
  documentIndexer: KnowledgeDocumentIndexer
  fileStore: KnowledgeFileStore
  metadataIndexService: DocumentMetadataIndexService
}

export class KnowledgeDocumentService {
  constructor(private readonly deps: KnowledgeDocumentServiceDeps) {}

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

  /**
   * Read indexed content (documents + chunks) for derivative pipelines
   * (quiz, ...): central read instead of each service querying chunks on its
   * own.
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
    const db = getDatabase()
    const { documentIds, docsLimit = 10, chunksPerDoc = 4, spreadChunks = true } = options

    const filters = [eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')]
    if (documentIds && documentIds.length > 0) {
      filters.push(inArray(documents.id, documentIds.slice(0, 50)))
    }

    const docs = db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(...filters))
      .orderBy(desc(documents.updatedAt))
      .limit(docsLimit)
      .all()

    const result: Array<{
      id: string
      title: string
      chunks: Array<{ id: string; content: string }>
    }> = []

    for (const doc of docs) {
      const docChunks = db
        .select({ id: chunks.id, content: chunks.content })
        .from(chunks)
        .where(eq(chunks.documentId, doc.id))
        .orderBy(chunks.chunkIndex)
        .limit(60)
        .all()
      if (docChunks.length === 0) continue
      const picked = spreadChunks
        ? this.pickSpreadChunks(docChunks, chunksPerDoc)
        : docChunks.slice(0, chunksPerDoc)
      result.push({ id: doc.id, title: doc.title, chunks: picked })
    }

    return result
  }

  getDocument(documentId: string): Document | undefined {
    const db = getDatabase()
    return db.select().from(documents).where(eq(documents.id, documentId)).get()
  }

  /**
   * Sync the retrieval metadata projection into the relational table, chunk
   * metadata and FTS. Called after every metadata/enrichment change so the
   * planner, lexical search and citations observe the same snapshot.
   */
  syncDocumentRetrievalMetadata(documentId: string): void {
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)

    this.deps.metadataIndexService.sync(document)
    const projection = readDocumentMetadataProjection(documentId)
    const chunkRows = getDatabase()
      .select({ id: chunks.id, content: chunks.content, metadata: chunks.metadata })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()
    const sqlite = getSqlite()

    const apply = (): void => {
      const removeFts = sqlite?.prepare('DELETE FROM fts_chunks WHERE chunk_id = ?')
      const insertFts = sqlite?.prepare(
        'INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)'
      )
      for (const row of chunkRows) {
        const metadata = withRetrievalMetadata(
          row.metadata as Record<string, unknown> | null,
          projection
        )
        getDatabase().update(chunks).set({ metadata }).where(eq(chunks.id, row.id)).run()
        removeFts?.run(row.id)
        insertFts?.run(
          row.id,
          document.notebookId,
          this.deps.documentIndexer.buildFtsIndexText(row.content, metadata)
        )
      }
    }

    if (sqlite && chunkRows.length > 0) sqlite.transaction(apply)()
    else apply()
  }

  updateDocumentMetadata(documentId: string, metadata: DocumentMetadata): Document {
    const db = getDatabase()
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)

    const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
    const inspector = inspectorFromMetadata(
      metadata,
      rootMetadata.documentMetadataInspector as DocumentMetadataInspector | undefined
    )
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

    this.syncDocumentRetrievalMetadata(documentId)
    const updated = this.getDocument(documentId)!
    return updated
  }

  refreshDocumentMetadata(documentId: string): Document {
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)

    this.deps.documentIndexer.refreshDocumentContentMetadata(documentId, document.content || '')

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

    const structure = (doc.metadata as Record<string, unknown> | null)?.structure as
      | PageStructure
      | undefined
    if (structure?.type === 'pages' && Array.isArray(structure.pages)) {
      const page = structure.pages.find((p) => p?.pageNumber === pageNumber)
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

    if (doc.localFilePath) await this.deps.fileStore.deleteLocalFile(doc.localFilePath)

    this.deps.documentIndexer.removeDocumentVectors([documentId])
    try {
      sectionVectorStore.deleteByDocumentIds([documentId])
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to remove section vectors:', error)
    }
    db.delete(sections).where(eq(sections.documentId, documentId)).run()

    db.delete(documents).where(eq(documents.id, documentId)).run()
    executeCheckpoint('PASSIVE')
    vacuumDatabase()
    Logger.info('KnowledgeService', `Document deleted: ${documentId}`)
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
    const db = getDatabase()
    const chunk = db.select().from(chunks).where(eq(chunks.id, chunkId)).get()
    if (!chunk) throw new Error(`Chunk ${chunkId} not found`)

    const feedback: NewChunkFeedback = {
      id: `fb_${randomUUID()}`,
      chunkId,
      notebookId,
      kind,
      note: note?.trim() || null,
      createdAt: new Date()
    }
    db.insert(chunkFeedback).values(feedback).run()
    Logger.info('KnowledgeService', `Feedback recorded: ${kind} on chunk ${chunkId}`)
  }

  /**
   * Mark the document lifecycle (draft/verified/outdated) — affects retrieval
   * weight (outdated ×0.4, verified ×1.1).
   */
  setDocumentLifecycle(documentId: string, state: 'draft' | 'verified' | 'outdated'): Document {
    const db = getDatabase()
    const doc = this.getDocument(documentId)
    if (!doc) throw new Error(`Document ${documentId} not found`)

    const rootMetadata = (doc.metadata as Record<string, unknown> | null) || {}
    db.update(documents)
      .set({
        metadata: { ...rootMetadata, lifecycleState: state },
        updatedAt: new Date()
      })
      .where(eq(documents.id, documentId))
      .run()

    const updated = this.getDocument(documentId)!
    this.deps.metadataIndexService.sync(updated)
    return updated
  }

  /**
   * Delete KB documents linked to a deleted note.
   */
  async deleteDocumentsBySourceNote(noteId: string): Promise<void> {
    const db = getDatabase()
    const linkedDocs = db.select().from(documents).where(eq(documents.sourceNoteId, noteId)).all()

    for (const doc of linkedDocs) {
      await this.deleteDocument(doc.id)
    }
  }

  /**
   * Optimized to a single aggregate query instead of 3 separate COUNT
   * queries.
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

  /**
   * Pick chunks spread across the document (start/middle/end) instead of
   * only the first N chunks.
   */
  private pickSpreadChunks(
    docChunks: Array<{ id: string; content: string }>,
    limit: number
  ): Array<{ id: string; content: string }> {
    if (limit <= 1) return docChunks.slice(0, Math.max(limit, 0))
    if (docChunks.length <= limit) return docChunks

    const picked: Array<{ id: string; content: string }> = []
    for (let i = 0; i < limit; i++) {
      const index = Math.round((i * (docChunks.length - 1)) / (limit - 1))
      picked.push(docChunks[index])
    }
    return picked
  }
}
