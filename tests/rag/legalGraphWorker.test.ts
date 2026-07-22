import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LegalGraphRetryableError } from '../../src/main/services/legalGraph/LegalGraphExtractionService'
import {
  LegalGraphWorker,
  prepareLegalGraphSource
} from '../../src/main/services/legalGraph/LegalGraphWorker'

function createJob() {
  return {
    id: 'job-1',
    notebookId: 'notebook-1',
    documentId: 'document-1',
    status: 'processing',
    extractorVersion: '1',
    promptVersion: '1',
    ontologyVersion: '1',
    model: null,
    attempts: 1,
    maxAttempts: 5,
    sourceUnitCount: 0,
    processedUnitCount: 0,
    leaseOwner: 'worker-test',
    leaseExpiresAt: new Date('2026-07-22T00:00:30.000Z'),
    nextRunAt: null,
    startedAt: new Date('2026-07-22T00:00:00.000Z'),
    completedAt: null,
    lastError: null,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z')
  }
}

function createDependencies() {
  const job = createJob()
  const repository = {
    claimNextJob: vi.fn(() => job),
    heartbeat: vi.fn(() => true),
    updateJobProgress: vi.fn(() => true),
    markJobRetry: vi.fn(),
    markJobFailed: vi.fn(),
    replaceDocumentGraph: vi.fn(),
    recoverExpiredLeases: vi.fn(() => 0),
    enqueueStaleDocuments: vi.fn(() => 0),
    releaseWorkerLeases: vi.fn(() => 0),
    retryDocument: vi.fn()
  }
  const extractor = {
    extractDocument: vi.fn(async (_document, chunks, _model, _signal, onProgress) => {
      onProgress?.(chunks.length, chunks.length)
      return {
        nodes: [],
        relations: [],
        sourceUnitCount: chunks.length,
        processedUnitCount: chunks.length
      }
    })
  }
  const providerManager = {
    getActiveChatLanguageModel: vi.fn(async () => ({
      model: { modelId: 'local-model' },
      provenance: 'llama:local-model'
    }))
  }
  const sourceLoader = vi.fn(async () => ({
    document: { id: job.documentId, notebookId: job.notebookId },
    chunks: [{ id: 'chunk-1' }]
  }))

  return { extractor, job, providerManager, repository, sourceLoader }
}

describe('prepareLegalGraphSource', () => {
  it('drops legal profiles and restores exact source text from offsets', () => {
    const document = { content: 'Mở Điều 1. Nghĩa vụ. Kết' }
    const source = prepareLegalGraphSource(
      document as never,
      [
        {
          id: 'profile',
          content: 'Hồ sơ pháp lý',
          startOffset: 0,
          endOffset: 3,
          metadata: { kind: 'legal-profile' }
        },
        {
          id: 'content',
          content: '[Điều 1] prefixed',
          startOffset: 3,
          endOffset: 19,
          metadata: { kind: 'legal-content' }
        }
      ] as never
    )

    expect(source.chunks).toHaveLength(1)
    expect(source.chunks[0]).toEqual(
      expect.objectContaining({ id: 'content', content: 'Điều 1. Nghĩa vụ' })
    )
  })
})

describe('LegalGraphWorker', () => {
  let dependencies: ReturnType<typeof createDependencies>
  let worker: LegalGraphWorker
  let progressEvents: Array<Record<string, unknown>>

  beforeEach(() => {
    dependencies = createDependencies()
    progressEvents = []
    worker = new LegalGraphWorker({
      repository: dependencies.repository as never,
      extractor: dependencies.extractor as never,
      providerManager: dependencies.providerManager as never,
      sourceLoader: dependencies.sourceLoader as never,
      workerId: 'worker-test',
      pollIntervalMs: 60_000,
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      onProgress: (progress) => progressEvents.push(progress)
    })
  })

  it('exposes running state and stable worker id', async () => {
    expect(worker.id).toBe('worker-test')
    expect(worker.isRunning()).toBe(false)

    await worker.start()
    expect(worker.isRunning()).toBe(true)

    await worker.stop()
    expect(worker.isRunning()).toBe(false)
  })

  it('emits processing and ready progress without source text', async () => {
    await worker.runOnce()

    expect(progressEvents).toEqual([
      expect.objectContaining({
        documentId: 'document-1',
        status: 'processing',
        processedUnitCount: 1,
        sourceUnitCount: 1
      }),
      expect.objectContaining({
        documentId: 'document-1',
        status: 'ready',
        nodeCount: 0,
        relationCount: 0
      })
    ])
    expect(JSON.stringify(progressEvents)).not.toContain('chunk-1')
  })

  it('does not claim work while chat is active', async () => {
    worker.setChatActive(true)

    expect(await worker.runOnce()).toBe(false)
    expect(dependencies.repository.claimNextJob).not.toHaveBeenCalled()
  })

  it('retries transient model failure and preserves old graph', async () => {
    dependencies.extractor.extractDocument.mockRejectedValue(
      new LegalGraphRetryableError('model unavailable')
    )

    expect(await worker.runOnce()).toBe(true)
    expect(dependencies.repository.markJobRetry).toHaveBeenCalledOnce()
    expect(dependencies.repository.replaceDocumentGraph).not.toHaveBeenCalled()
  })

  it('marks permanent extraction validation failures as failed', async () => {
    dependencies.extractor.extractDocument.mockRejectedValue(
      new Error('Evidence text is not present in source chunk')
    )

    await worker.runOnce()
    expect(dependencies.repository.markJobFailed).toHaveBeenCalledOnce()
    expect(dependencies.repository.markJobRetry).not.toHaveBeenCalled()
  })

  it('replaces graph only after complete extraction and heartbeats progress', async () => {
    await worker.runOnce()

    expect(dependencies.repository.updateJobProgress).toHaveBeenCalledWith(
      dependencies.job.id,
      'worker-test',
      1,
      1,
      expect.any(Date),
      30_000
    )
    expect(dependencies.repository.replaceDocumentGraph).toHaveBeenCalledWith(
      dependencies.job.documentId,
      expect.objectContaining({ sourceUnitCount: 1, processedUnitCount: 1 }),
      {
        model: 'llama:local-model',
        extractorVersion: '1',
        promptVersion: '1',
        ontologyVersion: '1'
      }
    )
  })

  it('recovers leases and backfills stale versions on start', async () => {
    await worker.start()

    expect(dependencies.repository.recoverExpiredLeases).toHaveBeenCalledOnce()
    expect(dependencies.repository.enqueueStaleDocuments).toHaveBeenCalledWith({
      model: '',
      extractorVersion: '1',
      promptVersion: '1',
      ontologyVersion: '1'
    })
    await worker.stop()
  })

  it('stops claiming and releases owned leases', async () => {
    await worker.start()
    await worker.stop(100)

    expect(dependencies.repository.releaseWorkerLeases).toHaveBeenCalledWith(
      'worker-test',
      expect.any(Date)
    )
  })
})
