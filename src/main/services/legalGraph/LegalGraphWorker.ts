import { randomUUID } from 'crypto'
import type { Chunk, Document, LegalExtractionJob } from '../../db/schema'
import type { LegalGraphProgress } from '../../../shared/types/legalReasoning'
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

export function prepareLegalGraphSource(
  document: Document,
  sourceChunks: Chunk[]
): LegalGraphSource {
  const originalContent = document.content || ''
  const chunks = sourceChunks
    .filter((chunk) => {
      const metadata = chunk.metadata as Record<string, unknown> | null
      return metadata?.kind !== 'legal-profile'
    })
    .map((chunk) => {
      const startOffset = chunk.startOffset
      const endOffset = chunk.endOffset
      const content =
        originalContent &&
        startOffset != null &&
        endOffset != null &&
        startOffset >= 0 &&
        endOffset > startOffset &&
        endOffset <= originalContent.length
          ? originalContent.slice(startOffset, endOffset)
          : chunk.content
      return { ...chunk, content }
    })
  return { document, chunks }
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
  onProgress?: (progress: LegalGraphProgress) => void
}

export class LegalGraphWorker {
  private readonly repository: LegalGraphWorkerRepository
  private readonly extractor: LegalGraphExtractionService
  private readonly sourceLoader: LegalGraphSourceLoader
  private readonly workerId: string
  private readonly pollIntervalMs: number
  private readonly leaseMs: number
  private readonly now: () => Date
  private readonly onProgress?: (progress: LegalGraphProgress) => void
  private pollTimer?: ReturnType<typeof setTimeout>
  private activeRun?: Promise<boolean>
  private activeAbortController?: AbortController
  private started = false
  private stopping = false
  private chatActive = false

  constructor(options: LegalGraphWorkerOptions) {
    this.repository = options.repository
    this.extractor = options.extractor ?? new LegalGraphExtractionService()
    void options.providerManager
    this.sourceLoader = options.sourceLoader
    this.workerId = options.workerId ?? `legal-graph-worker:${randomUUID()}`
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.now = options.now ?? (() => new Date())
    this.onProgress = options.onProgress
  }

  get id(): string {
    return this.workerId
  }

  isRunning(): boolean {
    return this.started && !this.stopping
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

  requestStop(): void {
    this.started = false
    this.stopping = true
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    this.activeAbortController?.abort()
  }

  async stop(timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
    this.requestStop()

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
      const source = await this.sourceLoader(job.documentId)
      if (!source) throw new Error('Legal graph source document is unavailable')

      const articleNumbers = new Set(
        source.chunks
          .map((chunk) => {
            const context = chunk.metadata?.legalContext
            return context && typeof context === 'object'
              ? (context as Record<string, unknown>).articleNumber
              : undefined
          })
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
      const sourceUnitCount = articleNumbers.size || source.chunks.length
      const initialized = this.repository.updateJobProgress(
        job.id,
        this.workerId,
        0,
        sourceUnitCount,
        this.now(),
        this.leaseMs
      )
      if (!initialized) throw new Error('Legal graph job lease was lost')
      this.emitProgress({
        documentId: job.documentId,
        status: 'processing',
        attempts: job.attempts,
        sourceUnitCount,
        processedUnitCount: 0,
        nodeCount: 0,
        relationCount: 0,
        model: 'deterministic-parser',
        extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
        promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
        ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
      })

      const candidate = await this.extractor.extractDocument(
        source.document,
        source.chunks,
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
          this.emitProgress({
            documentId: job.documentId,
            status: 'processing',
            attempts: job.attempts,
            sourceUnitCount,
            processedUnitCount,
            nodeCount: 0,
            relationCount: 0,
            model: 'deterministic-parser',
            extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
            promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
            ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
          })
        }
      )

      if (this.stopping) return true
      this.repository.replaceDocumentGraph(job.documentId, candidate, {
        model: 'deterministic-parser',
        extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
        promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
        ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
      })
      this.emitProgress({
        documentId: job.documentId,
        status: 'ready',
        attempts: job.attempts,
        sourceUnitCount: candidate.sourceUnitCount ?? 0,
        processedUnitCount: candidate.processedUnitCount ?? candidate.sourceUnitCount ?? 0,
        nodeCount: candidate.nodes.length,
        relationCount: candidate.relations.length,
        model: 'deterministic-parser',
        extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
        promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
        ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
      })
    } catch (error) {
      if (this.stopping) return true
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      if (normalizedError instanceof LegalGraphRetryableError) {
        this.repository.markJobRetry(job.id, normalizedError, this.now())
        this.emitProgress(
          this.failedProgress(job, job.attempts >= job.maxAttempts ? 'failed' : 'retry')
        )
      } else {
        this.repository.markJobFailed(job.id, normalizedError, this.now())
        this.emitProgress(this.failedProgress(job, 'failed'))
      }
    } finally {
      this.activeAbortController = undefined
    }
    return true
  }

  private emitProgress(progress: LegalGraphProgress): void {
    try {
      this.onProgress?.(progress)
    } catch {
      return
    }
  }

  private failedProgress(job: LegalExtractionJob, status: 'retry' | 'failed'): LegalGraphProgress {
    return {
      documentId: job.documentId,
      status,
      attempts: job.attempts,
      sourceUnitCount: job.sourceUnitCount,
      processedUnitCount: job.processedUnitCount,
      nodeCount: 0,
      relationCount: 0,
      extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
      promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
      ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
    }
  }

  private currentVersions(): LegalGraphProvenance {
    return {
      model: 'deterministic-parser',
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
