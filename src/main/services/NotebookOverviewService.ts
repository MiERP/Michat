import { and, asc, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { randomUUID } from 'crypto'
import { getDatabase } from '../db'
import { chunks, documents, notebookOverviews } from '../db/schema'
import { ProviderManager } from '../providers/ProviderManager'
import { AISDKProvider } from '../providers/base/AISDKProvider'
import type { NotebookOverview } from '../../shared/types/notebookOverview'
import type { ChatCitation } from '../../shared/types/chat'
import Logger from '../../shared/utils/logger'
import { finalizeChatEvidence } from './chatEvidence'
import {
  buildNotebookOverviewSource,
  limitWords,
  type NotebookOverviewSourceDocument
} from './notebookOverviewPrompt'

const MAX_OUTPUT_TOKENS = 384
const MAX_OUTPUT_WORDS = 240
const LLM_RETRY_ATTEMPTS = 3

export type NotebookOverviewProgressCallback = (stage: string, progress: number) => void

function sourceHash(document: { contentHash: string | null; updatedAt: Date }): string {
  return document.contentHash || 'updated:' + document.updatedAt.getTime()
}

export class NotebookOverviewService {
  constructor(private providerManager: ProviderManager) {}

  getOverview(notebookId: string): NotebookOverview | null {
    const record = getDatabase()
      .select()
      .from(notebookOverviews)
      .where(eq(notebookOverviews.notebookId, notebookId))
      .get()
    if (!record) return null
    return {
      id: record.id,
      notebookId: record.notebookId,
      content: record.content,
      citations: record.citations as unknown as ChatCitation[],
      sourceFingerprint: record.sourceFingerprint,
      status: record.status as 'fresh' | 'stale',
      model: record.model,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }

  markStale(notebookId: string): void {
    getDatabase()
      .update(notebookOverviews)
      .set({ status: 'stale', updatedAt: new Date() })
      .where(eq(notebookOverviews.notebookId, notebookId))
      .run()
  }

  async generate(
    notebookId: string,
    onProgress?: NotebookOverviewProgressCallback,
    abortSignal?: AbortSignal
  ): Promise<NotebookOverview> {
    const startedAt = Date.now()
    const db = getDatabase()
    const docs = db
      .select()
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .orderBy(asc(documents.createdAt))
      .all()

    if (docs.length === 0) {
      throw new Error('No indexed documents available to create a notebook overview')
    }

    const canonicalDocuments = new Map<string, (typeof docs)[number]>()
    for (const doc of docs) {
      const metadata = (doc.metadata as Record<string, unknown> | null) || {}
      const key =
        (metadata.canonicalLegalWorkKey as string | undefined) ||
        (metadata.canonicalGraphDocumentId as string | undefined) ||
        doc.id
      const current = canonicalDocuments.get(key)
      if (!current || doc.id === (metadata.canonicalGraphDocumentId as string | undefined)) {
        canonicalDocuments.set(key, doc)
      }
    }
    const overviewDocuments = [...canonicalDocuments.values()]

    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) throw new Error('No active chat provider configured')
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('Provider does not support text generation')
    }

    const model = provider.getAIModel()
    const modelName = provider.name
    const sourceDocuments: NotebookOverviewSourceDocument[] = []
    const sourceCitations: ChatCitation[] = []
    let totalChunks = 0

    Logger.info(
      'NotebookOverviewService',
      'Starting: ' + overviewDocuments.length + ' canonical works, model: ' + modelName
    )
    onProgress?.('preparing_sources', 5)

    for (let index = 0; index < overviewDocuments.length; index++) {
      if (abortSignal?.aborted) throw new Error('Notebook overview generation cancelled')

      const doc = overviewDocuments[index]
      const docChunks = db
        .select()
        .from(chunks)
        .where(eq(chunks.documentId, doc.id))
        .orderBy(asc(chunks.chunkIndex))
        .all()
      totalChunks += docChunks.length

      sourceDocuments.push({
        index: index + 1,
        citationId: index + 1,
        title: doc.title,
        chunks: docChunks.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content
        }))
      })

      const citationChunk = docChunks[0]
      if (citationChunk) {
        sourceCitations.push({
          index: index + 1,
          documentId: doc.id,
          documentTitle: doc.title,
          chunkId: citationChunk.id,
          chunkIndex: citationChunk.chunkIndex,
          score: 1,
          snippet: citationChunk.content.replace(/\s+/gu, ' ').trim().slice(0, 240),
          sourceUri: doc.sourceUri || undefined
        })
      }

      onProgress?.(
        'preparing_sources',
        5 + Math.round(((index + 1) / overviewDocuments.length) * 30)
      )
    }

    const sourceText = buildNotebookOverviewSource(sourceDocuments)
    Logger.info(
      'NotebookOverviewService',
      'Prepared ' +
        sourceText.length +
        ' chars from ' +
        totalChunks +
        ' chunks across ' +
        overviewDocuments.length +
        ' canonical works, 1 LLM request'
    )

    onProgress?.('synthesizing_overview', 40)
    if (abortSignal?.aborted) throw new Error('Notebook overview generation cancelled')

    const generatedContent = await this.synthesizeOverview(model, sourceText, abortSignal)
    const finalizedOverview = finalizeChatEvidence(
      limitWords(generatedContent, MAX_OUTPUT_WORDS),
      sourceCitations
    )
    const overviewContent = finalizedOverview.content
    if (!overviewContent) throw new Error('Model returned an empty notebook overview')

    onProgress?.('saving', 90)
    const fingerprint = docs.map((doc) => doc.id + ':' + sourceHash(doc)).join('|')
    const existing = db
      .select()
      .from(notebookOverviews)
      .where(eq(notebookOverviews.notebookId, notebookId))
      .get()
    const now = new Date()

    if (existing && existing.sourceFingerprint === fingerprint) {
      db.update(notebookOverviews)
        .set({
          content: overviewContent,
          citations: finalizedOverview.citations as unknown as Record<string, unknown>[],
          sourceFingerprint: fingerprint,
          status: 'fresh',
          model: modelName,
          updatedAt: now
        })
        .where(eq(notebookOverviews.notebookId, notebookId))
        .run()
    } else {
      db.delete(notebookOverviews).where(eq(notebookOverviews.notebookId, notebookId)).run()
      db.insert(notebookOverviews)
        .values({
          id: 'overview_' + randomUUID(),
          notebookId,
          content: overviewContent,
          citations: finalizedOverview.citations as unknown as Record<string, unknown>[],
          sourceFingerprint: fingerprint,
          status: 'fresh',
          model: modelName,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }

    onProgress?.('completed', 100)
    const outputWords = overviewContent.split(/\s+/).length
    Logger.info(
      'NotebookOverviewService',
      'Done in ' +
        (Date.now() - startedAt) +
        'ms: ' +
        overviewDocuments.length +
        ' canonical works, ' +
        totalChunks +
        ' chunks, ' +
        outputWords +
        ' words'
    )

    return this.getOverview(notebookId)!
  }

  private async synthesizeOverview(
    model: ReturnType<AISDKProvider['getAIModel']>,
    sourceText: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const prompt = [
      'Viết bản Tổng quan Điều hành cho notebook bằng tiếng Việt, định dạng Markdown.',
      'Độ dài 160-220 từ; tuyệt đối không vượt 240 từ.',
      'Chỉ gồm một tiêu đề ngắn và hai đoạn văn cô đọng.',
      'Bao quát chủ đề, phạm vi, quy định hoặc kết luận quan trọng nhất từ toàn bộ nguồn.',
      'Không phân tích chuyên sâu, không lặp ý, không suy diễn hoặc thêm kiến thức ngoài nguồn.',
      'Mỗi đoạn phải có ít nhất một trích dẫn [n] tương ứng với số nguồn; không dùng số ngoài nguồn.',
      '',
      '--- NGUỒN ĐÃ CHỌN CỤC BỘ ---',
      sourceText,
      '',
      'Bản tổng quan:'
    ].join('\n')

    return await this.callLLM(model, prompt, abortSignal)
  }

  private async callLLM(
    model: ReturnType<AISDKProvider['getAIModel']>,
    prompt: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= LLM_RETRY_ATTEMPTS; attempt++) {
      if (abortSignal?.aborted) throw new Error('Notebook overview generation cancelled')
      try {
        const result = await generateText({
          model,
          prompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal
        })
        return result.text.trim()
      } catch (error) {
        if (abortSignal?.aborted) throw new Error('Notebook overview generation cancelled')
        lastError = error as Error
        Logger.warn(
          'NotebookOverviewService',
          'LLM attempt ' + attempt + '/' + LLM_RETRY_ATTEMPTS + ': ' + lastError.message
        )
      }
    }

    throw new Error(
      'LLM failed after ' + LLM_RETRY_ATTEMPTS + ' attempts: ' + (lastError?.message || 'unknown')
    )
  }
}
