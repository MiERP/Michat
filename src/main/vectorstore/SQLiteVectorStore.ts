/**
 * SQLiteVectorStore
 * 基于 sqlite-vec 扩展的向量存储实现
 */

import { getSqlite } from '../db'
import type { VectorStore, VectorItem, QueryResult, QueryOptions, VectorStoreConfig } from './types'
import Logger from '../../shared/utils/logger'

/**
 * SQLite 向量存储实现
 * 使用 sqlite-vec 的 vec0 虚拟表进行高性能向量检索
 */
export class SQLiteVectorStore implements VectorStore {
  private notebookId: string = ''
  private dimensions: number = 1024
  private tableName: string = 'vec_embeddings'
  private initialized: boolean = false

  async initialize(config: VectorStoreConfig): Promise<void> {
    this.notebookId = config.notebookId
    this.dimensions = config.dimensions || 1024
    if (!Number.isInteger(this.dimensions) || this.dimensions < 1 || this.dimensions > 8192) {
      throw new Error(`Invalid vector dimensions: ${this.dimensions}`)
    }
    this.tableName =
      this.dimensions === 1024 ? 'vec_embeddings' : `vec_embeddings_${this.dimensions}`
    const sqlite = getSqlite()
    if (!sqlite) throw new Error('SQLite instance not available')
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        embedding_id TEXT PRIMARY KEY,
        chunk_id TEXT,
        notebook_id TEXT,
        embedding FLOAT[${this.dimensions}] distance_metric=cosine
      );
    `)
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
      INSERT OR REPLACE INTO ${this.tableName} (embedding_id, chunk_id, notebook_id, embedding)
      VALUES (?, ?, ?, ?)
    `)

    const insertMany = sqlite.transaction((items: VectorItem[]) => {
      for (const item of items) {
        // 验证向量维度
        if (item.vector.length !== this.dimensions) {
          throw new Error(
            `Vector dimension mismatch: expected ${this.dimensions}, got ${item.vector.length}`
          )
        }

        // sqlite-vec 可以直接接受 Float32Array
        insertStmt.run(item.id, item.chunkId, this.notebookId, item.vector)
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
      DELETE FROM ${this.tableName} WHERE embedding_id IN (${placeholders})
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
      DELETE FROM ${this.tableName} WHERE chunk_id IN (${placeholders})
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
      // 使用 sqlite-vec 的 KNN 查询
      // cosine 距离：0 表示完全相同，2 表示完全相反
      // 转换为相似度分数：1 - (distance / 2)
      const requestedChunkIds = filter?.chunkIds?.filter(Boolean) || []
      if (requestedChunkIds.length === 0 && filter?.chunkIds) {
        return []
      }

      let querySql = `
        SELECT
          embedding_id,
          chunk_id,
          distance
        FROM ${this.tableName}
        WHERE embedding MATCH ?
          AND k = ?
          AND notebook_id = ?
      `

      const params: any[] = [queryVector, topK, this.notebookId]
      if (requestedChunkIds.length > 0) {
        const placeholders = requestedChunkIds.map(() => '?').join(',')
        querySql += ` AND chunk_id IN (${placeholders})`
        params.push(...requestedChunkIds)
      }

      querySql += ' ORDER BY distance ASC'
      const queryStmt = sqlite.prepare(querySql)

      // sqlite-vec 可以直接接受 Float32Array
      const results = queryStmt.all(...params) as Array<{
        embedding_id: string
        chunk_id: string
        distance: number
      }>

      // 转换结果
      const queryResults: QueryResult[] = results.map((row) => {
        // cosine 距离转相似度（0-1）
        const score = 1 - row.distance / 2

        return {
          id: row.embedding_id,
          chunkId: row.chunk_id,
          score,
          distance: row.distance
        }
      })

      // 应用阈值过滤
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
        DELETE FROM ${this.tableName} WHERE notebook_id = ?
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
        SELECT COUNT(*) as count FROM ${this.tableName} WHERE notebook_id = ?
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
