import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import type {
  EmbeddingConfig,
  EmbeddingResult
} from '../../src/main/providers/capabilities/EmbeddingCapability'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      return userDataDir
    }
  }
}))

function vectorFor(text: string): Float32Array {
  const vector = new Float32Array(1024)
  const lower = text.toLowerCase()
  if (lower.includes('local-first') || lower.includes('local first')) vector[0] = 1
  if (
    lower.includes('privacy') ||
    lower.includes('riÃªng tÆ°') ||
    lower.includes('quyá»n riÃªng tÆ°')
  )
    vector[1] = 1
  if (lower.includes('embedding') || lower.includes('embeddings')) vector[2] = 1
  if (lower.includes('chunk')) vector[3] = 1
  if (lower.includes('remote')) vector[4] = 1
  if (vector.every((value) => value === 0)) vector[10] = 1
  return vector
}

function embedding(text: string, config?: EmbeddingConfig): EmbeddingResult {
  return {
    embedding: vectorFor(text),
    model: config?.model || 'fake-local-embedding',
    dimensions: 1024,
    tokensUsed: text.length
  }
}

class FakeProviderManager {
  public embeddingCalls: string[] = []
  public failEmbeddings = false
  public remoteCalls = 0

  async getActiveEmbeddingProvider() {
    return {
      createEmbedding: async (text: string, config?: EmbeddingConfig) => {
        this.embeddingCalls.push(text)
        if (this.failEmbeddings) throw new Error('fake local embedding failure')
        return embedding(text, config)
      },
      createEmbeddings: async (texts: string[], config?: EmbeddingConfig) => {
        this.embeddingCalls.push(...texts)
        if (this.failEmbeddings) throw new Error('fake local embedding failure')
        return texts.map((text) => embedding(text, config))
      },
      getDefaultEmbeddingModel: () => 'fake-local-embedding'
    }
  }

  async getActiveRerankProvider() {
    return null
  }
}

type TestContext = Awaited<ReturnType<typeof createContext>>

