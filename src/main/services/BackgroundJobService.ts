/**
 * BackgroundJobService
 * Hàng đợi job nền lưu trong SQLite, chạy tuần tự khi app idle.
 *
 * Job types:
 *  - generate-links: sinh liên kết tri thức cho document (LLM + FTS)
 *  - decay-links: giảm confidence liên kết cũ
 *  - reindex-document: reindex incremental document
 *  - enrich-document: tóm tắt + keyword + entity cho document (LLM local)
 *  - memory-consolidate: (dự phòng) gộp ký ức cũ
 *
 * Nguyên tắc: task của user luôn ưu tiên — job chỉ chạy khi app idle
 * (không có hoạt động chat) và mỗi lần chỉ chạy 1 job. Job đang chạy sẽ bị
 * hủy ngay khi user hoạt động trở lại (job quay về pending, không tính là lỗi),
 * và job làm giàu tài liệu có cooldown để không ngốn CPU liên tục.
 */

import { randomUUID } from 'crypto'
import { getDatabase } from '../db'
import { backgroundJobs } from '../db/schema'
import type { NewBackgroundJob } from '../db/schema'
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { KnowledgeService } from './KnowledgeService'
import { KnowledgeLinkService } from './KnowledgeLinkService'
import { NotebookSummaryService } from './NotebookSummaryService'
import {
  DocumentEnrichmentService,
  EnrichmentCancelledError,
  type DocumentEnrichment
} from './DocumentEnrichmentService'
import { isIdle, markActive } from '../utils/activityTracker'
import Logger from '../../shared/utils/logger'

export type BackgroundJobType =
  | 'generate-links'
  | 'decay-links'
  | 'reindex-document'
  | 'enrich-document'
  | 'summarize-notebook'
  | 'rebuild-vectors'
  | 'backfill-knowledge'
  | 'memory-consolidate'

/** Các job nặng (gọi LLM/embedding) — phải giãn cách để không ngốn CPU liên tục. */
const HEAVY_JOB_TYPES: readonly string[] = [
  'enrich-document',
  'summarize-notebook',
  'rebuild-vectors',
  'backfill-knowledge'
]

/** Số chunk embed lại mỗi lần chạy job rebuild-vectors. */
const VECTOR_REBUILD_BATCH = 200

/** Số tài liệu xử lý mỗi lần chạy job backfill-knowledge. */
const BACKFILL_BATCH = 5

/** Sau bao lâu thì dọn job đã hoàn thành/thất bại khỏi bảng. */
const PRUNE_COMPLETED_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Trần chờ shutdown: không để job đang chạy kẹt quá trình thoát app. */
const SHUTDOWN_WAIT_MS = 5000

/** Backoff luỹ thừa cho job thất bại: 30s → 1m → 2m → ... tối đa 10 phút. */
function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000)
}

export interface EnqueueOptions {
  jobType: BackgroundJobType
  notebookId?: string
  documentId?: string
  payload?: Record<string, unknown>
  maxAttempts?: number
}

export class BackgroundJobService {
  private knowledgeService: KnowledgeService
  private linkService: KnowledgeLinkService
  private enrichmentService?: DocumentEnrichmentService
  private notebookSummaryService?: NotebookSummaryService
  private timer: NodeJS.Timeout | null = null
  private running = false
  private paused = false
  private idleMs: number
  private heavyCooldownMs: number
  private lastHeavyJobAt = 0
  private activeJob: { id: string; abort: AbortController } | null = null
  private activeRun: Promise<void> | null = null
  private onJobCompleted?: (jobType: BackgroundJobType, notebookId?: string) => void

  constructor(
    knowledgeService: KnowledgeService,
    linkService: KnowledgeLinkService,
    enrichmentService?: DocumentEnrichmentService,
    idleMs = 30000,
    heavyCooldownMs = 60000,
    onJobCompleted?: (jobType: BackgroundJobType, notebookId?: string) => void,
    notebookSummaryService?: NotebookSummaryService
  ) {
    this.knowledgeService = knowledgeService
    this.linkService = linkService
    this.enrichmentService = enrichmentService
    this.idleMs = idleMs
    this.heavyCooldownMs = heavyCooldownMs
    this.onJobCompleted = onJobCompleted
    this.notebookSummaryService = notebookSummaryService
  }

