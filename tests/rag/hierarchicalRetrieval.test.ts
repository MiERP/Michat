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

/**
 * Embedding giả: mỗi chủ đề là một chiều one-hot → cosine similarity xác định,
 * nhờ vậy tầng chọn tài liệu (doc-level) kiểm chứng được một cách tất định.
 */
function vectorFor(text: string): Float32Array {
  const vector = new Float32Array(1024)
  const lower = text.toLowerCase()

  if (lower.includes('hợp đồng')) vector[5] = 1
  if (lower.includes('bảng giá')) vector[6] = 1
  if (lower.includes('quy định')) vector[7] = 1
  if (vector.every((value) => value === 0)) vector[10] = 1

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

class FakeProviderManager {
  async getActiveEmbeddingProvider() {
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

const CONTRACT = [
  '# Hợp đồng ABC',
  '',
  '## 1. Phạm vi',
  'Phạm vi dịch vụ bao gồm tư vấn và triển khai hệ thống nội bộ theo quy định của bên A trong năm 2026.',
  'Bên B chịu trách nhiệm đào tạo nhân sự và bàn giao tài liệu kỹ thuật đầy đủ cho bên A.',
  '',
  '## 2. Termination',
  'Điều khoản chấm dứt hợp đồng khi bên A vi phạm nghĩa vụ thanh toán qua hai kỳ liên tiếp.',
  'Bên B có quyền tạm dừng dịch vụ và yêu cầu bồi thường theo mức phạt đã thoả thuận trong phụ lục.',
  '',
  '## 3. Bảo mật',
  'Thông tin bảo mật không được tiết lộ cho bên thứ ba nếu không có sự đồng ý bằng văn bản của bên còn lại.'
].join('\n')

const PRICING = [
  '# Bảng giá 2026',
  '',
  '## Quy định chung',
  'Bảng giá áp dụng theo quy định hiện hành và được điều chỉnh mỗi quý theo thoả thuận hai bên.',
  'Mọi thay đổi về giá phải được thông báo trước ba mươi ngày làm việc cho khách hàng.'
].join('\n')

describe('Metadata-aware hierarchical retrieval', () => {
  let context: any

  beforeEach(async () => {
    userDataDir = join(tmpdir(), `michat-hier-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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
      .values({ id: notebookId, title: 'Hier Test', createdAt: new Date(), updatedAt: new Date() })
      .run()

    context = {
      dbModule,
      schema,
      db,
      notebookId,
      service: new KnowledgeService(new FakeProviderManager() as never)
    }
  })

  afterEach(async () => {
    context?.dbModule.closeDatabase()
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
    vi.resetModules()
  })

  async function seedCorpus(): Promise<{ contractId: string; pricingId: string }> {
    const { service, notebookId } = context
    const chunkOptions = { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }

    const contractId = await service.addDocument(notebookId, {
      title: 'Hợp đồng ABC',
      type: 'text',
      content: CONTRACT,
      chunkOptions
    })
    const pricingId = await service.addDocument(notebookId, {
      title: 'Bảng giá 2026',
      type: 'text',
      content: PRICING,
      chunkOptions
    })

    return { contractId, pricingId }
  }

  it('writes a document-level vector for every indexed document', async () => {
    const { service, notebookId, dbModule } = await context
    const { contractId, pricingId } = await seedCorpus()

    const rows = dbModule
      .getSqlite()
      .prepare('SELECT document_id FROM vec_documents WHERE notebook_id = ?')
      .all(notebookId) as Array<{ document_id: string }>
    const documentIds = rows.map((row) => row.document_id).sort()

    expect(documentIds).toEqual([contractId, pricingId].sort())
    expect(await service.search(notebookId, 'bảng giá', { threshold: 0 })).toBeTruthy()
  })

  it('imports web content through canonical Markdown and structured indexes', async () => {
    const { service, notebookId, db, schema } = await context
    ;(service as any).webFetchService.fetchUrl = vi.fn().mockResolvedValue({
      title: 'Hướng dẫn thanh toán',
      description: 'Quy trình thanh toán trực tuyến',
      url: 'https://example.com/guide',
      mimeType: 'text/html',
      content: '# Hướng dẫn thanh toán\n\n## Điều kiện\nKhách hàng thanh toán trong vòng mười ngày.'
    })

    const documentId = await service.addDocumentFromUrl(notebookId, 'https://example.com/guide')
    const document = service.getDocument(documentId)
    expect(document).toMatchObject({
      type: 'url',
      sourceUri: 'https://example.com/guide',
      status: 'indexed'
    })
    expect((document.metadata as any).structure.sections).toHaveLength(2)

    const { eq } = await import('drizzle-orm')
    const sectionRows = db
      .select()
      .from(schema.sections)
      .where(eq(schema.sections.documentId, documentId))
      .all()
    expect(sectionRows.map((row: any) => row.title)).toContain('Điều kiện')
    expect(service.getDocumentChunks(documentId).length).toBeGreaterThan(0)
  })

  it('restricts retrieval to the documents selected by the doc-level stage', async () => {
    const { service, notebookId } = await context
    const { contractId, pricingId } = await seedCorpus()
    // Truy vấn chỉ có "hợp đồng": không tài liệu nào khác khớp từ khoá,
    // nên tập tài liệu chọn ra chỉ còn "Hợp đồng ABC".
    const query = 'hợp đồng'

    // Không bật tầng chọn tài liệu: nhánh vector vẫn trả về cả tài liệu khác
    const flatResults = await service.search(notebookId, query, { topK: 10, threshold: 0 })
    expect(flatResults.some((result: any) => result.documentId === pricingId)).toBe(true)

    // Bật tầng chọn tài liệu: chỉ "Hợp đồng ABC" vượt ngưỡng tương đồng tài liệu
    const hierarchicalResults = await service.search(notebookId, query, {
      topK: 10,
      threshold: 0,
      hierarchical: { enabled: true, docTopK: 5, threshold: 0.9 }
    })

    expect(hierarchicalResults.length).toBeGreaterThan(0)
    expect(hierarchicalResults.every((result: any) => result.documentId === contractId)).toBe(true)
  })

  it('runs document retrieval inside an explicit hard document scope', async () => {
    const { service, notebookId, dbModule } = await context
    const { contractId, pricingId } = await seedCorpus()

    // Cô lập tầng document: khi section vectors chưa phủ đủ, hệ thống phải
    // fallback ở section nhưng vẫn thu hẹp candidate bằng document retrieval.
    dbModule.getSqlite().prepare('DELETE FROM vec_sections').run()

    const results = await service.search(notebookId, 'hợp đồng', {
      topK: 10,
      threshold: 0,
      metadataFilter: { documentIds: [contractId, pricingId] },
      hierarchical: { enabled: true, docTopK: 1, threshold: 0.9 }
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result: any) => result.documentId === contractId)).toBe(true)
  })

  it('filters chunks by section path', async () => {
    const { service, notebookId } = await context
    await seedCorpus()

    const results = await service.search(notebookId, 'chấm dứt bồi thường quy định', {
      topK: 5,
      threshold: 0,
      metadataFilter: { sectionPath: ['Termination'] }
    })

    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.sectionPath).toContain('2. Termination')
    }
  })

  it('filters chunks by page range using indexed page metadata', async () => {
    const { service, notebookId, db, schema, dbModule } = await context
    const { contractId } = await seedCorpus()
    const { eq } = await import('drizzle-orm')

    const docChunks = service.getDocumentChunks(contractId)
    const sqlite = dbModule.getSqlite()

    // Gắn pageStart/pageEnd như loader PDF/PPT vẫn làm khi index
    db.update(schema.chunks)
      .set({ metadata: { pageStart: 1, pageEnd: 1 } })
      .where(eq(schema.chunks.id, docChunks[0].id))
      .run()
    db.update(schema.chunks)
      .set({ metadata: { pageStart: 7, pageEnd: 7 } })
      .where(eq(schema.chunks.id, docChunks[docChunks.length - 1].id))
      .run()

    // FTS text phải chứa từ khoá để có ứng viên cho tầng lọc
    for (const chunk of docChunks) {
      sqlite.prepare('DELETE FROM fts_chunks WHERE chunk_id = ?').run(chunk.id)
      sqlite
        .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
        .run(chunk.id, notebookId, 'truy vấn kiểm thử theo trang')
    }

    const results = await service.search(notebookId, 'truy vấn', {
      topK: 10,
      threshold: 0,
      metadataFilter: { pageRange: { from: 6, to: 9 } }
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.map((result: any) => result.chunkId)).toEqual([
      docChunks[docChunks.length - 1].id
    ])
  })

  it('expands a matched chunk to its whole section (small-to-big)', async () => {
    const { service, notebookId } = await context
    await seedCorpus()

    const results = await service.search(notebookId, 'chấm dứt hợp đồng', { topK: 1, threshold: 0 })
    const result = results.find((item: any) => item.matchedContent?.includes('chấm dứt'))

    expect(result).toBeTruthy()
    expect(result!.sectionPath).toContain('2. Termination')
    // Ngữ cảnh mở rộng phải chứa cả phần còn lại của mục, không chỉ chunk trúng
    expect(result!.content.length).toBeGreaterThan(result!.matchedContent!.length)
    expect(result!.content).toContain('bồi thường')
  })

  it('does not hide documents that have no document-level vector yet', async () => {
    const { service, notebookId, dbModule } = await context
    const { contractId, pricingId } = await seedCorpus()

    // Mô phỏng tài liệu cũ: chunk đã có nhưng chưa có vector cấp tài liệu
    dbModule.getSqlite().prepare('DELETE FROM vec_documents WHERE document_id = ?').run(pricingId)

    const results = await service.search(notebookId, 'bảng giá quy định', {
      topK: 5,
      threshold: 0,
      hierarchical: { enabled: true, docTopK: 5 }
    })

    // Nếu vẫn giới hạn theo doc index thì tài liệu này biến mất khỏi kết quả
    expect(results.some((result: any) => result.documentId === pricingId)).toBe(true)
    expect(
      dbModule.getSqlite().prepare('SELECT count(*) as c FROM vec_documents').get()
    ).toMatchObject({ c: 1 })
    expect(contractId).toBeTruthy()
  })

  it('unions keyword-matched documents into the document-level selection', async () => {
    const { service, notebookId } = await context

    await seedCorpus()
    // Khớp TỪ KHOÁ nhưng dưới ngưỡng tương đồng tài liệu
    await service.addDocument(notebookId, {
      title: 'Báo cáo nội bộ',
      type: 'text',
      content:
        '# Báo cáo nội bộ\n\nMọi thay đổi phải tuân theo quy định nội bộ của công ty và được lưu lại.',
      chunkOptions: { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }
    })
    // Không khớp từ khoá và cũng dưới ngưỡng tương đồng → phải bị loại
    await service.addDocument(notebookId, {
      title: 'Dự báo thời tiết',
      type: 'text',
      content:
        '# Dự báo thời tiết\n\nMiền Bắc có mưa rào rải rác vào buổi chiều, nhiệt độ giảm nhẹ về đêm.',
      chunkOptions: { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }
    })

    const hierarchicalResults = await service.search(notebookId, 'hợp đồng quy định', {
      topK: 10,
      threshold: 0,
      hierarchical: { enabled: true, docTopK: 4, threshold: 0.9 }
    })
    const hierarchicalTitles = hierarchicalResults.map((result: any) => result.documentTitle)

    // Tầng vector chỉ chọn "Hợp đồng ABC"; BM25 cấp tài liệu kéo thêm các tài liệu
    // có chứa "quy định" (Bảng giá, Báo cáo nội bộ) vào tập đã chọn.
    expect(hierarchicalTitles).toContain('Hợp đồng ABC')
    expect(hierarchicalTitles).toContain('Báo cáo nội bộ')
    expect(hierarchicalTitles).toContain('Bảng giá 2026')
    expect(hierarchicalTitles).not.toContain('Dự báo thời tiết')

    // Không bật tầng chọn: nhánh vector (threshold 0) vẫn trả về tài liệu không liên quan
    const flatResults = await service.search(notebookId, 'hợp đồng quy định', {
      topK: 10,
      threshold: 0
    })
    expect(flatResults.map((result: any) => result.documentTitle)).toContain('Dự báo thời tiết')
  })

  it('keeps working when the chunk-id filter is larger than the SQL parameter limit', async () => {
    const { service, notebookId } = await context

    const paragraphs = Array.from(
      { length: 700 },
      (_, index) => `Cau truy van so ${index}: noi dung kiem thu loc lon voi tu khoa truy van.`
    )
    const documentId = await service.addDocument(notebookId, {
      title: 'Tài liệu lớn',
      type: 'text',
      content: paragraphs.join('\n\n'),
      chunkOptions: { chunkSize: 60, chunkOverlap: 0, minChunkSize: 20 }
    })

    const chunkCount = service.getDocumentChunks(documentId).length
    expect(chunkCount).toBeGreaterThan(900)

    const results = await service.search(notebookId, 'truy van', {
      topK: 5,
      threshold: 0,
      metadataFilter: { documentIds: [documentId] }
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result: any) => result.documentId === documentId)).toBe(true)
    // Tài liệu lớn: index + embed nhiều lô (EmbeddingService chờ giữa các lô)
  }, 60000)

  it('does not leak knowledge-linked chunks outside the requested document/section scope', async () => {
    const { service, notebookId, db, schema } = await context
    const { contractId, pricingId } = await seedCorpus()

    const contractChunks = service.getDocumentChunks(contractId)
    const pricingChunks = service.getDocumentChunks(pricingId)
    // Chunk nằm trong mục Termination (chứa từ khoá truy vấn) và một chunk của Bảng giá.
    const terminationChunk = contractChunks.find((chunk: any) => chunk.content.includes('chấm dứt'))
    expect(terminationChunk).toBeTruthy()
    expect(pricingChunks.length).toBeGreaterThan(0)

    // Link tri thức: chunk Termination → chunk Bảng giá. Link expansion chỉ được
    // phép kéo Bảng giá vào khi KHÔNG có scope tường minh.
    db.insert(schema.knowledgeLinks)
      .values({
        id: `link_${Math.random().toString(16).slice(2)}`,
        notebookId,
        sourceDocumentId: contractId,
        targetDocumentId: pricingId,
        sourceChunkId: terminationChunk!.id,
        targetChunkId: pricingChunks[0].id,
        relationType: 'related',
        confidence: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .run()

    // Không scope: link expansion kéo chunk Bảng giá vào kết quả (hành vi mong muốn).
    const unscoped = await service.search(notebookId, 'chấm dứt hợp đồng', {
      topK: 10,
      threshold: 0
    })
    expect(unscoped.some((result: any) => result.documentId === pricingId)).toBe(true)

    // Scope theo tài liệu: Bảng giá không được lọt vào dù có link tri thức.
    const docScoped = await service.search(notebookId, 'chấm dứt hợp đồng', {
      topK: 10,
      threshold: 0,
      metadataFilter: { documentIds: [contractId] }
    })
    expect(docScoped.length).toBeGreaterThan(0)
    expect(docScoped.every((result: any) => result.documentId === contractId)).toBe(true)

    // Scope theo mục (sectionPath): chunk Bảng giá cũng không được lọt vào.
    const sectionScoped = await service.search(notebookId, 'chấm dứt bồi thường', {
      topK: 10,
      threshold: 0,
      metadataFilter: { sectionPath: ['Termination'] }
    })
    expect(sectionScoped.length).toBeGreaterThan(0)
    expect(
      sectionScoped.every((result: any) => result.sectionPath.includes('2. Termination'))
    ).toBe(true)
  })

  it('writes section records, section vectors and chunk sectionId on index', async () => {
    const { service, notebookId, db, schema, dbModule } = await context
    const { contractId } = await seedCorpus()

    const sectionRows = db
      .select()
      .from(schema.sections)
      .where((await import('drizzle-orm')).eq(schema.sections.documentId, contractId))
      .all()

    // Hợp đồng ABC: 1. Phạm vi, 2. Termination, 3. Bảo mật — H1 không có body nên bỏ qua.
    expect(sectionRows.map((row: any) => row.title).sort()).toEqual([
      '1. Phạm vi',
      '2. Termination',
      '3. Bảo mật'
    ])
    for (const row of sectionRows as any[]) {
      expect(row.headingPath[0]).toBe('Hợp đồng ABC')
      expect(row.content).toContain(row.title)
    }

    // Vector cấp mục phải phủ đủ số section của notebook.
    const sectionVectorCount = dbModule
      .getSqlite()
      .prepare('SELECT count(*) as c FROM vec_sections WHERE notebook_id = ?')
      .get(notebookId) as { c: number }
    expect(sectionVectorCount.c).toBeGreaterThanOrEqual(3)

    // Chunk trong mục có body được gán sectionId trỏ về section record đã tạo.
    const docChunks = service.getDocumentChunks(contractId)
    const sectionIds = new Set(sectionRows.map((row: any) => row.id))
    const linkedChunks = docChunks.filter((chunk: any) => chunk.sectionId)
    expect(linkedChunks.length).toBeGreaterThan(0)
    for (const chunk of linkedChunks as any[]) {
      expect(sectionIds.has(chunk.sectionId)).toBe(true)
    }
  })

  it('section tier restricts chunk retrieval to sections matched at section level', async () => {
    const { service, notebookId } = await context
    const { contractId } = await seedCorpus()

    // Query "chấm dứt hợp đồng" chỉ khớp vector với mục Termination của Hợp đồng.
    // Bật 3 tầng document → section → chunk với ngưỡng đủ cao (0.9 ⇔ similarity
    // >= 0.8) để loại mục/tài liệu không khớp chủ đề.
    const results = await service.search(notebookId, 'chấm dứt hợp đồng', {
      topK: 10,
      threshold: 0,
      hierarchical: { enabled: true, docTopK: 4, sectionTopK: 5, threshold: 0.9 }
    })

    expect(results.length).toBeGreaterThan(0)
    // Mọi kết quả phải nằm trong mục Termination của Hợp đồng — không lọt mục
    // khác hay tài liệu khác (tầng section đã thu hẹp candidate set).
    for (const result of results as any[]) {
      expect(result.documentId).toBe(contractId)
      expect(result.sectionPath).toContain('2. Termination')
    }
  })

  it('keeps section retrieval available when another document has stale section vectors', async () => {
    const { service, notebookId, dbModule } = await context
    const { contractId, pricingId } = await seedCorpus()
    dbModule.getSqlite().prepare('DELETE FROM vec_sections WHERE document_id = ?').run(pricingId)

    const results = await service.search(notebookId, 'chấm dứt hợp đồng', {
      topK: 10,
      threshold: 0,
      metadataFilter: { documentIds: [contractId] },
      hierarchical: { enabled: true, docTopK: 4, sectionTopK: 5, threshold: 0.9 }
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result: any) => result.sectionPath.includes('2. Termination'))).toBe(true)
  })
})
