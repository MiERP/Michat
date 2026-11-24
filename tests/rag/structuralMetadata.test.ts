import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkingService } from '../../src/main/services/ChunkingService'
import {
  extractSectionsFromMarkdown,
  flattenSectionsWithPath
} from '../../src/main/services/loaders/sections'
import { MarkdownNormalizer } from '../../src/main/services/MarkdownNormalizer'
import type { Database } from '../../src/main/db'
import type { KnowledgeService } from '../../src/main/services/KnowledgeService'
import type { EmbeddingResult } from '../../src/main/ai/types'

type DbModule = typeof import('../../src/main/db')
type SchemaModule = typeof import('../../src/main/db/schema')

type StructuralContext = {
  dbModule: DbModule
  schema: SchemaModule
  db: Database
  notebookId: string
  service: KnowledgeService
}

type CompactSectionMetadata = {
  title: string
  headingPath: string[]
}

type StructuralDocumentMetadata = {
  structure: {
    type: string
    sections: CompactSectionMetadata[]
  }
}

function sectionsOf(content: string) {
  return flattenSectionsWithPath(extractSectionsFromMarkdown(content))
}

describe('sections.extractSectionsFromMarkdown', () => {
  it('builds heading paths with offsets that match the content', () => {
    const content = [
      '# Hop dong ABC',
      '',
      '## 1. Pham vi',
      'noi dung',
      '',
      '## 2. Termination',
      'noi dung 2'
    ].join('\n')

    const flat = sectionsOf(content)

    expect(flat.map((section) => section.title)).toEqual([
      'Hop dong ABC',
      '1. Pham vi',
      '2. Termination'
    ])
    expect(flat[2].headingPath).toEqual(['Hop dong ABC', '2. Termination'])

    for (const section of flat) {
      const marker = `${'#'.repeat(section.level)} ${section.title}`
      expect(content.slice(section.startOffset, section.startOffset + marker.length)).toBe(marker)
    }
  })

  it('skips heading markers inside fenced code blocks', () => {
    const content = ['# Real Heading', '```sh', '# not a heading', '```', '## Second'].join('\n')

    expect(sectionsOf(content).map((section) => section.title)).toEqual(['Real Heading', 'Second'])
  })
})

describe('MarkdownNormalizer', () => {
  it('derives sections from content that already has headings', () => {
    const result = new MarkdownNormalizer().normalize({
      content: '# Title\n\n## Child\nbody',
      mimeType: 'text/markdown'
    })

    expect(result.structure?.type).toBe('sections')
    expect(result.structure?.sections?.length).toBe(1)
    expect(result.structure?.sections?.[0].children?.[0].title).toBe('Child')
  })

  it('inserts heading markers from loader sections and returns recomputed offsets', () => {
    const content = 'Title\nbody text\nChild\nchild body'
    const childOffset = content.indexOf('Child')
    const normalized = new MarkdownNormalizer().normalize({
      content,
      mimeType: 'text/markdown',
      structure: {
        type: 'sections',
        sections: [
          {
            level: 1,
            title: 'Title',
            content: '',
            startOffset: 0,
            endOffset: content.length,
            children: [
              {
                level: 2,
                title: 'Child',
                content: '',
                startOffset: childOffset,
                endOffset: content.length
              }
            ]
          }
        ]
      }
    })

    expect(normalized.content).toBe('# Title\nbody text\n## Child\nchild body')

    const flat = flattenSectionsWithPath(normalized.structure!.sections!)
    expect(flat[0].startOffset).toBe(0)
    expect(flat[1].headingPath).toEqual(['Title', 'Child'])
    expect(normalized.content.slice(flat[1].startOffset, flat[1].startOffset + 8)).toBe('## Child')
  })

  it('does not invent headings when loader offsets do not point at the title', () => {
    const content = 'plain text without headings'
    const normalized = new MarkdownNormalizer().normalize({
      content,
      mimeType: 'text/markdown',
      structure: {
        type: 'sections',
        sections: [{ level: 1, title: 'Missing', content: '', startOffset: 4, endOffset: 10 }]
      }
    })

    expect(normalized.content).toBe(content)
  })
})

