import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTempUserData, closeAndRemove } from '../helpers/tempUserData'
import type { Database } from '../../src/main/db'
import type { KnowledgeService } from '../../src/main/services/KnowledgeService'
import type { BackgroundJobService } from '../../src/main/services/BackgroundJobService'
import type { EmbeddingResult } from '../../src/main/ai/types'

type DbModule = typeof import('../../src/main/db')
type SchemaModule = typeof import('../../src/main/db/schema')

type BackfillContext = {
  dbModule: DbModule
  schema: SchemaModule
  db: Database
  notebookId: string
  knowledgeService: KnowledgeService
  jobService: BackgroundJobService
}

type DocumentStructureMetadata = {
  structure?: {
    sections?: unknown[]
  }
}

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

function embedding(text: string): EmbeddingResult {
  const vector = new Float32Array(1024)
  vector[Math.abs(text.length % 900)] = 1
  return {
    embedding: vector,
    model: 'fake-local-embedding',
    dimensions: 1024,
    tokensUsed: text.length
  }
}

class FakeProviderManager {
  async getEmbeddingProvider() {
    return {
      createEmbedding: async (text: string) => embedding(text),
      createEmbeddings: async (texts: string[]) => texts.map(embedding),
      getDefaultEmbeddingModel: () => 'fake-local-embedding'
    }
  }

  async getActiveRerankProvider() {
    return null
  }
}

const CONTENT = [
  '# Hợp đồng ABC',
  '',
  '## 1. Phạm vi',
  'Phạm vi dịch vụ bao gồm tư vấn và triển khai hệ thống nội bộ theo yêu cầu của bên A.',
  '',
  '## 2. Termination',
  'Điều khoản chấm dứt hợp đồng khi bên A vi phạm nghĩa vụ thanh toán qua hai kỳ liên tiếp.'
].join('\n')

const LEGACY_VEC_DDL = `
  CREATE VIRTUAL TABLE vec_embeddings USING vec0(
    embedding_id TEXT PRIMARY KEY,
    chunk_id TEXT,
    notebook_id TEXT,
    embedding FLOAT[1024] distance_metric=cosine
  );
`

describe('vec_embeddings migration', () => {
  let dbModule: DbModule | undefined

  beforeEach(async () => {
    userDataDir = await createTempUserData('michat-vecmig')
    dbModule = await import('../../src/main/db')
    dbModule.initDatabase()
    dbModule.runMigrations()
  })

  afterEach(async () => {
    if (userDataDir) {
      await closeAndRemove(userDataDir, () => dbModule?.closeDatabase())
    }
    vi.resetModules()
  })

  it('rebuilds a legacy vector table that has no document_id column', () => {
    const sqlite = dbModule!.getSqlite()

    // Bảng kiểu cũ + một vector giả để chứng minh dữ liệu cũ bị bỏ đi
    sqlite.exec(LEGACY_VEC_DDL)
    sqlite
      .prepare(
        'INSERT INTO vec_embeddings (embedding_id, chunk_id, notebook_id, embedding) VALUES (?, ?, ?, ?)'
      )
      .run('emb_legacy', 'chunk_legacy', 'nb_legacy', new Float32Array(1024))

    expect(() => sqlite.prepare('SELECT document_id FROM vec_embeddings LIMIT 1').get()).toThrow()

    dbModule!.initExtensions()

    // Cột mới có mặt, cờ rebuild được bật, dữ liệu cũ đã bị xoá (sẽ embed lại)
    expect(dbModule!.wasVectorIndexRebuilt()).toBe(true)
    expect(sqlite.prepare('SELECT document_id FROM vec_embeddings LIMIT 1').get()).toBeUndefined()
    expect(sqlite.prepare('SELECT count(*) as c FROM vec_embeddings').get()).toMatchObject({ c: 0 })
  })

  it('keeps a modern vector table as-is (no rebuild)', () => {
    dbModule!.initExtensions()

    expect(() =>
      dbModule!.getSqlite().prepare('SELECT document_id FROM vec_embeddings LIMIT 1').get()
    ).not.toThrow()
    expect(dbModule!.wasVectorIndexRebuilt()).toBe(false)
  })
})

