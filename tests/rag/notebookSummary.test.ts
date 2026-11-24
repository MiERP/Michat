import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../src/main/db'

type DbModule = typeof import('../../src/main/db')
type SchemaModule = typeof import('../../src/main/db/schema')

type NotebookSummaryServiceClass =
  (typeof import('../../src/main/services/NotebookSummaryService'))['NotebookSummaryService']

type SummaryContext = {
  dbModule: DbModule
  schema: SchemaModule
  db: Database
  notebookId: string
  insertDoc: (title: string, content: string, enrichmentSummary?: string) => string
  NotebookSummaryService: NotebookSummaryServiceClass
}

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

describe('NotebookSummaryService', () => {
  let context: SummaryContext | undefined

  beforeEach(async () => {
    userDataDir = join(
      tmpdir(),
      `michat-nbsum-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    await mkdir(userDataDir, { recursive: true })

    const dbModule = await import('../../src/main/db')
    const schema = await import('../../src/main/db/schema')
    const { NotebookSummaryService } =
      await import('../../src/main/services/NotebookSummaryService')

    dbModule.initDatabase()
    dbModule.runMigrations()
    dbModule.initExtensions()

    const db = dbModule.getDatabase()
    const notebookId = `notebook_${Math.random().toString(16).slice(2)}`
    db.insert(schema.notebooks)
      .values({
        id: notebookId,
        title: 'Summary Test',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .run()

    const insertDoc = (title: string, content: string, enrichmentSummary?: string) => {
      const documentId = `doc_${Math.random().toString(16).slice(2)}`
      db.insert(schema.documents)
        .values({
          id: documentId,
          notebookId,
          title,
          type: 'text',
          content,
          contentHash: `hash_${documentId}`,
          status: 'indexed',
          metadata: enrichmentSummary
            ? {
                enrichment: { summary: enrichmentSummary, generatedAt: '2026-10-16T00:00:00.000Z' }
              }
            : null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .run()
      return documentId
    }

    context = { dbModule, schema, db, notebookId, insertDoc, NotebookSummaryService }
  })

  afterEach(async () => {
    context?.dbModule.closeDatabase()
    vi.resetModules()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('uses the single document summary directly and caps at 120 words', async () => {
    const { insertDoc, notebookId, NotebookSummaryService } = context!

    const longSummary = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    insertDoc('Tài liệu duy nhất', 'nội dung', longSummary)

    const service = new NotebookSummaryService({} as never)
    const summary = await service.summarize(notebookId)

    expect(summary).toBeTruthy()
    const words = summary!.split(' ')
    expect(words.length).toBeLessThanOrEqual(120)
    expect(summary!.endsWith('…')).toBe(true)
    expect(summary).toBe(longSummary.split(' ').slice(0, 120).join(' ') + '…')
    expect(service.isFresh(notebookId)).toBe(true)
  })

  it('aggregates multiple document summaries through the LLM with a 100-120 word instruction', async () => {
    const { insertDoc, notebookId, NotebookSummaryService } = context!

    insertDoc('Hợp đồng ABC', 'nội dung 1', 'Tóm tắt hợp đồng ABC')
    insertDoc('Bảng giá 2026', 'nội dung 2', 'Tóm tắt bảng giá')

    let capturedPrompt = ''
    const fakeProvider = {
      getActiveChatProvider: async () => ({
        sendMessageStream: async (
          messages: Array<{ role: string; content: string }>,
          onChunk: (chunk: { content: string }) => void,
          _onError: (error: Error) => void,
          onComplete: () => void
        ) => {
          capturedPrompt = messages[0]?.content ?? ''
          onChunk({ content: 'Tổng hợp chung của sổ tay.' })
          onComplete()
          return new AbortController()
        },
        getDefaultChatModel: () => 'fake-chat-model'
      })
    }

    const service = new NotebookSummaryService(fakeProvider as never)
    const summary = await service.summarize(notebookId)

    expect(summary).toBe('Tổng hợp chung của sổ tay.')
    expect(capturedPrompt).toContain('100-120')
    expect(capturedPrompt).toContain('Hợp đồng ABC')
    expect(capturedPrompt).toContain('Bảng giá 2026')
    expect(service.isFresh(notebookId)).toBe(true)
  })

  it('marks the summary stale when a document changes', async () => {
    const { db, schema, insertDoc, notebookId, NotebookSummaryService } = context!

    const documentId = insertDoc('Tài liệu', 'nội dung', 'Tóm tắt ban đầu')
    const service = new NotebookSummaryService({} as never)
    await service.summarize(notebookId)
    expect(service.isFresh(notebookId)).toBe(true)

    // Tài liệu thay đổi → chữ ký lệch → tóm tắt notebook cũ
    const { eq } = await import('drizzle-orm')
    db.update(schema.documents)
      .set({ contentHash: 'hash_moi' })
      .where(eq(schema.documents.id, documentId))
      .run()

    expect(service.isFresh(notebookId)).toBe(false)
    expect(service.getStored(notebookId)?.summary).toBe('Tóm tắt ban đầu')
  })

  it('clears the summary when the notebook has no documents', async () => {
    const { db, schema, insertDoc, notebookId, NotebookSummaryService } = context!

    const documentId = insertDoc('Tài liệu', 'nội dung', 'Tóm tắt')
    const service = new NotebookSummaryService({} as never)
    await service.summarize(notebookId)
    expect(service.getStored(notebookId)).toBeTruthy()

    const { eq } = await import('drizzle-orm')
    db.delete(schema.documents).where(eq(schema.documents.id, documentId)).run()

    const summary = await service.summarize(notebookId)
    expect(summary).toBeNull()
    expect(service.getStored(notebookId)).toBeNull()
  })
})
