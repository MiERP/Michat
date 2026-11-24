/**
 * SQLiteVectorStore
 * Vector storage implementation backed by the sqlite-vec extension
 */

import { getSqlite } from '../db'
import type { VectorStore, VectorItem, QueryResult, QueryOptions, VectorStoreConfig } from './types'
import Logger from '../../shared/utils/logger'

/**
 * SQLite vector store implementation
 * Uses the sqlite-vec vec0 virtual table for high-performance vector search
 */
export class SQLiteVectorStore implements VectorStore {
  private notebookId: string = ''
  private dimensions: number = 1024
  private initialized: boolean = false

  async initialize(config: VectorStoreConfig): Promise<void> {
    this.notebookId = config.notebookId
    this.dimensions = config.dimensions || 1024
    this.initialized = true
    Logger.info('SQLiteVectorStore', `Initialized for notebook: ${this.notebookId}`)
  }

  async upsert(items: VectorItem[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const insertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO vec_embeddings (embedding_id, chunk_id, document_id, notebook_id, embedding)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertMany = sqlite.transaction((items: VectorItem[]) => {
      for (const item of items) {
        // Validate the vector dimensions
        if (item.vector.length !== this.dimensions) {
          Logger.warn(
            'SQLiteVectorStore',
            `Vector dimension mismatch: expected ${this.dimensions}, got ${item.vector.length}`
          )
        }

        const documentId =
          typeof item.metadata?.documentId === 'string' ? item.metadata.documentId : null

        // sqlite-vec accepts Float32Array directly
        insertStmt.run(item.id, item.chunkId, documentId, this.notebookId, item.vector)
      }
    })

    try {
      insertMany(items)
      Logger.debug('SQLiteVectorStore', `Upserted ${items.length} vectors`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to upsert vectors:', error)
      throw error
    }
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (ids.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const placeholders = ids.map(() => '?').join(',')
    const deleteStmt = sqlite.prepare(`
      DELETE FROM vec_embeddings WHERE embedding_id IN (${placeholders})
    `)

    try {
      deleteStmt.run(...ids)
      Logger.debug('SQLiteVectorStore', `Deleted ${ids.length} vectors`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to delete vectors:', error)
      throw error
    }
  }

  async deleteByChunkIds(chunkIds: string[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (chunkIds.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const placeholders = chunkIds.map(() => '?').join(',')
    const deleteStmt = sqlite.prepare(`
      DELETE FROM vec_embeddings WHERE chunk_id IN (${placeholders})
    `)

    try {
      deleteStmt.run(...chunkIds)
      Logger.debug('SQLiteVectorStore', `Deleted vectors for ${chunkIds.length} chunks`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to delete vectors by chunk IDs:', error)
      throw error
    }
  }

  async query(queryVector: Float32Array, options: QueryOptions = {}): Promise<QueryResult[]> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const { topK = 5, threshold, filter } = options

    if (queryVector.length !== this.dimensions) {
      throw new Error(
        `Query vector dimension mismatch: expected ${this.dimensions}, got ${queryVector.length}`
      )
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      // Use a sqlite-vec KNN query
      // Cosine distance: 0 means identical, 2 means opposite
      // Convert to a similarity score: 1 - (distance / 2)
      const requestedChunkIds = filter?.chunkIds?.filter(Boolean) || []
      if (requestedChunkIds.length === 0 && filter?.chunkIds) {
        return []
      }

      const requestedDocumentIds = filter?.documentIds?.filter(Boolean) || []
      if (requestedDocumentIds.length === 0 && filter?.documentIds) {
        return []
      }

      let querySql = `
        SELECT
          embedding_id,
          chunk_id,
          distance
        FROM vec_embeddings
        WHERE embedding MATCH ?
          AND k = ?
          AND notebook_id = ?
      `

      const params: Array<string | number | Float32Array> = [queryVector, topK, this.notebookId]

      // Filter by document directly inside the KNN query (avoids building a huge chunk_id list)
      if (requestedDocumentIds.length > 0) {
        const placeholders = requestedDocumentIds.map(() => '?').join(',')
        querySql += ` AND document_id IN (${placeholders})`
        params.push(...requestedDocumentIds)
      }

      if (requestedChunkIds.length > 0) {
        const placeholders = requestedChunkIds.map(() => '?').join(',')
        querySql += ` AND chunk_id IN (${placeholders})`
        params.push(...requestedChunkIds)
      }

      querySql += ' ORDER BY distance ASC'
      const queryStmt = sqlite.prepare(querySql)

      // sqlite-vec accepts Float32Array directly
      const results = queryStmt.all(...params) as Array<{
        embedding_id: string
        chunk_id: string
        distance: number
      }>

      // Transform the results
      const queryResults: QueryResult[] = results.map((row) => {
        // Convert cosine distance to a similarity score (0-1)
        const score = 1 - row.distance / 2

        return {
          id: row.embedding_id,
          chunkId: row.chunk_id,
          score,
          distance: row.distance
        }
      })

      // Apply threshold filtering
      const filteredResults = threshold
        ? queryResults.filter((r) => r.score >= threshold)
        : queryResults

      Logger.debug(
        'SQLiteVectorStore',
        `Query returned ${filteredResults.length} results (threshold: ${threshold})`
      )

      return filteredResults
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to query vectors:', error)
      throw error
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      const deleteStmt = sqlite.prepare(`
        DELETE FROM vec_embeddings WHERE notebook_id = ?
      `)
      deleteStmt.run(this.notebookId)

      Logger.info('SQLiteVectorStore', `Cleared all vectors for notebook: ${this.notebookId}`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to clear vectors:', error)
      throw error
    }
  }

  async count(): Promise<number> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as count FROM vec_embeddings WHERE notebook_id = ?
      `)
      const result = countStmt.get(this.notebookId) as { count: number }

      return result?.count || 0
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to count vectors:', error)
      throw error
    }
  }

  async close(): Promise<void> {
    this.initialized = false
    Logger.info('SQLiteVectorStore', `Closed for notebook: ${this.notebookId}`)
  }

  getNotebookId(): string {
    return this.notebookId
  }

  getDimensions(): number {
    return this.dimensions
  }
}