describe('vector rebuild and knowledge backfill', () => {
  let context: BackfillContext | undefined

  beforeEach(async () => {
    userDataDir = await createTempUserData('michat-backfill')

    const dbModule = await import('../../src/main/db')
    const schema = await import('../../src/main/db/schema')
    const { KnowledgeService } = await import('../../src/main/services/KnowledgeService')
    const { BackgroundJobService } = await import('../../src/main/services/BackgroundJobService')

    dbModule.initDatabase()
    dbModule.runMigrations()
    dbModule.initExtensions()

    const db = dbModule.getDatabase()
    const notebookId = `notebook_${Math.random().toString(16).slice(2)}`
    db.insert(schema.notebooks)
      .values({
        id: notebookId,
        title: 'Backfill Test',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .run()

    const knowledgeService = new KnowledgeService(new FakeProviderManager() as never)
    const jobService = new BackgroundJobService(
      knowledgeService,
      { generateLinksForDocument: async () => 0, decayLinks: () => 0 } as never,
      { enrich: async () => ({}) } as never,
      0,
      0
    )

    context = { dbModule, schema, db, notebookId, knowledgeService, jobService }
  })

  afterEach(async () => {
    context?.jobService?.stop()
    if (userDataDir) {
      await closeAndRemove(userDataDir, () => context?.dbModule.closeDatabase())
    }
    vi.resetModules()
  })

  async function seedDocument(): Promise<string> {
    const { knowledgeService, notebookId } = context!
    return knowledgeService.addDocument(notebookId, {
      title: 'Hợp đồng ABC',
      type: 'text',
      content: CONTENT,
      chunkOptions: { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }
    })
  }

  it('filters vectors by document id inside the KNN query', async () => {
    const { knowledgeService, notebookId } = context!
    const first = await seedDocument()
    const second = await knowledgeService.addDocument(notebookId, {
      title: 'Bảng giá 2026',
      type: 'text',
      content: '# Bảng giá 2026\n\nBảng giá áp dụng theo quy định hiện hành và điều chỉnh mỗi quý.',
      chunkOptions: { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }
    })

    const { vectorStoreManager } = await import('../../src/main/vectorstore')
    const store = await vectorStoreManager.getStore(notebookId, undefined, 1024)
    const matches = await store.query(embedding('hợp đồng').embedding, {
      topK: 20,
      filter: { documentIds: [first] }
    })

    expect(matches.length).toBeGreaterThan(0)

    const chunkIds = new Set(matches.map((match) => match.chunkId))
    const allowed = new Set(knowledgeService.getDocumentChunks(first).map((chunk) => chunk.id))
    for (const chunkId of chunkIds) expect(allowed.has(chunkId)).toBe(true)

    const secondMatches = await store.query(embedding('bảng giá').embedding, {
      topK: 20,
      filter: { documentIds: [second] }
    })
    const secondAllowed = new Set(
      knowledgeService.getDocumentChunks(second).map((chunk) => chunk.id)
    )
    for (const match of secondMatches) expect(secondAllowed.has(match.chunkId)).toBe(true)
  })

  it('re-embeds chunks whose vectors are missing', async () => {
    const { knowledgeService, notebookId, dbModule } = context!
    const documentId = await seedDocument()
    const chunkCount = knowledgeService.getDocumentChunks(documentId).length

    // Mô phỏng hậu quả của việc tạo lại bảng vector: vector mất, chunk còn nguyên
    dbModule.getSqlite().prepare('DELETE FROM vec_embeddings WHERE notebook_id = ?').run(notebookId)

    const result = await knowledgeService.rebuildMissingVectors(notebookId, 500)

    expect(result.rebuilt).toBe(chunkCount)
    expect(result.remaining).toBe(0)
    expect(
      dbModule
        .getSqlite()
        .prepare('SELECT count(*) as c FROM vec_embeddings WHERE notebook_id = ?')
        .get(notebookId)
    ).toMatchObject({ c: chunkCount })

    // Không nhân đôi dòng metadata embedding
    const embeddingRows = dbModule
      .getSqlite()
      .prepare('SELECT count(*) as c FROM embeddings WHERE notebook_id = ?')
      .get(notebookId) as { c: number }
    expect(embeddingRows.c).toBe(chunkCount)

    // Vector mới thật sự dùng được
    const results = await knowledgeService.search(notebookId, 'chấm dứt hợp đồng', {
      topK: 2,
      threshold: 0
    })
    expect(results.length).toBeGreaterThan(0)
  })

  it('backfills FTS rows that are missing while vectors are intact', async () => {
    const { knowledgeService, notebookId, dbModule } = context!
    const documentId = await seedDocument()
    const chunkCount = knowledgeService.getDocumentChunks(documentId).length

    // Bảng FTS bị xoá/tạo lại nhưng chunk + vector vẫn còn.
    dbModule.getSqlite().prepare('DELETE FROM fts_chunks WHERE notebook_id = ?').run(notebookId)

    const result = await knowledgeService.rebuildMissingVectors(notebookId, 500)

    expect(result.ftsRebuilt).toBe(chunkCount)
    expect(
      dbModule
        .getSqlite()
        .prepare('SELECT count(*) as c FROM fts_chunks WHERE notebook_id = ?')
        .get(notebookId)
    ).toMatchObject({ c: chunkCount })
  })

  it('queues a backfill job for documents missing structure or document vector', async () => {
    const { knowledgeService, notebookId, jobService, dbModule, schema, db } = context!
    const { eq } = await import('drizzle-orm')
    const documentId = await seedDocument()

    // Tài liệu "cũ": chưa có vector cấp tài liệu và chưa có cấu trúc mục
    dbModule.getSqlite().prepare('DELETE FROM vec_documents WHERE document_id = ?').run(documentId)
    db.update(schema.documents)
      .set({ metadata: { fileMd5: 'legacy' } })
      .where(eq(schema.documents.id, documentId))
      .run()

    expect(knowledgeService.findDocumentsNeedingBackfill(notebookId, 5)).toEqual([documentId])

    jobService.enqueueBackfill(notebookId)
    await jobService.tick()

    const queued = db.select().from(schema.backgroundJobs).all()
    const queuedTypes = queued.map((job) => job.jobType)
    expect(queuedTypes).toContain('reindex-document')
    expect(queuedTypes).toContain('enrich-document')

    // Chạy job reindex → cấu trúc mục + vector cấp tài liệu được tạo lại
    await jobService.tick()

    const refreshed = knowledgeService.getDocument(documentId)
    expect(
      (refreshed?.metadata as unknown as DocumentStructureMetadata | null)?.structure?.sections
        ?.length
    ).toBeGreaterThan(0)
    expect(
      dbModule
        .getSqlite()
        .prepare('SELECT count(*) as c FROM vec_documents WHERE document_id = ?')
        .get(documentId)
    ).toMatchObject({ c: 1 })

    expect(knowledgeService.findDocumentsNeedingBackfill(notebookId, 5)).toEqual([])
  })
})
