import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('ai', () => ({
  generateText: generateTextMock
}))

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

describe('NotebookOverviewService', () => {
  let dbModule: typeof import('../../src/main/db')
  let schema: typeof import('../../src/main/db/schema')
  let service: import('../../src/main/services/NotebookOverviewService').NotebookOverviewService
  let notebookId: string

  beforeEach(async () => {
    generateTextMock.mockReset()
    userDataDir = join(
      tmpdir(),
      `michat-overview-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    await mkdir(userDataDir, { recursive: true })
    dbModule = await import('../../src/main/db')
    schema = await import('../../src/main/db/schema')
    const { NotebookOverviewService } =
      await import('../../src/main/services/NotebookOverviewService')

    dbModule.initDatabase()
    dbModule.runMigrations()
    dbModule.initExtensions()

    notebookId = `notebook_${Math.random().toString(16).slice(2)}`
    dbModule
      .getDatabase()
      .insert(schema.notebooks)
      .values({
        id: notebookId,
        title: 'Overview test',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .run()
    service = new NotebookOverviewService({} as never)
  })

  afterEach(async () => {
    dbModule.closeDatabase()
    await rm(userDataDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('rejects generation when notebook has no indexed documents', async () => {
    await expect(service.generate(notebookId)).rejects.toThrow('No indexed documents')
  })

  it('marks saved overview stale without regenerating it', () => {
    const now = new Date()
    dbModule
      .getDatabase()
      .insert(schema.notebookOverviews)
      .values({
        id: 'overview_1',
        notebookId,
        content: '## Tổng quan notebook\nNội dung [1]',
        citations: [],
        sourceFingerprint: 'before-change',
        status: 'fresh',
        createdAt: now,
        updatedAt: now
      })
      .run()

    service.markStale(notebookId)
    expect(service.getOverview(notebookId)?.status).toBe('stale')
  })

  it('returns null for non-existent notebook overview', () => {
    expect(service.getOverview('nonexistent')).toBeNull()
  })

  it('getOverview returns fresh overview when it exists', () => {
    const now = new Date()
    dbModule
      .getDatabase()
      .insert(schema.notebookOverviews)
      .values({
        id: 'overview_2',
        notebookId,
        content: '## Tổng quan\nĐiểm chính [1]',
        citations: [],
        sourceFingerprint: 'v1',
        status: 'fresh',
        createdAt: now,
        updatedAt: now
      })
      .run()

    const overview = service.getOverview(notebookId)
    expect(overview).not.toBeNull()
    expect(overview!.status).toBe('fresh')
    expect(overview!.content).toContain('## Tổng quan')
  })

  it('uses one short LLM request without citations for multiple documents', async () => {
    const now = new Date()
    for (let index = 1; index <= 3; index++) {
      const documentId = 'document_' + index
      dbModule
        .getDatabase()
        .insert(schema.documents)
        .values({
          id: documentId,
          notebookId,
          title: 'Source ' + index + '.pdf',
          type: 'file',
          contentHash: 'source-v' + index,
          status: 'indexed',
          chunkCount: 1,
          createdAt: new Date(now.getTime() + index),
          updatedAt: now
        })
        .run()
      dbModule
        .getDatabase()
        .insert(schema.chunks)
        .values({
          id: 'chunk_' + index,
          documentId,
          notebookId,
          content: 'DOCUMENT_' + index + ' Điều ' + index + ' quy định quyền và nghĩa vụ.',
          chunkIndex: 0,
          createdAt: now
        })
        .run()
    }

    const { AISDKProvider } = await import('../../src/main/providers/base/AISDKProvider')
    const provider = Object.create(AISDKProvider.prototype) as InstanceType<typeof AISDKProvider>
    Object.defineProperties(provider, {
      name: { value: 'llama' },
      getAIModel: { value: () => ({ modelId: 'local-test-model' }) }
    })
    service = new (
      await import('../../src/main/services/NotebookOverviewService')
    ).NotebookOverviewService({
      getActiveChatProvider: async () => provider
    } as never)
    generateTextMock.mockResolvedValue({
      text: Array.from({ length: 300 }, (_, index) => 'word' + index).join(' ')
    })

    const progressEvents: Array<{ stage: string; progress: number }> = []
    const overview = await service.generate(notebookId, (stage, progress) =>
      progressEvents.push({ stage, progress })
    )

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const prompt = generateTextMock.mock.calls[0][0].prompt as string
    expect(prompt.length).toBeLessThan(11_000)
    expect(prompt).toContain('DOCUMENT_1')
    expect(prompt).toContain('DOCUMENT_2')
    expect(prompt).toContain('DOCUMENT_3')
    expect(prompt).toContain('160-220 từ')
    expect(prompt.toLowerCase()).not.toContain('citation')
    expect(prompt).not.toMatch(/\[\d+\]/)
    expect(overview.content.trim().split(/\s+/)).toHaveLength(240)
    expect('citations' in overview).toBe(false)
    expect(progressEvents[0]).toEqual({ stage: 'preparing_sources', progress: 5 })
    expect(progressEvents.some((event) => event.stage === 'synthesizing_overview')).toBe(true)
  })
})
