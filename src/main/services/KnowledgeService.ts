/**
 * KnowledgeService
 * Knowledge base core service: document management, chunking, embedding, retrieval
 *
 * Refactored: Extracted shared _indexContent() method to eliminate duplication (Q-01)
 * Fixed: reindexDocument no longer creates duplicate records (BUG-02)
 */

import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { app } from 'electron'
import { join, basename, extname } from 'path'
import { mkdir, copyFile, unlink, stat, readdir, readFile } from 'fs/promises'
import { existsSync, watch, type FSWatcher } from 'fs'
import { getDatabase, executeCheckpoint, getSqlite } from '../db'
import {
  documents,
  chunks,
  embeddings,
  notes,
  chunkFeedback,
  knowledgeLinks,
  sections
} from '../db/schema'
import type {
  Document,
  Chunk,
  NewDocument,
  NewChunk,
  NewEmbedding,
  NewChunkFeedback,
  NewSection
} from '../db/schema'
import { and, eq, desc, inArray, isNull, sql } from 'drizzle-orm'
import { EmbeddingService } from './EmbeddingService'
import { ChunkingService, type ChunkOptions, type ChunkStructureContext } from './ChunkingService'
import { FileParserService } from './FileParserService'
import type { SectionInfo } from './loaders/types'
import { validateImportableFile } from './import/fileValidation'
import {
  flattenSectionsWithPath,
  sanitizeCompactSections,
  findDeepestSection,
  type CompactSection
} from './loaders/sections'
import { MarkdownNormalizer } from './MarkdownNormalizer'
import { detectQueryMetadata, normalizeMetadataValue } from '../utils/queryMetadata'
import {
  extractDocumentMetadata,
  inspectorFromMetadata,
  isOriginalLegalDocument,
  mergeDocumentMetadataInspector,
  metadataFromInspector,
  type DocumentMetadata,
  type DocumentMetadataInspector
} from './DocumentMetadataExtractionService'
import { RerankService } from './RerankService'
import { vectorStoreManager, documentVectorStore, sectionVectorStore } from '../vectorstore'
import { ProviderManager } from '../providers/ProviderManager'
import { LlamaService } from './LlamaService'
import Logger from '../../shared/utils/logger'
import { isPathInsideDirectory } from '../security/guards'
import { REQUIRED_EMBEDDING_DIMENSIONS } from '../../shared/types/knowledge'
import type { MetadataAwareSearchResult, RetrievalTrace } from '../../shared/types/retrieval'
import {
  createRetrievalPlan,
  mergePreferredAndBroadResults,
  type ExplicitRetrievalScope
} from './RetrievalPlanner'
import { DocumentMetadataIndexService } from './DocumentMetadataIndexService'
import { WebFetchService } from './WebFetchService'

/** Giới hạn số chunk mở rộng theo MỤC (small-to-big) để context không phình. */
const MAX_SECTION_CONTEXT_CHUNKS = 12

/** Giới hạn số chunk id nhét vào mệnh đề IN của SQL (tránh vượt hạn tham số). */
const MAX_PARAMETERIZED_CHUNK_FILTER = 5000

/** Kích thước lô khi phải lọc FTS theo danh sách chunk id rất lớn. */
const FTS_FILTER_BATCH_SIZE = 900

/** Số ký tự tối đa của nội dung đưa vào vector cấp tài liệu. */
const DOCUMENT_INDEX_MAX_CHARS = 2000

/** Số ký tự tối đa của nội dung mục đưa vào vector cấp mục (section). */
const SECTION_INDEX_MAX_CHARS = 1200

/** Nhận diện nội dung có heading markdown (điều kiện để backfill cấu trúc mục). */
const HEADING_MARKER_REGEX = /^#{1,6}\s+\S/m

interface RetrievalMetadataProjection {
  keywords: string[]
  entities: string[]
  tags: string[]
}

/**
 * Dựng biểu thức MATCH cho FTS5.
 *
 * Bản cũ dùng `"cả câu" OR cả câu`: FTS5 hiểu nhánh thứ hai là AND các từ, nên
 * truy vấn nhiều từ hầu như không khớp gì (recall rất thấp, chỉ còn nhánh vector
 * gánh). Ở đây tách thành từng từ rồi OR — BM25 vẫn tự xếp hạng theo số từ khớp
 * và độ hiếm của từ.
 */
