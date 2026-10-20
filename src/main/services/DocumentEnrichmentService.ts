/**
 * DocumentEnrichmentService
 * Làm giàu tài liệu (Document Enrichment) bằng LLM local:
 *  - TOC / cây mục: lấy trực tiếp từ cấu trúc đã lưu (không tốn LLM).
 *  - Summary, keywords, entities: một lần gọi LLM local, chạy nền khi app rảnh.
 *
 * Kết quả lưu vào documents.metadata.enrichment và được dùng lại cho:
 *  - vector cấp tài liệu (tầng chọn tài liệu của Hierarchical Retrieval)
 *  - knowledge links (keyword/entity thay vì gọi LLM lần hai)
 */

import { getDatabase } from '../db'
import { documents } from '../db/schema'
import { eq } from 'drizzle-orm'
import { ProviderManager } from '../providers/ProviderManager'
import { KnowledgeService } from './KnowledgeService'
import { flattenSectionsWithPath } from './loaders/sections'
import type { SectionInfo } from './loaders/types'
import Logger from '../../shared/utils/logger'

const MAX_KEYWORDS = 12
const MAX_ENTITIES = 12
const CONTENT_EXCERPT_CHARS = 3000

export interface EnrichmentTocEntry {
  level: number
  title: string
  headingPath: string[]
}

export interface DocumentEnrichment {
  summary: string
  keywords: string[]
  entities: string[]
  toc: EnrichmentTocEntry[]
  model?: string
  /** Hash nội dung tại thời điểm làm giàu — dùng để biết enrichment còn hợp lệ. */
  sourceHash?: string
  generatedAt: string
}

export interface EnrichOptions {
  signal?: AbortSignal
  /** Bỏ qua nếu enrichment hiện tại vẫn khớp nội dung (dùng cho job nền). */
  skipIfFresh?: boolean
}

export class EnrichmentCancelledError extends Error {
  constructor() {
    super('Enrichment cancelled')
    this.name = 'EnrichmentCancelledError'
  }
}

export class DocumentEnrichmentService {
  constructor(
    private providerManager: ProviderManager,
    private knowledgeService: KnowledgeService
  ) {}

  /**
   * Đọc enrichment đã lưu của một tài liệu.
   */
  getEnrichment(documentId: string): DocumentEnrichment | undefined {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return undefined

    const enrichment = (doc.metadata as Record<string, unknown> | null)?.enrichment
    if (!enrichment || typeof enrichment !== 'object') return undefined

    return enrichment as DocumentEnrichment
  }