  enqueue(options: EnqueueOptions): string {
    const db = getDatabase()

    // Dedup: job cùng loại cho cùng notebook/document đang CHỜ thì không
    // enqueue lại — tránh hàng đợi phình mỗi lần khởi động. Không tính trạng
    // thái 'running' vì rebuild/backfill tự enqueue chính nó ngay trong lúc
    // chạy để tiếp tục ở nhịp sau.
    const existing = db
      .select({ id: backgroundJobs.id })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.jobType, options.jobType),
          options.notebookId
            ? eq(backgroundJobs.notebookId, options.notebookId)
            : isNull(backgroundJobs.notebookId),
          options.documentId
            ? eq(backgroundJobs.documentId, options.documentId)
            : isNull(backgroundJobs.documentId),
          eq(backgroundJobs.status, 'pending')
        )
      )
      .limit(1)
      .all()

    if (existing.length > 0) {
      Logger.debug(
        'BackgroundJob',
        `Skipped duplicate ${options.jobType} (already queued as ${existing[0].id})`
      )
      return existing[0].id
    }

    const id = `job_${randomUUID()}`
    const now = new Date()

    const job: NewBackgroundJob = {
      id,
      jobType: options.jobType,
      notebookId: options.notebookId,
      documentId: options.documentId,
      payload: options.payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 2,
      createdAt: now,
      updatedAt: now
    }
    db.insert(backgroundJobs).values(job).run()
    Logger.debug('BackgroundJob', `Enqueued ${options.jobType}: ${id}`)
    return id
  }

  enqueueGenerateLinks(documentId: string, notebookId?: string): string {
    return this.enqueue({ jobType: 'generate-links', documentId, notebookId })
  }

  enqueueDecayLinks(notebookId: string): string {
    return this.enqueue({ jobType: 'decay-links', notebookId })
  }

  enqueueReindex(documentId: string, notebookId?: string): string {
    return this.enqueue({ jobType: 'reindex-document', documentId, notebookId })
  }

  enqueueEnrich(documentId: string, notebookId?: string): string {
    return this.enqueue({ jobType: 'enrich-document', documentId, notebookId, maxAttempts: 1 })
  }

  /** Tổng hợp tóm tắt thống nhất của cả notebook (bỏ qua nếu còn tươi). */
  enqueueSummarizeNotebook(notebookId: string): string {
    return this.enqueue({ jobType: 'summarize-notebook', notebookId, maxAttempts: 1 })
  }

  /** Embed lại toàn bộ chunk thiếu vector của một sổ tay (idempotent). */
  enqueueRebuildVectors(notebookId: string): string {
    return this.enqueue({ jobType: 'rebuild-vectors', notebookId, maxAttempts: 3 })
  }

  /** Quét tài liệu cũ thiếu headingPath/doc vector để index lại (idempotent). */
  enqueueBackfill(notebookId: string): string {
    return this.enqueue({ jobType: 'backfill-knowledge', notebookId, maxAttempts: 1 })
  }

  getPendingCount(): number {
    const db = getDatabase()
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.status, 'pending'))
      .get()
    return row?.count ?? 0
  }

  /**
   * Stop the idle queue from starting new work while a model-level rebuild
   * owns the notebook. An in-flight enrich/summarize job is aborted; a
   * reindex/rebuild job is not abortable mid-write, so callers should also
   * await `waitForActiveJob()` before touching the same rows.
   */
  pause(): void {
    this.paused = true
    if (this.running) this.cancelActiveJob('embedding-rebuild')
  }

  resume(): void {
    this.paused = false
  }

  async waitForActiveJob(timeoutMs = 120_000): Promise<boolean> {
    if (!this.activeRun) return true

    const activeRun = this.activeRun
    const settled = activeRun.then(
      () => true,
      () => true
    )
    const timeout = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), Math.max(timeoutMs, 1))
      timer.unref?.()
    })
    return Promise.race([settled, timeout])
  }

  /**
   * Hủy job đang chạy (user quay lại hoặc app tắt). Job không bị tính là thất bại:
   * nó quay về pending với số lần thử như trước để chạy lại khi rảnh.
   */
  cancelActiveJob(reason: string): boolean {
    if (!this.activeJob) return false

    Logger.info('BackgroundJob', `Cancelling active job ${this.activeJob.id} (${reason})`)
    this.activeJob.abort.abort()
    return true
  }

  /**
   * Chạy enrichment NGAY cho một tài liệu (user bấm thủ công) — không qua
   * idle gate/cooldown, nhưng vẫn tôn trọng job nền đang chạy.
   */
  async runEnrichNow(documentId: string): Promise<DocumentEnrichment> {
    if (!this.enrichmentService) throw new Error('Enrichment service is not available')
    return this.runManualJob('manual-enrich', (signal) =>
      this.enrichmentService!.enrich(documentId, { signal })
    )
  }

  /**
   * Tổng hợp tóm tắt notebook NGAY (user bấm thủ công) — không qua idle gate,
   * nhưng vẫn tôn trọng job nền đang chạy.
   */
  async runSummarizeNow(notebookId: string): Promise<string | null> {
    if (!this.notebookSummaryService) throw new Error('Notebook summary service is not available')
    return this.runManualJob('manual-summarize', (signal) =>
      this.notebookSummaryService!.summarize(notebookId, signal)
    )
  }

  private async runManualJob<T>(
    id: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.running) throw new Error('Có job nền đang chạy, vui lòng thử lại sau')

    const abort = new AbortController()
    this.running = true
    this.activeJob = { id, abort }
    // Cùng một khóa và promise chờ shutdown cho cả job thủ công lẫn job nền.
    const run = Promise.resolve().then(() => operation(abort.signal))
    this.activeRun = run.then(
      () => {},
      () => {}
    )

    try {
      const result = await run
      this.lastHeavyJobAt = Date.now()
      return result
    } finally {
      this.activeJob = null
      this.activeRun = null
      this.running = false
    }
  }

  /**
   * Bắt đầu vòng lặp xử lý job (interval). Đồng thời phục hồi job bị kẹt ở
   * trạng thái 'running' do lần chạy trước crash, và dọn job đã xong quá hạn.
   */
  start(intervalMs = 15000): void {
    if (this.timer) return
    this.recoverStaleJobs()
    this.pruneCompletedJobs()

    this.timer = setInterval(() => {
      void this.tick()
    }, intervalMs)
    this.timer.unref()
    Logger.info('BackgroundJob', `Queue processor started (idle=${this.idleMs}ms)`)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.cancelActiveJob('shutdown')
    Logger.info('BackgroundJob', 'Queue processor stopped')
  }

  /**
   * Shutdown có rào chắn: dừng timer, hủy job đang chạy và CHỜ job về trạng
   * thái cuối (pending/failed) trước khi caller đóng database. Có trần thời
   * gian chờ để không kẹt quá trình thoát app.
   */
  async shutdown(): Promise<void> {
    this.stop()
    const activeRun = this.activeRun
    if (!activeRun) return

    Logger.info('BackgroundJob', 'Waiting for active job to settle before shutdown...')
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_WAIT_MS)
    })
    try {
      await Promise.race([activeRun, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Job để ở 'running' từ lần chạy trước (app crash) không có ai xử lý —
   * đưa về pending để chạy lại, không tính là lỗi.
   */
  private recoverStaleJobs(): void {
    const db = getDatabase()
    const result = db
      .update(backgroundJobs)
      .set({
        status: 'pending',
        startedAt: null,
        lastError: 'recovered after restart',
        updatedAt: new Date()
      })
      .where(eq(backgroundJobs.status, 'running'))
      .run()

    if (result.changes > 0) {
      Logger.info('BackgroundJob', `Recovered ${result.changes} stale running job(s)`)
    }
  }

  /** Dọn job done/failed quá hạn để bảng không phình vô hạn. */
  private pruneCompletedJobs(): void {
    const db = getDatabase()
    const cutoff = new Date(Date.now() - PRUNE_COMPLETED_AFTER_MS)
    const result = db
      .delete(backgroundJobs)
      .where(
        and(
          inArray(backgroundJobs.status, ['done', 'failed']),
          lt(backgroundJobs.completedAt, cutoff)
        )
      )
      .run()

    if (result.changes > 0) {
      Logger.info('BackgroundJob', `Pruned ${result.changes} completed job(s)`)
    }
  }

  /**
   * Xử lý tối đa 1 job mỗi tick, chỉ khi app idle.
   * Job làm giàu tài liệu còn cooldown thì bị bỏ qua để nhường cho job khác.
   */
  async tick(): Promise<void> {
    if (this.paused) return
    if (this.running) {
      // User quay lại → nhường CPU ngay, job sẽ chạy lại khi app rảnh
      if (!isIdle(this.idleMs)) this.cancelActiveJob('user-active')
      return
    }
    if (!isIdle(this.idleMs)) return

    const db = getDatabase()
    const pending = db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.status, 'pending'))
      .orderBy(asc(backgroundJobs.createdAt))
      .limit(20)
      .all()

    const now = Date.now()
    const next = pending.find(
      (job) =>
        (!job.retryAt || job.retryAt.getTime() <= now) &&
        (!HEAVY_JOB_TYPES.includes(job.jobType) ||
          this.lastHeavyJobAt === 0 ||
          now - this.lastHeavyJobAt >= this.heavyCooldownMs)
    )

    if (!next) return

    this.running = true
    const run = this.runJob(next)
    this.activeRun = run
    try {
      await run
    } finally {
      this.running = false
      this.activeRun = null
    }
  }

  private async runJob(job: typeof backgroundJobs.$inferSelect): Promise<void> {
    const db = getDatabase()
    const now = new Date()
    const previousAttempts = job.attempts

    db.update(backgroundJobs)
      .set({ status: 'running', attempts: job.attempts + 1, startedAt: now, updatedAt: now })
      .where(eq(backgroundJobs.id, job.id))
      .run()

    try {
      await this.executeJob(job)

      db.update(backgroundJobs)
        .set({ status: 'done', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(backgroundJobs.id, job.id))
        .run()
      Logger.info('BackgroundJob', `Job ${job.id} (${job.jobType}) completed`)

      // Báo cho UI (vd thẻ tóm tắt trong khung chat) biết dữ liệu đã đổi sau
      // khi job nền hoàn thành — đặc biệt là enrich-document.
      try {
        this.onJobCompleted?.(job.jobType as BackgroundJobType, job.notebookId ?? undefined)
      } catch (error) {
        Logger.warn('BackgroundJob', 'onJobCompleted callback failed:', error)
      }
    } catch (error) {
      const cancelled =
        error instanceof EnrichmentCancelledError ||
        (error as Error)?.name === 'AbortError' ||
        this.activeJob?.abort.signal.aborted === true

      if (cancelled) {
        // Hủy vì user hoạt động trở lại → không tính là thất bại, chạy lại ngay
        // khi app rảnh (không đặt retryAt).
        db.update(backgroundJobs)
          .set({
            status: 'pending',
            attempts: previousAttempts,
            startedAt: null,
            retryAt: null,
            lastError: 'cancelled',
            updatedAt: new Date()
          })
          .where(eq(backgroundJobs.id, job.id))
          .run()
        Logger.info(
          'BackgroundJob',
          `Job ${job.id} (${job.jobType}) cancelled, will retry when idle`
        )
        return
      }

      const message = (error as Error).message
      Logger.error('BackgroundJob', `Job ${job.id} (${job.jobType}) failed:`, error)

      const retryable = job.attempts + 1 < job.maxAttempts
      db.update(backgroundJobs)
        .set({
          status: retryable ? 'pending' : 'failed',
          lastError: message,
          completedAt: retryable ? null : new Date(),
          retryAt: retryable ? new Date(Date.now() + retryDelayMs(job.attempts + 1)) : null,
          updatedAt: new Date()
        })
        .where(eq(backgroundJobs.id, job.id))
        .run()
    }
  }

  private async executeJob(job: typeof backgroundJobs.$inferSelect): Promise<void> {
    switch (job.jobType) {
      case 'generate-links': {
        if (!job.documentId) throw new Error('generate-links requires documentId')
        await this.linkService.generateLinksForDocument(job.documentId)
        break
      }
      case 'decay-links': {
        if (!job.notebookId) throw new Error('decay-links requires notebookId')
        this.linkService.decayLinks(job.notebookId)
        break
      }
      case 'reindex-document': {
        if (!job.documentId) throw new Error('reindex-document requires documentId')
        await this.knowledgeService.reindexDocument(job.documentId)
        break
      }
      case 'enrich-document': {
        if (!job.documentId) throw new Error('enrich-document requires documentId')
        if (!this.enrichmentService) throw new Error('enrich-document requires enricher')

        const abort = new AbortController()
        this.activeJob = { id: job.id, abort }
        try {
          await this.enrichmentService.enrich(job.documentId, {
            signal: abort.signal,
            skipIfFresh: true
          })
          this.lastHeavyJobAt = Date.now()
        } finally {
          this.activeJob = null
        }
        break
      }
      case 'summarize-notebook': {
        if (!job.notebookId) throw new Error('summarize-notebook requires notebookId')
        if (!this.notebookSummaryService) throw new Error('summarize-notebook requires summarizer')

        // Tóm tắt còn tươi (tài liệu chưa đổi) → không gọi LLM, coi như xong.
        if (this.notebookSummaryService.isFresh(job.notebookId)) {
          Logger.debug('BackgroundJob', `Notebook summary fresh, skipped: ${job.notebookId}`)
          break
        }

        const abort = new AbortController()
        this.activeJob = { id: job.id, abort }
        try {
          await this.notebookSummaryService.summarize(job.notebookId, abort.signal)
          this.lastHeavyJobAt = Date.now()
        } finally {
          this.activeJob = null
        }
        break
      }
      case 'rebuild-vectors': {
        if (!job.notebookId) throw new Error('rebuild-vectors requires notebookId')

        const result = await this.knowledgeService.rebuildMissingVectors(
          job.notebookId,
          VECTOR_REBUILD_BATCH
        )
        this.lastHeavyJobAt = Date.now()

        if (result.remaining > 0) {
          if (result.rebuilt > 0) {
            // Còn chunk chưa có vector → chạy tiếp ở nhịp sau (có cooldown).
            this.enqueueRebuildVectors(job.notebookId)
          } else {
            Logger.warn(
              'BackgroundJob',
              `rebuild-vectors made no progress for ${job.notebookId}; stopping to avoid a loop`
            )
          }
        }
        break
      }
      case 'backfill-knowledge': {
        if (!job.notebookId) throw new Error('backfill-knowledge requires notebookId')

        const documentIds = this.knowledgeService.findDocumentsNeedingBackfill(
          job.notebookId,
          BACKFILL_BATCH
        )
        this.lastHeavyJobAt = Date.now()

        for (const documentId of documentIds) {
          this.enqueueReindex(documentId, job.notebookId)
          this.enqueueEnrich(documentId, job.notebookId)
        }

        if (documentIds.length > 0) {
          Logger.info(
            'BackgroundJob',
            `Backfill queued ${documentIds.length} document(s) for notebook ${job.notebookId}`
          )
        }

        // Còn nhiều tài liệu cần backfill → quét tiếp ở nhịp sau
        if (documentIds.length >= BACKFILL_BATCH) {
          this.enqueueBackfill(job.notebookId)
        }
        break
      }
      case 'memory-consolidate': {
        // Dự phòng: hiện tại decay trong search đã kiểm soát ký ức cũ.
        // Có thể mở rộng thành LLM gộp ký ức cũ khi cần.
        Logger.info('BackgroundJob', 'memory-consolidate is a no-op placeholder')
        break
      }
      default: {
        throw new Error(`Unknown job type: ${(job as { jobType: string }).jobType}`)
      }
    }
  }
}

// Re-export để các nơi khác không cần import riêng
export { markActive }