export function buildFtsMatchQuery(query: string): string {
  const safe = query.replace(/["'*()]/g, ' ').trim()
  if (!safe) return ''

  const terms = safe.split(/\s+/).filter((term) => term.length >= 2)
  if (terms.length === 0) return ''
  if (terms.length === 1) return `"${terms[0]}"`

  return terms.map((term) => `"${term}"`).join(' OR ')
}

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

/**
 * Cấu trúc tài liệu sau khi loader/normalizer trả về.
 * Offset tính trên content sẽ được lưu vào documents.content.
 */
export interface DocumentStructureLike {
  type: 'flat' | 'pages' | 'sections'
  pages?: Array<{ pageNumber: number; startOffset: number; endOffset: number }>
  sections?: SectionInfo[]
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

export class KnowledgeService {
  private embeddingService: EmbeddingService
  private chunkingService: ChunkingService
  private fileParserService: FileParserService
  private rerankService: RerankService
  private markdownNormalizer: MarkdownNormalizer
  private metadataIndexService = new DocumentMetadataIndexService()
  private webFetchService = new WebFetchService()
  private knowledgeFilesDir: string
  private llamaService?: LlamaService
  private fileWatchers = new Map<string, FSWatcher>()
  private syncTimers = new Map<string, NodeJS.Timeout>()
  private autoSyncCallback?: (payload: AutoSyncPayload) => void
  private autoSyncRunning = false

  constructor(providerManager: ProviderManager, llamaService?: LlamaService) {
    this.embeddingService = new EmbeddingService(providerManager)
    this.chunkingService = new ChunkingService()
    this.fileParserService = new FileParserService()
    this.rerankService = new RerankService()
    this.markdownNormalizer = new MarkdownNormalizer()
    this.llamaService = llamaService
    this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
    this.ensureKnowledgeFilesDir()
  }

  /**
   * Đảm bảo embedding server (llama.cpp :8001) đang chạy trước khi index/search.
   * Đây là lớp bảo vệ ở tầng service: mọi caller (IPC, watcher, background queue)
   * đều được đảm bảo server sẵn sàng, không chỉ các handler đã gọi thủ công.
   */
  private async ensureEmbeddingReady(): Promise<void> {
    if (!this.llamaService) return
    const ready = await this.llamaService.ensureEmbeddingStarted()
    if (!ready) {
      throw new Error(
        'Embedding server is unavailable. Please import/select an embedding model (e.g. bge/e5) and try again.'
      )
    }
  }

  /**
   * Số chiều embedding thực tế của model đang cấu hình.
   * Dùng cho UI kiểm tra trước khi giữ lựa chọn model mới.
   */
  async probeEmbeddingDimensions(): Promise<number> {
    await this.ensureEmbeddingReady()
    return this.embeddingService.probeDimensions()
  }

  /**
   * Chặn sớm khi model embedding không khớp schema vector (1024 chiều), trước
   * khi ghi chunk/embedding — tránh để lại tài liệu `failed` giữa chừng.
   */
  private async assertEmbeddingDimensions(): Promise<void> {
    const dimensions = await this.probeEmbeddingDimensions()
    if (dimensions !== REQUIRED_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding model returns ${dimensions}-dimensional vectors, but MiChat requires ` +
          `${REQUIRED_EMBEDDING_DIMENSIONS}. Choose a ${REQUIRED_EMBEDDING_DIMENSIONS}-dimension ` +
          'model (for example bge-m3).'
      )
    }
  }

  private async ensureKnowledgeFilesDir(): Promise<void> {
    try {
      await mkdir(this.knowledgeFilesDir, { recursive: true })
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to create knowledge files directory:', error)
    }
  }

  private async copyFileToKnowledgeDir(
    sourceFilePath: string,
    documentId: string,
    extension: string
  ): Promise<string> {
    await this.ensureKnowledgeFilesDir()
    const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin'
    const localFilePath = join(this.knowledgeFilesDir, `${documentId}.${safeExtension}`)
    await copyFile(sourceFilePath, localFilePath)
    Logger.info('KnowledgeService', `File copied: ${sourceFilePath} -> ${localFilePath}`)
    return localFilePath
  }

  private async deleteLocalFile(localFilePath: string): Promise<void> {
    if (!this.isManagedLocalFilePath(localFilePath)) {
      Logger.warn('KnowledgeService', `Refusing to delete unmanaged path: ${localFilePath}`)
      return
    }
    try {
      const exists = await stat(localFilePath)
        .then(() => true)
        .catch(() => false)
      if (exists) {
        await unlink(localFilePath)
        Logger.info('KnowledgeService', `Local file deleted: ${localFilePath}`)
      }
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to delete local file:', error)
    }
  }

  isManagedLocalFilePath(filePath: string): boolean {
    return isPathInsideDirectory(filePath, this.knowledgeFilesDir)
  }

  /**
   * Rút gọn cấu trúc tài liệu để lưu vào documents.metadata.
   * Giữ CẢ pages (PDF/PPT) và sections (Word/Markdown) — sections trước đây bị
   * bỏ hoàn toàn nên metadata-aware retrieval không có gì để lọc.
   */
  private buildCompactStructureMetadata(
    structure: DocumentStructureLike | undefined
  ): Record<string, unknown> | undefined {
    if (!structure) return undefined

    const pages = structure.pages
      ?.filter(
        (page) =>
          typeof page?.startOffset === 'number' &&
          typeof page?.endOffset === 'number' &&
          page.endOffset > page.startOffset
      )
      .map((page) => ({
        pageNumber: page.pageNumber,
        startOffset: page.startOffset,
        endOffset: page.endOffset
      }))

    const sections = structure.sections?.length
      ? sanitizeCompactSections(flattenSectionsWithPath(structure.sections))
      : undefined

    if (!pages?.length && !sections?.length) return undefined

    return {
      structure: {
        type: structure.type,
        ...(pages?.length ? { pages } : {}),
        ...(sections?.length ? { sections } : {})
      }
    }
  }

  /**
   * Dựng ngữ cảnh cấu trúc truyền cho ChunkingService để neo headingPath/trang.
   */
  private buildChunkStructureContext(
    structure: DocumentStructureLike | undefined
  ): ChunkStructureContext | undefined {
    if (!structure) return undefined

    const sections = structure.sections?.length
      ? sanitizeCompactSections(flattenSectionsWithPath(structure.sections))
      : undefined
    const pages = structure.pages?.length
      ? structure.pages.map((page) => ({
          pageNumber: page.pageNumber,
          startOffset: page.startOffset,
          endOffset: page.endOffset
        }))
      : undefined

    if (!sections?.length && !pages?.length) return undefined
    return { sections, pages }
  }

  /** Metadata pháp lý đã trích, chỉ giữ các trường có giá trị. */
  private extractLegalMetadata(
    metadata: Record<string, unknown> | null | undefined
  ): Record<string, string> | undefined {
    const source = metadata?.documentMetadata
    if (!source || typeof source !== 'object') return undefined

    const result: Record<string, string> = {}
    for (const key of [
      'documentNumber',
      'documentType',
      'issuer',
      'issuedAt',
      'documentTitle',
      'legalBases'
    ]) {
      const value = (source as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) result[key] = value.trim()
    }

    return Object.keys(result).length > 0 ? result : undefined
  }

  private extractRetrievalMetadata(
    metadata: Record<string, unknown> | null | undefined
  ): RetrievalMetadataProjection {
    const enrichment =
      metadata?.enrichment &&
      typeof metadata.enrichment === 'object' &&
      !Array.isArray(metadata.enrichment)
        ? (metadata.enrichment as Record<string, unknown>)
        : {}
    const readList = (value: unknown): string[] =>
      Array.isArray(value)
        ? [
            ...new Set(
              value
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean)
            )
          ]
        : []

    return {
      keywords: readList(enrichment.keywords),
      entities: readList(enrichment.entities),
      tags: readList(metadata?.tags)
    }
  }

  private readDocumentMetadataProjection(documentId: string): {
    legalMetadata?: Record<string, string>
    retrievalMetadata: RetrievalMetadataProjection
  } {
    const row = getDatabase()
      .select({ metadata: documents.metadata })
      .from(documents)
      .where(eq(documents.id, documentId))
      .get()
    const metadata = row?.metadata as Record<string, unknown> | null | undefined
    return {
      legalMetadata: this.extractLegalMetadata(metadata),
      retrievalMetadata: this.extractRetrievalMetadata(metadata)
    }
  }

  private withRetrievalMetadata(
    metadata: Record<string, unknown> | null | undefined,
    projection: {
      legalMetadata?: Record<string, string>
      retrievalMetadata: RetrievalMetadataProjection
    }
  ): Record<string, unknown> | undefined {
    const result = { ...(metadata || {}) }
    if (projection.legalMetadata) result.documentMetadata = projection.legalMetadata
    else delete result.documentMetadata

    const hasRetrievalMetadata = Object.values(projection.retrievalMetadata).some(
      (values) => values.length > 0
    )
    if (hasRetrievalMetadata) result.retrievalMetadata = projection.retrievalMetadata
    else delete result.retrievalMetadata

    return Object.keys(result).length > 0 ? result : undefined
  }

  private legalMetadataIndexText(legalMetadata: Record<string, string> | undefined): string {
    if (!legalMetadata) return ''
    return [
      legalMetadata.documentNumber,
      legalMetadata.documentType,
      legalMetadata.issuer,
      legalMetadata.issuedAt
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' · ')
  }

  private retrievalMetadataIndexText(metadata: RetrievalMetadataProjection): string {
    return [...metadata.keywords, ...metadata.entities, ...metadata.tags].join(' · ')
  }

  /**
   * Text dùng để embed ở cấp TÀI LIỆU: ưu tiên summary (enrichment), nếu chưa có
   * thì dùng tiêu đề + phần đầu nội dung — đủ để phân biệt chủ đề tài liệu.
   */
  private buildDocumentIndexText(doc: Document): string {
    const metadata = (doc.metadata as Record<string, unknown> | null) || {}
    const enrichment = metadata.enrichment as { summary?: unknown } | undefined
    const summary = typeof enrichment?.summary === 'string' ? enrichment.summary.trim() : ''
    const legalText = this.legalMetadataIndexText(this.extractLegalMetadata(metadata))
    const retrievalText = this.retrievalMetadataIndexText(this.extractRetrievalMetadata(metadata))

    const heading = (doc.title || '').trim()
    const body = (doc.content || '').trim().slice(0, DOCUMENT_INDEX_MAX_CHARS)

    return [heading, legalText, retrievalText, summary, body]
      .filter((part) => part.length > 0)
      .join('\n\n')
  }

  /**
   * Cập nhật vector cấp tài liệu (tầng 1 của Hierarchical Retrieval).
   * Đây là bước phụ trợ: lỗi chỉ được log, không được làm hỏng luồng index chính.
   */
  private async updateDocumentVector(documentId: string, notebookId: string): Promise<void> {
    try {
      const db = getDatabase()
      const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
      if (!doc) return

      const text = this.buildDocumentIndexText(doc)
      if (!text) return

      const [result] = await this.embeddingService.embedBatch([text], { dimensions: 1024 })
      if (!result) return
      if (result.dimensions !== 1024) {
        Logger.warn(
          'KnowledgeService',
          `Skip document vector for ${documentId}: unexpected dimensions ${result.dimensions}`
        )
        return
      }

      documentVectorStore.upsert(notebookId, [
        { id: `docvec_${documentId}`, documentId, vector: result.embedding }
      ])
    } catch (error) {
      Logger.warn('KnowledgeService', `Failed to update document vector for ${documentId}:`, error)
    }
  }

  /**
   * Cập nhật lại vector cấp tài liệu (dùng sau khi enrichment có summary mới).
   */
  async refreshDocumentVector(documentId: string): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return

    await this.updateDocumentVector(documentId, doc.notebookId)
  }

  /**
   * Xóa vector cấp tài liệu khi document bị xóa.
   */
  private removeDocumentVectors(documentIds: string[]): void {
    try {
      documentVectorStore.deleteByDocumentIds(documentIds)
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to remove document vectors:', error)
    }
  }

  /**
   * Dựng bản ghi MỤC (section) từ cấu trúc phẳng của tài liệu có heading.
   * Chỉ giữ mục có nội dung thật (bỏ mục chỉ có tiêu đề). Trả về danh sách
   * bản ghi và hàm gán sectionId cho chunk theo offset bắt đầu.
   */
  private buildSectionRecords(
    notebookId: string,
    documentId: string,
    content: string,
    compactSections: CompactSection[] | undefined
  ): { records: NewSection[]; assign: (startOffset: number | null) => string | null } {
    const empty = { records: [], assign: () => null }

    if (!compactSections?.length) return empty

    const sanitized = sanitizeCompactSections(compactSections)
    if (sanitized.length === 0) return empty

    const now = new Date()
    const records: NewSection[] = []
    const idByOffset = new Map<string, string>()

    for (const section of sanitized) {
      const raw = content.slice(section.startOffset, section.endOffset)
      const title = (section.title || '').trim()
      // Bỏ dòng heading để biết mục có nội dung thật hay chỉ có tiêu đề.
      const body = raw.replace(/^#{1,6}[ \t]+.+?[ \t]*(\r?\n|$)/, '').trim()
      if (!body || !title) continue

      const id = `sec_${randomUUID()}`
      const key = `${section.startOffset}:${section.endOffset}`
      idByOffset.set(key, id)
      records.push({
        id,
        notebookId,
        documentId,
        headingPath: section.headingPath,
        title,
        level: section.level,
        content: raw.trim(),
        contentHash: createHash('md5').update(raw).digest('hex'),
        startOffset: section.startOffset,
        endOffset: section.endOffset,
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      })
    }

    if (records.length === 0) return empty

    const assign = (startOffset: number | null): string | null => {
      if (startOffset === null || startOffset === undefined) return null
      const keyOf = (section: CompactSection): string =>
        `${section.startOffset}:${section.endOffset}`

      const deepest = findDeepestSection(sanitized, startOffset)
      if (deepest) {
        const direct = idByOffset.get(keyOf(deepest))
        if (direct) return direct

        // Mục sâu nhất không có bản ghi (chỉ có tiêu đề, như H1) → gán về mục
        // con đầu tiên có bản ghi xuất hiện sau đó, để chunk không bị coi là
        // "không thuộc mục nào" rồi lọt qua tầng section khi truy vấn.
        const successor = sanitized.find(
          (section) => section.startOffset >= deepest.startOffset && idByOffset.has(keyOf(section))
        )
        if (successor) return idByOffset.get(keyOf(successor)) ?? null
        return null
      }

      // Chunk bắt đầu TRƯỚC mục đầu tiên (preamble) → gán về mục đầu tiên có
      // bản ghi (thường là mục 1).
      if (sanitized.length > 0 && startOffset < sanitized[0].startOffset) {
        const firstWithRecord = sanitized.find((section) => idByOffset.has(keyOf(section)))
        if (firstWithRecord) return idByOffset.get(keyOf(firstWithRecord)) ?? null
      }

      return null
    }

    return { records, assign }
  }

  /**
   * Cập nhật vector cấp MỤC (tầng giữa Hierarchical Retrieval) — best-effort:
   * lỗi chỉ log, không làm hỏng luồng index chính. Xoá vector cũ của document
   * trước khi upsert để mục đã bị xoá không để lại vector mồ côi.
   */
  private async updateSectionVectors(
    notebookId: string,
    documentId: string,
    records: NewSection[]
  ): Promise<void> {
    if (records.length === 0) {
      // Document no longer has sections — drop the vectors it left behind so the
      // section tier cannot point at deleted `sections` rows.
      sectionVectorStore.deleteByDocumentIds([documentId])
      return
    }

    try {
      const doc = getDatabase()
        .select({ metadata: documents.metadata })
        .from(documents)
        .where(eq(documents.id, documentId))
        .get()
      const rootMetadata = doc?.metadata as Record<string, unknown> | null
      const legalText = this.legalMetadataIndexText(this.extractLegalMetadata(rootMetadata))
      const retrievalText = this.retrievalMetadataIndexText(
        this.extractRetrievalMetadata(rootMetadata)
      )
      const texts = records.map((record) =>
        [record.title, legalText, retrievalText, record.content.slice(0, SECTION_INDEX_MAX_CHARS)]
          .filter((part) => part.length > 0)
          .join('\n\n')
      )
      const results = await this.embeddingService.embedBatch(texts, { dimensions: 1024 })

      const items: Array<{
        id: string
        sectionId: string
        documentId: string
        vector: Float32Array
      }> = []

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (!result || result.dimensions !== 1024) continue
        items.push({
          id: `secvec_${records[i].id}`,
          sectionId: records[i].id,
          documentId: records[i].documentId,
          vector: result.embedding
        })
      }

      sectionVectorStore.deleteByDocumentIds([documentId])
      sectionVectorStore.upsert(notebookId, items)
    } catch (error) {
      Logger.warn('KnowledgeService', `Failed to update section vectors for ${documentId}:`, error)
    }
  }

  /**
   * Ghi lại số chunk thực tế thuộc mỗi mục sau khi index xong.
   * `chunk_count` chỉ phục vụ thống kê/UI; lỗi không được làm hỏng index.
   */
  private updateSectionChunkCounts(documentId: string): void {
    try {
      const db = getDatabase()
      const rows = db
        .select({ sectionId: chunks.sectionId })
        .from(chunks)
        .where(eq(chunks.documentId, documentId))
        .all()

      const counts = new Map<string, number>()
      for (const row of rows) {
        if (!row.sectionId) continue
        counts.set(row.sectionId, (counts.get(row.sectionId) ?? 0) + 1)
      }

      const sectionRows = db
        .select({ id: sections.id, chunkCount: sections.chunkCount })
        .from(sections)
        .where(eq(sections.documentId, documentId))
        .all()

      for (const section of sectionRows) {
        const next = counts.get(section.id) ?? 0
        if (section.chunkCount === next) continue
        db.update(sections)
          .set({ chunkCount: next, updatedAt: new Date() })
          .where(eq(sections.id, section.id))
          .run()
      }
    } catch (error) {
      Logger.warn(
        'KnowledgeService',
        `Failed to update section chunk counts for ${documentId}:`,
        error
      )
    }
  }

  /**
   * Embed lại các chunk CHƯA có vector — dùng sau khi bảng vector phải tạo lại
   * (vec0 không ALTER được nên bảng cũ thiếu cột document_id bị drop) hoặc khi
   * vector bị mất vì bất kỳ lý do gì.
   *
   * Chạy theo lô để job nền có thể dừng giữa đường mà vẫn tiến được.
   */
  async rebuildMissingVectors(
    notebookId: string,
    limit = 200
  ): Promise<{ rebuilt: number; remaining: number; ftsRebuilt: number }> {
    await this.ensureEmbeddingReady()

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

    const embeddingResults = await this.embeddingService.embedBatch(
      batchRows.map((row) => row.content),
      { dimensions: 1024 }
    )

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
      if (!embResult || embResult.dimensions !== 1024) continue

      // Bảng `embeddings` có thể vẫn còn dòng metadata từ trước → tái sử dụng id
      // để giữ quan hệ 1-1 với vector.
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
            model: embResult.model,
            dimensions: embResult.dimensions,
            createdAt: now
          })
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
   * Tài liệu cần backfill: thiếu vector cấp tài liệu, thiếu cấu trúc mục trong
   * khi nội dung CÓ heading (tài liệu cũ index trước khi có headingPath), hoặc
   * đã có cấu trúc mục nhưng chưa có bản ghi section/vector cấp mục.
   *
   * Chỉ trả các tài liệu mà việc index lại thực sự có thể cải thiện — tài liệu
   * không có heading thì index lại cũng không sinh thêm mục, tránh vòng lặp job.
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

      // Có cấu trúc mục nhưng chưa có section record (index trước khi có
      // section index) → reindex để dựng tầng mục cho Hierarchical Retrieval.
      if (hasSections && !documentIdsWithSections.has(row.id)) {
        needs.push(row.id)
      }
    }

    return needs
  }

  /**
   * Text đưa vào FTS5. Heading path được ghép vào đầu để BM25 bắt được tên mục
   * (vd gõ "Termination" khớp đúng section), trong khi chunk.content giữ nguyên.
   */
  private buildFtsIndexText(content: string, metadata?: Record<string, unknown> | null): string {
    const headingPath = metadata?.headingPath
    const path =
      Array.isArray(headingPath) && headingPath.length > 0
        ? headingPath.filter((part) => typeof part === 'string' && part.trim()).join(' > ')
        : ''

    const legal = metadata?.documentMetadata as Record<string, string> | undefined
    const legalText = this.legalMetadataIndexText(legal)
    const retrieval = metadata?.retrievalMetadata as RetrievalMetadataProjection | undefined
    const retrievalText = retrieval ? this.retrievalMetadataIndexText(retrieval) : ''
    const header = [path, legalText, retrievalText].filter((part) => part.length > 0).join(' > ')

    return header ? `${header}\n${content}` : content
  }

  private getPageNumberForChunk(
    documentMetadata: Record<string, unknown> | null | undefined,
    startOffset: number | null,
    endOffset: number | null
  ): number | undefined {
    if (
      !documentMetadata ||
      startOffset === null ||
      startOffset === undefined ||
      endOffset === null ||
      endOffset === undefined
    ) {
      return undefined
    }

    const structure = (documentMetadata as any).structure
    if (!structure || structure.type !== 'pages' || !Array.isArray(structure.pages)) {
      return undefined
    }

    const page = structure.pages.find((p: any) => {
      if (
        typeof p?.startOffset !== 'number' ||
        typeof p?.endOffset !== 'number' ||
        typeof p?.pageNumber !== 'number'
      ) {
        return false
      }

      return startOffset < p.endOffset && endOffset >= p.startOffset
    })

    return page?.pageNumber
  }

  /**
   * Nội dung ngữ cảnh cho một chunk đã trúng (small-to-big):
   *  - Có neo mục (sectionStart/sectionEnd) → lấy mọi chunk trong cùng mục.
   *  - Không có → prev + current + next như trước.
   */
  private collectContextContents(docChunks: Chunk[], currentChunk: Chunk): string[] {
    const metadata = (currentChunk.metadata as Record<string, unknown> | null) || undefined
    const sectionStart = metadata?.sectionStart
    const sectionEnd = metadata?.sectionEnd

    if (typeof sectionStart === 'number' && typeof sectionEnd === 'number') {
      const inSection = docChunks.filter((candidate) => {
        const candidateMetadata =
          (candidate.metadata as Record<string, unknown> | null) || undefined
        const start = candidateMetadata?.sectionStart
        return typeof start === 'number' && start >= sectionStart && start < sectionEnd
      })

      if (inSection.length > 0 && inSection.length <= MAX_SECTION_CONTEXT_CHUNKS) {
        return [...inSection]
          .sort((a, b) => a.chunkIndex - b.chunkIndex)
          .map((candidate) => candidate.content)
      }
    }

    const cIndex = currentChunk.chunkIndex
    const prevChunk = docChunks.find((c) => c.chunkIndex === cIndex - 1)
    const nextChunk = docChunks.find((c) => c.chunkIndex === cIndex + 1)

    const contents: string[] = []
    if (prevChunk) contents.push(prevChunk.content)
    contents.push(currentChunk.content)
    if (nextChunk) contents.push(nextChunk.content)
    return contents
  }

  /**
   * Lấy heading path đã gắn lúc index (chunk.metadata.headingPath).
   */
  private extractHeadingPath(
    chunkMetadata: Record<string, unknown> | null | undefined
  ): string[] | undefined {
    const headingPath = chunkMetadata?.headingPath
    if (!Array.isArray(headingPath)) return undefined

    const parts = headingPath.filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0
    )
    return parts.length > 0 ? parts : undefined
  }

  /**
   * Số trang của chunk: ưu tiên pageStart gắn lúc index (mọi loader), fallback
   * sang suy từ documents.metadata.structure.pages (dữ liệu cũ chưa có metadata).
   */
  private resolveChunkPageNumber(
    documentMetadata: Record<string, unknown> | null | undefined,
    chunkMetadata: Record<string, unknown> | null | undefined,
    startOffset: number | null,
    endOffset: number | null
  ): number | undefined {
    const pageStart = chunkMetadata?.pageStart
    if (typeof pageStart === 'number' && Number.isFinite(pageStart)) return pageStart

    return this.getPageNumberForChunk(documentMetadata, startOffset, endOffset)
  }

  /**
   * Tự suy filter metadata từ câu hỏi (số hiệu, loại văn bản, cơ quan) và đối
   * chiếu với metadata thật đã lưu. Chỉ trả filter khi kết quả không mơ hồ —
   * nếu không, retrieval chạy bình thường để tránh lọc rỗng.
   */
  detectMetadataFilter(notebookId: string, query: string): Record<string, string> | undefined {
    const signals = detectQueryMetadata(query)
    if (
      !signals.documentNumber &&
      signals.documentTypes.length === 0 &&
      signals.issuers.length === 0
    ) {
      return undefined
    }

    const rows = getDatabase()
      .select({ metadata: documents.metadata })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .all()
    const metadataList = rows
      .map((row) => this.extractLegalMetadata(row.metadata as Record<string, unknown> | null))
      .filter((value): value is Record<string, string> => !!value)

    if (metadataList.length === 0) return undefined

    const uniqueValues = (values: string[]): string[] => Array.from(new Set(values))

    if (signals.documentNumber) {
      const target = normalizeMetadataValue(signals.documentNumber)
      const targetHasYear = /^\d{1,4}\d{4}[A-Z]/.test(target)
      const values = uniqueValues(
        metadataList
          .filter((metadata) => {
            if (!metadata.documentNumber) return false
            const stored = normalizeMetadataValue(metadata.documentNumber)
            if (targetHasYear) return stored === target || stored.includes(target)
            // Người dùng chỉ nói "15/NQ-CP": so với bản đã bỏ năm của số hiệu lưu.
            return stored.replace(/^(\d{1,4})\d{4}(?=[A-Z])/, '$1') === target
          })
          .map((metadata) => metadata.documentNumber)
      )
      return values.length === 1 ? { documentNumber: values[0] } : undefined
    }

    const filters: Record<string, string> = {}

    if (signals.documentTypes.length === 1) {
      const target = normalizeMetadataValue(signals.documentTypes[0])
      const values = uniqueValues(
        metadataList
          .filter(
            (metadata) =>
              metadata.documentType &&
              normalizeMetadataValue(metadata.documentType).includes(target)
          )
          .map((metadata) => metadata.documentType)
      )
      if (values.length === 1) filters.documentType = values[0]
    }

    if (signals.issuers.length === 1) {
      const target = normalizeMetadataValue(signals.issuers[0])
      const values = uniqueValues(
        metadataList
          .filter(
            (metadata) =>
              metadata.issuer && normalizeMetadataValue(metadata.issuer).includes(target)
          )
          .map((metadata) => metadata.issuer)
      )
      if (values.length === 1) filters.issuer = values[0]
    }

    if (Object.keys(filters).length === 0) return undefined

    const matches = metadataList.filter((metadata) =>
      Object.entries(filters).every(([key, value]) =>
        normalizeMetadataValue(metadata[key] || '').includes(normalizeMetadataValue(value))
      )
    )

    return matches.length > 0 ? filters : undefined
  }

  private resolveFilteredDocumentIds(
    notebookId: string,
    metadataFilter: SearchOptions['metadataFilter']
  ): string[] | null {
    if (!metadataFilter) return null

    const hasDocumentLevelFilter =
      !!metadataFilter.documentIds?.length ||
      !!metadataFilter.documentTypes?.length ||
      !!metadataFilter.sourceUriContains?.trim()

    const metadataEntries = Object.entries(metadataFilter.documentMetadata || {}).filter(
      ([, value]) => typeof value === 'string' && value.trim().length > 0
    )

    // sectionPath/pageRange chỉ lọc ở cấp chunk — không giới hạn document.
    if (!hasDocumentLevelFilter && metadataEntries.length === 0) return null

    const filters = [eq(documents.notebookId, notebookId)]

    if (metadataFilter.documentIds?.length) {
      filters.push(inArray(documents.id, metadataFilter.documentIds))
    }

    if (metadataFilter.documentTypes?.length) {
      filters.push(inArray(documents.type, metadataFilter.documentTypes))
    }

    const db = getDatabase()
    const docs = db
      .select({
        id: documents.id,
        sourceUri: documents.sourceUri,
        metadata: documents.metadata
      })
      .from(documents)
      .where(and(...(filters as any)))
      .all()

    const normalizedSource = metadataFilter.sourceUriContains?.trim().toLowerCase()

    return docs
      .filter((doc) => {
        if (normalizedSource && !(doc.sourceUri || '').toLowerCase().includes(normalizedSource)) {
          return false
        }
        if (metadataEntries.length === 0) return true

        const documentMetadata = (doc.metadata as Record<string, unknown> | null)
          ?.documentMetadata as Record<string, unknown> | undefined
        if (!documentMetadata) return false

        return metadataEntries.every(
          ([key, value]) =>
            String(documentMetadata[key] ?? '')
              .trim()
              .toLowerCase() === value.trim().toLowerCase()
        )
      })
      .map((doc) => doc.id)
  }

  /**
   * Lọc ở cấp chunk theo metadata cấu trúc (headingPath) và khoảng trang.
   */
  private matchesChunkMetadataFilter(
    chunkMetadata: Record<string, unknown> | null | undefined,
    filter: SearchMetadataFilter
  ): boolean {
    const sectionPath = (filter.sectionPath || [])
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0)

    if (sectionPath.length > 0) {
      const headingPath = this.extractHeadingPath(chunkMetadata)
      if (!headingPath) return false

      const haystack = headingPath.map((part) => part.toLowerCase())
      let cursor = 0

      for (const needle of sectionPath) {
        const foundIndex = haystack.findIndex(
          (candidate, index) => index >= cursor && candidate.includes(needle)
        )
        if (foundIndex < 0) return false
        cursor = foundIndex + 1
      }
    }

    const pageRange = filter.pageRange
    if (pageRange) {
      const pageStart = chunkMetadata?.pageStart
      const pageEnd = chunkMetadata?.pageEnd ?? pageStart
      if (typeof pageStart !== 'number' || typeof pageEnd !== 'number') return false
      if (pageEnd < pageRange.from || pageStart > pageRange.to) return false
    }

    return true
  }

  /**
   * Lọc ở cấp CHUNK (heading path / khoảng trang). Trả null khi không cần lọc.
   * Chỉ dùng cho sectionPath/pageRange — scope theo tài liệu giờ được lọc ngay
   * trong truy vấn KNN qua cột document_id, không cần danh sách chunk id.
   */
  private resolveChunkLevelFilterIds(
    notebookId: string,
    documentIds: string[] | null,
    metadataFilter: SearchOptions['metadataFilter']
  ): string[] | null {
    const needsChunkLevelFilter =
      !!metadataFilter?.sectionPath?.length || !!metadataFilter?.pageRange
    if (!needsChunkLevelFilter) return null
    if (documentIds && documentIds.length === 0) return []

    const db = getDatabase()
    const conditions = [eq(chunks.notebookId, notebookId)]

    if (documentIds) {
      conditions.push(inArray(chunks.documentId, documentIds))
    }

    return db
      .select({ id: chunks.id, metadata: chunks.metadata })
      .from(chunks)
      .where(and(...conditions))
      .all()
      .filter((row) =>
        this.matchesChunkMetadataFilter(
          (row.metadata as Record<string, unknown> | null) || undefined,
          metadataFilter!
        )
      )
      .map((row) => row.id)
  }

  /**
   * Số tài liệu đã index xong trong sổ tay (để kiểm tra độ phủ của doc index).
   */
  private countIndexedDocuments(notebookId: string, documentIds?: string[]): number {
    const db = getDatabase()
    if (documentIds && documentIds.length === 0) return 0
    const conditions = [eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')]
    if (documentIds) conditions.push(inArray(documents.id, documentIds))
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(and(...conditions))
      .get()

    return row?.count ?? 0
  }

  /**
   * Số bản ghi mục của notebook (để kiểm tra độ phủ của section index).
   */
  private countSections(notebookId: string, documentIds?: string[]): number {
    const db = getDatabase()
    if (documentIds && documentIds.length === 0) return 0
    const conditions = [eq(sections.notebookId, notebookId)]
    if (documentIds) conditions.push(inArray(sections.documentId, documentIds))
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(sections)
      .where(and(...conditions))
      .get()

    return row?.count ?? 0
  }

  /**
   * Lấy chunk id thuộc các mục đã chọn (bước section → chunk của Hierarchical
   * Retrieval). Chia lô để không vượt hạn tham số SQLite.
   */
  private chunkIdsBySectionIds(notebookId: string, sectionIds: string[]): string[] {
    if (sectionIds.length === 0) return []

    const db = getDatabase()
    const rows: Array<{ id: string }> = []

    for (let offset = 0; offset < sectionIds.length; offset += MAX_PARAMETERIZED_CHUNK_FILTER) {
      const batch = sectionIds.slice(offset, offset + MAX_PARAMETERIZED_CHUNK_FILTER)
      rows.push(
        ...db
          .select({ id: chunks.id })
          .from(chunks)
          .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.sectionId, batch)))
          .all()
      )
    }

    return rows.map((row) => row.id)
  }

  /**
   * Tập chunk cho tầng section của Hierarchical Retrieval:
   *  - chunk nằm trong các mục đã chọn, CỘNG
   *  - chunk KHÔNG thuộc mục nào của tài liệu đã chọn (tài liệu không có cấu
   *    trúc mục không bị tầng mục lọc — nếu không, txt/pdf/pptx sẽ biến mất
   *    khỏi kết quả một cách âm thầm).
   */
  private chunkIdsForSectionTier(
    notebookId: string,
    sectionIds: string[],
    documentIds?: string[]
  ): string[] {
    const db = getDatabase()
    const conditions = [eq(chunks.notebookId, notebookId), isNull(chunks.sectionId)]
    if (documentIds?.length) {
      conditions.push(inArray(chunks.documentId, documentIds))
    }

    const sectionless = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(and(...conditions))
      .all()
      .map((row) => row.id)

    return [...this.chunkIdsBySectionIds(notebookId, sectionIds), ...sectionless]
  }

  /**
   * Document khớp TỪ KHOÁ với truy vấn (nhánh BM25 cấp tài liệu).
   * Dùng để hợp nhất vào tập tài liệu do tầng vector chọn — tránh mất recall
   * với truy vấn thiên về từ khoá mà vector cấp tài liệu không phủ hết.
   */
  private findKeywordDocumentIds(notebookId: string, query: string, limit: number): string[] {
    const sqlite = getSqlite()
    if (!sqlite) return []

    const safeQuery = buildFtsMatchQuery(query)
    if (!safeQuery) return []

    try {
      const rows = sqlite
        .prepare(
          `SELECT c.document_id AS document_id
           FROM fts_chunks f
           JOIN chunks c ON c.id = f.chunk_id
           WHERE f.notebook_id = ? AND fts_chunks MATCH ?
           ORDER BY rank LIMIT ?`
        )
        .all(notebookId, safeQuery, limit) as Array<{
        document_id: string
      }>

      return [...new Set(rows.map((row) => row.document_id))]
    } catch (error) {
      Logger.warn('KnowledgeService', 'Keyword document lookup failed:', error)
      return []
    }
  }

  private buildChunkOptionsForMimeType(mimeType: string | undefined): ChunkOptions | undefined {
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      // Spreadsheet rows can be token-dense; use tighter chunking for stable local embedding.
      return {
        chunkSize: 220,
        chunkOverlap: 20,
        minChunkSize: 30,
        maxChunkTokens: 96,
        maxTableRowsPerChunk: 3
      }
    }

    return undefined
  }

  private deleteFtsChunkIds(chunkIds: string[]): void {
    if (chunkIds.length === 0) return
    const sqlite = getSqlite()
    if (!sqlite) return

    const placeholders = chunkIds.map(() => '?').join(',')
    sqlite.prepare(`DELETE FROM fts_chunks WHERE chunk_id IN (${placeholders})`).run(...chunkIds)
  }

  private async cleanupDocumentIndex(notebookId: string, documentId: string): Promise<void> {
    const db = getDatabase()
    const docChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    // Vector cấp tài liệu phải bị xóa cùng, kể cả khi không còn chunk nào.
    this.removeDocumentVectors([documentId])

    // Sections are written before chunk embeddings. A failure in the embedding
    // phase must not leave orphan section rows behind: they would make the
    // section-vector coverage check fail for every later search in the notebook.
    try {
      sectionVectorStore.deleteByDocumentIds([documentId])
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to remove section vectors during cleanup:', error)
    }
    db.delete(sections).where(eq(sections.documentId, documentId)).run()

    if (docChunks.length === 0) return

    const chunkIds = docChunks.map((chunk) => chunk.id)
    const vectorStore = await vectorStoreManager.getStore(notebookId)
    await vectorStore.deleteByChunkIds(chunkIds)
    this.deleteFtsChunkIds(chunkIds)
    db.delete(embeddings).where(inArray(embeddings.chunkId, chunkIds)).run()
    db.delete(chunks).where(eq(chunks.documentId, documentId)).run()
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
      await this.cleanupDocumentIndex(notebookId, document.id)
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
   * Bổ sung metadata pháp lý đã trích vào chunk.metadata + FTS cho tài liệu
   * được index trước khi có metadata-aware retrieval. Chạy nền một lần sau
   * khởi động; không đổi nội dung/embedding của chunk nên rất nhẹ.
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
        legalMetadata: this.extractLegalMetadata(rootMetadata),
        retrievalMetadata: this.extractRetrievalMetadata(rootMetadata)
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
            const metadata = this.withRetrievalMetadata(
              row.metadata as Record<string, unknown> | null,
              projection
            )
            db.update(chunks).set({ metadata }).where(eq(chunks.id, row.id)).run()
            remove.run(row.id)
            insert.run(row.id, doc.notebookId, this.buildFtsIndexText(row.content, metadata))
          }
        })
        run()

        documentsUpdated++
        chunksUpdated += missing.length
        // Vector cấp tài liệu cũng nên chứa số hiệu/loại/cơ quan.
        await this.updateDocumentVector(doc.id, doc.notebookId)
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
   * Tài liệu pháp lý bị mất metadata do parser cũ (DOCX từng mất bảng quốc
   * hiệu/số hiệu). Chỉ trả tài liệu có file gốc để reindex lại nội dung.
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
      if (this.extractLegalMetadata(row.metadata as Record<string, unknown> | null)) continue

      const raw = (row.content || '').trimStart()
      // Dấu hiệu parser DOCX cũ thay bảng đầu văn bản bằng marker này.
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
   * Dựng lại các dòng `fts_chunks` bị thiếu (bảng FTS bị xoá/tạo lại, hoặc lần
   * insert trước thất bại giữa chừng). Không phụ thuộc vào tình trạng vector.
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
        projectionByDocument.set(documentId, this.readDocumentMetadataProjection(documentId))
      }

      const insert = sqlite.prepare(
        'INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)'
      )
      const run = sqlite.transaction((rows: typeof missingRows) => {
        for (const row of rows) {
          const metadata = this.withRetrievalMetadata(
            row.metadata as Record<string, unknown> | null,
            projectionByDocument.get(row.documentId) ?? {
              retrievalMetadata: { keywords: [], entities: [], tags: [] }
            }
          )
          insert.run(row.id, notebookId, this.buildFtsIndexText(row.content, metadata))
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

  /**
   * Q-01 Fix: Shared indexing logic extracted from addDocument and addDocumentFromFile.
   * BUG-02 Fix: reindexDocument now calls this directly, avoiding creation of a new document record.
   *
   * Steps: chunk content → save chunks → embed → save embeddings → update vector store → finalize document status
   */
  private async _indexContent(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<void> {
    await this.ensureEmbeddingReady()
    await this.assertEmbeddingDimensions()
    const db = getDatabase()
    const now = new Date()
    this.refreshDocumentContentMetadata(documentId, content)
    const metadataProjection = this.readDocumentMetadataProjection(documentId)

    // 1. Chunk
    onProgress?.('chunking', 10)
    const chunkResults = this.chunkingService.chunk(content, chunkOptions, structure)
    if (chunkResults.length === 0) throw new Error('No chunks generated from document')
    Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

    // 1.5 Mục (section) — tầng giữa Hierarchical Retrieval: tách bản ghi mục từ
    // cấu trúc phẳng và gán sectionId cho từng chunk theo offset bắt đầu.
    const sectionPlan = this.buildSectionRecords(
      notebookId,
      documentId,
      content,
      structure?.sections
    )
    db.delete(sections).where(eq(sections.documentId, documentId)).run()
    if (sectionPlan.records.length > 0) {
      db.insert(sections).values(sectionPlan.records).run()
    }

    // 2. Save chunks
    onProgress?.('saving_chunks', 20)
    const chunkIds: string[] = []
    const chunkContents: string[] = []

    for (const chunk of chunkResults) {
      const chunkId = `chunk_${randomUUID()}`
      chunkIds.push(chunkId)
      chunkContents.push(chunk.content)
      const chunkMetadata = this.withRetrievalMetadata(chunk.metadata, metadataProjection)

      const newChunk: NewChunk = {
        id: chunkId,
        documentId,
        notebookId,
        content: chunk.content,
        contentHash: createHash('md5').update(chunk.content).digest('hex'),
        chunkIndex: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        metadata: chunkMetadata,
        tokenCount: chunk.tokenCount,
        sectionId: sectionPlan.assign(chunk.startOffset) ?? undefined,
        createdAt: now
      }
      db.insert(chunks).values(newChunk).run()

      // Also insert into FTS5 virtual table for Hybrid Search
      const sqlite = getSqlite()
      if (sqlite) {
        sqlite
          .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
          .run(chunkId, notebookId, this.buildFtsIndexText(chunk.content, chunkMetadata))
      }
    }

    // 3. Generate embeddings
    onProgress?.('generating_embeddings', 30)
    const embeddingResults = await this.embeddingService.embedBatch(
      chunkContents,
      { dimensions: 1024 },
      (completed, total) => {
        onProgress?.('generating_embeddings', Math.round(30 + (completed / total) * 50))
      }
    )

    const detectedDimensions = embeddingResults.length > 0 ? embeddingResults[0].dimensions : 1024
    if (embeddingResults.length > 0 && detectedDimensions !== 1024) {
      throw new Error(
        `Unsupported embedding dimensions: ${detectedDimensions}. Current sqlite-vec schema requires 1024 dimensions.`
      )
    }
    if (embeddingResults.length > 0) {
      vectorStoreManager.setDefaultDimensions(1024)
      Logger.debug('KnowledgeService', `Detected embedding dimensions: ${detectedDimensions}`)
    }

    // 4. Save embeddings + add to vector store
    onProgress?.('saving_embeddings', 85)
    const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, detectedDimensions)
    const vectorItems: Array<{
      id: string
      chunkId: string
      vector: Float32Array
      metadata?: Record<string, unknown>
    }> = []

    for (let i = 0; i < chunkIds.length; i++) {
      const embeddingId = `emb_${randomUUID()}`
      const embResult = embeddingResults[i]

      const newEmbedding: NewEmbedding = {
        id: embeddingId,
        chunkId: chunkIds[i],
        notebookId,
        model: embResult.model,
        dimensions: embResult.dimensions,
        createdAt: now
      }
      db.insert(embeddings).values(newEmbedding).run()

      vectorItems.push({
        id: embeddingId,
        chunkId: chunkIds[i],
        vector: embResult.embedding,
        metadata: { model: embResult.model, documentId }
      })
    }

    await vectorStore.upsert(vectorItems)

    // 5. Update document status
    onProgress?.('finalizing', 95)
    db.update(documents)
      .set({ status: 'indexed', chunkCount: chunkResults.length, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 6. Vector cấp tài liệu (tầng 1 Hierarchical Retrieval) — best-effort
    await this.updateDocumentVector(documentId, notebookId)

    // 6.5 Vector cấp mục (tầng 2 Hierarchical Retrieval) — best-effort
    await this.updateSectionVectors(notebookId, documentId, sectionPlan.records)
    this.updateSectionChunkCounts(documentId)

    executeCheckpoint('PASSIVE')
    onProgress?.('completed', 100)
    Logger.info(
      'KnowledgeService',
      `Document indexed: ${documentId}, ${chunkResults.length} chunks`
    )
  }

  async addDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${randomUUID()}`
    const now = new Date()
    const normalized = this.markdownNormalizer.normalize({
      content: options.content,
      mimeType: options.mimeType ?? 'text/plain'
    })
    const normalizedContent = normalized.content
    const structureMetadata = this.buildCompactStructureMetadata(normalized.structure)
    const contentHash = createHash('md5').update(options.content).digest('hex')
    const contentMdHash = createHash('md5').update(normalizedContent).digest('hex')

    try {
      onProgress?.('creating_document', 0)

      const newDoc: NewDocument = {
        id: documentId,
        notebookId,
        title: options.title,
        type: options.type,
        sourceUri: options.sourceUri,
        sourceNoteId: options.sourceNoteId,
        memoryOfSessionId: options.memoryOfSessionId,
        content: normalizedContent,
        contentHash,
        contentMdHash,
        mimeType: options.mimeType,
        fileSize: options.fileSize,
        metadata: { ...(options.metadata || {}), ...(structureMetadata || {}) },
        status: 'processing',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      }
      db.insert(documents).values(newDoc).run()

      await this._indexContent(
        documentId,
        notebookId,
        normalizedContent,
        options.chunkOptions,
        this.buildChunkStructureContext(normalized.structure),
        onProgress
      )
      return documentId
    } catch (error) {
      await this.cleanupDocumentIndex(notebookId, documentId)
      db.update(documents)
        .set({ status: 'failed', errorMessage: (error as Error).message, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
        .run()
      Logger.error('KnowledgeService', 'Failed to add document:', error)
      throw error
    }
  }

  async addDocumentFromFile(
    notebookId: string,
    filePath: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${randomUUID()}`
    let localFilePath: string | undefined
    const now = new Date()

    try {
      onProgress?.('parsing_file', 0)
      const importInfo = await validateImportableFile(filePath)
      localFilePath = await this.copyFileToKnowledgeDir(
        importInfo.path,
        documentId,
        importInfo.extension
      )

      db.insert(documents)
        .values({
          id: documentId,
          notebookId,
          title: basename(filePath) || 'Untitled',
          type: 'file',
          sourceUri: filePath,
          localFilePath,
          status: 'processing',
          chunkCount: 0,
          createdAt: now,
          updatedAt: now
        })
        .run()

      const parseResult = await this.fileParserService.parseFile(filePath)
      const normalizedResult = this.markdownNormalizer.normalize(parseResult)
      const normalizedContent = normalizedResult.content
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const contentMdHash = createHash('md5').update(normalizedContent).digest('hex')
      const fileInfo = await stat(filePath).catch(() => undefined)
      const fileBytes = await readFile(filePath).catch(() => undefined)
      const fileMd5 = fileBytes ? createHash('md5').update(fileBytes).digest('hex') : undefined

      const docType =
        parseResult.mimeType === 'text/plain' || parseResult.mimeType === 'text/markdown'
          ? 'text'
          : 'file'

      const structureMetadata = this.buildCompactStructureMetadata(normalizedResult.structure)
      const chunkOptions = this.buildChunkOptionsForMimeType(parseResult.mimeType)
      if (chunkOptions) {
        Logger.info(
          'KnowledgeService',
          `Using spreadsheet-safe chunk profile for ${basename(filePath)}: ${JSON.stringify(chunkOptions)}`
        )
      }

      onProgress?.('creating_document', 5)
      db.update(documents)
        .set({
          title: parseResult.title || basename(filePath) || 'Untitled',
          type: docType,
          content: normalizedContent,
          contentHash,
          contentMdHash,
          mimeType: parseResult.mimeType,
          fileSize: (parseResult.metadata?.fileSize as number | undefined) ?? fileInfo?.size,
          metadata: {
            ...(parseResult.metadata || {}),
            ...(structureMetadata || {}),
            ...(fileMd5 ? { fileMd5 } : {})
          },
          updatedAt: now
        })
        .where(eq(documents.id, documentId))
        .run()

      await this._indexContent(
        documentId,
        notebookId,
        normalizedContent,
        chunkOptions,
        this.buildChunkStructureContext(normalizedResult.structure),
        onProgress
      )
      return documentId
    } catch (error) {
      if (localFilePath) await this.deleteLocalFile(localFilePath)
      await this.cleanupDocumentIndex(notebookId, documentId)
      db.update(documents)
        .set({
          status: 'failed',
          localFilePath: null,
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()
      Logger.error('KnowledgeService', 'Failed to add document from file:', error)
      throw error
    }
  }

  /** Fetches a public web page, converts it to canonical Markdown, then sends it
   * through the same structure/chunk/vector/FTS pipeline as uploaded files. */
  async addDocumentFromUrl(
    notebookId: string,
    url: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    onProgress?.('fetching_url', 0)
    const fetched = await this.webFetchService.fetchUrl(url, {
      extractMainContent: true,
      convertToMarkdown: true
    })
    if (!fetched.content.trim()) throw new Error('Web page has no indexable content')

    const parsedUrl = new URL(fetched.url)
    return this.addDocument(
      notebookId,
      {
        title: fetched.title?.trim() || parsedUrl.hostname,
        type: 'url',
        content: fetched.content,
        sourceUri: fetched.url,
        mimeType: 'text/markdown',
        metadata: {
          ...(fetched.metadata || {}),
          sourceMimeType: fetched.mimeType,
          ...(fetched.description ? { description: fetched.description } : {})
        }
      },
      onProgress
    )
  }

  private async collectSupportedFilesRecursively(folderPath: string): Promise<string[]> {
    const entries = await readdir(folderPath, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      const fullPath = join(folderPath, entry.name)

      if (entry.isDirectory()) {
        const nestedFiles = await this.collectSupportedFilesRecursively(fullPath)
        files.push(...nestedFiles)
        continue
      }

      if (!entry.isFile()) continue
      const extension = extname(entry.name).toLowerCase().replace(/^\./, '')
      if (!extension) continue

      if (this.fileParserService.isSupported(extension)) {
        files.push(fullPath)
      }
    }

    return files
  }

  async addDocumentsFromFolder(
    notebookId: string,
    folderPath: string,
    onProgress?: IndexProgressCallback
  ): Promise<BatchIndexResult> {
    onProgress?.('scanning_folder', 0)
    const files = await this.collectSupportedFilesRecursively(folderPath)
    const failedFiles: Array<{ filePath: string; error: string }> = []
    const indexedDocumentIds: string[] = []

    if (files.length === 0) {
      onProgress?.('completed', 100)
      return {
        totalFiles: 0,
        indexedFiles: 0,
        failedFiles: [],
        indexedDocumentIds: []
      }
    }

    let indexedFiles = 0

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      const fileBaseProgress = Math.round((i / files.length) * 100)
      onProgress?.('batch_indexing', fileBaseProgress)

      try {
        const documentId = await this.addDocumentFromFile(
          notebookId,
          filePath,
          (stage, progress) => {
            const localProgress = progress / files.length
            const overallProgress = Math.min(
              99,
              Math.round((i / files.length) * 100 + localProgress)
            )
            onProgress?.(`batch:${stage}`, overallProgress)
          }
        )
        indexedDocumentIds.push(documentId)
        indexedFiles++
      } catch (error) {
        failedFiles.push({ filePath, error: (error as Error).message })
      }
    }

    onProgress?.('completed', 100)
    return {
      totalFiles: files.length,
      indexedFiles,
      failedFiles,
      indexedDocumentIds
    }
  }

  async addNoteToKnowledge(
    notebookId: string,
    noteId: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const note = db.select().from(notes).where(eq(notes.id, noteId)).get()
    if (!note) throw new Error(`Note ${noteId} not found`)

    const trimmedContent = note.content.trim()
    if (!trimmedContent)
      throw new Error('Note content is empty. Cannot add empty note to knowledge base.')

    return this.addDocument(
      notebookId,
      { title: note.title, type: 'note', content: note.content, sourceNoteId: noteId },
      onProgress
    )
  }

  /**
   * Lưu ký ức phiên hội thoại vào KB dạng document type='memory' (có embedding).
   * Gọi từ SessionAutoSwitchService sau khi tóm tắt session.
   */
  async storeSessionMemory(
    notebookId: string,
    sessionId: string,
    summary: string,
    sessionTitle: string
  ): Promise<string | null> {
    const trimmed = summary.trim()
    if (!trimmed) return null

    try {
      const documentId = await this.addDocument(notebookId, {
        title: `🧠 Ký ức: ${sessionTitle}`,
        type: 'memory',
        content: trimmed,
        memoryOfSessionId: sessionId,
        metadata: {
          memorySource: 'session-summary',
          sessionId,
          sessionTitle
        }
      })
      Logger.info('KnowledgeService', `Session memory stored: ${documentId} (session ${sessionId})`)
      return documentId
    } catch (error) {
      Logger.error('KnowledgeService', `Failed to store session memory for ${sessionId}:`, error)
      return null
    }
  }

  /**
   * Công thức decay cho ký ức: half-life 30 ngày.
   * Ký ức càng cũ càng giảm trọng số khi search.
   */
  static memoryDecay(updatedAt: Date | null, now: Date = new Date()): number {
    if (!updatedAt) return 1
    const ageDays = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays <= 0) return 1
    return Math.pow(0.5, ageDays / 30)
  }

  /**
   * Ghi nhận phản hồi của người dùng lên chunk (feedback loop).
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
   * Đánh dấu lifecycle cho document (draft/verified/outdated) —
   * ảnh hưởng trọng số retrieval (outdated ×0.4, verified ×1.1).
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
    this.metadataIndexService.sync(updated)
    return updated
  }

  /**
   * Metadata-aware orchestration. Explicit scope and a uniquely identified
   * document are hard constraints; all other inferred metadata gets a
   * preferred pass followed by a broad pass, preserving recall.
   */
  async searchMetadataAware(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<MetadataAwareSearchResult<SearchResult>> {
    const startedAt = Date.now()
    const explicitScope = options.metadataFilter
    const detectedMetadata = detectQueryMetadata(query)
    // A document number is the only inferred signal permitted to become a
    // hard scope. Resolve it directly through the relational index first so a
    // large corpus does not need to be projected merely to find one document.
    const directDocumentIds = detectedMetadata.documentNumber
      ? this.metadataIndexService.findDocumentIdsByNumber(
          notebookId,
          detectedMetadata.documentNumber
        )
      : []
    const corpus = this.metadataIndexService.listForPlanning(
      notebookId,
      directDocumentIds.length === 1 ? directDocumentIds : undefined
    )
    const plan = createRetrievalPlan(
      query,
      corpus,
      explicitScope as ExplicitRetrievalScope | undefined
    )
    const inferredHard = plan.hardConstraints.find(
      (constraint) => constraint.source === 'query-resolver'
    )
    const hardScope: SearchMetadataFilter | undefined = inferredHard
      ? { ...explicitScope, documentIds: plan.preferredDocumentIds }
      : explicitScope

    const passes: RetrievalTrace['passes'] = []
    const run = async (
      name: 'preferred' | 'broad',
      metadataFilter: SearchMetadataFilter | undefined,
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      const passStartedAt = Date.now()
      const result = await this.search(notebookId, query, { ...options, metadataFilter })
      passes.push({
        name,
        documentIds: documentIds?.length,
        returned: result.length,
        elapsedMs: Date.now() - passStartedAt
      })
      return result
    }

    // A unique document number is exact enough to honour as a hard scope.
    if (inferredHard) {
      const results = await run('preferred', hardScope, plan.preferredDocumentIds)
      return {
        results,
        trace: { version: 1, plan, passes, fallbackUsed: false, returned: results.length }
      }
    }

    const preferredIds = plan.preferredDocumentIds
    let preferredResults: SearchResult[] = []
    if (preferredIds.length) {
      const explicitIds = hardScope?.documentIds
      const ids = explicitIds ? preferredIds.filter((id) => explicitIds.includes(id)) : preferredIds
      if (ids.length) {
        preferredResults = await run('preferred', { ...hardScope, documentIds: ids }, ids)
      }
    }

    // Inferred type/issuer signals are never allowed to suppress semantic
    // evidence. Always execute the broad pass, then use the preferred pass as
    // a bounded ranking hint within that broad candidate set.
    const broadResults = await run('broad', hardScope)
    const fallbackUsed = preferredIds.length > 0
    const results = mergePreferredAndBroadResults(preferredResults, broadResults, options.topK ?? 5)

    const trace: RetrievalTrace = {
      version: 1,
      plan,
      passes,
      fallbackUsed,
      returned: results.length
    }
    Logger.debug(
      'KnowledgeService',
      `Metadata-aware retrieval completed in ${Date.now() - startedAt}ms`,
      trace
    )
    return { results, trace }
  }

  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    await this.ensureEmbeddingReady()
    await this.assertEmbeddingDimensions()
    const startedAt = Date.now()
    const { topK = 5, threshold = 0.5, includeContent = true, metadataFilter, rerank } = options
    const rerankEnabled = rerank?.enabled ?? false
    const rerankTopN = Math.min(Math.max(rerank?.topN ?? topK * 2, 1), 100)
    const rerankHeuristicFallback = rerank?.heuristicFallback ?? true
    const retrievalCandidateLimit = Math.max(topK * 2, rerankEnabled ? rerankTopN : topK)
    const sqlite = getSqlite()

    // Scope cấp TÀI LIỆU (đi thẳng vào KNN qua cột document_id) và scope cấp
    // CHUNK (chỉ cần khi lọc theo mục/khoảng trang).
    const scopeDocumentIds = this.resolveFilteredDocumentIds(notebookId, metadataFilter)
    if (scopeDocumentIds && scopeDocumentIds.length === 0) {
      const hasMetadataFilter =
        !!metadataFilter?.documentMetadata &&
        Object.keys(metadataFilter.documentMetadata).length > 0
      const message = 'Search returned 0 results due to metadata filter'
      if (hasMetadataFilter) Logger.warn('KnowledgeService', message)
      else Logger.debug('KnowledgeService', message)
      return []
    }

    let scopeChunkIds = this.resolveChunkLevelFilterIds(
      notebookId,
      scopeDocumentIds,
      metadataFilter
    )
    if (scopeChunkIds && scopeChunkIds.length === 0) {
      Logger.debug('KnowledgeService', 'Search returned 0 results due to section/page filter')
      return []
    }

    // 1. Vector Search
    const queryEmbedding = await this.embeddingService.embed(query)
    if (queryEmbedding.dimensions !== 1024) {
      throw new Error(
        `Unsupported query embedding dimensions: ${queryEmbedding.dimensions}. Current sqlite-vec schema requires 1024 dimensions.`
      )
    }

    const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, 1024)

    // 1b. Tầng chọn TÀI LIỆU (Hierarchical Retrieval). Hard scope được áp dụng
    // trước, rồi semantic/keyword document retrieval thu hẹp bên trong scope.
    let hierarchicalDocumentIds: string[] = []

    if ((options.hierarchical?.enabled ?? false) && !scopeChunkIds) {
      const docTopK = Math.min(Math.max(options.hierarchical?.docTopK ?? 8, 1), 50)
      const indexedDocumentCount = this.countIndexedDocuments(
        notebookId,
        scopeDocumentIds ?? undefined
      )
      const documentVectorCount = documentVectorStore.count(
        notebookId,
        scopeDocumentIds ?? undefined
      )

      if (documentVectorCount === 0) {
        Logger.debug('KnowledgeService', 'Hierarchical stage skipped: document index is empty')
      } else if (documentVectorCount < indexedDocumentCount) {
        // Doc index CHƯA phủ hết tài liệu (vd tài liệu cũ chưa được index lại).
        // Nếu vẫn giới hạn theo tầng chọn thì mọi tài liệu không có vector sẽ
        // biến mất khỏi kết quả — hỏng recall một cách âm thầm. Vì vậy tạm
        // dùng flat search cho tới khi doc index đủ phủ.
        Logger.debug(
          'KnowledgeService',
          `Hierarchical stage skipped: document index covers ${documentVectorCount}/${indexedDocumentCount} documents`
        )
      } else {
        const docMatches = documentVectorStore.query(notebookId, queryEmbedding.embedding, {
          topK: docTopK,
          threshold: options.hierarchical?.threshold,
          documentIds: scopeDocumentIds ?? undefined
        })

        // Hợp nhất với tài liệu khớp từ khoá (BM25 cấp tài liệu) để giữ recall
        // cho truy vấn mà vector cấp tài liệu không phủ.
        const hardScope = scopeDocumentIds ? new Set(scopeDocumentIds) : null
        const keywordDocumentIds = this.findKeywordDocumentIds(
          notebookId,
          query,
          docTopK * 2
        ).filter((documentId) => !hardScope || hardScope.has(documentId))
        const selectedDocumentIds = [
          ...new Set([...docMatches.map((match) => match.documentId), ...keywordDocumentIds])
        ]

        // Chọn ra toàn bộ tài liệu thì không cần giới hạn gì nữa (bằng flat search).
        if (selectedDocumentIds.length > 0 && selectedDocumentIds.length < indexedDocumentCount) {
          hierarchicalDocumentIds = selectedDocumentIds
        }
      }
    }

    const effectiveDocumentIds =
      hierarchicalDocumentIds.length > 0 ? hierarchicalDocumentIds : scopeDocumentIds
    const documentFilterIds =
      effectiveDocumentIds && effectiveDocumentIds.length > 0 ? effectiveDocumentIds : undefined

    // 1c. Tầng chọn MỤC (section retrieval) — tầng giữa của Hierarchical
    // Retrieval. Chỉ chạy khi caller bật hierarchical và không có scope mục/trang
    // tường minh. Tự bỏ qua khi section index chưa đủ phủ để không hỏng recall.
    if ((options.hierarchical?.enabled ?? false) && !scopeChunkIds) {
      const sectionTopK = Math.min(Math.max(options.hierarchical?.sectionTopK ?? 16, 1), 100)
      const totalSections = this.countSections(notebookId, documentFilterIds)
      const sectionVectorCount = sectionVectorStore.count(notebookId, documentFilterIds)

      if (totalSections === 0) {
        Logger.debug('KnowledgeService', 'Section stage skipped: no section records')
      } else if (sectionVectorCount < totalSections) {
        Logger.debug(
          'KnowledgeService',
          `Section stage skipped: section index covers ${sectionVectorCount}/${totalSections} sections`
        )
      } else {
        const sectionMatches = sectionVectorStore.query(notebookId, queryEmbedding.embedding, {
          topK: sectionTopK,
          threshold: options.hierarchical?.threshold,
          documentIds: documentFilterIds
        })

        if (sectionMatches.length > 0) {
          const tierChunkIds = this.chunkIdsForSectionTier(
            notebookId,
            sectionMatches.map((match) => match.sectionId),
            documentFilterIds
          )
          if (tierChunkIds.length > 0) {
            scopeChunkIds = tierChunkIds
            Logger.debug(
              'KnowledgeService',
              `Section stage selected ${sectionMatches.length} sections -> ${tierChunkIds.length} chunks`
            )
          }
        }
      }
    }

    // Danh sách chunk id (chỉ có khi lọc theo mục/trang) có thể quá lớn để nhét
    // vào mệnh đề IN của SQLite → khi đó lấy KNN rộng hơn rồi lọc bằng JS.
    const filterOverflow = !!scopeChunkIds && scopeChunkIds.length > MAX_PARAMETERIZED_CHUNK_FILTER
    const overflowFilterSet = filterOverflow ? new Set(scopeChunkIds) : undefined

    if (filterOverflow) {
      Logger.warn(
        'KnowledgeService',
        `Chunk-id filter too large (${scopeChunkIds!.length}); widened KNN + JS filter`
      )
    }

    const vectorFilter =
      documentFilterIds || (scopeChunkIds && !filterOverflow)
        ? {
            documentIds: documentFilterIds,
            chunkIds: scopeChunkIds && !filterOverflow ? scopeChunkIds : undefined
          }
        : undefined

    const vectorCandidates = await vectorStore.query(queryEmbedding.embedding, {
      topK: filterOverflow ? Math.min(retrievalCandidateLimit * 40, 500) : retrievalCandidateLimit,
      threshold,
      filter: vectorFilter
    }) // Fetch more for RRF

    const vectorResults = overflowFilterSet
      ? vectorCandidates
          .filter((candidate) => overflowFilterSet.has(candidate.chunkId))
          .slice(0, retrievalCandidateLimit)
      : vectorCandidates

    // 2. FTS5 BM25 Search (Keyword search)
    let ftsResults: Array<{ chunk_id: string; rank: number }> = []
    if (sqlite) {
      try {
        const match = buildFtsMatchQuery(query)
        if (match) {
          const baseSql = `
            SELECT chunk_id, rank 
            FROM fts_chunks 
            WHERE notebook_id = ? AND fts_chunks MATCH ? 
          `
          const baseParams: unknown[] = [notebookId, match]

          // Lọc theo tài liệu bằng subquery trên bảng chunks: số tham số nhỏ
          // (bằng số tài liệu được chọn), không phình như danh sách chunk id.
          const documentClause = documentFilterIds?.length
            ? ` AND chunk_id IN (SELECT id FROM chunks WHERE notebook_id = ? AND document_id IN (${documentFilterIds
                .map(() => '?')
                .join(',')}))`
            : ''
          const documentParams: unknown[] = documentFilterIds?.length
            ? [notebookId, ...documentFilterIds]
            : []

          if (!scopeChunkIds || scopeChunkIds.length === 0) {
            ftsResults = sqlite
              .prepare(`${baseSql}${documentClause} ORDER BY rank LIMIT ?`)
              .all(...baseParams, ...documentParams, retrievalCandidateLimit) as any
          } else if (scopeChunkIds.length <= FTS_FILTER_BATCH_SIZE) {
            const placeholders = scopeChunkIds.map(() => '?').join(',')
            ftsResults = sqlite
              .prepare(
                `${baseSql}${documentClause} AND chunk_id IN (${placeholders}) ORDER BY rank LIMIT ?`
              )
              .all(
                ...baseParams,
                ...documentParams,
                ...scopeChunkIds,
                retrievalCandidateLimit
              ) as any
          } else {
            // Danh sách chunk id quá lớn → chia lô để không vượt hạn tham số.
            // rank BM25 là điểm của từng dòng nên vẫn so sánh được giữa các lô.
            const merged: Array<{ chunk_id: string; rank: number }> = []

            for (let offset = 0; offset < scopeChunkIds.length; offset += FTS_FILTER_BATCH_SIZE) {
              const batch = scopeChunkIds.slice(offset, offset + FTS_FILTER_BATCH_SIZE)
              const placeholders = batch.map(() => '?').join(',')
              merged.push(
                ...(sqlite
                  .prepare(
                    `${baseSql}${documentClause} AND chunk_id IN (${placeholders}) ORDER BY rank LIMIT ?`
                  )
                  .all(...baseParams, ...documentParams, ...batch, retrievalCandidateLimit) as any)
              )
            }

            ftsResults = merged.sort((a, b) => a.rank - b.rank).slice(0, retrievalCandidateLimit)
          }
        }
      } catch (error) {
        Logger.warn('KnowledgeService', 'FTS Search failed (likely syntax):', error)
      }
    }

    // 3. Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map<string, number>()
    const k = 60 // RRF constant

    // Add vector scores
    vectorResults.forEach((vr, index) => {
      const rank = index + 1
      rrfScores.set(vr.chunkId, 1 / (k + rank))
    })

    // Add FTS scores
    ftsResults.forEach((fr, index) => {
      const rank = index + 1
      const currentScore = rrfScores.get(fr.chunk_id) || 0
      rrfScores.set(fr.chunk_id, currentScore + 1 / (k + rank))
    })

    if (rrfScores.size === 0) return []

    let fusedRankedChunkIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1]) // highest score first
      .map(([chunkId]) => chunkId)

    const db = getDatabase()

    // 3.5 Memory decay + feedback + lifecycle weighting
    const fusedChunkRows = db
      .select({ id: chunks.id, documentId: chunks.documentId })
      .from(chunks)
      .where(inArray(chunks.id, fusedRankedChunkIds))
      .all()
    const fusedDocIds = [...new Set(fusedChunkRows.map((c) => c.documentId))]
    if (fusedDocIds.length > 0) {
      const fusedDocs = db
        .select({
          id: documents.id,
          type: documents.type,
          updatedAt: documents.updatedAt,
          metadata: documents.metadata
        })
        .from(documents)
        .where(inArray(documents.id, fusedDocIds))
        .all()

      // 3.5a Memory decay: ký ức càng cũ càng giảm trọng số
      const decayByDoc = new Map<string, number>()
      // 3.5b Lifecycle: outdated giảm mạnh, verified tăng nhẹ
      const lifecycleWeightByDoc = new Map<string, number>()
      for (const d of fusedDocs) {
        if (d.type === 'memory') {
          decayByDoc.set(d.id, KnowledgeService.memoryDecay(d.updatedAt))
        }
        const lifecycleState = (d.metadata as Record<string, unknown> | null)?.lifecycleState
        if (lifecycleState === 'outdated') lifecycleWeightByDoc.set(d.id, 0.4)
        else if (lifecycleState === 'verified') lifecycleWeightByDoc.set(d.id, 1.1)
      }

      // 3.5c Chunk feedback: user đánh giá citation/chỉnh sửa
      const feedbackRows = db
        .select()
        .from(chunkFeedback)
        .where(inArray(chunkFeedback.chunkId, fusedRankedChunkIds))
        .all()
      const feedbackWeightByChunk = new Map<string, number>()
      for (const fb of feedbackRows) {
        const weight = fb.kind === 'citation_good' ? 1.15 : fb.kind === 'citation_bad' ? 0.7 : 0.5
        const current = feedbackWeightByChunk.get(fb.chunkId) ?? 1
        feedbackWeightByChunk.set(fb.chunkId, current * weight)
      }

      const chunkDocMap = new Map(fusedChunkRows.map((c) => [c.id, c.documentId]))

      for (const [chunkId, score] of rrfScores) {
        let adjusted = score
        const docId = chunkDocMap.get(chunkId)
        if (docId) {
          const decay = decayByDoc.get(docId)
          if (decay !== undefined && decay < 1) adjusted *= decay
          const lifecycle = lifecycleWeightByDoc.get(docId)
          if (lifecycle !== undefined) adjusted *= lifecycle
        }
        const feedback = feedbackWeightByChunk.get(chunkId)
        if (feedback !== undefined) adjusted *= feedback
        if (adjusted !== score) rrfScores.set(chunkId, adjusted)
      }

      fusedRankedChunkIds = Array.from(rrfScores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([chunkId]) => chunkId)
    }

    // 3.6 Knowledge links expansion: kéo chunk liên kết chéo giữa các document
    // (knowledge graph) vào tập kết quả với thứ hạng thấp hơn chunk gốc.
    // Trước đây links chỉ hiển thị trong panel — giờ thực sự ảnh hưởng retrieval.
    const linkRows = db
      .select({
        sourceChunkId: knowledgeLinks.sourceChunkId,
        targetChunkId: knowledgeLinks.targetChunkId,
        confidence: knowledgeLinks.confidence
      })
      .from(knowledgeLinks)
      .where(and(eq(knowledgeLinks.notebookId, notebookId), eq(knowledgeLinks.status, 'active')))
      .all()

    const linkedExtra = new Map<string, number>()
    if (linkRows.length > 0) {
      // Trước khi mở rộng theo link, xác định chunk liên kết nào NẰM TRONG scope
      // tìm kiếm hiện tại (document/section/page) — không để knowledge links kéo
      // kết quả ra ngoài phạm vi người dùng đã chọn.
      const linkedCandidateIds = new Set<string>()
      for (const link of linkRows) {
        if (!link.sourceChunkId || !link.targetChunkId) continue
        const sourceScore = rrfScores.get(link.sourceChunkId)
        const targetScore = rrfScores.get(link.targetChunkId)
        if (sourceScore !== undefined && targetScore === undefined) {
          linkedCandidateIds.add(link.targetChunkId)
        } else if (targetScore !== undefined && sourceScore === undefined) {
          linkedCandidateIds.add(link.sourceChunkId)
        }
      }

      const scopedLinkIds = new Set<string>()
      const hasScope = scopeChunkIds !== null || documentFilterIds !== undefined
      if (!hasScope) {
        for (const id of linkedCandidateIds) scopedLinkIds.add(id)
      } else if (linkedCandidateIds.size > 0) {
        const scopeChunkSet = scopeChunkIds ? new Set(scopeChunkIds) : null
        const scopeDocSet = documentFilterIds ? new Set(documentFilterIds) : null
        const candidateList = [...linkedCandidateIds]

        for (
          let offset = 0;
          offset < candidateList.length;
          offset += MAX_PARAMETERIZED_CHUNK_FILTER
        ) {
          const batch = candidateList.slice(offset, offset + MAX_PARAMETERIZED_CHUNK_FILTER)
          const rows = db
            .select({ id: chunks.id, documentId: chunks.documentId })
            .from(chunks)
            .where(inArray(chunks.id, batch))
            .all()
          for (const row of rows) {
            if (scopeChunkSet) {
              if (scopeChunkSet.has(row.id)) scopedLinkIds.add(row.id)
            } else if (scopeDocSet?.has(row.documentId)) {
              scopedLinkIds.add(row.id)
            }
          }
        }
      }

      for (const link of linkRows) {
        if (!link.sourceChunkId || !link.targetChunkId) continue
        const confidence = link.confidence ?? 0.5
        const sourceScore = rrfScores.get(link.sourceChunkId)
        const targetScore = rrfScores.get(link.targetChunkId)
        // Chunk liên kết chưa nằm trong pool được ghi điểm = điểm chunk
        // gốc × confidence × hệ số suy giảm (chỉ dùng cho phần bổ sung cuối).
        if (
          sourceScore !== undefined &&
          targetScore === undefined &&
          scopedLinkIds.has(link.targetChunkId)
        ) {
          const score = sourceScore * 0.5 * confidence
          linkedExtra.set(
            link.targetChunkId,
            Math.max(linkedExtra.get(link.targetChunkId) ?? 0, score)
          )
        } else if (
          targetScore !== undefined &&
          sourceScore === undefined &&
          scopedLinkIds.has(link.sourceChunkId)
        ) {
          const score = targetScore * 0.5 * confidence
          linkedExtra.set(
            link.sourceChunkId,
            Math.max(linkedExtra.get(link.sourceChunkId) ?? 0, score)
          )
        }
      }
    }

    const rerankCandidateIds = fusedRankedChunkIds.slice(
      0,
      Math.min(rerankTopN, fusedRankedChunkIds.length)
    )
    let rerankMethod: 'provider' | 'heuristic' | 'none' = 'none'
    let rerankScores = new Map<string, number>()
    let finalRankedChunkIds = fusedRankedChunkIds

    if (rerankEnabled && rerankCandidateIds.length > 1) {
      const rerankRows = db
        .select({ id: chunks.id, content: chunks.content })
        .from(chunks)
        .where(inArray(chunks.id, rerankCandidateIds))
        .all()
      const rerankContentMap = new Map(rerankRows.map((row) => [row.id, row.content]))

      const rerankCandidates = rerankCandidateIds.map((chunkId) => ({
        id: chunkId,
        text: rerankContentMap.get(chunkId) || '',
        baseScore: rrfScores.get(chunkId) || 0
      }))

      const rerankOutcome = await this.rerankService.rerank(query, rerankCandidates, {
        enabled: true,
        topN: rerankTopN,
        heuristicFallback: rerankHeuristicFallback
      })
      rerankMethod = rerankOutcome.method
      rerankScores = rerankOutcome.scores

      const uniqueOrderedIds: string[] = []
      const seen = new Set<string>()
      for (const id of rerankOutcome.orderedIds) {
        if (!seen.has(id)) {
          uniqueOrderedIds.push(id)
          seen.add(id)
        }
      }

      for (const id of fusedRankedChunkIds) {
        if (!seen.has(id)) {
          uniqueOrderedIds.push(id)
          seen.add(id)
        }
      }

      finalRankedChunkIds = uniqueOrderedIds
    }

    const fusedChunkIds = finalRankedChunkIds.slice(0, topK)

    // Bổ sung chunk liên kết tri thức (knowledge graph) chưa có trong top-K —
    // tối đa 3 chunk, chỉ khi links thực sự tồn tại.
    if (linkedExtra.size > 0) {
      const extras = [...linkedExtra.entries()]
        .filter(([chunkId]) => !fusedChunkIds.includes(chunkId))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      for (const [chunkId, score] of extras) {
        fusedChunkIds.push(chunkId)
        // Ghi điểm vào rrfScores để kết quả trả về mang điểm thật (thay vì 0)
        rrfScores.set(chunkId, score)
      }
    }

    // 4. Fetch Expanded Context (Parent-Child Strategy)
    const chunkDetails = db.select().from(chunks).where(inArray(chunks.id, fusedChunkIds)).all()
    const documentIds = [...new Set(chunkDetails.map((c) => c.documentId))]
    const documentDetails = db
      .select()
      .from(documents)
      .where(inArray(documents.id, documentIds))
      .all()
    const documentMap = new Map(documentDetails.map((d) => [d.id, d]))

    // Get all chunks for these documents to support context expansion
    const allDocChunks = db
      .select()
      .from(chunks)
      .where(inArray(chunks.documentId, documentIds))
      .orderBy(chunks.chunkIndex)
      .all()

    const chunkListByDoc = new Map<string, (typeof chunks.$inferSelect)[]>()
    allDocChunks.forEach((c) => {
      if (!chunkListByDoc.has(c.documentId)) chunkListByDoc.set(c.documentId, [])
      chunkListByDoc.get(c.documentId)!.push(c)
    })

    const results: SearchResult[] = []

    // Create results mapping maintaining Fused Order
    for (const chunkId of fusedChunkIds) {
      const currentChunk = chunkDetails.find((c) => c.id === chunkId)
      if (!currentChunk) continue

      const doc = documentMap.get(currentChunk.documentId)
      const docChunks = chunkListByDoc.get(currentChunk.documentId) || []

      // Context expansion (small-to-big): ưu tiên toàn bộ MỤC chứa chunk,
      // fallback prev/current/next khi tài liệu không có cấu trúc mục.
      let expandedContent = currentChunk.content
      if (includeContent) {
        expandedContent = this.collectContextContents(docChunks, currentChunk).join('\n...\n')
      }

      const chunkMetadata = (currentChunk.metadata as Record<string, unknown> | null) || undefined
      const headingPath = this.extractHeadingPath(chunkMetadata)

      const result: SearchResult = {
        chunkId: currentChunk.id,
        documentId: currentChunk.documentId,
        documentTitle: doc?.title || 'Unknown',
        documentType: doc?.type || 'unknown',
        sourceUri: doc?.sourceUri || undefined,
        pageNumber: this.resolveChunkPageNumber(
          (doc?.metadata as Record<string, unknown>) || undefined,
          chunkMetadata,
          currentChunk.startOffset,
          currentChunk.endOffset
        ),
        sectionPath: headingPath,
        content: expandedContent,
        matchedContent: currentChunk.content,
        score: rerankScores.get(chunkId) ?? rrfScores.get(chunkId) ?? 0,
        chunkIndex: currentChunk.chunkIndex
      }
      if (chunkMetadata) result.metadata = chunkMetadata
      results.push(result)
    }

    Logger.debug('KnowledgeService', 'search_metrics', {
      notebookId,
      queryLength: query.length,
      topK,
      threshold,
      vectorCandidates: vectorResults.length,
      ftsCandidates: ftsResults.length,
      fusedCandidates: fusedRankedChunkIds.length,
      rerankEnabled,
      rerankMethod,
      rerankCandidates: rerankCandidateIds.length,
      returned: results.length,
      latencyMs: Date.now() - startedAt,
      scoped: !!scopeDocumentIds || !!scopeChunkIds,
      hierarchicalDocuments: hierarchicalDocumentIds.length,
      filterOverflow
    })

    return results
  }

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
   * Lấy nội dung thế hệ (documents + chunks đã index) cho các pipeline sinh
   * dẫn xuất (quiz...): đọc tập trung tại đây thay vì mỗi service tự query
   * bảng chunks theo cách riêng (trước đây MindMapService/QuizService lặp code).
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

  /**
   * Chọn chunk trải đều khắp tài liệu (đầu/giữa/cuối) thay vì chỉ lấy N chunk đầu.
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

  getDocument(documentId: string): Document | undefined {
    const db = getDatabase()
    return db.select().from(documents).where(eq(documents.id, documentId)).get()
  }

  /**
   * Đồng bộ projection metadata dùng cho retrieval xuống cả bảng quan hệ,
   * chunk metadata và FTS. Gọi sau mọi thay đổi metadata/enrichment để các
   * tầng planner, lexical search và citation quan sát cùng một snapshot.
   */
  syncDocumentRetrievalMetadata(documentId: string): void {
    const document = this.getDocument(documentId)
    if (!document) throw new Error(`Document ${documentId} not found`)

    this.metadataIndexService.sync(document)
    const projection = this.readDocumentMetadataProjection(documentId)
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
        const metadata = this.withRetrievalMetadata(
          row.metadata as Record<string, unknown> | null,
          projection
        )
        getDatabase().update(chunks).set({ metadata }).where(eq(chunks.id, row.id)).run()
        removeFts?.run(row.id)
        insertFts?.run(row.id, document.notebookId, this.buildFtsIndexText(row.content, metadata))
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

    this.refreshDocumentContentMetadata(documentId, document.content || '')

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

    const structure = (doc.metadata as any)?.structure
    if (structure?.type === 'pages' && Array.isArray(structure.pages)) {
      const page = structure.pages.find((p: any) => p?.pageNumber === pageNumber)
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

    if (doc.localFilePath) await this.deleteLocalFile(doc.localFilePath)

    this.removeDocumentVectors([documentId])
    try {
      sectionVectorStore.deleteByDocumentIds([documentId])
    } catch (error) {
      Logger.warn('KnowledgeService', 'Failed to remove section vectors:', error)
    }
    db.delete(sections).where(eq(sections.documentId, documentId)).run()

    db.delete(documents).where(eq(documents.id, documentId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('KnowledgeService', `Document deleted: ${documentId}`)
  }

  /**
   * BUG-02 Fix: reindexDocument no longer calls addDocument (which would create a new document record).
   * Nâng cấp: khi document đã có chunks, dùng incremental diff theo contentHash từng chunk —
   * chỉ re-embed những chunk thực sự thay đổi.
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc || !doc.content) throw new Error(`Document ${documentId} not found or has no content`)

    const localFile =
      doc.localFilePath && this.isManagedLocalFilePath(doc.localFilePath)
        ? await stat(doc.localFilePath).catch(() => undefined)
        : undefined
    const parsed = localFile
      ? await this.fileParserService.parseFile(doc.localFilePath!)
      : undefined
    const rawContent = parsed?.content ?? doc.content
    const normalized = this.markdownNormalizer.normalize({
      content: rawContent,
      mimeType: parsed?.mimeType ?? doc.mimeType ?? 'text/plain',
      structure: parsed?.structure
    })
    const content = normalized.content
    const structureContext = this.buildChunkStructureContext(normalized.structure)

    const oldChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    // Cập nhật metadata/chunk options trước khi index.
    // Luôn ghi lại cấu trúc mục từ nội dung chuẩn hoá — kể cả tài liệu không có
    // file gốc (text/note), nếu không thì backfill sẽ lặp vô hạn vì mãi thiếu
    // metadata.structure.
    const metadata = { ...((doc.metadata as Record<string, unknown> | null) || {}) }
    delete metadata.structure
    const structureMetadata = this.buildCompactStructureMetadata(normalized.structure)
    if (structureMetadata) Object.assign(metadata, structureMetadata)

    if (parsed) {
      Object.assign(metadata, parsed.metadata)
      if (doc.localFilePath) {
        const localBytes = await readFile(doc.localFilePath).catch(() => undefined)
        if (localBytes) metadata.fileMd5 = createHash('md5').update(localBytes).digest('hex')
      }
    }
    db.update(documents)
      .set({
        status: 'processing',
        content,
        contentHash: createHash('md5').update(rawContent).digest('hex'),
        contentMdHash: createHash('md5').update(content).digest('hex'),
        mimeType: parsed?.mimeType ?? doc.mimeType,
        fileSize: localFile?.size ?? doc.fileSize,
        metadata,
        updatedAt: new Date()
      })
      .where(eq(documents.id, documentId))
      .run()

    if (oldChunks.length > 0) {
      // Incremental: chỉ re-embed chunk thay đổi
      await this.reindexDocumentIncremental(
        documentId,
        doc.notebookId,
        content,
        parsed ? this.buildChunkOptionsForMimeType(parsed.mimeType) : undefined,
        structureContext,
        onProgress
      )
      return
    }

    // No previous chunks: nothing to delete, go straight to re-indexing.
    // 3. Re-index using existing documentId via shared _indexContent
    await this._indexContent(
      documentId,
      doc.notebookId,
      content,
      parsed ? this.buildChunkOptionsForMimeType(parsed.mimeType) : undefined,
      structureContext,
      onProgress
    )
  }

  /**
   * Incremental reindex: chunk mới được diff theo contentHash với chunk cũ.
   *  - Chunk có hash trùng: giữ nguyên id/embedding, chỉ cập nhật chunkIndex/offsets
   *  - Chunk mới: embed và insert
   *  - Chunk cũ không còn khớp: xóa khỏi chunks + embeddings + vec + FTS
   */
  async reindexDocumentIncremental(
    documentId: string,
    notebookId: string,
    content: string,
    chunkOptions?: ChunkOptions,
    structure?: ChunkStructureContext,
    onProgress?: IndexProgressCallback
  ): Promise<IncrementalReindexResult> {
    await this.ensureEmbeddingReady()
    const db = getDatabase()
    const now = new Date()
    // Trích metadata TRƯỚC khi dựng chunk/FTS để metadata mới đi vào index.
    this.refreshDocumentContentMetadata(documentId, content)
    const metadataProjection = this.readDocumentMetadataProjection(documentId)

    onProgress?.('diffing', 10)
    const chunkResults = this.chunkingService.chunk(content, chunkOptions, structure)
    if (chunkResults.length === 0) throw new Error('No chunks generated from document')

    // Tách lại bản ghi mục + gán sectionId theo offset (giống full index) để
    // cấu trúc mục không bị lệch khi nội dung tài liệu thay đổi.
    const sectionPlan = this.buildSectionRecords(
      notebookId,
      documentId,
      content,
      structure?.sections
    )
    db.delete(sections).where(eq(sections.documentId, documentId)).run()
    if (sectionPlan.records.length > 0) {
      db.insert(sections).values(sectionPlan.records).run()
    }

    const oldChunks = db.select().from(chunks).where(eq(chunks.documentId, documentId)).all()
    const oldByHash = new Map<string, Chunk>()
    for (const old of oldChunks) {
      if (old.contentHash) oldByHash.set(old.contentHash, old)
    }

    const toReuse: Array<{
      oldChunk: Chunk
      chunkIndex: number
      startOffset: number | null
      endOffset: number | null
      metadata?: Record<string, unknown>
      tokenCount: number | null
      sectionId: string | null
    }> = []
    const toCreate: Array<Chunk & { content: string; contentHash: string }> = []
    const reusedOldIds = new Set<string>()

    for (const chunk of chunkResults) {
      const hash = createHash('md5').update(chunk.content).digest('hex')
      const old = oldByHash.get(hash)
      if (old && !reusedOldIds.has(old.id)) {
        reusedOldIds.add(old.id)
        toReuse.push({
          oldChunk: old,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          metadata: this.withRetrievalMetadata(chunk.metadata, metadataProjection),
          tokenCount: chunk.tokenCount,
          sectionId: sectionPlan.assign(chunk.startOffset)
        })
      } else {
        toCreate.push({
          id: `chunk_${randomUUID()}`,
          documentId,
          notebookId,
          content: chunk.content,
          contentHash: hash,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          metadata: this.withRetrievalMetadata(chunk.metadata, metadataProjection) ?? null,
          tokenCount: chunk.tokenCount,
          sectionId: sectionPlan.assign(chunk.startOffset) ?? null,
          createdAt: now
        })
      }
    }

    const toRemove = oldChunks.filter((c) => !reusedOldIds.has(c.id))
    Logger.info(
      'KnowledgeService',
      `Incremental diff: ${toReuse.length} reuse, ${toCreate.length} create, ${toRemove.length} remove`
    )

    // 1. Xóa chunk không còn khớp
    if (toRemove.length > 0) {
      const removeIds = toRemove.map((c) => c.id)
      const vectorStore = await vectorStoreManager.getStore(notebookId)
      await vectorStore.deleteByChunkIds(removeIds)
      this.deleteFtsChunkIds(removeIds)
      db.delete(embeddings).where(inArray(embeddings.chunkId, removeIds)).run()
      db.delete(chunks).where(inArray(chunks.id, removeIds)).run()
    }

    // 2. Cập nhật vị trí + metadata cấu trúc cho chunk tái sử dụng
    //    (nội dung không đổi → embedding giữ nguyên). FTS được refresh để
    //    headingPath mới đi vào index — cũng là bước backfill cho chunk cũ.
    //    Bọc trong 1 transaction để tài liệu lớn không bị dở dang giữa đường
    //    (metadata đã đổi nhưng FTS chưa cập nhật) nếu app tắt đột ngột.
    const reuseSqlite = getSqlite()

    const applyReuse = (): void => {
      for (const item of toReuse) {
        db.update(chunks)
          .set({
            chunkIndex: item.chunkIndex,
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            metadata: item.metadata ?? null,
            tokenCount: item.tokenCount,
            sectionId: item.sectionId ?? null
          })
          .where(eq(chunks.id, item.oldChunk.id))
          .run()

        if (reuseSqlite) {
          this.deleteFtsChunkIds([item.oldChunk.id])
          reuseSqlite
            .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
            .run(
              item.oldChunk.id,
              notebookId,
              this.buildFtsIndexText(item.oldChunk.content, item.metadata)
            )
        }
      }
    }

    if (reuseSqlite && toReuse.length > 1) {
      reuseSqlite.transaction(applyReuse)()
    } else {
      applyReuse()
    }

    // 3. Embed + insert chunk mới
    if (toCreate.length > 0) {
      onProgress?.('generating_embeddings', 30)
      const embeddingResults = await this.embeddingService.embedBatch(
        toCreate.map((c) => c.content),
        { dimensions: 1024 },
        (completed, total) => {
          onProgress?.('generating_embeddings', Math.round(30 + (completed / total) * 50))
        }
      )

      const detectedDimensions = embeddingResults.length > 0 ? embeddingResults[0].dimensions : 1024
      if (embeddingResults.length > 0 && detectedDimensions !== 1024) {
        throw new Error(
          `Unsupported embedding dimensions: ${detectedDimensions}. Current sqlite-vec schema requires 1024 dimensions.`
        )
      }

      onProgress?.('saving_embeddings', 85)
      const sqlite = getSqlite()
      const vectorItems: Array<{
        id: string
        chunkId: string
        vector: Float32Array
        metadata?: Record<string, unknown>
      }> = []

      for (let i = 0; i < toCreate.length; i++) {
        const chunkRow = toCreate[i]
        const embResult = embeddingResults[i]
        db.insert(chunks).values(chunkRow).run()

        if (sqlite) {
          sqlite
            .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
            .run(
              chunkRow.id,
              notebookId,
              this.buildFtsIndexText(chunkRow.content, chunkRow.metadata)
            )
        }

        const embeddingId = `emb_${randomUUID()}`
        db.insert(embeddings)
          .values({
            id: embeddingId,
            chunkId: chunkRow.id,
            notebookId,
            model: embResult.model,
            dimensions: embResult.dimensions,
            createdAt: now
          })
          .run()

        vectorItems.push({
          id: embeddingId,
          chunkId: chunkRow.id,
          vector: embResult.embedding,
          metadata: { model: embResult.model, documentId }
        })
      }

      const vectorStore = await vectorStoreManager.getStore(
        notebookId,
        undefined,
        detectedDimensions
      )
      await vectorStore.upsert(vectorItems)
    }

    // 4. Trạng thái document (metadata đã refresh ở đầu incremental)
    db.update(documents)
      .set({ status: 'indexed', chunkCount: chunkResults.length, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 5. Vector cấp tài liệu (tầng 1 Hierarchical Retrieval) — best-effort
    await this.updateDocumentVector(documentId, notebookId)

    // 5.5 Vector cấp mục (tầng 2 Hierarchical Retrieval) — best-effort
    await this.updateSectionVectors(notebookId, documentId, sectionPlan.records)
    this.updateSectionChunkCounts(documentId)

    executeCheckpoint('PASSIVE')
    onProgress?.('completed', 100)
    return { created: toCreate.length, reused: toReuse.length, removed: toRemove.length }
  }

  /**
   * Trích + lưu metadata tài liệu dựa trên nội dung mới (dùng chung cho full & incremental)
   */
  private refreshDocumentContentMetadata(documentId: string, content: string): void {
    const db = getDatabase()
    const document = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!document) return

    const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
    const extracted = extractDocumentMetadata({ title: document.title, content })
    const inspector = isOriginalLegalDocument(content)
      ? mergeDocumentMetadataInspector(
          extracted.inspector,
          rootMetadata.documentMetadataInspector as DocumentMetadataInspector | undefined
        )
      : extracted.inspector

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
    this.metadataIndexService.sync(this.getDocument(documentId)!)
  }

  /**
   * Đồng bộ note đã sửa vào KB (gọi từ noteHandlers sau update-note)
   */
  async syncNoteToKnowledge(noteId: string): Promise<void> {
    const db = getDatabase()
    const linkedDocs = db.select().from(documents).where(eq(documents.sourceNoteId, noteId)).all()

    if (linkedDocs.length === 0) return

    const note = db.select().from(notes).where(eq(notes.id, noteId)).get()
    if (!note) return

    for (const doc of linkedDocs) {
      try {
        const trimmedContent = note.content.trim()
        if (!trimmedContent) continue

        const normalized = this.markdownNormalizer.normalize({
          content: note.content,
          mimeType: 'text/plain'
        })
        const content = normalized.content
        const structureMetadata = this.buildCompactStructureMetadata(normalized.structure)
        const docMetadata = { ...((doc.metadata as Record<string, unknown> | null) || {}) }
        delete docMetadata.structure
        if (structureMetadata) Object.assign(docMetadata, structureMetadata)

        db.update(documents)
          .set({
            title: note.title,
            content,
            contentHash: createHash('md5').update(note.content).digest('hex'),
            contentMdHash: createHash('md5').update(content).digest('hex'),
            metadata: docMetadata,
            updatedAt: new Date()
          })
          .where(eq(documents.id, doc.id))
          .run()

        const result = await this.reindexDocumentIncremental(
          doc.id,
          doc.notebookId,
          content,
          undefined,
          this.buildChunkStructureContext(normalized.structure),
          undefined
        )
        Logger.info('KnowledgeService', `Note ${noteId} synced to KB doc ${doc.id}:`, result)
        this.emitAutoSync({
          documentId: doc.id,
          documentTitle: note.title,
          reason: 'note-updated',
          result
        })
      } catch (error) {
        Logger.error('KnowledgeService', `Failed to sync note ${noteId} to KB:`, error)
        this.emitAutoSync({
          documentId: doc.id,
          documentTitle: note.title,
          reason: 'note-updated',
          error: (error as Error).message
        })
      }
    }
  }

  /**
   * Xóa KB documents liên kết với note bị xóa
   */
  async deleteDocumentsBySourceNote(noteId: string): Promise<void> {
    const db = getDatabase()
    const linkedDocs = db.select().from(documents).where(eq(documents.sourceNoteId, noteId)).all()

    for (const doc of linkedDocs) {
      await this.deleteDocument(doc.id)
    }
  }

  // ==================== Auto-sync (watcher) ====================

  /**
   * Bật auto-sync: watch thư mục knowledge-files/ + source file gốc của các
   * document dạng file. Khi file thay đổi → tự reindex incremental.
   */
  startAutoSync(callback?: (payload: AutoSyncPayload) => void): void {
    this.autoSyncCallback = callback
    if (this.fileWatchers.size > 0) return

    this.watchKnowledgeFilesDir()

    const db = getDatabase()
    const fileDocs = db.select().from(documents).where(eq(documents.type, 'file')).all()
    for (const doc of fileDocs) {
      if (doc.sourceUri) this.watchSourceFile(doc)
    }

    Logger.info('KnowledgeService', 'Auto-sync started')
  }

  stopAutoSync(): void {
    for (const watcher of this.fileWatchers.values()) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
    }
    this.fileWatchers.clear()
    for (const timer of this.syncTimers.values()) {
      clearTimeout(timer)
    }
    this.syncTimers.clear()
    this.autoSyncCallback = undefined
    Logger.info('KnowledgeService', 'Auto-sync stopped')
  }

  /**
   * Gắn watcher cho source file gốc (khi người dùng sửa file ngoài app).
   */
  watchSourceFile(doc: Document): void {
    if (!doc.sourceUri) return
    const key = `source:${doc.id}`
    if (this.fileWatchers.has(key)) return
    if (!existsSync(doc.sourceUri)) {
      // The source can legitimately be moved or deleted outside MiChat. Keep
      // the indexed snapshot available, but do not attempt an invalid watcher
      // again on every application startup.
      Logger.info('KnowledgeService', `Auto-sync skipped missing source: ${doc.sourceUri}`)
      return
    }

    try {
      const watcher = watch(doc.sourceUri, () => {
        this.scheduleAutoSync(doc.id)
      })
      watcher.on('error', () => {
        this.fileWatchers.delete(key)
      })
      this.fileWatchers.set(key, watcher)
    } catch (error) {
      Logger.warn('KnowledgeService', `Cannot watch source file ${doc.sourceUri}:`, error)
    }
  }

  private watchKnowledgeFilesDir(): void {
    if (this.fileWatchers.has('knowledge-files-dir')) return

    try {
      const watcher = watch(this.knowledgeFilesDir, (_eventType, filename) => {
        if (!filename) return
        const doc = this.findDocumentByLocalFileName(filename)
        if (doc) this.scheduleAutoSync(doc.id)
      })
      watcher.on('error', () => {
        this.fileWatchers.delete('knowledge-files-dir')
      })
      this.fileWatchers.set('knowledge-files-dir', watcher)
    } catch (error) {
      Logger.warn('KnowledgeService', 'Cannot watch knowledge-files dir:', error)
    }
  }

  private findDocumentByLocalFileName(filename: string): Document | undefined {
    const db = getDatabase()
    return db
      .select()
      .from(documents)
      .where(eq(documents.localFilePath, join(this.knowledgeFilesDir, filename)))
      .get()
  }

  /**
   * Debounce 2 giây cho mỗi document (tránh watcher bắn nhiều lần khi đang ghi file)
   */
  private scheduleAutoSync(documentId: string): void {
    const existing = this.syncTimers.get(documentId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.syncTimers.delete(documentId)
      void this.autoSyncDocument(documentId)
    }, 2000)
    this.syncTimers.set(documentId, timer)
  }

  private async autoSyncDocument(documentId: string): Promise<void> {
    if (this.autoSyncRunning) {
      // Xếp lại sau khi lượt hiện tại xong
      this.scheduleAutoSync(documentId)
      return
    }

    this.autoSyncRunning = true
    try {
      const db = getDatabase()
      const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
      if (!doc || doc.type !== 'file') return

      // Chọn nguồn: file gốc (sourceUri) ưu tiên, nếu không thì bản copy local
      const sourceExists = doc.sourceUri
        ? await stat(doc.sourceUri)
            .then(() => true)
            .catch(() => false)
        : false
      const sourcePath = sourceExists ? doc.sourceUri! : doc.localFilePath

      if (!sourcePath) {
        Logger.warn('KnowledgeService', `No source file for document ${documentId}, skip auto-sync`)
        return
      }

      if (sourcePath === doc.localFilePath && !this.isManagedLocalFilePath(sourcePath)) {
        return
      }

      // So sánh md5 bytes của file trước khi parse (rẻ)
      const fileBytes = await readFile(sourcePath)
      const fileMd5 = createHash('md5').update(fileBytes).digest('hex')
      const metadata = (doc.metadata as Record<string, unknown> | null) || {}
      const knownMd5 = typeof metadata.fileMd5 === 'string' ? metadata.fileMd5 : undefined

      if (knownMd5 === fileMd5 && doc.contentHash) return

      // Nếu nguồn là file gốc → copy đè bản local rồi reparse
      if (sourcePath !== doc.localFilePath && doc.localFilePath) {
        await copyFile(sourcePath, doc.localFilePath)
      }

      const result = await this.reindexDocument(documentId)
      Logger.info(
        'KnowledgeService',
        `Auto-synced document ${documentId}`,
        result === undefined ? '' : result
      )

      // Cập nhật fileMd5 trong metadata
      const updatedDoc = db.select().from(documents).where(eq(documents.id, documentId)).get()
      if (updatedDoc) {
        const updatedMetadata = { ...((updatedDoc.metadata as Record<string, unknown>) || {}) }
        updatedMetadata.fileMd5 = fileMd5
        db.update(documents)
          .set({ metadata: updatedMetadata })
          .where(eq(documents.id, documentId))
          .run()
      }

      this.emitAutoSync({ documentId, documentTitle: doc.title, reason: 'file-changed' })
    } catch (error) {
      Logger.error('KnowledgeService', `Auto-sync failed for document ${documentId}:`, error)
      this.emitAutoSync({
        documentId,
        documentTitle: documentId,
        reason: 'file-changed',
        error: (error as Error).message
      })
    } finally {
      this.autoSyncRunning = false
    }
  }

  private emitAutoSync(payload: AutoSyncPayload): void {
    try {
      this.autoSyncCallback?.(payload)
    } catch (error) {
      Logger.error('KnowledgeService', 'Auto-sync callback error:', error)
    }
  }

  /**
   * P-01 Fix: Optimized to a single aggregated query instead of 3 separate COUNT queries
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
}
