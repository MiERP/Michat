/**
 * Public types for the knowledge-base facade.
 *
 * They live next to the extracted RAG modules so the modules can share the
 * contracts without importing the facade (which would create a cycle).
 */

import type { ChunkOptions } from '../ChunkingService'

export interface AddDocumentOptions {
  title: string
  type: 'file' | 'note' | 'url' | 'text' | 'memory'
  content: string
  sourceUri?: string
  sourceNoteId?: string
  memoryOfSessionId?: string
  mimeType?: string
  fileSize?: number
  metadata?: Record<string, unknown>
  chunkOptions?: ChunkOptions
}

export interface SearchMetadataFilter {
  documentIds?: string[]
  documentTypes?: Array<'file' | 'note' | 'url' | 'text' | 'memory'>
  sourceUriContains?: string
  /**
   * Chỉ lấy chunk thuộc một mục (heading) nhất định — so khớp theo headingPath,
   * không phân biệt hoa/thường, theo thứ tự xuất hiện (subsequence).
   */
  sectionPath?: string[]
  /** Khoảng trang (1-based, bao gồm hai đầu). Chunk không rõ trang sẽ bị loại. */
  pageRange?: { from: number; to: number }
  /**
   * So khớp trường trong documents.metadata.documentMetadata
   * (vd { documentNumber: '15/NQ-CP' } hoặc { documentType: 'contract' }).
   */
  documentMetadata?: Record<string, string>
}

export interface SearchOptions {
  topK?: number
  threshold?: number
  includeContent?: boolean
  metadataFilter?: SearchMetadataFilter
  /**
   * Hierarchical Retrieval 3 tầng: chọn tài liệu (vector cấp tài liệu) →
   * chọn mục bên trong tài liệu đã chọn (vector cấp section) → tìm chunk.
   * Tầng section tự bỏ qua khi section index chưa đủ phủ (fallback flat).
   */
  hierarchical?: {
    enabled?: boolean
    docTopK?: number
    sectionTopK?: number
    threshold?: number
  }
  metadataAware?: {
    enabled?: boolean
    debug?: boolean
    minPreferredResults?: number
  }
  rerank?: {
    enabled?: boolean
    topN?: number
    model?: string
    heuristicFallback?: boolean
  }
}

export interface SearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  sourceUri?: string
  pageNumber?: number
  sectionPath?: string[]
  content: string
  matchedContent?: string
  score: number
  chunkIndex: number
  metadata?: Record<string, unknown>
}

export interface DocumentPageContent {
  documentId: string
  documentTitle: string
  pageNumber: number
  content: string
  sourceUri?: string
  highlightText?: string
}

export type IndexProgressCallback = (stage: string, progress: number) => void

export interface BatchIndexResult {
  totalFiles: number
  indexedFiles: number
  failedFiles: Array<{ filePath: string; error: string }>
  /** Id các document đã index xong (để enqueue làm giàu/liên kết cho từng cái). */
  indexedDocumentIds: string[]
}

export interface IncrementalReindexResult {
  created: number
  reused: number
  removed: number
}

export interface AutoSyncPayload {
  documentId: string
  documentTitle: string
  reason: 'file-changed' | 'note-updated'
  result?: IncrementalReindexResult
  error?: string
}