describe('ChunkingService structural metadata', () => {
  it('maps chunk offsets back to the original content across newline collapsing', () => {
    const intro = 'MO DAU\n' + 'mo '.repeat(30)
    const bigGap = '\n\n\n\n\n' // 5 newline → tiền xử lý gộp còn 3, làm lệch offset phía sau
    const sectionOne = '# Muc Mot\n' + 'noi dung mot '.repeat(7)
    const gap = '\n\n\n'
    const sectionTwo = '# Muc Hai\n' + 'noi dung hai '.repeat(7)
    const original = intro + bigGap + sectionOne + gap + sectionTwo

    const chunks = new ChunkingService().chunk(
      original,
      {
        chunkSize: intro.length + 3 + sectionOne.length + 3,
        chunkOverlap: 0,
        minChunkSize: 10
      },
      { sections: sectionsOf(original) }
    )

    const second = chunks.find((chunk) => chunk.content.startsWith('# Muc Hai'))
    expect(second).toBeTruthy()
    expect(second?.metadata?.headingPath).toEqual(['Muc Hai'])
    expect(second?.metadata?.sectionTitle).toBe('Muc Hai')
    expect(chunks[0].metadata?.headingPath).toBeUndefined()
  })

  it('keeps chunk boundaries unchanged when structural metadata is attached', () => {
    const original = '# A\n' + 'alpha '.repeat(60) + '\n# B\n' + 'beta '.repeat(60)
    const chunking = new ChunkingService()
    const options = { chunkSize: 120, chunkOverlap: 0, minChunkSize: 10 }

    const withoutStructure = chunking.chunk(original, options)
    const withStructure = chunking.chunk(original, options, { sections: sectionsOf(original) })

    expect(withStructure.map((chunk) => chunk.content)).toEqual(
      withoutStructure.map((chunk) => chunk.content)
    )
    expect(withStructure.map((chunk) => chunk.startOffset)).toEqual(
      withoutStructure.map((chunk) => chunk.startOffset)
    )
  })

  it('attaches page ranges for paginated documents', () => {
    const page1 = 'trang mot '.repeat(10)
    const page2 = 'trang hai '.repeat(10)
    const content = `${page1}\n\n${page2}`

    const chunks = new ChunkingService().chunk(
      content,
      { chunkSize: page1.length + 2, chunkOverlap: 0, minChunkSize: 10 },
      {
        pages: [
          { pageNumber: 1, startOffset: 0, endOffset: page1.length },
          { pageNumber: 2, startOffset: page1.length + 2, endOffset: content.length }
        ]
      }
    )

    const secondPageChunk = chunks.find((chunk) => chunk.content.includes('trang hai'))
    expect(secondPageChunk?.metadata?.pageStart).toBe(2)
    expect(chunks[0].metadata?.pageStart).toBe(1)
  })
})

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

const CONTRACT = [
  '# Hợp đồng ABC',
  '',
  '## 1. Phạm vi',
  'Phạm vi dịch vụ bao gồm tư vấn và triển khai hệ thống nội bộ theo yêu cầu của bên A trong năm 2026.',
  'Bên B chịu trách nhiệm đào tạo nhân sự và bàn giao tài liệu kỹ thuật đầy đủ cho bên A.',
  '',
  '## 2. Termination',
  'Điều khoản chấm dứt hợp đồng khi bên A vi phạm nghĩa vụ thanh toán qua hai kỳ liên tiếp.',
  'Bên B có quyền tạm dừng dịch vụ và yêu cầu bồi thường theo mức phạt đã thoả thuận trong phụ lục.',
  '',
  '## 3. Bảo mật',
  'Thông tin bảo mật không được tiết lộ cho bên thứ ba nếu không có sự đồng ý bằng văn bản của bên còn lại.'
].join('\n')

