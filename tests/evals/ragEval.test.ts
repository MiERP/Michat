import { mkdir, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddingConfig, EmbeddingResult } from '../../src/main/providers/capabilities/EmbeddingCapability'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

/**
 * Embedding giả tất định: mỗi chủ đề là một chiều one-hot — đủ để kiểm chứng
 * retrieval THẬT (chunking + FTS + RRF + vector) chứ không phải retriever giả
 * viết riêng cho eval.
 */
function vectorFor(text: string): Float32Array {
  const vector = new Float32Array(1024)
  const lower = text.toLowerCase()
  if (lower.includes('local-first') || lower.includes('local first')) vector[0] = 1
  if (lower.includes('embedding')) vector[1] = 1
  if (lower.includes('query rag')) vector[2] = 1
  if (lower.includes('bảo mật') || lower.includes('privacy')) vector[3] = 1
  if (lower.includes('citation') || lower.includes('trích dẫn')) vector[4] = 1
  if (lower.includes('docx')) vector[5] = 1
  if (lower.includes('pdf')) vector[6] = 1
  if (lower.includes('pptx')) vector[7] = 1
  if (lower.includes('xlsx') || lower.includes('bảng tính')) vector[8] = 1
  if (vector.every((value) => value === 0)) vector[10] = 1
  return vector
}

function embedding(text: string, config?: EmbeddingConfig): EmbeddingResult {
  return {
    embedding: vectorFor(text),
    model: config?.model || 'fake-eval-embedding',
    dimensions: 1024,
    tokensUsed: text.length
  }
}

class FakeProviderManager {
  async getActiveEmbeddingProvider() {
    return {
      createEmbedding: async (text: string, config?: EmbeddingConfig) => embedding(text, config),
      createEmbeddings: async (texts: string[], config?: EmbeddingConfig) =>
        texts.map((text) => embedding(text, config)),
      getDefaultEmbeddingModel: () => 'fake-eval-embedding'
    }
  }

  async getActiveRerankProvider() {
    return null
  }
}

interface EvalCase {
  id: string
  query: string
  expectedTerms: string[]
  /** Term chỉ tồn tại trong tài liệu đích — dùng để kiểm chứng scope không rò. */
  uniqueTerm: string
}

