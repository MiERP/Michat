import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type {
  EmbeddingConfig,
  EmbeddingResult
} from '../../src/main/providers/capabilities/EmbeddingCapability'
import { buildLegalDocumentMetadata } from '../../src/main/services/LegalComparisonService'
import type {
  LegalReasoningEvidence,
  LegalReasoningSeed
} from '../../src/main/services/legalGraph/LegalReasoningService'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock
}))

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

interface EvidenceRow {
  id: string
  document_id: string
  chunk_index: number
  content: string
  title: string
}

function createEvidenceLoader(database: Database.Database) {
  return (notebookId: string, chunkIds: string[]): LegalReasoningEvidence[] => {
    if (chunkIds.length === 0) return []
    const placeholders = chunkIds.map(() => '?').join(', ')
    const rows = database
      .prepare(
        'SELECT c.id, c.document_id, c.chunk_index, c.content, d.title ' +
          'FROM chunks c JOIN documents d ON d.id = c.document_id ' +
          'WHERE c.notebook_id = ? AND c.id IN (' +
          placeholders +
          ')'
      )
      .all(notebookId, ...chunkIds) as EvidenceRow[]
    return rows.map((row) => ({
      notebookId,
      documentId: row.document_id,
      documentTitle: row.title,
      chunkId: row.id,
      chunkIndex: row.chunk_index,
      content: row.content,
      score: 0
    }))
  }
}

function embedding(text: string, config?: EmbeddingConfig): EmbeddingResult {
  const vector = new Float32Array(1024)
  vector[0] = 1
  return {
    embedding: vector,
    model: config?.model || 'fake-local-embedding',
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
      getDefaultEmbeddingModel: () => 'fake-local-embedding'
    }
  }

  async getActiveRerankProvider() {
    return null
  }

  async getActiveChatLanguageModel() {
    return {
      model: { modelId: 'local-runtime-test' } as never,
      provenance: 'llama:local-runtime-test'
    }
  }
}

const lawText = `QU\u1ed0C H\u1ed8I
S\u1ed1: 07/2022/QH15

LU\u1eacT

CH\u01af\u01a0NG I
QUY \u0110\u1ecaNH CHUNG
\u0110i\u1ec1u 15. Th\u1eddi h\u1ea1n n\u1ed9p h\u1ed3 s\u01a1
1. Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1 trong 10 ng\u00e0y.
\u0110i\u1ec1u 16. Ch\u1ebf t\u00e0i ch\u1eadm n\u1ed9p
1. H\u00e0nh vi ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb ph\u1ea1t ti\u1ec1n.`

type Context = Awaited<ReturnType<typeof createContext>>

