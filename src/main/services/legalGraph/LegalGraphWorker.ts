import { randomUUID } from 'crypto'
import type { Chunk, Document, LegalExtractionJob } from '../../db/schema'
import type { ProviderManager } from '../../providers/ProviderManager'
import {
  LegalGraphExtractionService,
  LegalGraphRetryableError
} from './LegalGraphExtractionService'
import type {
  LegalGraphCandidate,
  LegalGraphProvenance,
  LegalGraphRepository
} from './LegalGraphRepository'
import {
  LEGAL_GRAPH_EXTRACTOR_VERSION,
  LEGAL_GRAPH_ONTOLOGY_VERSION,
  LEGAL_GRAPH_PROMPT_VERSION
} from './legalGraphPrompt'

const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_LEASE_MS = 30_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000

interface LegalGraphWorkerRepository {
  claimNextJob(workerId: string, now: Date, leaseMs: number): LegalExtractionJob | undefined
  updateJobProgress(
    jobId: string,
    workerId: string,
    processedUnitCount: number,
    sourceUnitCount: number,
    now: Date,
    leaseMs: number
  ): boolean
  markJobRetry(jobId: string, error: Error, now: Date): void
  markJobFailed(jobId: string, error: Error, now: Date): void
  replaceDocumentGraph(
    documentId: string,
    candidate: LegalGraphCandidate,
    provenance: LegalGraphProvenance
  ): void
  recoverExpiredLeases(now: Date): number
  enqueueStaleDocuments(versions: LegalGraphProvenance): number
  releaseWorkerLeases(workerId: string, now: Date): number
  retryDocument(documentId: string): void
}

export interface LegalGraphSource {
  document: Document
  chunks: Chunk[]
}

export type LegalGraphSourceLoader = (
  documentId: string
) => Promise<LegalGraphSource | undefined> | LegalGraphSource | undefined

export interface LegalGraphWorkerOptions {
  repository: LegalGraphWorkerRepository | LegalGraphRepository
  extractor?: LegalGraphExtractionService
  providerManager: Pick<ProviderManager, 'getActiveChatLanguageModel'>
  sourceLoader: LegalGraphSourceLoader
  workerId?: string
  pollIntervalMs?: number
  leaseMs?: number
  now?: () => Date
}

export class LegalGraphWorker {
  private readonly repository: LegalGraphWorkerRepository
  private readonly extractor: LegalGraphExtractionService
  private readonly providerManager: Pick<ProviderManager, 'getActiveChatLanguageModel'>
  private readonly sourceLoader: LegalGraphSourceLoader
  private readonly workerId: string
  private readonly pollIntervalMs: number
  private readonly leaseMs: number
  private readonly now: () => Date
  private pollTimer?: ReturnType<typeof setTimeout>
  private activeRun?: Promise<boolean>
  private activeAbortController?: AbortController
  private started = false
  private stopping = false
  private chatActive = false

  constructor(options: LegalGraphWorkerOptions) {
    this.repository = options.repository
    this.extractor = options.extractor ?? new LegalGraphExtractionService()
    this.providerManager = options.providerManager
    this.sourceLoader = options.sourceLoader
    this.workerId = options.workerId ?? `legal-graph-worker:${randomUUID()}`
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.now = options.now ?? (() => new Date())
  }

  // ponytail: one extraction worker protects local model latency; raise concurrency only after model-level scheduling exists.
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.stopping = false
    this.repository.recoverExpiredLeases(this.now())
    this.repository.enqueueStaleDocuments(this.currentVersions())
    this.schedulePoll(0)
  }

  async stop(timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
    this.started = false
    this.stopping = true
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    this.activeAbortController?.abort()

    if (this.activeRun) {
      await Promise.race([
        this.activeRun.catch(() => false),
        new Promise<false>((resolve) => {
          const timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs))
          timeout.unref?.()
        })
      ])
    }
    this.repository.releaseWorkerLeases(this.workerId, this.now())
  }

  setChatActive(active: boolean): void {
    this.chatActive = active
  }

  async runOnce(): Promise<boolean> {
    if (this.activeRun) return this.activeRun
    const run = this.processOnce()
    this.activeRun = run
    try {
      return await run
    } finally {
      if (this.activeRun === run) this.activeRun = undefined
    }
  }

  retryDocument(documentId: string): void {
    this.repository.retryDocument(documentId)
    if (this.started && !this.pollTimer) this.schedulePoll(0)
  }

  private async processOnce(): Promise<boolean> {
    if (this.stopping || this.chatActive) return false
    const job = this.repository.claimNextJob(this.workerId, this.now(), this.leaseMs)
    if (!job) return false

    this.activeAbortController = new AbortController()
    try {
      const activeModel = await this.providerManager.getActiveChatLanguageModel()
      if (!activeModel) throw new LegalGraphRetryableError('No active chat model available')
      const source = await this.sourceLoader(job.documentId)
      if (!source) throw new Error('Legal graph source document is unavailable')

      const candidate = await this.extractor.extractDocument(
        source.document,
        source.chunks,
        activeModel,
        this.activeAbortController.signal,
        (processedUnitCount, sourceUnitCount) => {
          const renewed = this.repository.updateJobProgress(
            job.id,
            this.workerId,
            processedUnitCount,
            sourceUnitCount,
            this.now(),
            this.leaseMs
          )
          if (!renewed) throw new LegalGraphRetryableError('Legal graph worker lease was lost')
        }
      )

      if (this.stopping) return true
      this.repository.replaceDocumentGraph(job.documentId, candidate, {
        model: activeModel.provenance,
        extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
        promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
        ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
      })
    } catch (error) {
      if (this.stopping) return true
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      if (normalizedError instanceof LegalGraphRetryableError) {
        this.repository.markJobRetry(job.id, normalizedError, this.now())
      } else {
        this.repository.markJobFailed(job.id, normalizedError, this.now())
      }
    } finally {
      this.activeAbortController = undefined
    }
    return true
  }

  private currentVersions(): LegalGraphProvenance {
    return {
      model: '',
      extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
      promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
      ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
    }
  }

  private schedulePoll(delayMs: number): void {
    if (!this.started || this.stopping || this.pollTimer) return
    this.pollTimer = setTimeout(
      async () => {
        this.pollTimer = undefined
        await this.runOnce()
        if (this.started && !this.stopping) this.schedulePoll(this.pollIntervalMs)
      },
      Math.max(0, delayMs)
    )
    this.pollTimer.unref?.()
  }
}
