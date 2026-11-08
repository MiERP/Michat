import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddingResult } from '../../src/main/providers/capabilities/EmbeddingCapability'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

function vectorFor(text: string): Float32Array {
  const vector = new Float32Array(1024)
  vector[Math.abs(text.length % 900)] = 1
  return vector
}

function embedding(text: string): EmbeddingResult {
  return {
    embedding: vectorFor(text),
    model: 'fake-local-embedding',
    dimensions: 1024,
    tokensUsed: text.length
  }
}

const ENRICHMENT_JSON = JSON.stringify({
  summary: 'Tóm tắt thử nghiệm cho hợp đồng.',
  keywords: ['hợp đồng', 'thanh toán'],
  entities: ['Công ty ABC']
})

/**
 * Chat provider giả: có thể "giữ" stream (hold=true) để test huỷ giữa chừng.
 */
class FakeChatProvider {
  public calls = 0
  public hold = false
  public lastMessages: unknown

  getDefaultChatModel(): string {
    return 'fake-chat'
  }

  async sendMessageStream(
    messages: unknown,
    onChunk: (chunk: { content: string }) => void,
    _onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController> {
    this.calls++
    this.lastMessages = messages
    const controller = new AbortController()

    if (this.hold) {
      // Không bao giờ complete → chỉ thoát khi bị abort
      return controller
    }

    setTimeout(() => {
      onChunk({ content: ENRICHMENT_JSON })
      onComplete()
    }, 0)

    return controller
  }
}

class FakeProviderManager {
  public chat = new FakeChatProvider()

  async getActiveEmbeddingProvider() {
    return {
      createEmbedding: async (text: string) => embedding(text),
      createEmbeddings: async (texts: string[]) => texts.map(embedding),
      getDefaultEmbeddingModel: () => 'fake-local-embedding'
    }
  }

  async getActiveChatProvider() {
    return this.chat
  }

