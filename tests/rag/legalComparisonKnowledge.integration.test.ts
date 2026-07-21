import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, rm } from 'fs/promises'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

class FakeProviderManager {
  async getActiveEmbeddingProvider() {
    return {
      createEmbedding: async () => ({
        embedding: new Float32Array(1024).fill(1),
        model: 'fake-local-embedding',
        dimensions: 1024,
        tokensUsed: 1
      }),
      createEmbeddings: async (texts: string[]) =>
        texts.map(() => ({
          embedding: new Float32Array(1024).fill(1),
          model: 'fake-local-embedding',
          dimensions: 1024,
          tokensUsed: 1
        })),
      getDefaultEmbeddingModel: () => 'fake-local-embedding'
    }
  }

  async getActiveRerankProvider() {
    return null
  }
}

type TestContext = Awaited<ReturnType<typeof createContext>>

async function createContext() {
  userDataDir = join(tmpdir(), `michat-legal-comparison-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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
    .values({ id: notebookId, title: 'Legal Comparison', createdAt: new Date(), updatedAt: new Date() })
    .run()

  return { dbModule, notebookId, service: new KnowledgeService(new FakeProviderManager() as never) }
}

async function cleanup(context: TestContext | undefined) {
  context?.dbModule.closeDatabase()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  vi.resetModules()
}

describe('Legal comparison knowledge integration', () => {
  let context: TestContext | undefined

  beforeEach(async () => {
    context = await createContext()
  })

  afterEach(async () => {
    await cleanup(context)
    context = undefined
  })

  it('persists verified legal metadata and returns it with article retrieval', async () => {
    const { service, notebookId } = context!
    const documentId = await service.addDocument(notebookId, {
      title: 'Luật thử nghiệm',
      type: 'text',
      content: 'Điều 15. Thời hạn nộp hồ sơ\n1. Doanh nghiệp phải nộp hồ sơ trong 10 ngày.',
      chunkOptions: { chunkSize: 400, chunkOverlap: 0, minChunkSize: 1 }
    })

    const updated = service.updateLegalDocumentMetadata(documentId, {
      documentNumber: '01/2026/QH15',
      documentType: 'law',
      issuer: 'Quốc hội',
      effectiveFrom: '2026-01-01',
      status: 'effective',
      amendsDocumentIds: [],
      replacesDocumentIds: [],
      repealedByDocumentIds: []
    })

    expect((updated.metadata as Record<string, any>).legalDocument).toMatchObject({
      documentNumber: '01/2026/QH15',
      status: 'effective'
    })

    const results = await service.search(notebookId, 'Điều 15 quy định gì?', {
      topK: 2,
      metadataFilter: { documentIds: [documentId] }
    })

    expect(results).toHaveLength(1)
    expect((results[0].documentMetadata as Record<string, any>).legalDocument).toMatchObject({
      effectiveFrom: '2026-01-01',
      status: 'effective'
    })
  })

  it('extracts metadata during indexing and resolves declared replacement by document number', async () => {
    const { service, notebookId } = context!
    const oldDocumentId = await service.addDocument(notebookId, {
      title: 'Luật cũ',
      type: 'text',
      content: `QUỐC HỘI
Số: 03/2020/QH14
Hà Nội, ngày 01 tháng 6 năm 2020
LUẬT CŨ
Điều 1. Phạm vi điều chỉnh
Luật này quy định nội dung cũ.`,
      chunkOptions: { chunkSize: 400, chunkOverlap: 0, minChunkSize: 1 }
    })
    const newDocumentId = await service.addDocument(notebookId, {
      title: 'Luật mới',
      type: 'text',
      content: `QUỐC HỘI
Số: 12/2026/QH15
Hà Nội, ngày 15 tháng 6 năm 2026
LUẬT MỚI
Điều 1. Phạm vi điều chỉnh
Luật này quy định nội dung mới.
Điều 30. Hiệu lực thi hành
Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2027 và thay thế Luật số 03/2020/QH14.`,
      chunkOptions: { chunkSize: 400, chunkOverlap: 0, minChunkSize: 1 }
    })

    const oldDocument = service.getDocument(oldDocumentId)!
    const newDocument = service.getDocument(newDocumentId)!
    const oldMetadata = oldDocument.metadata as Record<string, any>
    const newMetadata = newDocument.metadata as Record<string, any>

    expect(oldMetadata.legalDocument).toMatchObject({
      documentNumber: '03/2020/QH14',
      status: 'unknown'
    })
    expect(newMetadata.legalDocument).toMatchObject({
      documentNumber: '12/2026/QH15',
      effectiveFrom: '2027-01-01',
      status: 'unknown',
      replacesDocumentIds: [oldDocumentId]
    })
    expect(newMetadata.legalMetadataInspector.fields.effectiveFrom).toMatchObject({
      status: 'extracted',
      evidence: expect.objectContaining({ articleNumber: '30' })
    })
  })
})