describe('KnowledgeService structural retrieval', () => {
  let context: StructuralContext | undefined

  beforeEach(async () => {
    userDataDir = join(
      tmpdir(),
      `michat-structure-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
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
      .values({
        id: notebookId,
        title: 'Structure Test',
        createdAt: new Date(),
        updatedAt: new Date()
      })
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

  it('attaches heading paths to chunks and indexes them for keyword search', async () => {
    const { service, notebookId, dbModule } = context!

    const documentId = await service.addDocument(notebookId, {
      title: 'Hợp đồng ABC',
      type: 'text',
      content: CONTRACT,
      chunkOptions: { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }
    })

    const docChunks = service.getDocumentChunks(documentId)
    expect(docChunks.length).toBeGreaterThan(2)

    const terminationChunk = docChunks.find((chunk) => chunk.content.includes('chấm dứt hợp đồng'))
    expect(terminationChunk?.metadata?.headingPath).toEqual(['Hợp đồng ABC', '2. Termination'])
    expect(terminationChunk?.metadata?.sectionTitle).toBe('2. Termination')

    const scopeTitled = docChunks.filter((chunk) =>
      chunk.metadata?.headingPath?.includes('1. Phạm vi')
    )
    expect(scopeTitled.length).toBeGreaterThan(0)
    expect(scopeTitled[0].metadata.headingPath).toEqual(['Hợp đồng ABC', '1. Phạm vi'])

    const ftsRow = dbModule
      .getSqlite()
      .prepare('SELECT content FROM fts_chunks WHERE chunk_id = ?')
      .get(terminationChunk!.id) as { content: string }
    expect(ftsRow.content.startsWith('Hợp đồng ABC > 2. Termination')).toBe(true)
    expect(ftsRow.content).toContain('chấm dứt hợp đồng')

    const results = await service.search(notebookId, 'Termination', { topK: 3, threshold: 0 })
    expect(results.some((result) => result.sectionPath?.includes('2. Termination'))).toBe(true)

    const terminationResult = results.find((result) =>
      result.sectionPath?.includes('2. Termination')
    )
    expect(terminationResult?.pageNumber).toBeUndefined()
  })

  it('persists compact sections into documents.metadata', async () => {
    const { service, notebookId } = context!

    const documentId = await service.addDocument(notebookId, {
      title: 'Hợp đồng ABC',
      type: 'text',
      content: CONTRACT
    })

    const metadata = service.getDocument(documentId)!
      .metadata as unknown as StructuralDocumentMetadata
    expect(metadata.structure.type).toBe('sections')
    expect(metadata.structure.sections.map((section) => section.title)).toEqual([
      'Hợp đồng ABC',
      '1. Phạm vi',
      '2. Termination',
      '3. Bảo mật'
    ])
    expect(metadata.structure.sections[2].headingPath).toEqual(['Hợp đồng ABC', '2. Termination'])
  })

  it('backfills heading paths when reindexing chunks whose content is unchanged', async () => {
    const { service, notebookId, db, schema, dbModule } = context!
    const { eq } = await import('drizzle-orm')

    const documentId = await service.addDocument(notebookId, {
      title: 'Hợp đồng ABC',
      type: 'text',
      content: CONTRACT,
      chunkOptions: { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 }
    })

    // Mô phỏng dữ liệu cũ: chunk chưa có metadata cấu trúc, FTS chưa có heading path
    db.update(schema.chunks)
      .set({ metadata: null })
      .where(eq(schema.chunks.documentId, documentId))
      .run()

    const sqlite = dbModule.getSqlite()
    const legacyChunks = db
      .select({ id: schema.chunks.id, content: schema.chunks.content })
      .from(schema.chunks)
      .where(eq(schema.chunks.documentId, documentId))
      .all()
    for (const row of legacyChunks) {
      sqlite.prepare('DELETE FROM fts_chunks WHERE chunk_id = ?').run(row.id)
      sqlite
        .prepare('INSERT INTO fts_chunks (chunk_id, notebook_id, content) VALUES (?, ?, ?)')
        .run(row.id, notebookId, row.content)
    }

    const result = await service.reindexDocumentIncremental(
      documentId,
      notebookId,
      CONTRACT,
      { chunkSize: 120, chunkOverlap: 0, minChunkSize: 20 },
      { sections: sectionsOf(CONTRACT) }
    )

    expect(result.created).toBe(0)
    expect(result.reused).toBeGreaterThan(0)

    const backfilled = service
      .getDocumentChunks(documentId)
      .find((chunk) => chunk.content.includes('chấm dứt hợp đồng'))
    expect(backfilled?.metadata?.headingPath).toEqual(['Hợp đồng ABC', '2. Termination'])

    const ftsRow = sqlite
      .prepare('SELECT content FROM fts_chunks WHERE chunk_id = ?')
      .get(backfilled!.id) as { content: string }
    expect(ftsRow.content.startsWith('Hợp đồng ABC > 2. Termination')).toBe(true)
  })
})