  async getActiveRerankProvider() {
    return null
  }
}

const CONTRACT = [
  '# Hợp đồng ABC',
  '',
  '## 1. Phạm vi',
  'Phạm vi dịch vụ bao gồm tư vấn và triển khai hệ thống nội bộ theo yêu cầu của bên A.',
  '',
  '## 2. Termination',
  'Điều khoản chấm dứt hợp đồng khi bên A vi phạm nghĩa vụ thanh toán qua hai kỳ liên tiếp.'
].join('\n')

describe('Document enrichment + background queue', () => {
  let context: any

  beforeEach(async () => {
    userDataDir = join(
      tmpdir(),
      `michat-enrich-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    await mkdir(userDataDir, { recursive: true })

    const dbModule = await import('../../src/main/db')
    const schema = await import('../../src/main/db/schema')
    const { KnowledgeService } = await import('../../src/main/services/KnowledgeService')
    const { DocumentEnrichmentService } =
      await import('../../src/main/services/DocumentEnrichmentService')
    const { BackgroundJobService } = await import('../../src/main/services/BackgroundJobService')

    dbModule.initDatabase()
    dbModule.runMigrations()
    dbModule.initExtensions()

    const db = dbModule.getDatabase()
    const notebookId = `notebook_${Math.random().toString(16).slice(2)}`
    db.insert(schema.notebooks)
      .values({
        id: notebookId,
        title: 'Enrich Test',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .run()

    const providerManager = new FakeProviderManager()
    const knowledgeService = new KnowledgeService(providerManager as never)
    const enrichmentService = new DocumentEnrichmentService(
      providerManager as never,
      knowledgeService
    )
    const jobService = new BackgroundJobService(
      knowledgeService,
      { generateLinksForDocument: async () => 0, decayLinks: () => 0 } as never,
      enrichmentService,
      0,
      60000
    )

    context = {
      dbModule,
      schema,
      db,
      notebookId,
      providerManager,
      knowledgeService,
      enrichmentService,
      jobService
    }
  })

  afterEach(async () => {
    context?.jobService?.stop()
    context?.dbModule.closeDatabase()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
    vi.resetModules()
  })

  async function seedDocument(): Promise<string> {
    const { knowledgeService, notebookId } = context
    return knowledgeService.addDocument(notebookId, {
      title: 'Hợp đồng ABC',
      type: 'text',
      content: CONTRACT
    })
  }

  it('stores summary/keywords/entities and builds the table of contents from structure', async () => {
    const { enrichmentService, knowledgeService, providerManager, dbModule } = context
    const documentId = await seedDocument()

    const enrichment = await enrichmentService.enrich(documentId)

    expect(providerManager.chat.calls).toBe(1)
    expect(enrichment.summary).toContain('Tóm tắt thử nghiệm')
    expect(enrichment.keywords).toEqual(['hợp đồng', 'thanh toán'])
    expect(enrichment.entities).toEqual(['Công ty ABC'])
    // TOC lấy từ cấu trúc đã index, không cần LLM
    expect(enrichment.toc.map((entry: any) => entry.title)).toEqual([
      'Hợp đồng ABC',
      '1. Phạm vi',
      '2. Termination'
    ])
    expect(enrichment.toc[2].headingPath).toEqual(['Hợp đồng ABC', '2. Termination'])

    const stored = enrichmentService.getEnrichment(documentId)
    expect(stored?.summary).toBe(enrichment.summary)
    expect(knowledgeService.getDocument(documentId)?.status).toBe('indexed')

    const chunks = knowledgeService.getDocumentChunks(documentId)
    expect(chunks[0].metadata).toMatchObject({
      retrievalMetadata: {
        keywords: ['hợp đồng', 'thanh toán'],
        entities: ['Công ty ABC']
      }
    })
    expect(
      dbModule
        .getSqlite()
        .prepare(
          "SELECT value_display FROM document_metadata_values WHERE document_id = ? AND field = 'entities'"
        )
        .all(documentId)
    ).toEqual([expect.objectContaining({ value_display: 'Công ty ABC' })])

    const metadataOutcome = await knowledgeService.searchMetadataAware(
      context.notebookId,
      'Nghĩa vụ của Công ty ABC',
      { topK: 3, threshold: 0 }
    )
    expect(metadataOutcome.trace.plan.preferredConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entity', values: ['Công ty ABC'] })
      ])
    )
    expect(metadataOutcome.results.some((result) => result.documentId === documentId)).toBe(true)

    // Vector cấp tài liệu phải được cập nhật lại (và không bị nhân đôi bản ghi)
    const docVectors = dbModule
      .getSqlite()
      .prepare('SELECT document_id FROM vec_documents WHERE document_id = ?')
      .all(documentId) as Array<{ document_id: string }>
    expect(docVectors).toHaveLength(1)
  })

  it('skips the LLM call when the enrichment is still fresh', async () => {
    const { enrichmentService, providerManager } = context
    const documentId = await seedDocument()

    await enrichmentService.enrich(documentId)
    const callsAfterFirst = providerManager.chat.calls

    await enrichmentService.enrich(documentId, { skipIfFresh: true })

    expect(providerManager.chat.calls).toBe(callsAfterFirst)
  })

  it('samples the full document for enrichment instead of only its first excerpt', async () => {
    const { enrichmentService, knowledgeService, notebookId, providerManager } = context
    const tailEvidence = 'ENTITY-ONLY-AT-THE-END-OF-THE-DOCUMENT'
    const documentId = await knowledgeService.addDocument(notebookId, {
      title: 'Dài',
      type: 'text',
      content: `${'Nội dung mở đầu. '.repeat(900)}\n\n${tailEvidence}`
    })

    await enrichmentService.enrich(documentId)

    expect(JSON.stringify(providerManager.chat.lastMessages)).toContain(tailEvidence)
  })

  it('can be cancelled mid-stream without writing an enrichment', async () => {
    const { enrichmentService, providerManager } = context
    const documentId = await seedDocument()
    providerManager.chat.hold = true

    const controller = new AbortController()
    const pending = enrichmentService.enrich(documentId, { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    await expect(pending).rejects.toThrow(/cancelled/i)
    expect(enrichmentService.getEnrichment(documentId)).toBeUndefined()
  })

  it('runs queued enrichment jobs and throttles them by cooldown', async () => {
    const { jobService, enrichmentService, schema, db, notebookId } = context
    const { eq } = await import('drizzle-orm')
    const first = await seedDocument()
    const second = await seedDocument()

    jobService.enqueueEnrich(first, notebookId)
    jobService.enqueueEnrich(second, notebookId)

    await jobService.tick()

    const jobs = db.select().from(schema.backgroundJobs).all()
    const statuses = jobs.map((job: any) => job.status)

    expect(statuses.filter((status: string) => status === 'done')).toHaveLength(1)
    expect(statuses.filter((status: string) => status === 'pending')).toHaveLength(1)
    expect(enrichmentService.getEnrichment(first)).toBeTruthy()

    // Job thứ hai vẫn pending (cooldown) — chứng minh throttle hoạt động
    const pendingJob = jobs.find((job: any) => job.status === 'pending')
    expect(pendingJob?.jobType).toBe('enrich-document')
    expect(
      db.select().from(schema.documents).where(eq(schema.documents.id, second)).get()
    ).toBeTruthy()
  })

  it('cancels a running manual enrichment when asked to stop', async () => {
    const { jobService, providerManager } = context
    const documentId = await seedDocument()
    providerManager.chat.hold = true

    const pending = jobService.runEnrichNow(documentId)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(jobService.cancelActiveJob('test')).toBe(true)
    await expect(pending).rejects.toThrow(/cancelled/i)
  })

  it('keeps queued jobs pending while manual enrichment is running', async () => {
    const { jobService, providerManager, notebookId, db, schema } = context
    const documentId = await seedDocument()
    providerManager.chat.hold = true
    const manual = jobService.runEnrichNow(documentId)
    const cancelled = expect(manual).rejects.toThrow(/cancelled/i)
    jobService.enqueueDecayLinks(notebookId)
    try {
      await jobService.tick()
      expect(db.select().from(schema.backgroundJobs).get().status).toBe('pending')
    } finally {
      jobService.cancelActiveJob('test')
      await cancelled
    }
  })

  it('waits for manual enrichment to settle before shutdown completes', async () => {
    const { jobService, enrichmentService } = context
    let finish!: () => void
    vi.spyOn(enrichmentService, 'enrich').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const manual = jobService.runEnrichNow('doc-manual')
    let stopped = false
    const shutdown = jobService.shutdown().then(() => {
      stopped = true
    })
    await Promise.resolve()
    await Promise.resolve()
    try {
      expect(stopped).toBe(false)
    } finally {
      finish()
      await Promise.all([manual, shutdown])
    }
  })
})
