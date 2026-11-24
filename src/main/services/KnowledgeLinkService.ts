/**
 * KnowledgeLinkService
 * Sinh và quản lý liên kết tri thức giữa các document (knowledge graph nhẹ).
 *
 * Chiến lược: LLM trích keyword/entity từ document → tìm document khác
 * trùng keyword qua FTS5 → tạo liên kết kèm confidence. Liên kết cũ
 * sẽ decay dần và bị loại nếu confidence xuống thấp.
 */

import { randomUUID } from 'crypto'
import { getDatabase, getSqlite } from '../db'
import { documents, chunks, knowledgeLinks } from '../db/schema'
import type { NewKnowledgeLink } from '../db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ApiClient } from '../ai/apiClient'
import Logger from '../../shared/utils/logger'

const MAX_KEYWORDS = 10
const MAX_SOURCE_CHUNKS = 400
const LINK_BASE_CONFIDENCE = 0.4
const DECAY_PER_WEEK = 0.95
const MIN_CONFIDENCE = 0.2

export interface LinkInfo {
  id: string
  sourceDocumentId: string
  targetDocumentId: string
  targetTitle: string
  relationType: 'related' | 'extends' | 'contradicts'
  confidence: number
  evidence?: string | null
}

export class KnowledgeLinkService {
  private apiClient: ApiClient

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient
  }

  /**
   * Trích keyword bằng LLM (fallback: từ khóa từ tiêu đề nếu LLM lỗi)
   */
  private async extractKeywords(title: string, contentSnippet: string): Promise<string[]> {
    const provider = await this.apiClient.getChatProvider()

    if (provider) {
      try {
        const prompt = `Extract up to ${MAX_KEYWORDS} most important keywords/entities from this document. Return ONLY a JSON array of strings, no explanation.

Title: ${title}

Content (excerpt):
${contentSnippet.slice(0, 2000)}`

        const raw = await new Promise<string>((resolve, reject) => {
          let text = ''
          provider.sendMessageStream(
            [{ role: 'user', content: prompt }],
            (chunk) => {
              text += chunk.content
            },
            (error) => reject(error),
            () => resolve(text.trim())
          )
        })

        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          if (Array.isArray(parsed)) {
            return parsed
              .filter((item): item is string => typeof item === 'string')
              .map((k) => k.trim())
              .filter((k) => k.length >= 2)
              .slice(0, MAX_KEYWORDS)
          }
        }
      } catch (error) {
        Logger.warn(
          'KnowledgeLinkService',
          'LLM keyword extraction failed, using title words:',
          error
        )
      }
    }

    // Fallback: từ trong tiêu đề (bỏ stopwords ngắn)
    return title
      .split(/[\s,;:.\-_()]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
      .slice(0, MAX_KEYWORDS)
  }

  /**
   * Sinh liên kết cho một document: tìm các document khác cùng notebook
   * có nội dung trùng keyword (FTS5), tạo link kèm confidence.
   */
  async generateLinksForDocument(documentId: string): Promise<number> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) throw new Error(`Document ${documentId} not found`)

    const docChunks = db
      .select({ id: chunks.id, content: chunks.content })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .orderBy(chunks.chunkIndex)
      .limit(MAX_SOURCE_CHUNKS)
      .all()
    const snippet = docChunks
      .slice(0, 3)
      .map((c) => c.content)
      .join('\n\n')

    const keywords = await this.resolveKeywords(doc, snippet)
    if (keywords.length === 0) return 0

    // Xóa link cũ của source doc để sinh mới
    db.delete(knowledgeLinks)
      .where(
        and(eq(knowledgeLinks.sourceDocumentId, documentId), eq(knowledgeLinks.status, 'active'))
      )
      .run()

    const sqlite = getSqlite()
    const now = new Date()
    let created = 0

    if (sqlite) {
      const targetIds = new Map<string, { chunkId?: string; evidence: string }>()
      const seenDocs = new Set<string>()

      for (const keyword of keywords) {
        const safeKeyword = keyword.replace(/["'*]/g, ' ').trim()
        if (!safeKeyword) continue

        try {
          const rows = sqlite
            .prepare(
              `SELECT f.chunk_id, c.document_id, c.notebook_id
               FROM fts_chunks f
               JOIN chunks c ON c.id = f.chunk_id
               WHERE f.notebook_id = ? AND c.document_id != ? AND fts_chunks MATCH ?
               ORDER BY rank LIMIT 8`
            )
            .all(doc.notebookId, documentId, `"${safeKeyword}"`) as Array<{
            chunk_id: string
            document_id: string
            notebook_id: string
          }>

          for (const row of rows) {
            if (row.notebook_id !== doc.notebookId) continue
            if (row.document_id === documentId) continue
            if (seenDocs.has(row.document_id)) continue
            seenDocs.add(row.document_id)
            targetIds.set(row.document_id, { chunkId: row.chunk_id, evidence: keyword })
          }
        } catch (error) {
          Logger.warn(
            'KnowledgeLinkService',
            `FTS keyword search failed for "${safeKeyword}":`,
            error
          )
        }
      }

      for (const [targetId, target] of targetIds) {
        const existing = db
          .select({ id: knowledgeLinks.id })
          .from(knowledgeLinks)
          .where(
            and(
              eq(knowledgeLinks.sourceDocumentId, documentId),
              eq(knowledgeLinks.targetDocumentId, targetId),
              eq(knowledgeLinks.status, 'active')
            )
          )
          .get()

        if (existing) continue

        // Neo link vào CHUNK cụ thể ở cả hai phía để retrieval mở rộng được
        // theo chunk (trước đây chỉ có document-level nên expansion vô hiệu).
        const sourceChunk = docChunks.find((chunk) =>
          chunk.content.toLowerCase().includes(target.evidence.toLowerCase())
        )

        const link: NewKnowledgeLink = {
          id: `link_${randomUUID()}`,
          notebookId: doc.notebookId,
          sourceDocumentId: documentId,
          targetDocumentId: targetId,
          sourceChunkId: sourceChunk?.id ?? null,
          targetChunkId: target.chunkId ?? null,
          relationType: 'related',
          confidence: LINK_BASE_CONFIDENCE,
          evidence: target.evidence,
          status: 'active',
          createdAt: now,
          updatedAt: now
        }
        db.insert(knowledgeLinks).values(link).run()
        created++
      }
    }

    Logger.info(
      'KnowledgeLinkService',
      `Generated ${created} links for document ${documentId} (${keywords.length} keywords)`
    )
    return created
  }

  /**
   * Keyword cho link: ưu tiên enrichment đã có (keywords + entities) để không
   * phải gọi LLM lần thứ hai cho cùng tài liệu.
   */
  private async resolveKeywords(
    doc: { title: string; metadata: unknown },
    snippet: string
  ): Promise<string[]> {
    const enrichment = (doc.metadata as Record<string, unknown> | null)?.enrichment as
      | { keywords?: unknown; entities?: unknown }
      | undefined

    const fromEnrichment = [
      ...(Array.isArray(enrichment?.keywords) ? enrichment.keywords : []),
      ...(Array.isArray(enrichment?.entities) ? enrichment.entities : [])
    ].filter((item): item is string => typeof item === 'string' && item.trim().length >= 2)

    if (fromEnrichment.length > 0) {
      return [...new Set(fromEnrichment.map((item) => item.trim()))].slice(0, MAX_KEYWORDS * 2)
    }

    return this.extractKeywords(doc.title, snippet)
  }

  /**
   * Lấy liên kết đang hoạt động của một document (cả 2 chiều)
   */
  getLinks(notebookId: string, documentId: string, limit = 50): LinkInfo[] {
    const db = getDatabase()
    const links = db
      .select()
      .from(knowledgeLinks)
      .where(
        and(
          eq(knowledgeLinks.notebookId, notebookId),
          eq(knowledgeLinks.status, 'active'),
          sql`(${knowledgeLinks.sourceDocumentId} = ${documentId} OR ${knowledgeLinks.targetDocumentId} = ${documentId})`
        )
      )
      .orderBy(sql`confidence DESC`)
      .limit(limit)
      .all()

    const docIds = [
      ...new Set(
        links
          .flatMap((l) => [l.sourceDocumentId, l.targetDocumentId])
          .filter((id) => id !== documentId)
      )
    ]
    const docTitles = new Map<string, string>()
    if (docIds.length > 0) {
      db.select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(inArray(documents.id, docIds))
        .all()
        .forEach((d) => docTitles.set(d.id, d.title))
    }

    return links.map((l) => ({
      id: l.id,
      sourceDocumentId: l.sourceDocumentId,
      targetDocumentId: l.targetDocumentId,
      targetTitle:
        l.targetDocumentId === documentId
          ? docTitles.get(l.sourceDocumentId) || 'Unknown'
          : docTitles.get(l.targetDocumentId) || 'Unknown',
      relationType: l.relationType,
      confidence: l.confidence,
      evidence: l.evidence
    }))
  }

  /**
   * Giảm confidence của liên kết cũ theo thời gian; loại link quá yếu.
   * Chạy định kỳ qua background queue.
   */
  decayLinks(notebookId: string): number {
    const db = getDatabase()
    const links = db
      .select()
      .from(knowledgeLinks)
      .where(and(eq(knowledgeLinks.notebookId, notebookId), eq(knowledgeLinks.status, 'active')))
      .all()

    const now = new Date()
    let removed = 0

    for (const link of links) {
      const ageWeeks = (now.getTime() - link.updatedAt.getTime()) / (1000 * 60 * 60 * 24 * 7)
      if (ageWeeks < 1) continue

      const newConfidence = link.confidence * Math.pow(DECAY_PER_WEEK, Math.floor(ageWeeks))
      if (newConfidence < MIN_CONFIDENCE) {
        db.update(knowledgeLinks)
          .set({ status: 'decayed', confidence: newConfidence, updatedAt: now })
          .where(eq(knowledgeLinks.id, link.id))
          .run()
        removed++
      } else if (newConfidence < link.confidence) {
        db.update(knowledgeLinks)
          .set({ confidence: newConfidence, updatedAt: now })
          .where(eq(knowledgeLinks.id, link.id))
          .run()
      }
    }

    if (removed > 0) {
      Logger.info('KnowledgeLinkService', `Decayed ${removed} weak links in notebook ${notebookId}`)
    }
    return removed
  }
}
