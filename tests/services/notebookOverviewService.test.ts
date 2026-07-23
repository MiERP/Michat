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

  it('allocates overview coverage per canonical work and persists used citations', async () => {
    const now = new Date()
    const sources = [
      { key: 'law:07/2022/QH15', content: 'LAW_07_DOCX' },
      { key: 'law:07/2022/QH15', content: 'LAW_07_PDF_DUPLICATE' },
      { key: 'law:24/2018/QH14', content: 'LAW_24' },
      { key: 'decree:103/2025/NĐ-CP', content: 'DECREE_103' }
    ]
    for (let index = 1; index <= sources.length; index++) {
      const documentId = 'document_' + index
      const source = sources[index - 1]
      dbModule
        .getDatabase()
        .insert(schema.documents)
        .values({
          id: documentId,
          notebookId,
          title: 'Source ' + index + '.pdf',
          type: 'file',
          contentHash: 'source-v' + index,
          metadata: { canonicalLegalWorkKey: source.key },
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
          content: source.content + ' Điều ' + index + ' quy định quyền và nghĩa vụ.',
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
      text:
        '## Tổng quan [1]\n' +
        'Luật 07 và Luật 24 quy định các nghĩa vụ chính [1] [2].\n\n' +
        'Nghị định 103 quy định chi tiết phạm vi áp dụng [3].'
    })

    const progressEvents: Array<{ stage: string; progress: number }> = []
    const overview = await service.generate(notebookId, (stage, progress) =>
      progressEvents.push({ stage, progress })
    )

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const prompt = generateTextMock.mock.calls[0][0].prompt as string
    expect(prompt.length).toBeLessThan(11_000)
    expect(prompt).toContain('LAW_07_DOCX')
    expect(prompt).not.toContain('LAW_07_PDF_DUPLICATE')
    expect(prompt).toContain('LAW_24')
    expect(prompt).toContain('DECREE_103')
    expect(prompt).toContain('160-220 từ')
    expect(prompt).toMatch(/Tài liệu \[1\]/)
    expect(overview.citations).toHaveLength(3)
    expect(overview.citations.map((citation) => citation.documentId)).toEqual([
      'document_1',
      'document_3',
      'document_4'
    ])
    expect(overview.content).toContain('[3]')
    expect(progressEvents[0]).toEqual({ stage: 'preparing_sources', progress: 5 })
    expect(progressEvents.some((event) => event.stage === 'synthesizing_overview')).toBe(true)
  })
})