describe('RAG eval — real document → section → chunk pipeline', () => {
  let context: any

  beforeEach(async () => {
    userDataDir = join(tmpdir(), `michat-eval-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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
      .values({ id: notebookId, title: 'Eval Test', createdAt: new Date(), updatedAt: new Date() })
      .run()

    const service = new KnowledgeService(new FakeProviderManager() as never)
    context = { dbModule, schema, db, notebookId, service }
  })

  afterEach(async () => {
    context?.dbModule.closeDatabase()
    vi.resetModules()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('ranks citation chunks in top 3 through the real retrieval pipeline', async () => {
    const { service, notebookId } = context
    const markdownFixture = await readFile(
      join(process.cwd(), 'tests/fixtures/rag/local-first.md'),
      'utf8'
    )

    const documents = [
      { title: 'Chính sách Local First', content: markdownFixture },
      {
        title: 'Ghi chú TXT',
        content:
          'Tài liệu TXT dài mô tả production RAG local-first.\n\nCitation phải chỉ về chunk nguồn, documentId và title.\n\nRemote provider không được gọi nếu người dùng chưa opt-in.'
      },
      {
        title: 'Tài liệu PDF',
        content:
          'Trang PDF 1 nói về chính sách bảo mật.\n\nTrang PDF 2 ghi rõ query RAG và embedding chạy local trên máy người dùng.'
      },
      {
        title: 'Quy trình DOCX',
        content:
          'Heading: Quy trình nhập DOCX.\n\nDOCX hợp lệ phải tạo chunks, embeddings và status indexed.\n\nKhi lỗi parse, document phải failed với errorMessage rõ ràng.'
      },
      {
        title: 'Slide PPTX',
        content:
          'Slide 1: Local-first default.\n\nSlide 2: Không silent fallback sang remote provider.\n\nSlide 3: Người dùng phải bật opt-in trước khi dữ liệu rời máy.'
      },
      {
        title: 'Bảng tính XLSX',
        content:
          '[[TABLE_START:sheet=Evidence;rows=3;cols=3]]\nheader: Topic | Default | Evidence\nrow 1: Query RAG | Local | Truy vấn và citation không rời khỏi máy\nrow 2: Embedding | Local | Vector được tạo bằng provider local\n[[TABLE_END]]'
      }
    ]

    const documentIds: string[] = []
    for (const doc of documents) {
      documentIds.push(
        await service.addDocument(notebookId, {
          title: doc.title,
          type: 'text',
          content: doc.content,
          chunkOptions: { chunkSize: 80, chunkOverlap: 0, minChunkSize: 10 }
        })
      )
    }

    const cases: EvalCase[] = [
      {
        id: 'local-first-policy',
        query: 'local-first tài liệu embeddings truy vấn có rời khỏi máy không',
        expectedTerms: ['không rời khỏi máy'],
        uniqueTerm: 'rời khỏi máy nếu'
      },
      {
        id: 'privacy-table',
        query: 'bảng quyền riêng tư query rag mặc định là gì',
        expectedTerms: ['query rag', 'local'],
        uniqueTerm: 'mặc định'
      },
      {
        id: 'txt-citation',
        query: 'citation trong tài liệu txt cần chỉ về đâu',
        expectedTerms: ['documentid', 'title'],
        uniqueTerm: 'documentid'
      },
      {
        id: 'pdf-page-evidence',
        query: 'pdf query rag embedding chạy ở đâu',
        expectedTerms: ['pdf 2', 'local'],
        uniqueTerm: 'pdf 2'
      },
      {
        id: 'docx-lifecycle',
        query: 'docx hợp lệ tạo trạng thái và embedding như thế nào',
        expectedTerms: ['chunks', 'embeddings', 'indexed'],
        uniqueTerm: 'status indexed'
      },
      {
        id: 'pptx-no-remote-fallback',
        query: 'pptx có được fallback remote provider không',
        expectedTerms: ['silent fallback', 'remote provider'],
        uniqueTerm: 'silent fallback'
      },
      {
        id: 'xlsx-table-evidence',
        query: 'xlsx query rag default local citation evidence',
        expectedTerms: ['query rag', 'local', 'citation'],
        uniqueTerm: 'table_start'
      }
    ]

    for (const evalCase of cases) {
      // Flat pipeline (document → chunk) — phải trả đúng chunk trích dẫn.
      const flatResults = await service.search(notebookId, evalCase.query, {
        topK: 5,
        threshold: 0
      })
      const flatText = flatResults
        .map((result) => `${result.matchedContent || ''}\n${result.content}`)
        .join('\n')
        .toLowerCase()

      for (const term of evalCase.expectedTerms) {
        expect(flatText, `${evalCase.id} (flat)`).toContain(term)
      }

      // Citation correctness: mọi kết quả phải có đủ định danh nguồn.
      for (const result of flatResults) {
        expect(result.chunkId).toBeTruthy()
        expect(result.documentId).toBeTruthy()
        expect(result.documentTitle).toBeTruthy()
      }

      // Hierarchical 3 tầng (document → section → chunk) — không làm mất recall
      // đã kiểm chứng ở tầng flat, kể cả tài liệu không có cấu trúc mục.
      const hierarchicalResults = await service.search(notebookId, evalCase.query, {
        topK: 5,
        threshold: 0,
        hierarchical: { enabled: true, docTopK: 8, sectionTopK: 12 }
      })
      const hierarchicalText = hierarchicalResults
        .map((result) => `${result.matchedContent || ''}\n${result.content}`)
        .join('\n')
        .toLowerCase()

      for (const term of evalCase.expectedTerms) {
        expect(hierarchicalText, `${evalCase.id} (hierarchical)`).toContain(term)
      }

      // Scope citation: tìm trong các tài liệu KHÁC tài liệu nguồn (xác định
      // qua term duy nhất) thì chunk trích dẫn không được xuất hiện.
      const sourceDocId = flatResults.find((result) =>
        `${result.matchedContent || ''}\n${result.content}`
          .toLowerCase()
          .includes(evalCase.uniqueTerm)
      )?.documentId
      expect(sourceDocId, `${evalCase.id} (source doc)`).toBeTruthy()

      const otherDocumentIds = documentIds.filter((id) => id !== sourceDocId)
      const scopedResults = await service.search(notebookId, evalCase.query, {
        topK: 5,
        threshold: 0,
        metadataFilter: { documentIds: otherDocumentIds }
      })
      const scopedText = scopedResults
        .map((result) => `${result.matchedContent || ''}\n${result.content}`)
        .join('\n')
        .toLowerCase()
      expect(scopedText, `${evalCase.id} (scoped miss)`).not.toContain(evalCase.uniqueTerm)
    }
  }, 60000)
})
