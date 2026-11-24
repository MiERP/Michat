/**
 * Section (heading) index lifecycle (plan Task 17).
 *
 * Extracted from `KnowledgeService` without behavior changes: it builds the
 * `sections` rows for a document, embeds them for the section tier of
 * hierarchical retrieval, and refreshes the per-section chunk counts.
 */

import { createHash, randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { chunks, documents, sections, type NewSection } from '../../db/schema'
import { sectionVectorStore } from '../../vectorstore'
import Logger from '../../../shared/utils/logger'
import {
  findDeepestSection,
  sanitizeCompactSections,
  type CompactSection
} from '../loaders/sections'
import type { EmbeddingResult } from '../../ai/types'
import {
  SECTION_INDEX_MAX_CHARS,
  extractLegalMetadata,
  extractRetrievalMetadata,
  legalMetadataIndexText,
  retrievalMetadataIndexText
} from './DocumentRetrievalMetadata'

export interface SectionPlan {
  records: NewSection[]
  assign: (startOffset: number | null) => string | null
}

export type SectionEmbedder = (texts: string[]) => Promise<EmbeddingResult[]>

export class SectionIndexService {
  constructor(private readonly embed: SectionEmbedder) {}

  /**
   * Dựng bản ghi MỤC (section) từ cấu trúc phẳng của tài liệu có heading.
   * Chỉ giữ mục có nội dung thật (bỏ mục chỉ có tiêu đề). Trả về danh sách
   * bản ghi và hàm gán sectionId cho chunk theo offset bắt đầu.
   */
  buildRecords(
    notebookId: string,
    documentId: string,
    content: string,
    compactSections: CompactSection[] | undefined
  ): SectionPlan {
    const empty: SectionPlan = { records: [], assign: () => null }

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
  async updateVectors(
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
      const legalText = legalMetadataIndexText(extractLegalMetadata(rootMetadata))
      const retrievalText = retrievalMetadataIndexText(extractRetrievalMetadata(rootMetadata))
      const texts = records.map((record) =>
        [record.title, legalText, retrievalText, record.content.slice(0, SECTION_INDEX_MAX_CHARS)]
          .filter((part) => part.length > 0)
          .join('\n\n')
      )
      const results = await this.embed(texts)

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
  updateChunkCounts(documentId: string): void {
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
}
