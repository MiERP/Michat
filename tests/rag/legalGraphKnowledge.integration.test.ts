import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type {
  EmbeddingConfig,
  EmbeddingResult
} from '../../src/main/providers/capabilities/EmbeddingCapability'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

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
}

const lawText = `CH\u01af\u01a0NG I
QUY \u0110\u1ecaNH CHUNG
\u0110i\u1ec1u 15. Th\u1eddi h\u1ea1n n\u1ed9p h\u1ed3 s\u01a1
1. Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1 trong 10 ng\u00e0y.`

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
    extractorVersion: '1',
    promptVersion: '1',
    ontologyVersion: '1'
  })
  const service = new KnowledgeService(new FakeProviderManager() as never, repository)
  return { dbModule, notebookId, repository, service }
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
      extractorVersion: '1',
      promptVersion: '1',
      ontologyVersion: '1'
    }
  )
}

describe('KnowledgeService legal graph integration', () => {
  let context: Context

  beforeEach(async () => {
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