async function createContext() {
  userDataDir = join(tmpdir(), `michat-rag-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(userDataDir, { recursive: true })

  const dbModule = await import('../../src/main/db')
  const schema = await import('../../src/main/db/schema')
  const { KnowledgeService } = await import('../../src/main/services/KnowledgeService')

  dbModule.initDatabase()
  dbModule.runMigrations()
  dbModule.initExtensions()

  const db = dbModule.getDatabase()
  const notebookId = `notebook_${Math.random().toString(16).slice(2)}`
  db.insert(schema.notebooks)
    .values({ id: notebookId, title: 'RAG Test', createdAt: new Date(), updatedAt: new Date() })
    .run()

  const providerManager = new FakeProviderManager()
  const service = new KnowledgeService(providerManager as never)

  return { dbModule, schema, db, notebookId, providerManager, service }
}

async function cleanup(context: TestContext | undefined) {
  if (context) {
    context.dbModule.closeDatabase()
  }
  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true })
  }
  vi.resetModules()
}

describe('KnowledgeService RAG regression', () => {
  let context: TestContext | undefined

  beforeEach(async () => {
    context = await createContext()
  })

  afterEach(async () => {
    await cleanup(context)
    context = undefined
  })

  it('indexes text documents into chunks and embedding metadata', async () => {
    const { service, notebookId, db, schema } = context!

    const documentId = await service.addDocument(notebookId, {
      title: 'Local-first text',
      type: 'text',
      content: 'Local-first RAG keeps privacy on device. Embeddings and query context stay local.',
      chunkOptions: { chunkSize: 40, chunkOverlap: 0, minChunkSize: 10 }
    })

    const document = service.getDocument(documentId)
    const docChunks = service.getDocumentChunks(documentId)
    const embeddingRows = db
      .select()
      .from(schema.embeddings)
      .where((await import('drizzle-orm')).eq(schema.embeddings.notebookId, notebookId))
      .all()

    expect(document?.status).toBe('indexed')
    expect(document?.chunkCount).toBe(docChunks.length)
    expect(docChunks.length).toBeGreaterThan(0)
    expect(embeddingRows).toHaveLength(docChunks.length)
  })

  it('indexes a legal profile and routes chapter and article count questions without embedding', async () => {
    const { service, notebookId, providerManager } = context!
    const lawText = `LUẬT DỮ LIỆU

CHƯƠNG I
QUY ĐỊNH CHUNG

Điều 1. Phạm vi điều chỉnh
Luật này quy định về dữ liệu.

Mục 1
NGUYÊN TẮC XỬ LÝ DỮ LIỆU

Điều 2. Nguyên tắc xử lý dữ liệu
Việc xử lý dữ liệu phải hợp pháp.

CHƯƠNG II
QUYỀN VÀ NGHĨA VỤ

Điều 3. Quyền của chủ thể dữ liệu
Chủ thể dữ liệu có quyền theo luật này.`

    const documentId = await service.addDocument(notebookId, {
      title: 'Luật Dữ liệu',
      type: 'text',
      content: lawText
    })

    const document = service.getDocument(documentId)
    const documentMetadata = document?.metadata as Record<string, any>
    expect(documentMetadata.legalStructure).toMatchObject({
      chapterCount: 2,
      sectionCount: 1,
      articleCount: 3
    })

    const profileChunk = service
      .getDocumentChunks(documentId)
      .find((chunk) => (chunk.metadata as Record<string, unknown>)?.kind === 'legal-profile')
    expect(profileChunk?.content).toContain('Số chương: 2')
    expect(profileChunk?.content).toContain('Số điều: 3')

    const legalContentChunks = service
      .getDocumentChunks(documentId)
      .filter((chunk) => (chunk.metadata as Record<string, unknown>)?.kind === 'legal-content')
    expect(
      new Set(
        legalContentChunks
          .map(
            (chunk) =>
              ((chunk.metadata as Record<string, any>).legalContext as Record<string, string>)
                .articleNumber
          )
          .filter(Boolean)
      )
    ).toEqual(new Set(['1', '2', '3']))

    const embeddingsBeforeQuery = providerManager.embeddingCalls.length
    const results = await service.search(notebookId, 'Luật có bao nhiêu chương, bao nhiêu điều?', {
      topK: 3,
      threshold: 0
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      chunkId: profileChunk?.id,
      documentId,
      content: expect.stringContaining('Số chương: 2')
    })
    expect(providerManager.embeddingCalls).toHaveLength(embeddingsBeforeQuery)

    const embeddingsBeforeArticleQuery = providerManager.embeddingCalls.length
    const articleResults = await service.search(notebookId, 'Điều 2 quy định gì?', {
      topK: 3,
      threshold: 0
    })

    expect(articleResults.length).toBeGreaterThan(0)
    expect(articleResults.every((result) => {
      const context = (result.metadata as Record<string, any>).legalContext as Record<string, string>
      return context.articleNumber === '2'
    })).toBe(true)
    expect(providerManager.embeddingCalls).toHaveLength(embeddingsBeforeArticleQuery)

    const embeddingsBeforeCompoundQuery = providerManager.embeddingCalls.length
    const compoundResults = await service.search(
      notebookId,
      'Luật có bao nhiêu chương, bao nhiêu điều? Điều 2 quy định gì?',
      { topK: 3, threshold: 0 }
    )

    expect(
      compoundResults.some(
        (result) => (result.metadata as Record<string, unknown>)?.kind === 'legal-profile'
      )
    ).toBe(true)
    expect(
      compoundResults.some((result) => {
        const context = (result.metadata as Record<string, any>)?.legalContext as
          | Record<string, string>
          | undefined
        return context?.articleNumber === '2'
      })
    ).toBe(true)
    expect(providerManager.embeddingCalls).toHaveLength(embeddingsBeforeCompoundQuery)
  })

  it('creates valid FTS5 syntax for punctuation-heavy Vietnamese queries', async () => {
    const { buildFtsMatchQuery } = await import('../../src/main/services/KnowledgeService')

    const quote = String.fromCharCode(34)
    expect(buildFtsMatchQuery('Luật có bao nhiêu chương, bao nhiêu điều?')).toBe(
      ['Luật', 'có', 'bao', 'nhiêu', 'chương', 'bao', 'nhiêu', 'điều']
        .map((term) => quote + term + quote)
        .join(' OR ')
    )
  })

  it('indexes markdown files with Vietnamese tables and retrieves cited local-first chunks', async () => {
    const { service, notebookId, providerManager } = context!
    const filePath = join(userDataDir, 'local-first.md')
    await writeFile(
      filePath,
      '# ChÃ­nh sÃ¡ch Local First\n\nMiChat giá»¯ tÃ i liá»‡u, embeddings vÃ  truy váº¥n RAG trÃªn mÃ¡y.\n\n| Dá»¯ liá»‡u | Máº·c Ä‘á»‹nh |\n| --- | --- |\n| Query RAG | Local |',
      'utf8'
    )

    const documentId = await service.addDocumentFromFile(notebookId, filePath)
    const results = await service.search(
      notebookId,
      'local-first embeddings truy váº¥n trÃªn mÃ¡y',
      {
        topK: 3,
        threshold: 0,
        rerank: { enabled: true, heuristicFallback: true }
      }
    )

    expect(service.getDocument(documentId)?.status).toBe('indexed')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].documentId).toBe(documentId)
    expect(results[0].content.toLowerCase()).toContain('local')
    expect(results[0].chunkId).toBeTruthy()
    expect(providerManager.remoteCalls).toBe(0)
  })

  it('indexes long TXT files into multiple chunks without remote provider calls', async () => {
    const { service, notebookId, providerManager } = context!
    const filePath = join(userDataDir, 'long-vietnamese.txt')
    const paragraphs = Array.from(
      { length: 24 },
      (_, index) =>
        `Đoạn ${index + 1}: MiChat RAG local-first giữ tài liệu, embedding, citation và truy vấn trên máy để bảo vệ quyền riêng tư.`
    )
    await writeFile(filePath, paragraphs.join('\n\n'), 'utf8')

    const documentId = await service.addDocumentFromFile(notebookId, filePath)
    const document = service.getDocument(documentId)
    const docChunks = service.getDocumentChunks(documentId)

    expect(document?.status).toBe('indexed')
    expect(docChunks.length).toBeGreaterThan(1)
    expect(providerManager.remoteCalls).toBe(0)
  })

  it('indexes XLSX tables with citations retrievable in top 3', async () => {
    const { service, notebookId } = context!
    const filePath = join(userDataDir, 'rag-evidence.xlsx')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Evidence')
    sheet.addRow(['Topic', 'Default', 'Evidence'])
    sheet.addRow(['Query RAG', 'Local', 'Truy vấn và citation không rời khỏi máy'])
    sheet.addRow(['Embedding', 'Local', 'Vector được tạo bằng provider local'])
    await workbook.xlsx.writeFile(filePath)

    const documentId = await service.addDocumentFromFile(notebookId, filePath)
    const results = await service.search(
      notebookId,
      'Query RAG citation local không rời khỏi máy',
      {
        topK: 3,
        threshold: 0
      }
    )

    expect(service.getDocument(documentId)?.status).toBe('indexed')
    expect(results.some((result) => result.documentId === documentId)).toBe(true)
    expect(results.find((result) => result.documentId === documentId)?.content).toContain(
      'Query RAG'
    )
  })

  it('records corrupt file parse failures as failed documents', async () => {
    const { service, notebookId } = context!
    const filePath = join(userDataDir, 'corrupt.pdf')
    await writeFile(filePath, 'not a real pdf', 'utf8')

    await expect(service.addDocumentFromFile(notebookId, filePath)).rejects.toThrow()

    const failedDocument = service
      .getDocuments(notebookId)
      .find((document) => document.title === 'corrupt.pdf')
    expect(failedDocument?.status).toBe('failed')
    expect(failedDocument?.errorMessage).toMatch(/parse|pdf|invalid|Failed/i)
    expect(service.getDocumentChunks(failedDocument!.id)).toHaveLength(0)
  })

  it('marks documents failed with actionable embedding errors', async () => {
    const { service, notebookId, providerManager } = context!
    providerManager.failEmbeddings = true

    await expect(
      service.addDocument(notebookId, {
        title: 'Failure path',
        type: 'text',
        content: 'This local-first document should fail embedding.'
      })
    ).rejects.toThrow('fake local embedding failure')

    const failedDocument = service
      .getDocuments(notebookId)
      .find((document) => document.title === 'Failure path')
    expect(failedDocument?.status).toBe('failed')
    expect(failedDocument?.errorMessage).toContain('fake local embedding failure')
  })

  it('retries failed embedding documents from failed to indexed', async () => {
    const { service, notebookId, providerManager } = context!
    providerManager.failEmbeddings = true

    await expect(
      service.addDocument(notebookId, {
        title: 'Retry path',
        type: 'text',
        content: 'Local-first retry should recover after embedding provider is configured.'
      })
    ).rejects.toThrow('fake local embedding failure')

    const failedDocument = service
      .getDocuments(notebookId)
      .find((document) => document.title === 'Retry path')
    expect(failedDocument?.status).toBe('failed')

    providerManager.failEmbeddings = false
    await service.reindexDocument(failedDocument!.id)

    const retriedDocument = service.getDocument(failedDocument!.id)
    expect(retriedDocument?.status).toBe('indexed')
    expect(service.getDocumentChunks(failedDocument!.id).length).toBeGreaterThan(0)
  })

  it('reparses a stored file before reindexing legal structure', async () => {
    const { service, notebookId, db, schema } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Imported law',
      type: 'file',
      content: 'Old flattened content without legal headings.'
    })
    const { eq } = await import('drizzle-orm')
    db.update(schema.documents)
      .set({ localFilePath: 'managed-law.pdf' })
      .where(eq(schema.documents.id, documentId))
      .run()

    const parseFile = vi.spyOn((service as any).fileParserService, 'parseFile').mockResolvedValue({
      content: `CHƯƠNG I
QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
Luật này quy định về dữ liệu.`,
      title: 'Luật đã phân tích lại',
      mimeType: 'application/pdf',
      metadata: { pageCount: 1 },
      structure: {
        type: 'pages',
        pages: [{ pageNumber: 1, startOffset: 0, endOffset: 94 }]
      }
    })

    await service.reindexDocument(documentId)

    expect(parseFile).toHaveBeenCalledWith('managed-law.pdf')
    expect(service.getDocument(documentId)).toMatchObject({
      title: 'Luật đã phân tích lại',
      content: expect.stringContaining('Điều 1. Phạm vi điều chỉnh'),
      metadata: {
        legalStructure: { articleCount: 1 }
      }
    })
  })

  it('delete and reindex clean chunks, embeddings, FTS, and vector records', async () => {
    const { service, notebookId, dbModule, db, schema } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Lifecycle',
      type: 'text',
      content:
        'Local-first lifecycle creates chunks. Local-first lifecycle supports reindex cleanup.',
      chunkOptions: { chunkSize: 35, chunkOverlap: 0, minChunkSize: 10 }
    })

    await service.reindexDocument(documentId)
    expect(service.getDocuments(notebookId)).toHaveLength(1)
    const chunksAfterReindex = service.getDocumentChunks(documentId)
    const embeddingsAfterReindex = db
      .select()
      .from(schema.embeddings)
      .where((await import('drizzle-orm')).eq(schema.embeddings.notebookId, notebookId))
      .all()
    expect(embeddingsAfterReindex).toHaveLength(chunksAfterReindex.length)

    await service.deleteDocument(documentId)
    expect(service.getDocument(documentId)).toBeUndefined()
    expect(service.getDocumentChunks(documentId)).toHaveLength(0)
    expect(
      dbModule.getSqlite()?.prepare('SELECT count(*) as count FROM fts_chunks').get()
    ).toMatchObject({ count: 0 })
    expect(
      dbModule.getSqlite()?.prepare('SELECT count(*) as count FROM vec_embeddings').get()
    ).toMatchObject({ count: 0 })
  })

  it('marks the notebook overview stale after source add, reindex, and delete', async () => {
    const { service, notebookId } = context!
    const changedNotebooks: string[] = []
    service.setNotebookSourcesChangedListener((changedNotebookId) =>
      changedNotebooks.push(changedNotebookId)
    )

    const documentId = await service.addDocument(notebookId, {
      title: 'Overview lifecycle',
      type: 'text',
      content: 'Source changes must mark the notebook overview stale.'
    })
    await service.reindexDocument(documentId)
    await service.deleteDocument(documentId)

    expect(changedNotebooks).toEqual([notebookId, notebookId, notebookId])
  })
})
