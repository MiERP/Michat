/**
 * VectorStore abstract interface
 * Backends such as SQLite / LanceDB / Qdrant are supported
 */

/**
 * A vector item
 */
export interface VectorItem {
  id: string // embedding_id
  chunkId: string
  vector: Float32Array
  metadata?: Record<string, unknown>
}

/**
 * Query result
 */
export interface QueryResult {
  id: string // embedding_id
  chunkId: string
  score: number // similarity score (0-1, higher means more similar)
  distance: number // raw distance value
  metadata?: Record<string, unknown>
}

/**
 * Query options
 */
export interface QueryOptions {
  topK?: number // return the top K results, defaults to 5
  threshold?: number // similarity threshold (0-1); results below it are dropped
  filter?: {
    chunkIds?: string[] // restrict the search to the given chunks
    documentIds?: string[] // restrict the search to the given documents (filtered inside the KNN query)
  }
}

/**
 * VectorStore configuration
 */
export interface VectorStoreConfig {
  notebookId: string
  dimensions?: number // vector dimensions, defaults to 1536
}

/**
 * Vector storage abstract interface
 * Business code uses this interface to access vector storage without caring about the backend
 */
export interface VectorStore {
  /**
   * Initializes the vector store
   */
  initialize(config: VectorStoreConfig): Promise<void>

  /**
   * Inserts or updates vectors in batches
   */
  upsert(items: VectorItem[]): Promise<void>

  /**
   * Deletes vectors in batches
   */
  delete(ids: string[]): Promise<void>

  /**
   * Deletes vectors in batches by chunk ID
   */
  deleteByChunkIds(chunkIds: string[]): Promise<void>

  /**
   * Vector similarity query
   * @param vector query vector
   * @param options query options
   * @returns list of results sorted by similarity
   */
  query(vector: Float32Array, options?: QueryOptions): Promise<QueryResult[]>

  /**
   * Clears all vectors for the current notebook
   */
  clear(): Promise<void>

  /**
   * Returns the vector count
   */
  count(): Promise<number>

  /**
   * Closes the connection / releases resources
   */
  close(): Promise<void>

  /**
   * Returns the current notebook ID
   */
  getNotebookId(): string

  /**
   * Returns the vector dimensions
   */
  getDimensions(): number
}

/**
 * Vector storage type
 */
export type VectorStoreType = 'sqlite' | 'lancedb' | 'qdrant'
