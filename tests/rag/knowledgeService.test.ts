import { writeFile } from 'fs/promises'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTempUserData, closeAndRemove } from '../helpers/tempUserData'
import ExcelJS from 'exceljs'
import type { DocumentMetadata, DocumentMetadataInspector } from '../../src/shared/legalMetadata'
import type { DocumentStructureLike } from '../../src/main/services/KnowledgeService'
import type { EmbeddingConfig, EmbeddingResult } from '../../src/main/ai/types'

type KnowledgeServiceInternals = {
  embeddingService: {
    embedBatch: (
      texts: string[],
      config?: EmbeddingConfig,
      onProgress?: (completed: number, total: number) => void
    ) => Promise<EmbeddingResult[]>
  }
}

type StoredDocumentMetadata = {
  documentMetadata: DocumentMetadata
  documentMetadataInspector: DocumentMetadataInspector
  structure?: DocumentStructureLike
}

type ChunkTableMetadata = {
  sheetName?: string
  rowRange?: [number, number]
}

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
  if (lower.includes('privacy') || lower.includes('riêng tư') || lower.includes('quyền riêng tư'))
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
  public embeddingDimensions = 1024

  private embeddingResult(text: string, config?: EmbeddingConfig): EmbeddingResult {
    const result = embedding(text, config)
    if (this.embeddingDimensions === result.dimensions) return result
    return {
      ...result,
      embedding: new Float32Array(this.embeddingDimensions),
      dimensions: this.embeddingDimensions
    }
  }

  async getEmbeddingProvider() {
    return {
      createEmbedding: async (text: string, config?: EmbeddingConfig) => {
        this.embeddingCalls.push(text)
        if (this.failEmbeddings) throw new Error('fake local embedding failure')
        return this.embeddingResult(text, config)
      },
      createEmbeddings: async (texts: string[], config?: EmbeddingConfig) => {
        this.embeddingCalls.push(...texts)
        if (this.failEmbeddings) throw new Error('fake local embedding failure')
        return texts.map((text) => this.embeddingResult(text, config))
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
  userDataDir = await createTempUserData('michat-rag')

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
  if (userDataDir) {
    await closeAndRemove(userDataDir, () => context?.dbModule.closeDatabase())
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

  it('rejects embedding models that are not 1024-dimensional before writing chunks', async () => {
    const { service, notebookId, providerManager } = context!
    providerManager.embeddingDimensions = 512

    await expect(
      service.addDocument(notebookId, {
        title: 'Wrong dimension',
        type: 'text',
        content: 'Local-first content that must not be indexed with a 512-dimension model.'
      })
    ).rejects.toThrow(/512-dimensional/)

    const failedDocument = service
      .getDocuments(notebookId)
      .find((document) => document.title === 'Wrong dimension')
    expect(failedDocument?.status).toBe('failed')
    expect(service.getDocumentChunks(failedDocument!.id)).toHaveLength(0)
  })

  it('retrieves the requested article chunk by query terms', async () => {
    const { service, notebookId } = context!

    await service.addDocument(notebookId, {
      title: '07_2022_QH15_luật sở hữu trí tuệ.pdf',
      type: 'text',
      content: [
        '# 07_2022_QH15_luật sở hữu trí tuệ',
        '',
        '### Điều 112a. Phản đối đơn đăng ký sở hữu công nghiệp',
        '',
        '1. Trước ngày ra quyết định cấp văn bằng bảo hộ, trong các thời hạn sau đây, bất kỳ người thứ ba nào cũng có quyền phản đối việc cấp văn bằng bảo hộ:',
        'a) Chín tháng kể từ ngày đơn đăng ký sáng chế được công bố;',
        'b) Bốn tháng kể từ ngày đơn đăng ký kiểu dáng công nghiệp được công bố;',
        'c) Năm tháng kể từ ngày đơn đăng ký nhãn hiệu được công bố;',
        'd) Ba tháng kể từ ngày đơn đăng ký chỉ dẫn địa lý được công bố.'
      ].join('\n'),
      chunkOptions: { chunkSize: 60, chunkOverlap: 0, minChunkSize: 10 }
    })
    await service.addDocument(notebookId, {
      title: '60_2024_QH15_luật dữ liệu.pdf',
      type: 'text',
      content: [
        '# 60_2024_QH15_luật dữ liệu',
        '',
        '### Điều 112a. Quy định dữ liệu',
        '',
        'Nội dung giả lập: thời hạn xử lý dữ liệu là năm tháng.'
      ].join('\n')
    })

    const firstClause = service.searchArticleChunks(
      notebookId,
      ['112a'],
      'Điều 112a Luật Sở hữu trí tuệ Chín tháng sáng chế',
      2
    )
    expect(firstClause.length).toBeGreaterThan(1)
    expect(firstClause[0].sectionPath?.join(' ')).toContain('112a')
    expect(firstClause.every((result) => result.documentTitle.includes('sở hữu trí tuệ'))).toBe(
      true
    )
    expect(firstClause.some((result) => result.content.includes('Chín tháng'))).toBe(true)
    // The successor clause must be attached even when it is not the top hit.
    expect(firstClause.some((result) => /Bốn tháng|Năm tháng/.test(result.content))).toBe(true)

    const direct = service.searchDirectEvidence(
      notebookId,
      'Điều 112a thời hạn phản đối nhãn hiệu là bao lâu',
      2
    )
    expect(direct.some((result) => /năm tháng/i.test(result.content))).toBe(true)
  })

  it('returns the complete article with overlapping chunks merged once', async () => {
    const { service, notebookId } = context!

    const documentId = await service.addDocument(notebookId, {
      title: '24_2018_QH14_luật an ninh mạng.pdf',
      type: 'text',
      content: [
        '# 24/2018/QH14 - Luật An ninh mạng',
        '',
        '### Điều 10. Hệ thống thông tin quan trọng về an ninh quốc gia',
        '',
        '1. Hệ thống thông tin quan trọng về an ninh quốc gia là hệ thống thông tin khi bị sự cố, xâm nhập, chiếm quyền điều khiển, làm sai lệch, gián đoạn, ngưng trệ, tê liệt, tấn công hoặc phá hoại sẽ xâm phạm nghiêm trọng an ninh mạng.',
        '2. Hệ thống thông tin quan trọng về an ninh quốc gia bao gồm:',
        'a) Hệ thống thông tin quân sự, an ninh, ngoại giao, cơ yếu;',
        'b) Hệ thống thông tin lưu trữ, xử lý thông tin thuộc bí mật nhà nước;',
        'c) Hệ thống thông tin phục vụ lưu giữ, bảo quản hiện vật, tài liệu có giá trị đặc biệt quan trọng;',
        'd) Hệ thống thông tin phục vụ bảo quản vật liệu, chất đặc biệt nguy hiểm;',
        'đ) Hệ thống thông tin phục vụ bảo quản, chế tạo, quản lý cơ sở vật chất đặc biệt quan trọng khác;',
        'e) Hệ thống thông tin quan trọng phục vụ hoạt động của cơ quan, tổ chức ở trung ương;',
        'g) Hệ thống thông tin quốc gia thuộc lĩnh vực năng lượng, tài chính, ngân hàng, viễn thông;',
        'h) Hệ thống điều khiển và giám sát tự động tại công trình quan trọng liên quan đến an ninh quốc gia.'
      ].join('\n'),
      chunkOptions: { chunkSize: 90, chunkOverlap: 30, minChunkSize: 10 }
    })

    const blocks = service.getArticleContext(notebookId, ['10'], {
      documentIds: [documentId],
      maxArticles: 1
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].sectionPath?.join(' ')).toContain('Điều 10')
    expect(blocks[0].content).toContain('a) Hệ thống thông tin quân sự')
    expect(blocks[0].content).toContain('h) Hệ thống điều khiển')
    expect(blocks[0].content.match(/Hệ thống thông tin quân sự/gu)).toHaveLength(1)
  })

  it('finds the exact definition clause when it starts in one chunk and ends in the next', async () => {
    const { service, notebookId } = context!

    const documentId = await service.addDocument(notebookId, {
      title: '60_2024_QH15_luật dữ liệu.pdf',
      type: 'text',
      content: [
        '# 60/2024/QH15 - Luật Dữ liệu',
        '',
        '### Điều 3. Giải thích từ ngữ',
        '',
        '5. Dữ liệu gốc là dữ liệu được tạo lập trong quá trình hoạt động của cơ quan, tổ chức, cá nhân.',
        '6. Dữ liệu quan trọng là dữ liệu có thể tác động đến quốc phòng, an ninh, đối ngoại, kinh tế vĩ mô, ổn định xã hội, sức khỏe và an toàn cộng đồng thuộc danh mục do Thủ tướng Chính phủ ban hành.',
        '7. Dữ liệu cốt lõi là dữ liệu quan trọng trực tiếp tác động đến quốc phòng, an ninh, đối ngoại.'
      ].join('\n'),
      chunkOptions: { chunkSize: 80, chunkOverlap: 30, minChunkSize: 10 }
    })

    // Guard the setup: the defining clause really must span two chunks,
    // otherwise the merge across a chunk boundary is not exercised.
    expect(
      service
        .getDocumentChunks(documentId)
        .some(
          (chunk) =>
            chunk.content.includes('Dữ liệu quan trọng là') &&
            chunk.content.includes('Thủ tướng Chính phủ ban hành')
        )
    ).toBe(false)

    const evidence = service.searchDefinitionEvidence(
      notebookId,
      'Luật Dữ liệu định nghĩa dữ liệu quan trọng là gì?',
      1
    )

    expect(evidence).toHaveLength(1)
    expect(evidence[0].sectionPath?.join(' ')).toContain('Điều 3')
    expect(evidence[0].content).toContain('Dữ liệu quan trọng là dữ liệu có thể tác động')
    expect(evidence[0].content).toContain('Thủ tướng Chính phủ ban hành')
    expect(evidence[0].content.match(/Dữ liệu quan trọng là/gu)).toHaveLength(1)
    // The defining clause keeps its source label so the model can quote the
    // numbering it is told to preserve.
    expect(evidence[0].content).toMatch(/\n?\s*6\.\s*Dữ liệu quan trọng là/u)
    // The block stops at the next numbered clause instead of carrying the
    // following definition into the prompt.
    expect(evidence[0].content).not.toContain('Dữ liệu cốt lõi là')
  })

  it('matches the exact article number and stays inside the requested document', async () => {
    const { service, notebookId } = context!

    const cyberId = await service.addDocument(notebookId, {
      title: '24_2018_QH14_luật an ninh mạng.pdf',
      type: 'text',
      content: [
        '# Luật An ninh mạng',
        '',
        '### Điều 1. Phạm vi điều chỉnh',
        '',
        '1. Luật này quy định về an ninh mạng.',
        '',
        '### Điều 10. Hệ thống thông tin quan trọng về an ninh quốc gia',
        '',
        '1. Hệ thống thông tin quan trọng về an ninh quốc gia gồm:',
        'a) Hệ thống thông tin quân sự.'
      ].join('\n')
    })
    const dataId = await service.addDocument(notebookId, {
      title: '60_2024_QH15_luật dữ liệu.pdf',
      type: 'text',
      content: [
        '# Luật Dữ liệu',
        '',
        '### Điều 10. Quy định về dữ liệu',
        '',
        '1. Nội dung về dữ liệu.'
      ].join('\n')
    })

    // "Điều 1" must not match "Điều 10".
    const firstArticle = service.getArticleContext(notebookId, ['1'], {
      documentIds: [cyberId],
      maxArticles: 2
    })
    expect(firstArticle).toHaveLength(1)
    expect(firstArticle[0].sectionPath?.join(' ')).toContain('Điều 1.')

    // Implicit expansion stays in the seed document even when another law has
    // an article with the same number.
    const sameArticleOtherLaw = service.getArticleContext(notebookId, ['10'], {
      documentIds: [dataId],
      maxArticles: 2
    })
    expect(sameArticleOtherLaw).toHaveLength(1)
    expect(sameArticleOtherLaw[0].documentId).toBe(dataId)
  })

  it('does not fall back to another law when the named law is not in the notebook', async () => {
    const { service, notebookId } = context!

    await service.addDocument(notebookId, {
      title: '24_2018_QH14_luật an ninh mạng.pdf',
      type: 'text',
      content: [
        '# Luật An ninh mạng',
        '',
        '### Điều 10. Hệ thống thông tin quan trọng',
        '',
        '1. Hệ thống thông tin quan trọng về an ninh quốc gia gồm:',
        'a) Hệ thống thông tin quân sự.'
      ].join('\n')
    })

    const blocks = service.getArticleContext(notebookId, ['10'], {
      query: 'Theo Luật Không Tồn Tại, Điều 10 quy định gì?',
      maxArticles: 1
    })

    expect(blocks).toEqual([])
  })

  it('resolves a law by its document number, not by an unrelated law', async () => {
    const { service, notebookId } = context!

    await service.addDocument(notebookId, {
      title: '07_2022_QH15_luật sở hữu trí tuệ.pdf',
      type: 'text',
      content: [
        '# 07/2022/QH15 - Luật Sở hữu trí tuệ',
        '',
        '### Điều 3. Hiệu lực thi hành',
        '',
        '1. Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2023.'
      ].join('\n')
    })
    const dataDocumentId = await service.addDocument(notebookId, {
      title: '60_2024_QH15_luật dữ liệu.pdf',
      type: 'text',
      content: [
        '# 60/2024/QH15 - Luật Dữ liệu',
        '',
        '### Điều 3. Hiệu lực thi hành',
        '',
        '1. Luật này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2025.'
      ].join('\n')
    })
    service.updateDocumentMetadata(dataDocumentId, { documentNumber: '60/2024/QH15' })

    const evidence = service.searchDirectEvidence(
      notebookId,
      'Theo 60/2024/QH15, luật có hiệu lực từ ngày nào?',
      4
    )

    expect(evidence.map((result) => result.documentTitle)).toEqual([
      expect.stringContaining('dữ liệu')
    ])
    expect(evidence[0]?.content).toContain('01 tháng 7 năm 2025')
  })

  it('resolves a law by its common abbreviation without a document number', async () => {
    const { service, notebookId } = context!

    await service.addDocument(notebookId, {
      title: '07_2022_QH15_luật sở hữu trí tuệ.pdf',
      type: 'text',
      content: [
        '# 07/2022/QH15 - Luật Sở hữu trí tuệ',
        '',
        '### Điều 3. Hiệu lực thi hành',
        '',
        '1. Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2023.'
      ].join('\n')
    })
    await service.addDocument(notebookId, {
      title: '60_2024_QH15_luật dữ liệu.pdf',
      type: 'text',
      content: [
        '# 60/2024/QH15 - Luật Dữ liệu',
        '',
        '### Điều 3. Hiệu lực thi hành',
        '',
        '1. Luật này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2025.'
      ].join('\n')
    })

    const evidence = service.searchDirectEvidence(
      notebookId,
      'Luật SHTT có hiệu lực từ ngày nào?',
      4
    )

    expect(evidence.map((result) => result.documentTitle)).toEqual([
      expect.stringContaining('sở hữu trí tuệ')
    ])
    expect(evidence[0]?.content).toContain('01 tháng 01 năm 2023')
  })

  it('resolves a "Bộ luật" title and keeps its article block', async () => {
    const { service, notebookId } = context!

    const documentId = await service.addDocument(notebookId, {
      title: 'Bộ luật Dân sự',
      type: 'text',
      content: [
        '# Bộ luật Dân sự',
        '',
        '### Điều 8. Nội dung thử',
        '',
        '1. Nội dung của Bộ luật Dân sự.'
      ].join('\n')
    })

    const blocks = service.getArticleContext(notebookId, ['8'], {
      query: 'Điều 8 Bộ luật Dân sự quy định gì?',
      documentIds: [documentId],
      maxArticles: 1
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].sectionPath?.join(' ')).toContain('Điều 8')
  })

  it('centres a long article block on the query-relevant clause', async () => {
    const { service, notebookId } = context!

    const filler = Array.from(
      { length: 40 },
      (_, index) =>
        `Quy định chung số ${index + 1}: nội dung không liên quan đến câu hỏi và không chứa từ khóa tìm kiếm.`
    ).join('\n\n')
    const documentId = await service.addDocument(notebookId, {
      title: 'Luật Dữ liệu',
      type: 'text',
      content: [
        '# Luật Dữ liệu',
        '',
        '### Điều 12. Thời hạn xử lý',
        '',
        filler,
        '',
        'Thời hạn giải quyết hồ sơ là bảy ngày làm việc kể từ ngày nhận đủ hồ sơ.',
        '',
        filler,
        '',
        'Kết thúc điều.'
      ].join('\n')
    })

    const blocks = service.getArticleContext(notebookId, ['12'], {
      query: 'Thời hạn giải quyết hồ sơ là bao lâu?',
      documentIds: [documentId],
      maxArticles: 1,
      maxChars: 1200
    })

    expect(blocks).toHaveLength(1)
    // The full block survives; the prompt window is what gets centred.
    expect(blocks[0].content).toContain('bảy ngày làm việc')
    expect(blocks[0].matchedContent).toContain('bảy ngày làm việc')
    expect(blocks[0].matchedContent).not.toContain('# Luật Dữ liệu')
    expect(blocks[0].matchedContent!.length).toBeLessThanOrEqual(1200)
  })

  it('extracts the main effective-date clause instead of a neighbour date', async () => {
    const { service, notebookId } = context!

    await service.addDocument(notebookId, {
      title: '07_2022_QH15_luật sở hữu trí tuệ.pdf',
      type: 'text',
      content: [
        '# 07_2022_QH15_luật sở hữu trí tuệ',
        '',
        '### Điều 3. Hiệu lực thi hành',
        '',
        '1. Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2023, trừ trường hợp quy định tại khoản 2 và khoản 3 Điều này.',
        '2. Quy định về nhãn hiệu là dấu hiệu âm thanh có hiệu lực thi hành từ ngày 14 tháng 01 năm 2022.',
        '3. Quy định về bảo hộ dữ liệu thử nghiệm dùng cho nông hóa phẩm có hiệu lực thi hành từ ngày 14 tháng 01 năm 2024.'
      ].join('\n')
    })
    await service.addDocument(notebookId, {
      title: '60_2024_QH15_luật dữ liệu.pdf',
      type: 'text',
      content: [
        '# 60_2024_QH15_luật dữ liệu',
        '',
        '### Điều 45. Hiệu lực thi hành',
        '',
        'Luật này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2025.'
      ].join('\n')
    })

    const direct = service.searchDirectEvidence(
      notebookId,
      'Luật Sở hữu trí tuệ số 07/2022/QH15 có hiệu lực từ ngày nào? Quy định về bảo hộ dữ liệu thử nghiệm dùng cho nông hóa phẩm có hiệu lực từ ngày nào?',
      3
    )

    expect(direct.length).toBeGreaterThan(0)
    expect(direct.every((result) => result.documentTitle.includes('sở hữu trí tuệ'))).toBe(true)
    expect(direct[0].content).toContain('01 tháng 01 năm 2023')
    expect(direct.some((result) => result.content.includes('14 tháng 01 năm 2024'))).toBe(true)
    expect(direct.some((result) => result.content.includes('01 tháng 7 năm 2025'))).toBe(false)
  })

  it('validates the query embedding directly with a single embedding call', async () => {
    const { service, notebookId, providerManager } = context!

    await service.addDocument(notebookId, {
      title: 'Query dimension check',
      type: 'text',
      content: 'Local-first embeddings stay on the machine and are validated before search.'
    })

    providerManager.embeddingCalls = []
    providerManager.embeddingDimensions = 768

    await expect(service.search(notebookId, 'local-first embeddings')).rejects.toThrow(/768/)

    // The old implementation issued a separate dimension probe plus the query
    // embedding. Retrieval must now validate the query result itself.
    expect(providerManager.embeddingCalls).toHaveLength(1)
  })

  it('removes section records when indexing fails after structural parsing', async () => {
    const { service, notebookId, db, schema } = context!
    ;(service as unknown as KnowledgeServiceInternals).embeddingService.embedBatch = vi
      .fn()
      .mockRejectedValue(new Error('simulated batch failure'))

    await expect(
      service.addDocument(notebookId, {
        title: 'Structured failure',
        type: 'text',
        content:
          '# Root\n\n## Evidence\n\nContent that creates a persisted section before embedding.'
      })
    ).rejects.toThrow(/simulated batch failure/)

    const failedDocument = service
      .getDocuments(notebookId)
      .find((document) => document.title === 'Structured failure')
    expect(failedDocument?.status).toBe('failed')
    expect(
      db
        .select()
        .from(schema.sections)
        .where((await import('drizzle-orm')).eq(schema.sections.documentId, failedDocument!.id))
        .all()
    ).toHaveLength(0)
  })

  it('indexes markdown files with Vietnamese tables and retrieves cited local-first chunks', async () => {
    const { service, notebookId, providerManager } = context!
    const filePath = join(userDataDir, 'local-first.md')
    await writeFile(
      filePath,
      '# Chính sách Local First\n\nMiChat giữ tài liệu, embeddings và truy vấn RAG trên máy.\n\n| Dữ liệu | Mặc định |\n| --- | --- |\n| Query RAG | Local |',
      'utf8'
    )

    const documentId = await service.addDocumentFromFile(notebookId, filePath)
    const results = await service.search(notebookId, 'local-first embeddings truy vấn trên máy', {
      topK: 3,
      threshold: 0,
      rerank: { enabled: true, heuristicFallback: true }
    })

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

  it('reparses the managed file when reindexing an existing document', async () => {
    const { service, notebookId } = context!
    const filePath = join(userDataDir, 'updated-source.txt')
    await writeFile(filePath, 'Original local-first source content.', 'utf8')

    const documentId = await service.addDocumentFromFile(notebookId, filePath)
    const localFilePath = service.getDocument(documentId)?.localFilePath
    expect(localFilePath).toBeTruthy()
    await writeFile(localFilePath!, 'Updated local-first source content.', 'utf8')

    await service.reindexDocument(documentId)

    expect(service.getDocument(documentId)?.content).toBe('Updated local-first source content.')
    expect(
      service.getDocumentChunks(documentId).some((chunk) => chunk.content.includes('Updated'))
    ).toBe(true)
  })

  it('clears stale legal metadata when reindexing a report', async () => {
    const { service, notebookId, db, schema } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Analysis report',
      type: 'text',
      content: 'BÁO CÁO PHÂN TÍCH: Nghị quyết 08-NQ/TW ban hành ngày 26 tháng 01 năm 2022.'
    })
    const { eq } = await import('drizzle-orm')
    db.update(schema.documents)
      .set({
        metadata: {
          documentMetadata: { issuedAt: '2022-01-26' },
          documentMetadataInspector: {
            version: 1,
            extractedAt: new Date().toISOString(),
            fields: { issuedAt: { value: '2022-01-26', status: 'user_corrected', confidence: 1 } }
          }
        }
      })
      .where(eq(schema.documents.id, documentId))
      .run()

    await service.reindexDocument(documentId)

    const metadata = service.getDocument(documentId)?.metadata as Record<string, unknown>
    expect(metadata.documentMetadata).toEqual({})
  })

  it('refreshes legal metadata without requesting embeddings or changing indexed chunks', async () => {
    const { service, notebookId, providerManager } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Resolution',
      type: 'text',
      content: 'CHÍNH PHỦ\nSố: 15/NQ-CP\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nNGHỊ QUYẾT'
    })
    const chunksBefore = service.getDocumentChunks(documentId)
    const embeddingCount = providerManager.embeddingCalls.length
    providerManager.failEmbeddings = true

    await service.refreshDocumentMetadata(documentId)

    expect(service.getDocument(documentId)?.metadata).toMatchObject({
      documentMetadata: { documentNumber: '15/NQ-CP' }
    })
    expect(service.getDocumentChunks(documentId)).toEqual(chunksBefore)
    expect(providerManager.embeddingCalls).toHaveLength(embeddingCount)
  })

  it('reconciles an interrupted indexing document without leaving searchable orphan indexes', async () => {
    const { service, notebookId, db, schema, dbModule } = context!
    const { eq } = await import('drizzle-orm')
    const documentId = await service.addDocument(notebookId, {
      title: 'Interrupted document',
      type: 'text',
      content: '# Mục\n\nNội dung phải bị dọn sau khi tiến trình index bị dừng.'
    })
    db.update(schema.documents)
      .set({ status: 'processing', errorMessage: null })
      .where(eq(schema.documents.id, documentId))
      .run()

    const result = await service.reconcileNotebookIndexes(notebookId)

    expect(result.interruptedDocuments).toBe(1)
    expect(service.getDocument(documentId)).toMatchObject({ status: 'failed' })
    expect(service.getDocumentChunks(documentId)).toHaveLength(0)
    expect(
      dbModule.getSqlite().prepare('SELECT count(*) AS count FROM fts_chunks').get()
    ).toMatchObject({ count: 0 })
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
    const storedMetadata = service.getDocument(documentId)!
      .metadata as unknown as StoredDocumentMetadata
    expect(storedMetadata.structure?.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Evidence' })])
    )
    const tableChunks = service.getDocumentChunks(documentId)
    expect(
      tableChunks.map(
        (chunk) => (chunk.metadata as unknown as ChunkTableMetadata | null)?.sheetName
      )
    ).toEqual(['Evidence', 'Evidence'])
    expect(
      tableChunks.map((chunk) => (chunk.metadata as unknown as ChunkTableMetadata | null)?.rowRange)
    ).toEqual([
      [2, 2],
      [3, 3]
    ])
    expect(results.some((result) => result.documentId === documentId)).toBe(true)
    expect(results.find((result) => result.documentId === documentId)?.content).toContain(
      'Query RAG'
    )
  })

  it('preserves extraction provenance for unchanged metadata and remembers explicit clearing', async () => {
    const { service, notebookId } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Synthetic resolution',
      type: 'text',
      content: 'CHÍNH PHỦ\nSố: 15/NQ-CP\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nNGHỊ QUYẾT'
    })
    const original = service.getDocument(documentId)!.metadata as unknown as StoredDocumentMetadata
    service.updateDocumentMetadata(documentId, {
      ...original.documentMetadata,
      issuer: 'Cơ quan đã xác nhận',
      documentNumber: ''
    })
    const saved = service.getDocument(documentId)!.metadata as unknown as StoredDocumentMetadata
    expect(saved.documentMetadataInspector.fields.documentType).toEqual(
      original.documentMetadataInspector.fields.documentType
    )
    service.refreshDocumentMetadata(documentId)
    const refreshed = service.getDocument(documentId)!.metadata as unknown as StoredDocumentMetadata
    expect(refreshed.documentMetadata.documentNumber).toBeUndefined()
    expect(refreshed.documentMetadata.issuer).toBe('Cơ quan đã xác nhận')
    const matches = await service.search(notebookId, 'NGHỊ QUYẾT', {
      threshold: 0,
      metadataFilter: { documentMetadata: { issuer: '  cơ quan đã xác nhận  ' } }
    })
    expect(matches.some((result) => result.documentId === documentId)).toBe(true)
    expect(
      await service.search(notebookId, 'NGHỊ QUYẾT', {
        threshold: 0,
        metadataFilter: { documentMetadata: { documentNumber: '15/NQ-CP' } }
      })
    ).toEqual([])
    await service.reindexDocument(documentId)
    expect(
      (service.getDocument(documentId)!.metadata as unknown as StoredDocumentMetadata)
        .documentMetadata.documentNumber
    ).toBeUndefined()
  })

  it('indexes legal metadata into FTS so document numbers are searchable automatically', async () => {
    const { service, notebookId } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Legal decree',
      type: 'text',
      content:
        'CHÍNH PHỦ\nSố: 15/2024/NĐ-CP\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nNGHỊ ĐỊNH\nĐiều 1. Quy định về đất đai.'
    })

    const results = await service.search(notebookId, '15/2024/NĐ-CP', { threshold: 0 })

    expect(results.some((result) => result.documentId === documentId)).toBe(true)
  })

  it('finds legal-looking files left without metadata by the old DOCX parser', async () => {
    const { service, notebookId, db, schema } = context!
    const legacyId = await service.addDocument(notebookId, {
      title: 'Legacy legal docx',
      type: 'text',
      content:
        '[Table: 2 rows]\n\nLUẬT\n\nCÔNG NGHIỆP CÔNG NGHỆ SỐ\n\nCăn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;\n\nQuốc hội ban hành Luật Công nghiệp công nghệ số.'
    })
    const { eq } = await import('drizzle-orm')
    db.update(schema.documents)
      .set({ localFilePath: 'C:/tmp/legacy-legal.docx' })
      .where(eq(schema.documents.id, legacyId))
      .run()

    expect(service.findDocumentsNeedingLegalMetadataReindex()).toContain(legacyId)
  })

  it('backfills legal metadata into chunks and FTS for documents indexed before the feature', async () => {
    const { service, notebookId, db, schema, dbModule } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Old legal decree',
      type: 'text',
      content:
        'CHÍNH PHỦ\nSố: 15/2024/NĐ-CP\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nNGHỊ ĐỊNH\nĐiều 1. Quy định về đất đai.'
    })
    const { eq } = await import('drizzle-orm')

    // Giả lập tài liệu index trước khi có metadata-aware retrieval.
    db.update(schema.chunks)
      .set({ metadata: {} })
      .where(eq(schema.chunks.documentId, documentId))
      .run()
    const sqlite = dbModule.getSqlite()!
    sqlite
      .prepare(
        'DELETE FROM fts_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)'
      )
      .run(documentId)

    const result = await service.backfillLegalMetadataToIndex(notebookId)

    expect(result.chunks).toBeGreaterThan(0)
    const chunks = service.getDocumentChunks(documentId)
    expect(chunks[0].metadata).toMatchObject({
      documentMetadata: { documentNumber: '15/2024/NĐ-CP' }
    })
    const results = await service.search(notebookId, '15/2024/NĐ-CP', { threshold: 0 })
    expect(results.some((item) => item.documentId === documentId)).toBe(true)
  })

  it('detects an automatic metadata filter from the question', async () => {
    const { service, notebookId } = context!
    const decreeId = await service.addDocument(notebookId, {
      title: 'Decree',
      type: 'text',
      content: 'Decree about land.'
    })
    const circularId = await service.addDocument(notebookId, {
      title: 'Circular',
      type: 'text',
      content: 'Circular about land.'
    })
    service.updateDocumentMetadata(decreeId, {
      documentNumber: '15/2024/NĐ-CP',
      documentType: 'Nghị định',
      issuer: 'Chính phủ'
    })
    service.updateDocumentMetadata(circularId, {
      documentNumber: '01/2024/TT-BTP',
      documentType: 'Thông tư',
      issuer: 'Bộ Tư pháp'
    })

    expect(service.detectMetadataFilter(notebookId, 'Tóm tắt Nghị định 15/2024/NĐ-CP')).toEqual({
      documentNumber: '15/2024/NĐ-CP'
    })
    expect(service.detectMetadataFilter(notebookId, 'Nghị định 15/NĐ-CP')).toEqual({
      documentNumber: '15/2024/NĐ-CP'
    })
    expect(service.detectMetadataFilter(notebookId, 'Thông tư của Bộ Tư pháp')).toEqual({
      documentType: 'Thông tư',
      issuer: 'Bộ Tư pháp'
    })
    expect(
      service.detectMetadataFilter(notebookId, 'So sánh Nghị định và Thông tư')
    ).toBeUndefined()
    expect(service.detectMetadataFilter(notebookId, 'Quy định về đất đai')).toBeUndefined()
  })

  it('filters retrieval by legal document metadata and excludes documents without it', async () => {
    const { service, notebookId } = context!
    const decreeId = await service.addDocument(notebookId, {
      title: 'Decree',
      type: 'text',
      content: 'Local-first decree content about privacy and embeddings.'
    })
    const circularId = await service.addDocument(notebookId, {
      title: 'Circular',
      type: 'text',
      content: 'Local-first circular content about privacy and embeddings.'
    })
    const plainId = await service.addDocument(notebookId, {
      title: 'No metadata',
      type: 'text',
      content: 'Local-first plain content about privacy and embeddings.'
    })

    service.updateDocumentMetadata(decreeId, {
      documentType: 'Nghị định',
      issuer: 'Chính phủ'
    })
    service.updateDocumentMetadata(circularId, {
      documentType: 'Thông tư',
      issuer: 'Bộ Tư pháp'
    })

    const byType = await service.search(notebookId, 'local-first privacy embeddings', {
      threshold: 0,
      metadataFilter: { documentMetadata: { documentType: '  nghị định  ' } }
    })
    expect(byType.length).toBeGreaterThan(0)
    expect(new Set(byType.map((result) => result.documentId))).toEqual(new Set([decreeId]))

    const byIssuer = await service.search(notebookId, 'local-first privacy embeddings', {
      threshold: 0,
      metadataFilter: { documentMetadata: { issuer: 'chính phủ' } }
    })
    expect(byIssuer.length).toBeGreaterThan(0)
    expect(byIssuer.every((result) => result.documentId === decreeId)).toBe(true)
    expect(
      byIssuer.some((result) => result.documentId === circularId || result.documentId === plainId)
    ).toBe(false)
  })

  it('uses inferred metadata as a preferred pass and falls back to the full explicit scope', async () => {
    const { service, notebookId } = context!
    const decreeId = await service.addDocument(notebookId, {
      title: 'Decree',
      type: 'text',
      content: 'Quy định về đất đai, quyền sử dụng đất và điều kiện cấp giấy chứng nhận.'
    })
    const reportId = await service.addDocument(notebookId, {
      title: 'Independent report',
      type: 'text',
      content: 'Quy định về đất đai, quyền sử dụng đất và điều kiện cấp giấy chứng nhận.'
    })
    service.updateDocumentMetadata(decreeId, { documentType: 'Nghị định', issuer: 'Chính phủ' })

    const outcome = await service.searchMetadataAware(
      notebookId,
      'Quy định về đất đai của Chính phủ',
      { topK: 5, threshold: 0, metadataAware: { enabled: true } }
    )

    expect(outcome.trace.plan.preferredConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'issuer', mode: 'preferred' })])
    )
    expect(outcome.trace.fallbackUsed).toBe(true)
    expect(outcome.results.map((result) => result.documentId)).toContain(decreeId)
    expect(outcome.results.map((result) => result.documentId)).toContain(reportId)
  })

  it('honours a unique document number as an inferred hard scope with an auditable trace', async () => {
    const { service, notebookId } = context!
    const decreeId = await service.addDocument(notebookId, {
      title: 'Decree',
      type: 'text',
      content: 'Nội dung riêng của nghị định về đất đai.'
    })
    const otherId = await service.addDocument(notebookId, {
      title: 'Other',
      type: 'text',
      content: 'Nội dung riêng của nghị định về đất đai.'
    })
    service.updateDocumentMetadata(decreeId, { documentNumber: '15/2024/NĐ-CP' })

    expect(
      context!.dbModule
        .getSqlite()
        .prepare(
          'SELECT value_display FROM document_metadata_values WHERE document_id = ? AND field = ?'
        )
        .get(decreeId, 'documentNumber')
    ).toMatchObject({ value_display: '15/2024/NĐ-CP' })

    const outcome = await service.searchMetadataAware(notebookId, 'Tóm tắt văn bản 15/2024/NĐ-CP', {
      topK: 5,
      threshold: 0
    })

    expect(outcome.trace.plan.hardConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'documentNumber', source: 'query-resolver' })
      ])
    )
    expect(outcome.trace.fallbackUsed).toBe(false)
    expect(outcome.results.length).toBeGreaterThan(0)
    expect(outcome.results.every((result) => result.documentId === decreeId)).toBe(true)
    expect(outcome.results.some((result) => result.documentId === otherId)).toBe(false)
  })

  it('resolves metadata through the relational index instead of rescanning document JSON', async () => {
    const { service, notebookId, db, schema } = context!
    const decreeId = await service.addDocument(notebookId, {
      title: 'Indexed decree',
      type: 'text',
      content: 'Nội dung duy nhất về quản lý dữ liệu công.'
    })
    service.updateDocumentMetadata(decreeId, { documentNumber: '15/2024/NĐ-CP' })

    const document = service.getDocument(decreeId)!
    db.update(schema.documents)
      .set({ metadata: { ...(document.metadata || {}), documentMetadata: {} } })
      .where((await import('drizzle-orm')).eq(schema.documents.id, decreeId))
      .run()

    const outcome = await service.searchMetadataAware(notebookId, 'Văn bản 15/2024/NĐ-CP', {
      topK: 3,
      threshold: 0
    })

    expect(outcome.trace.plan.hardConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'documentNumber', source: 'query-resolver' })
      ])
    )
    expect(outcome.results.length).toBeGreaterThan(0)
    expect(outcome.results.every((result) => result.documentId === decreeId)).toBe(true)
  })

  it('rejects a corrupt PDF before creating a document row', async () => {
    const { service, notebookId } = context!
    const filePath = join(userDataDir, 'corrupt.pdf')
    await writeFile(filePath, 'not a real pdf', 'utf8')

    await expect(service.addDocumentFromFile(notebookId, filePath)).rejects.toThrow(
      /does not match/i
    )

    expect(
      service.getDocuments(notebookId).some((document) => document.title === 'corrupt.pdf')
    ).toBe(false)
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

  it('deleting a notebook removes all levels of its vector index', async () => {
    const { service, notebookId, dbModule } = context!
    await service.addDocument(notebookId, {
      title: 'Notebook deletion',
      type: 'text',
      content:
        '# Local-first\n\n## Privacy\nLocal-first documents stay on the machine and support private embedding and retrieval.'
    })
    const sqlite = dbModule.getSqlite()!
    expect(
      sqlite.prepare('SELECT * FROM vec_sections WHERE notebook_id = ?').all(notebookId).length
    ).toBeGreaterThan(0)
    const { deleteNotebook } = await import('../../src/main/db/queries')
    await deleteNotebook(notebookId)
    for (const table of ['vec_sections', 'vec_documents', 'vec_embeddings', 'fts_chunks']) {
      expect(
        sqlite.prepare(`SELECT * FROM ${table} WHERE notebook_id = ?`).all(notebookId)
      ).toEqual([])
    }
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
})
