/**
 * Document metadata projections and retrieval index text (plan Task 17).
 *
 * Extracted from `KnowledgeService` without behavior changes: these helpers
 * turn loader structure and stored metadata JSON into the compact structure
 * record, the retrieval metadata projection, and the text embedded for the
 * document-level vector.
 */

import { eq } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { documents, type Document } from '../../db/schema'
import { flattenSectionsWithPath, sanitizeCompactSections } from '../loaders/sections'
import type { SectionInfo } from '../loaders/types'
import type { ChunkStructureContext } from '../ChunkingService'

/** Số ký tự tối đa của nội dung đưa vào vector cấp tài liệu. */
export const DOCUMENT_INDEX_MAX_CHARS = 2000

/** Số ký tự tối đa của nội dung mục đưa vào vector cấp mục (section). */
export const SECTION_INDEX_MAX_CHARS = 1200

export interface RetrievalMetadataProjection {
  keywords: string[]
  entities: string[]
  tags: string[]
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

export interface DocumentMetadataProjection {
  legalMetadata?: Record<string, string>
  retrievalMetadata: RetrievalMetadataProjection
}

/**
 * Rút gọn cấu trúc tài liệu để lưu vào documents.metadata.
 * Giữ CẢ pages (PDF/PPT) và sections (Word/Markdown).
 */
export function buildCompactStructureMetadata(
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
export function buildChunkStructureContext(
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
export function extractLegalMetadata(
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

export function extractRetrievalMetadata(
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

export function readDocumentMetadataProjection(documentId: string): DocumentMetadataProjection {
  const row = getDatabase()
    .select({ metadata: documents.metadata })
    .from(documents)
    .where(eq(documents.id, documentId))
    .get()
  const metadata = row?.metadata as Record<string, unknown> | null | undefined
  return {
    legalMetadata: extractLegalMetadata(metadata),
    retrievalMetadata: extractRetrievalMetadata(metadata)
  }
}

export function withRetrievalMetadata(
  metadata: Record<string, unknown> | null | undefined,
  projection: DocumentMetadataProjection
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

export function legalMetadataIndexText(legalMetadata: Record<string, string> | undefined): string {
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

export function retrievalMetadataIndexText(metadata: RetrievalMetadataProjection): string {
  return [...metadata.keywords, ...metadata.entities, ...metadata.tags].join(' · ')
}

/**
 * Text dùng để embed ở cấp TÀI LIỆU: ưu tiên summary (enrichment), nếu chưa có
 * thì dùng tiêu đề + phần đầu nội dung — đủ để phân biệt chủ đề tài liệu.
 */
export function buildDocumentIndexText(doc: Document): string {
  const metadata = (doc.metadata as Record<string, unknown> | null) || {}
  const enrichment = metadata.enrichment as { summary?: unknown } | undefined
  const summary = typeof enrichment?.summary === 'string' ? enrichment.summary.trim() : ''
  const legalText = legalMetadataIndexText(extractLegalMetadata(metadata))
  const retrievalText = retrievalMetadataIndexText(extractRetrievalMetadata(metadata))

  const heading = (doc.title || '').trim()
  const body = (doc.content || '').trim().slice(0, DOCUMENT_INDEX_MAX_CHARS)

  return [heading, legalText, retrievalText, summary, body]
    .filter((part) => part.length > 0)
    .join('\n\n')
}