async function createContext() {
  userDataDir = join(
    tmpdir(),
    `michat-legal-graph-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
  await mkdir(userDataDir, { recursive: true })
  const dbModule = await import('../../src/main/db')
  const schema = await import('../../src/main/db/schema')
  const { KnowledgeService } = await import('../../src/main/services/KnowledgeService')
  const { LegalGraphRepository } =
    await import('../../src/main/services/legalGraph/LegalGraphRepository')
  const { LegalGraphWorker, prepareLegalGraphSource } =
    await import('../../src/main/services/legalGraph/LegalGraphWorker')
  const { LegalReasoningService } =
    await import('../../src/main/services/legalGraph/LegalReasoningService')

  dbModule.initDatabase()
  dbModule.runMigrations()
  dbModule.initExtensions()
  const notebookId = `notebook-${Math.random().toString(16).slice(2)}`
  dbModule
    .getDatabase()
    .insert(schema.notebooks)
    .values({ id: notebookId, title: 'Legal graph', createdAt: new Date(), updatedAt: new Date() })
    .run()

  const repository = new LegalGraphRepository(dbModule.getSqlite()!, {
    model: '',
    extractorVersion: '2',
    promptVersion: '1',
    ontologyVersion: '1'
  })
  const providerManager = new FakeProviderManager()
  const service = new KnowledgeService(providerManager as never, repository)
  const worker = new LegalGraphWorker({
    repository,
    providerManager: providerManager as never,
    sourceLoader: (documentId) => {
      const document = service.getDocument(documentId)
      return document
        ? prepareLegalGraphSource(document, service.getDocumentChunks(documentId))
        : undefined
    }
  })
  const reasoning = new LegalReasoningService(
    repository,
    createEvidenceLoader(dbModule.getSqlite()!)
  )
  return { dbModule, notebookId, repository, service, worker, reasoning }
}

async function addLegalDocument(context: Context): Promise<string> {
  return context.service.addDocument(context.notebookId, {
    title: 'Deadline law',
    type: 'text',
    content: lawText,
    chunkOptions: { chunkSize: 200, chunkOverlap: 0, minChunkSize: 1 }
  })
}

function seedReadyGraph(context: Context, documentId: string): void {
  const chunk = context.service
    .getDocumentChunks(documentId)
    .find((item) => item.metadata?.kind === 'legal-content')!
  context.repository.replaceDocumentGraph(
    documentId,
    {
      nodes: [
        {
          localId: 'article',
          nodeType: 'article',
          canonicalKey: `${documentId}:article:15`,
          label: 'Article 15',
          aliases: [],
          chunkId: chunk.id,
          articleNumber: '15'
        },
        {
          localId: 'action',
          nodeType: 'action',
          canonicalKey: `${documentId}:action:file`,
          label: 'File dossier',
          aliases: [],
          chunkId: chunk.id
        }
      ],
      relations: [
        {
          sourceLocalId: 'article',
          targetLocalId: 'action',
          relationType: 'requires',
          evidenceChunkId: chunk.id,
          evidenceText: 'ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1',
          evidenceStartOffset: chunk.startOffset!,
          evidenceEndOffset: chunk.startOffset! + 14,
          confidence: 0.9
        }
      ],
      sourceUnitCount: 1,
      processedUnitCount: 1
    },
    {
      model: 'llama:local-model',
      extractorVersion: '2',
      promptVersion: '1',
      ontologyVersion: '1'
    }
  )
}

describe('KnowledgeService legal graph integration', () => {
  let context: Context

  beforeEach(async () => {
    generateTextMock.mockReset()
    generateTextMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const nodes: Array<{ localId: string; type: string; label: string; aliases: string[] }> = []
      const relations: Array<{
        source: string
        target: string
        type: string
        confidence: number
        evidenceText: string
      }> = []

      if (prompt.includes('ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1')) {
        nodes.push(
          {
            localId: 'subject-business',
            type: 'subject',
            label: 'Doanh nghi\u1ec7p',
            aliases: []
          },
          {
            localId: 'action-file',
            type: 'action',
            label: 'n\u1ed9p h\u1ed3 s\u01a1',
            aliases: []
          }
        )
        relations.push({
          source: 'subject-business',
          target: 'action-file',
          type: 'requires',
          confidence: 0.94,
          evidenceText: 'ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1'
        })
      }
      if (prompt.includes('b\u1ecb ph\u1ea1t ti\u1ec1n')) {
        if (!nodes.some((node) => node.localId === 'action-file')) {
          nodes.push({
            localId: 'action-file',
            type: 'action',
            label: 'n\u1ed9p h\u1ed3 s\u01a1',
            aliases: []
          })
        }
        nodes.push({
          localId: 'sanction-late',
          type: 'sanction',
          label: 'ph\u1ea1t ti\u1ec1n do ch\u1eadm n\u1ed9p',
          aliases: []
        })
        relations.push({
          source: 'action-file',
          target: 'sanction-late',
          type: 'sanction_for',
          confidence: 0.92,
          evidenceText: 'b\u1ecb ph\u1ea1t ti\u1ec1n'
        })
      }
      return { experimental_output: { nodes, relations } }
    })
    context = await createContext()
  })

  afterEach(async () => {
    context.dbModule.closeDatabase()
    await rm(userDataDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('finishes indexing before graph extraction and enqueues one job', async () => {
    const documentId = await addLegalDocument(context)
    const legalChunk = context.service
      .getDocumentChunks(documentId)
      .find((chunk) => chunk.metadata?.kind === 'legal-content')!

    expect(context.service.getDocument(documentId)?.status).toBe('indexed')
    expect(context.repository.getJob(documentId)?.status).toBe('pending')
    expect(legalChunk.metadata?.legalContext?.modalities).toEqual([
      expect.objectContaining({
        type: 'obligation',
        evidenceText: 'ph\u1ea3i',
        startOffset: lawText.indexOf('ph\u1ea3i')
      })
    ])
  })

  it('uses one canonical graph job and status for duplicate source variants', async () => {
    const canonicalDocumentId = await addLegalDocument(context)
    const duplicateDocumentId = await context.service.addDocument(context.notebookId, {
      title: 'Deadline law.pdf',
      type: 'text',
      content: lawText,
      chunkOptions: { chunkSize: 200, chunkOverlap: 0, minChunkSize: 1 }
    })

    expect(context.service.getDocument(duplicateDocumentId)?.metadata).toMatchObject({
      canonicalGraphDocumentId: canonicalDocumentId
    })
    expect(context.repository.getJob(canonicalDocumentId)?.status).toBe('pending')
    expect(context.repository.getJob(duplicateDocumentId)).toBeUndefined()

    seedReadyGraph(context, canonicalDocumentId)
    expect(context.service.getLegalGraphStatus(duplicateDocumentId).status).toBe('ready')

    context.service.retryLegalGraph(duplicateDocumentId)
    expect(context.repository.getJob(canonicalDocumentId)?.status).toBe('pending')
  })

  it('reindex marks graph pending without exposing stale paths', async () => {
    const documentId = await addLegalDocument(context)
    seedReadyGraph(context, documentId)

    await context.service.reindexDocument(documentId)

    expect(context.repository.getDocumentGraphStatus(documentId).status).toBe('pending')
    expect(context.repository.getDocumentGraph(documentId).relations).toEqual([])
  })

  it('delete removes graph and job state', async () => {
    const documentId = await addLegalDocument(context)
    seedReadyGraph(context, documentId)

    await context.service.deleteDocument(documentId)

    expect(context.repository.getJob(documentId)).toBeUndefined()
    expect(context.repository.getDocumentGraph(documentId).relations).toEqual([])
  })

  it('indexes deterministic structure, restarts, and deletes cleanly', async () => {
    const documentId = await addLegalDocument(context)
    expect(await context.worker.runOnce()).toBe(true)
    expect(context.repository.getDocumentGraphStatus(documentId)).toMatchObject({
      status: 'ready',
      relationCount: expect.any(Number),
      model: 'deterministic-parser'
    })

    const seedChunk = context.service
      .getDocumentChunks(documentId)
      .find((chunk) => chunk.content.includes('ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1'))!
    const seed: LegalReasoningSeed = {
      notebookId: context.notebookId,
      citationId: 1,
      documentId,
      documentTitle: 'Deadline law',
      chunkId: seedChunk.id,
      chunkIndex: seedChunk.chunkIndex,
      score: 0.95,
      content: seedChunk.content,
      legalContext: seedChunk.metadata?.legalContext,
      metadata: buildLegalDocumentMetadata({ status: 'unknown' })
    }
    const first = context.reasoning.reason(
      'Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb x\u1eed l\u00fd th\u1ebf n\u00e0o?',
      [seed]
    )
    expect(first).toMatchObject({ graphStatus: 'ready', paths: [] })

    context.dbModule.closeDatabase()
    vi.resetModules()
    const reopenedDbModule = await import('../../src/main/db')
    const { KnowledgeService } = await import('../../src/main/services/KnowledgeService')
    const { LegalGraphRepository } =
      await import('../../src/main/services/legalGraph/LegalGraphRepository')
    const { LegalReasoningService } =
      await import('../../src/main/services/legalGraph/LegalReasoningService')
    reopenedDbModule.initDatabase()
    reopenedDbModule.runMigrations()
    reopenedDbModule.initExtensions()
    const reopenedRepository = new LegalGraphRepository(reopenedDbModule.getSqlite()!, {
      model: '',
      extractorVersion: '2',
      promptVersion: '1',
      ontologyVersion: '1'
    })
    const reopenedService = new KnowledgeService(
      new FakeProviderManager() as never,
      reopenedRepository
    )
    const reopenedReasoning = new LegalReasoningService(
      reopenedRepository,
      createEvidenceLoader(reopenedDbModule.getSqlite()!)
    )
    context.dbModule = reopenedDbModule

    const second = reopenedReasoning.reason(
      'Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb x\u1eed l\u00fd th\u1ebf n\u00e0o?',
      [seed]
    )
    expect(second.paths).toEqual([])

    await reopenedService.deleteDocument(documentId)
    expect(reopenedRepository.getDocumentGraphStatus(documentId)).toMatchObject({
      status: 'unavailable',
      relationCount: 0
    })
  })

  it('exposes graph status and retries only existing documents', async () => {
    const documentId = await addLegalDocument(context)
    seedReadyGraph(context, documentId)

    expect(context.service.getLegalGraphStatus(documentId).status).toBe('ready')
    context.service.retryLegalGraph(documentId)
    expect(context.service.getLegalGraphStatus(documentId).status).toBe('pending')
    expect(() => context.service.getLegalGraphStatus('missing-document')).toThrow(
      'Document missing-document not found'
    )
  })
})
