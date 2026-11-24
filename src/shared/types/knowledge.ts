/**
 * Knowledge base type definitions
 * Based on the Drizzle database schema to keep a single source of truth
 */

import type { Document, Chunk } from '../../main/db/schema'

/**
 * Document type (uses the type inferred by Drizzle directly)
 */
export type KnowledgeDocument = Document

/**
 * Document chunk (uses the type inferred by Drizzle directly)
 */
export type KnowledgeChunk = Chunk

/**
 * Document type enum
 */
export type DocumentType = 'file' | 'note' | 'url' | 'text'

/**
 * Document status enum
 */
export type DocumentStatus = 'pending' | 'processing' | 'indexed' | 'failed'

/**
 * Phạm vi truy hồi do người dùng chọn (Metadata-Aware Retrieval).
 * Đây là "filter tầng": đúng tài liệu → đúng mục → đúng khoảng trang.
 */
export interface RetrievalScope {
  documentIds?: string[]
  sectionPath?: string[]
  pageRange?: { from: number; to: number }
}

/**
 * Bộ lọc metadata cho tìm kiếm.
 */
export interface SearchMetadataFilter extends RetrievalScope {
  documentTypes?: Array<'file' | 'note' | 'url' | 'text' | 'memory'>
  sourceUriContains?: string
  /** So khớp documents.metadata.documentMetadata (vd documentNumber, documentType). */
  documentMetadata?: Record<string, string>
}

/**
 * Search results
 */
export interface KnowledgeSearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  sourceUri?: string
  pageNumber?: number
  sectionPath?: string[]
  content: string
  score: number
  chunkIndex: number
  metadata?: Record<string, unknown>
}

/**
 * Indexing progress
 */
export interface IndexProgress {
  notebookId?: string
  documentId?: string
  stage: string
  progress: number
}

/**
 * Knowledge base statistics
 */
export interface KnowledgeStats {
  documentCount: number
  chunkCount: number
  embeddingCount: number
}

/**
 * Add document options
 */
export interface AddDocumentOptions {
  title: string
  type: DocumentType
  content: string
  sourceUri?: string
  sourceNoteId?: string
  mimeType?: string
  fileSize?: number
  metadata?: Record<string, unknown>
}

/**
 * Số chiều vector mà schema sqlite-vec hiện tại yêu cầu (`vec0(... FLOAT[1024])`).
 * Model embedding trả về số chiều khác sẽ bị từ chối trước khi ghi dữ liệu.
 */
export const REQUIRED_EMBEDDING_DIMENSIONS = 1024

/**
 * Search options
 */
export interface SearchOptions {
  topK?: number
  threshold?: number
  includeContent?: boolean
  metadataFilter?: SearchMetadataFilter
  /** Tầng 1 của Hierarchical Retrieval: chọn tài liệu trước, rồi tìm chunk. */
  hierarchical?: {
    enabled?: boolean
    docTopK?: number
    sectionTopK?: number
    threshold?: number
  }
  /** Run metadata planning before retrieval. Query-derived constraints are conservative. */
  metadataAware?: {
    enabled?: boolean
    debug?: boolean
    minPreferredResults?: number
  }
  rerank?: {
    enabled?: boolean
    topN?: number
    heuristicFallback?: boolean
  }
}
