/**
 * 知识库相关类型定义
 * 基于 Drizzle 推导的数据库 schema,确保类型定义的单一数据源
 */

import type { Document, Chunk } from '../../main/db/schema'

/**
 * 文档类型（直接使用 Drizzle 推导的类型）
 */
export type KnowledgeDocument = Document

/**
 * 文档分块（直接使用 Drizzle 推导的类型）
 */
export type KnowledgeChunk = Chunk

/**
 * 文档类型枚举
 */
export type DocumentType = 'file' | 'note' | 'url' | 'text'

/**
 * 文档状态枚举
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
 * 搜索结果
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
 * 索引进度
 */
export interface IndexProgress {
  notebookId?: string
  documentId?: string
  stage: string
  progress: number
}

/**
 * 知识库统计
 */
export interface KnowledgeStats {
  documentCount: number
  chunkCount: number
  embeddingCount: number
}

/**
 * 添加文档选项
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
 * 搜索选项
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
