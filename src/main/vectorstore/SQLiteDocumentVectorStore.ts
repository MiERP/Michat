/**
 * SQLiteDocumentVectorStore
 * Vector cấp TÀI LIỆU (một vector cho mỗi document) trên bảng vec_documents.
 *
 * Phục vụ tầng 1 của Hierarchical Retrieval: chọn tài liệu trước, rồi mới tìm
 * chunk bên trong. Tách khỏi SQLiteVectorStore (vốn gắn với chunk_id) để không
 * đụng vào luồng chunk hiện có.
 */

import { getSqlite } from '../db'
import Logger from '../../shared/utils/logger'

export const DOCUMENT_VECTOR_DIMENSIONS = 1024

export interface DocumentVectorItem {
  id: string
  documentId: string
  vector: Float32Array
}

export interface DocumentVectorMatch {
  documentId: string
  score: number
  distance: number
}

export interface DocumentVectorQueryOptions {
  topK?: number
  threshold?: number
  /** Hard scope resolved before semantic document selection. */
  documentIds?: string[]
}

export class SQLiteDocumentVectorStore {
  upsert(notebookId: string, items: DocumentVectorItem[]): void {
    if (items.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) return

    // vec0 KHÔNG hỗ trợ INSERT OR REPLACE khi trùng primary key (báo
    // "UNIQUE constraint failed"), nên phải xoá trước rồi chèn lại —
    // đúng cách cho vector cấp tài liệu vì id của nó ổn định theo document.
    const deleteStmt = sqlite.prepare('DELETE FROM vec_documents WHERE document_id = ?')
    const insertStmt = sqlite.prepare(`
      INSERT INTO vec_documents (embedding_id, document_id, notebook_id, embedding)
      VALUES (?, ?, ?, ?)
    `)

    const run = sqlite.transaction((rows: DocumentVectorItem[]) => {
      for (const item of rows) {
        if (item.vector.length !== DOCUMENT_VECTOR_DIMENSIONS) {
          Logger.warn(
            'SQLiteDocumentVectorStore',
            `Vector dimension mismatch: expected ${DOCUMENT_VECTOR_DIMENSIONS}, got ${item.vector.length}`
          )
          continue
        }

        deleteStmt.run(item.documentId)
        insertStmt.run(item.id, item.documentId, notebookId, item.vector)
      }
    })

    run(items)
    Logger.debug('SQLiteDocumentVectorStore', `Upserted ${items.length} document vectors`)
  }

  deleteByDocumentIds(documentIds: string[]): void {
    if (documentIds.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) return

    const placeholders = documentIds.map(() => '?').join(',')
    sqlite
      .prepare(`DELETE FROM vec_documents WHERE document_id IN (${placeholders})`)
      .run(...documentIds)
  }

  query(
    notebookId: string,
    vector: Float32Array,
    options: DocumentVectorQueryOptions = {}
  ): DocumentVectorMatch[] {
    const { topK = 8, threshold, documentIds } = options

    const sqlite = getSqlite()
    if (!sqlite) return []
    if (vector.length !== DOCUMENT_VECTOR_DIMENSIONS) return []

    const knnTopK = documentIds?.length ? this.count(notebookId) : topK
    const rows = sqlite
      .prepare(
        `SELECT document_id, distance
         FROM vec_documents
         WHERE embedding MATCH ? AND k = ? AND notebook_id = ?
         ORDER BY distance ASC`
      )
      .all(vector, Math.max(knnTopK, topK), notebookId) as Array<{
      document_id: string
      distance: number
    }>

    const documentScope = documentIds ? new Set(documentIds) : null

    return rows
      .filter((row) => !documentScope || documentScope.has(row.document_id))
      .slice(0, topK)
      .map((row) => ({
        documentId: row.document_id,
        distance: row.distance,
        score: 1 - row.distance / 2
      }))
      .filter((row) => (threshold === undefined ? true : row.score >= threshold))
  }

  count(notebookId: string, documentIds?: string[]): number {
    const sqlite = getSqlite()
    if (!sqlite) return 0

    if (documentIds) {
      if (documentIds.length === 0) return 0
      const placeholders = documentIds.map(() => '?').join(',')
      const row = sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM vec_documents
           WHERE notebook_id = ? AND document_id IN (${placeholders})`
        )
        .get(notebookId, ...documentIds) as { count: number } | undefined
      return row?.count || 0
    }

    const row = sqlite
      .prepare('SELECT COUNT(*) as count FROM vec_documents WHERE notebook_id = ?')
      .get(notebookId) as { count: number } | undefined

    return row?.count || 0
  }
}

export const documentVectorStore = new SQLiteDocumentVectorStore()