  /**
   * Làm giàu một tài liệu và lưu kết quả vào documents.metadata.enrichment.
   */
  async enrich(documentId: string, options: EnrichOptions = {}): Promise<DocumentEnrichment> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) throw new Error(`Document ${documentId} not found`)

    const rootMetadata = (doc.metadata as Record<string, unknown> | null) || {}
    const existing = rootMetadata.enrichment as DocumentEnrichment | undefined

    if (options.skipIfFresh && existing?.sourceHash && existing.sourceHash === doc.contentHash) {
      Logger.debug('DocumentEnrichment', `Enrichment fresh, skipped: ${documentId}`)
      return existing
    }

    const toc = this.buildToc(rootMetadata)
    const extracted = await this.extractWithLlm(doc.title, doc.content || '', toc, options.signal)

    const enrichment: DocumentEnrichment = {
      summary: extracted.summary,
      keywords: extracted.keywords,
      entities: extracted.entities,
      toc,
      model: extracted.model,
      sourceHash: doc.contentHash || undefined,
      generatedAt: new Date().toISOString()
    }

    db.update(documents)
      .set({
        metadata: { ...rootMetadata, enrichment }
      })
      .where(eq(documents.id, documentId))
      .run()

    // Summary mới → cập nhật vector cấp tài liệu (best-effort, không làm hỏng enrichment)
    await this.knowledgeService.refreshDocumentVector(documentId)

    Logger.info(
      'DocumentEnrichment',
      `Enriched ${documentId}: ${toc.length} mục, ${enrichment.keywords.length} keywords, ${enrichment.entities.length} entities, summary=${enrichment.summary.length} chars`
    )

    return enrichment
  }

  /**
   * TOC lấy từ cấu trúc tài liệu đã lưu lúc index — không cần thêm LLM.
   */
  private buildToc(rootMetadata: Record<string, unknown>): EnrichmentTocEntry[] {
    const structure = rootMetadata.structure as
      | { sections?: Array<{ level: number; title: string; headingPath?: string[] }> }
      | undefined

    if (structure?.sections?.length) {
      return structure.sections.map((section) => ({
        level: section.level,
        title: section.title,
        headingPath: section.headingPath || [section.title]
      }))
    }

    // Dữ liệu cũ chưa có sections phẳng → suy từ cây SectionInfo nếu còn
    const sections = rootMetadata.sections as SectionInfo[] | undefined
    if (sections?.length) {
      return flattenSectionsWithPath(sections).map((section) => ({
        level: section.level,
        title: section.title,
        headingPath: section.headingPath
      }))
    }

    return []
  }

  private async extractWithLlm(
    title: string,
    content: string,
    toc: EnrichmentTocEntry[],
    signal?: AbortSignal
  ): Promise<{ summary: string; keywords: string[]; entities: string[]; model?: string }> {
    const fallback = {
      summary: '',
      keywords: this.keywordsFromTitle(title),
      entities: [] as string[]
    }

    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      Logger.warn('DocumentEnrichment', 'No chat provider available, kept fallback enrichment')
      return fallback
    }

    const tocLine = toc.length > 0 ? toc.map((entry) => entry.title).join(' | ') : '(không có mục)'
    const prompt = `Bạn là công cụ trích xuất dữ liệu. Đọc tài liệu rồi trả về DUY NHẤT một đối tượng JSON, không giải thích gì thêm:
{"summary":"tóm tắt 2-3 câu bằng cùng ngôn ngữ với tài liệu","keywords":["tối đa ${MAX_KEYWORDS} từ khoá quan trọng"],"entities":["tối đa ${MAX_ENTITIES} tên riêng/tổ chức/số hiệu văn bản/mốc thời gian"]}

Tiêu đề: ${title}
Các mục: ${tocLine}

Nội dung (trích):
${content.slice(0, CONTENT_EXCERPT_CHARS)}`

    if (signal?.aborted) throw new EnrichmentCancelledError()

    let raw = ''
    let controller: AbortController | undefined
    let settled = false

    const onAbort = (): void => {
      controller?.abort()
    }

    try {
      raw = await new Promise<string>((resolve, reject) => {
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          fn()
        }

        void provider
          .sendMessageStream(
            [{ role: 'user', content: prompt }],
            (chunk) => {
              raw += chunk.content
            },
            (error) => finish(() => reject(error)),
            () => finish(() => resolve(raw))
          )
          .then((activeController) => {
            controller = activeController
            activeController.signal.addEventListener(
              'abort',
              () => finish(() => reject(new EnrichmentCancelledError())),
              { once: true }
            )
            // Signal ngoài đã abort trước khi stream kịp trả controller
            if (signal?.aborted) activeController.abort()
          })
          .catch((error: unknown) =>
            finish(() => reject(error instanceof Error ? error : new Error(String(error))))
          )

        signal?.addEventListener('abort', onAbort, { once: true })
      })
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    const parsed = this.parseJsonObject(raw)
    if (!parsed) {
      Logger.warn('DocumentEnrichment', 'LLM returned unparsable JSON, kept fallback enrichment')
      return { ...fallback, model: provider.getDefaultChatModel() }
    }

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      keywords: this.normalizeList(parsed.keywords, MAX_KEYWORDS),
      entities: this.normalizeList(parsed.entities, MAX_ENTITIES),
      model: provider.getDefaultChatModel()
    }
  }

  private parseJsonObject(raw: string): Record<string, unknown> | null {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null

    try {
      const parsed = JSON.parse(match[0])
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  private normalizeList(value: unknown, max: number): string[] {
    if (!Array.isArray(value)) return []

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item, index, list) => item.length >= 2 && list.indexOf(item) === index)
      .slice(0, max)
  }

  private keywordsFromTitle(title: string): string[] {
    return title
      .split(/[\s,;:.\-_()/]+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3)
      .slice(0, MAX_KEYWORDS)
  }
}
