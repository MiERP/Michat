/**
 * SQLiteSectionVectorStore
 * Vector cấp MỤC (một vector cho mỗi section/heading) trên bảng vec_sections.
 *
 * Tầng giữa của Hierarchical Retrieval: sau khi chọn tài liệu (vec_documents),
 * chọn mục bên trong rồi mới tìm chunk — giảm candidate set cho tài liệu dài.
 */

import { getSqlite } from '../db'
import Logger from '../../shared/utils/logger'

export const SECTION_VECTOR_DIMENSIONS = 1024

export interface SectionVectorItem {
  id: string
  sectionId: string
  documentId: string
  vector: Float32Array
}

export interface SectionVectorMatch {
  sectionId: string
  documentId: string
  score: number
  distance: number
}

export interface SectionVectorQueryOptions {
  topK?: number
  threshold?: number
  /** Chỉ tìm mục trong các tài liệu này (scope cấp document). */
  documentIds?: string[]
}

export class SQLiteSectionVectorStore {
  upsert(notebookId: string, items: SectionVectorItem[]): void {
    if (items.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) return

    // vec0 KHÔNG hỗ trợ INSERT OR REPLACE khi trùng primary key → xoá trước.
    const deleteStmt = sqlite.prepare('DELETE FROM vec_sections WHERE section_id = ?')
    const insertStmt = sqlite.prepare(`
      INSERT INTO vec_sections (embedding_id, section_id, document_id, notebook_id, embedding)
      VALUES (?, ?, ?, ?, ?)
    `)

    const run = sqlite.transaction((rows: SectionVectorItem[]) => {
      for (const item of rows) {
        if (item.vector.length !== SECTION_VECTOR_DIMENSIONS) {
          Logger.warn(
            'SQLiteSectionVectorStore',
            `Vector dimension mismatch: expected ${SECTION_VECTOR_DIMENSIONS}, got ${item.vector.length}`
          )
          continue
        }

        deleteStmt.run(item.sectionId)
        insertStmt.run(item.id, item.sectionId, item.documentId, notebookId, item.vector)
      }
    })

    run(items)
    Logger.debug('SQLiteSectionVectorStore', `Upserted ${items.length} section vectors`)
  }

  deleteByDocumentIds(documentIds: string[]): void {
    if (documentIds.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) return

    const placeholders = documentIds.map(() => '?').join(',')
    sqlite
      .prepare(`DELETE FROM vec_sections WHERE document_id IN (${placeholders})`)
      .run(...documentIds)
  }

  query(
    notebookId: string,
    vector: Float32Array,
    options: SectionVectorQueryOptions = {}
  ): SectionVectorMatch[] {
    const { topK = 12, threshold, documentIds } = options

    const sqlite = getSqlite()
    if (!sqlite) return []
    if (vector.length !== SECTION_VECTOR_DIMENSIONS) return []

    // Lọc theo tài liệu bằng KNN mở rộng rồi lọc JS (số tài liệu được chọn nhỏ,
    // KNN mở rộng vẫn đủ để lấy đủ topK mục).
    const knnTopK = documentIds?.length ? Math.min(topK * 4, 200) : topK
    const rows = sqlite
      .prepare(
        `SELECT section_id, document_id, distance
         FROM vec_sections
         WHERE embedding MATCH ? AND k = ? AND notebook_id = ?
         ORDER BY distance ASC`
      )
      .all(vector, knnTopK, notebookId) as Array<{
      section_id: string
      document_id: string
      distance: number
    }>

    const docScope = documentIds ? new Set(documentIds) : null

    return rows
      .filter((row) => !docScope || docScope.has(row.document_id))
      .slice(0, topK)
      .map((row) => ({
        sectionId: row.section_id,
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
          `SELECT COUNT(*) as count FROM vec_sections
           WHERE notebook_id = ? AND document_id IN (${placeholders})`
        )
        .get(notebookId, ...documentIds) as { count: number } | undefined
      return row?.count || 0
    }

    const row = sqlite
      .prepare('SELECT COUNT(*) as count FROM vec_sections WHERE notebook_id = ?')
      .get(notebookId) as { count: number } | undefined

    return row?.count || 0
  }
}

export const sectionVectorStore = new SQLiteSectionVectorStore()
