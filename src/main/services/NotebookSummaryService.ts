/**
 * NotebookSummaryService
 * Tóm tắt THỐNG NHẤT cấp notebook (không phải cấp tài liệu).
 *
 * Tổng hợp tóm tắt từng tài liệu (enrichment.summary) thành MỘT đoạn 100-120
 * từ cho cả notebook, lưu vào notebooks.metadata.notebookSummary. Tự nhận
 * biết "stale" qua chữ ký (contentHash + enrichment của từng tài liệu): tài
 * liệu đổi → tóm tắt notebook cũ → xếp hàng tạo lại.
 */

import { createHash } from 'crypto'
import { getDatabase } from '../db'
import { notebooks, documents } from '../db/schema'
import { and, eq } from 'drizzle-orm'
import type { ApiClient } from '../ai/apiClient'
import type { ChatProvider } from '../ai/types'
import Logger from '../../shared/utils/logger'

/** Trần cứng số từ của tóm tắt notebook. */
export const NOTEBOOK_SUMMARY_MAX_WORDS = 120

export interface NotebookSummary {
  summary: string
  generatedAt: string
  /** Chữ ký nội dung dùng để phát hiện tóm tắt đã cũ. */
  signature: string
  model?: string
}

export class NotebookSummaryService {
  constructor(private apiClient: ApiClient) {}

  private buildSignature(notebookId: string): string {
    const db = getDatabase()
    const rows = db
      .select({
        id: documents.id,
        contentHash: documents.contentHash,
        metadata: documents.metadata
      })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .all()

    const parts = rows
      .map((row) => {
        const enrichment = (row.metadata as Record<string, unknown> | null)?.enrichment as
          | { generatedAt?: string; sourceHash?: string }
          | undefined
        const stamp = enrichment?.generatedAt || enrichment?.sourceHash || 'none'
        return `${row.id}:${row.contentHash ?? ''}:${stamp}`
      })
      .sort()

    return createHash('md5').update(parts.join('|')).digest('hex')
  }

  getStored(notebookId: string): NotebookSummary | null {
    const db = getDatabase()
    const notebook = db
      .select({ metadata: notebooks.metadata })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .get()

    const summary = (notebook?.metadata as Record<string, unknown> | null | undefined)
      ?.notebookSummary as NotebookSummary | undefined

    if (!summary?.summary || typeof summary.summary !== 'string') return null
    return summary
  }

  /** Tóm tắt hiện có còn đúng với nội dung tài liệu hiện tại không. */
  isFresh(notebookId: string): boolean {
    const stored = this.getStored(notebookId)
    if (!stored) return false
    return stored.signature === this.buildSignature(notebookId)
  }

  private limitWords(text: string, maxWords: number): string {
    const words = text.replace(/\s+/g, ' ').trim().split(' ')
    if (words.length <= maxWords) return words.join(' ')
    return `${words.slice(0, maxWords).join(' ')}…`
  }

  /** Bản mô tả ngắn từng tài liệu — đầu vào cho bước tổng hợp. */
  private collectDocumentBriefs(notebookId: string): Array<{ title: string; summary: string }> {
    const db = getDatabase()
    const rows = db
      .select({ title: documents.title, content: documents.content, metadata: documents.metadata })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .all()

    return rows.map((row) => {
      const enrichment = (row.metadata as Record<string, unknown> | null)?.enrichment as
        | { summary?: string }
        | undefined
      const perDoc =
        typeof enrichment?.summary === 'string' && enrichment.summary.trim()
          ? enrichment.summary.trim()
          : (row.content || '').replace(/\s+/g, ' ').trim().slice(0, 400)
      return { title: row.title || 'Tài liệu', summary: perDoc }
    })
  }

  /**
   * Tạo (hoặc tạo lại) tóm tắt notebook. Trả về đoạn tóm tắt đã lưu, hoặc
   * null khi notebook không có tài liệu nào để tóm tắt.
   */
  async summarize(notebookId: string, signal?: AbortSignal): Promise<string | null> {
    const db = getDatabase()
    const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
    if (!notebook) throw new Error(`Notebook ${notebookId} not found`)

    const briefs = this.collectDocumentBriefs(notebookId)
    const signature = this.buildSignature(notebookId)

    if (briefs.length === 0) {
      this.store(notebookId, null)
      Logger.info('NotebookSummary', `Notebook ${notebookId} has no documents; summary cleared`)
      return null
    }

    let summary = ''
    let model: string | undefined

    if (briefs.length === 1) {
      // Một tài liệu duy nhất → dùng thẳng tóm tắt tài liệu, chỉ cắt từ.
      summary = briefs[0].summary
    } else {
      const provider = await this.apiClient.getChatProvider()
      if (!provider) {
        Logger.warn('NotebookSummary', 'No chat provider; falling back to concatenated summaries')
        summary = briefs.map((brief) => `${brief.title}: ${brief.summary}`).join(' ')
      } else {
        const briefLines = briefs.map((brief) => `- ${brief.title}: ${brief.summary}`).join('\n')
        const prompt = [
          'Bạn là trợ lý tổng hợp tài liệu. Dưới đây là tóm tắt của từng tài liệu trong một sổ tay.',
          'Hãy viết MỘT đoạn tóm tắt THỐNG NHẤT cho cả sổ tay, dài khoảng 100-120 từ,',
          'nêu chủ đề chung và các nội dung chính; KHÔNG liệt kê tên từng tài liệu;',
          'giọng văn trung tính, dùng cùng ngôn ngữ với tài liệu gốc.',
          '',
          briefLines
        ].join('\n')

        summary = await this.extractWithLlm(prompt, provider, signal)
        model = provider.getDefaultChatModel()
      }
    }

    const trimmed = this.limitWords(summary, NOTEBOOK_SUMMARY_MAX_WORDS)
    if (!trimmed) return null

    const stored: NotebookSummary = {
      summary: trimmed,
      generatedAt: new Date().toISOString(),
      signature,
      model
    }
    this.store(notebookId, stored)
    Logger.info(
      'NotebookSummary',
      `Notebook ${notebookId} summarized (${trimmed.split(' ').length} words)`
    )
    return trimmed
  }

  private store(notebookId: string, summary: NotebookSummary | null): void {
    const db = getDatabase()
    const notebook = db
      .select({ metadata: notebooks.metadata })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .get()
    if (!notebook) return

    const metadata = { ...((notebook.metadata as Record<string, unknown> | null) || {}) }
    if (summary) metadata.notebookSummary = summary
    else delete metadata.notebookSummary

    db.update(notebooks).set({ metadata }).where(eq(notebooks.id, notebookId)).run()
  }

  private async extractWithLlm(
    prompt: string,
    provider: Pick<ChatProvider, 'sendMessageStream'>,
    signal?: AbortSignal
  ): Promise<string> {
    let raw = ''
    let controller: AbortController | undefined
    let settled = false

    const onAbort = (): void => {
      controller?.abort()
    }

    try {
      return await new Promise<string>((resolve, reject) => {
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          fn()
        }

        void provider
          .sendMessageStream(
            [{ role: 'user', content: prompt }],
            (chunk: { content: string }) => {
              raw += chunk.content
            },
            (error: Error) => finish(() => reject(error)),
            () => finish(() => resolve(raw))
          )
          .then((activeController: AbortController) => {
            controller = activeController
            activeController.signal.addEventListener(
              'abort',
              () => finish(() => reject(new Error('aborted'))),
              {
                once: true
              }
            )
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
  }
}
