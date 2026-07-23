import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LegalGraphRepository,
  type LegalGraphCandidate,
  type LegalGraphProvenance
} from '../../src/main/services/legalGraph/LegalGraphRepository'

const notebookId = 'notebook-a'
const otherNotebookId = 'notebook-b'
const documentA = 'document-a'
const documentB = 'document-b'
const otherDocument = 'document-c'
const provenance: LegalGraphProvenance = {
  model: 'local-model',
  promptVersion: '1',
  extractorVersion: '1',
  ontologyVersion: '1'
}

function candidate(documentId: string, relationCount: number): LegalGraphCandidate {
  const chunkId = `chunk-${documentId}`
  const nodes = Array.from({ length: relationCount + 1 }, (_, index) => ({
    localId: `node-${index}`,
    nodeType: index === 0 ? ('article' as const) : ('action' as const),
    canonicalKey: `${documentId}:node:${index}`,
    label: `Node ${index}`,
    aliases: [],
    chunkId
  }))

  return {
    nodes,
    relations: Array.from({ length: relationCount }, (_, index) => ({
      sourceLocalId: `node-${index}`,
      targetLocalId: `node-${index + 1}`,
      relationType: index % 2 === 0 ? ('requires' as const) : ('references' as const),
      evidenceChunkId: chunkId,
      evidenceText: `evidence ${index}`,
      evidenceStartOffset: index * 10,
      evidenceEndOffset: index * 10 + 8,
      confidence: 0.9
    }))
  }
}

function legacySharedCandidate(documentId: string): LegalGraphCandidate {
  const chunkId = 'chunk-' + documentId
  return {
    nodes: [
      {
        localId: 'shared-action',
        nodeType: 'action',
        canonicalKey: 'action:shared-filing',
        label: 'Shared filing action',
        aliases: [],
        chunkId
      },
      {
        localId: 'sanction',
        nodeType: 'sanction',
        canonicalKey: documentId + ':sanction',
        label: 'Sanction ' + documentId,
        aliases: [],
        chunkId
      }
    ],
    relations: [
      {
        sourceLocalId: 'shared-action',
        targetLocalId: 'sanction',
        relationType: 'sanction_for',
        evidenceChunkId: chunkId,
        evidenceText: 'evidence',
        evidenceStartOffset: 0,
        evidenceEndOffset: 8,
        confidence: 0.9
      }
    ]
  }
}

describe('LegalGraphRepository', () => {
  let database: Database.Database
  let repository: LegalGraphRepository

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE notebooks (id TEXT PRIMARY KEY);
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        metadata TEXT,
        status TEXT NOT NULL DEFAULT 'indexed'
      );
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE
      );
    `)
    database.exec(
      readFileSync(resolve('src/main/db/migrations/0013_legal_knowledge_graph.sql'), 'utf8')
    )

    database.prepare('INSERT INTO notebooks (id) VALUES (?), (?)').run(notebookId, otherNotebookId)
    database
      .prepare('INSERT INTO documents (id, notebook_id) VALUES (?, ?), (?, ?), (?, ?)')
      .run(documentA, notebookId, documentB, notebookId, otherDocument, otherNotebookId)
    database
      .prepare('INSERT INTO chunks (id, document_id) VALUES (?, ?), (?, ?), (?, ?)')
      .run(
        `chunk-${documentA}`,
        documentA,
        `chunk-${documentB}`,
        documentB,
        `chunk-${otherDocument}`,
        otherDocument
      )

    repository = new LegalGraphRepository(database, provenance)
  })

  afterEach(() => database.close())

  it('replaces one document graph atomically and preserves another', () => {
    repository.replaceDocumentGraph(documentA, candidate(documentA, 2), provenance)
    repository.replaceDocumentGraph(documentB, candidate(documentB, 2), provenance)
    repository.replaceDocumentGraph(documentA, candidate(documentA, 1), provenance)

    expect(repository.getDocumentGraph(documentA).relations).toHaveLength(1)
    expect(repository.getDocumentGraph(documentB).relations).toHaveLength(2)
  })

  it('links external document references to a canonical document node in the notebook', () => {
    database
      .prepare('UPDATE documents SET metadata = ? WHERE id = ?')
      .run(JSON.stringify({ legalDocument: { documentNumber: '24/2018/QH14' } }), documentB)
    repository.replaceDocumentGraph(
      documentB,
      {
        nodes: [
          {
            localId: 'target-document',
            nodeType: 'document',
            canonicalKey: 'document:luật:24/2018/QH14',
            label: 'Luật 24/2018/QH14',
            aliases: []
          }
        ],
        relations: []
      },
      provenance
    )
    repository.replaceDocumentGraph(
      documentA,
      {
        nodes: [
          {
            localId: 'source-article',
            nodeType: 'article',
            canonicalKey: 'article:source:1',
            label: 'Điều 1',
            aliases: [],
            chunkId: `chunk-${documentA}`,
            articleNumber: '1'
          },
          {
            localId: 'external-target',
            nodeType: 'external_reference',
            canonicalKey: 'external-document:24/2018/QH14',
            label: '24/2018/QH14',
            aliases: [],
            metadata: { documentNumber: '24/2018/QH14', unresolved: true }
          }
        ],
        relations: [
          {
            sourceLocalId: 'source-article',
            targetLocalId: 'external-target',
            relationType: 'references',
            evidenceChunkId: `chunk-${documentA}`,
            evidenceText: '24/2018/QH14',
            evidenceStartOffset: 0,
            evidenceEndOffset: 13,
            confidence: 1
          }
        ]
      },
      provenance
    )

    const targetDocumentNode = repository
      .getDocumentGraph(documentB)
      .nodes.find((node) => node.nodeType === 'document')
    expect(repository.getDocumentGraph(documentA).relations[0].targetNodeId).toBe(
      targetDocumentNode?.id
    )
  })

  it('cleans legacy shared semantic nodes after versioned replacement', () => {
    repository.replaceDocumentGraph(documentA, legacySharedCandidate(documentA), provenance)
    repository.replaceDocumentGraph(documentB, legacySharedCandidate(documentB), provenance)

    repository.replaceDocumentGraph(documentA, candidate(documentA, 1), provenance)
    repository.replaceDocumentGraph(documentB, candidate(documentB, 1), provenance)

    const legacyNodeCount = database
      .prepare('SELECT COUNT(*) AS count FROM legal_nodes WHERE canonical_key = ?')
      .get('action:shared-filing') as { count: number }
    expect(legacyNodeCount.count).toBe(0)
    expect(repository.getDocumentGraph(documentA).relations).toHaveLength(1)
    expect(repository.getDocumentGraph(documentB).relations).toHaveLength(1)
  })

  it('keeps the previous graph when replacement validation fails', () => {
    repository.replaceDocumentGraph(documentA, candidate(documentA, 2), provenance)
    const invalid = candidate(documentA, 1)
    invalid.relations[0].targetLocalId = 'missing-node'

    expect(() => repository.replaceDocumentGraph(documentA, invalid, provenance)).toThrow(
      'Legal graph relation references an unknown node'
    )
    expect(repository.getDocumentGraph(documentA).relations).toHaveLength(2)
  })

  it('claims due jobs and recovers expired leases', () => {
    const now = new Date('2026-07-22T00:00:00.000Z')
    repository.enqueueDocument(documentA, notebookId)

    const claimed = repository.claimNextJob('worker-1', now, 30_000)
    expect(claimed).toMatchObject({ status: 'processing', attempts: 1, leaseOwner: 'worker-1' })
    expect(repository.heartbeat(claimed!.id, 'other-worker', now, 30_000)).toBe(false)

    expect(repository.recoverExpiredLeases(new Date(now.getTime() + 31_000))).toBe(1)
    expect(repository.getJob(documentA)).toMatchObject({
      status: 'retry',
      leaseOwner: null,
      leaseExpiresAt: null
    })
  })

  it('uses bounded exponential retry and sanitizes stored errors', () => {
    const now = new Date('2026-07-22T00:00:00.000Z')
    repository.enqueueDocument(documentA, notebookId)
    const claimed = repository.claimNextJob('worker-1', now, 30_000)!
    repository.markJobRetry(claimed.id, new Error('bad\nerror\u0000'.repeat(100)), now)

    const job = repository.getJob(documentA)!
    expect(job.status).toBe('retry')
    expect(job.nextRunAt?.getTime()).toBe(now.getTime() + 5_000)
    expect(
      Array.from(job.lastError!).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint > 31 && (codePoint < 127 || codePoint > 159)
      })
    ).toBe(true)
    expect(job.lastError!.length).toBeLessThanOrEqual(500)
  })

  it('rejects cross-notebook evidence', () => {
    const crossNotebookCandidate = candidate(documentA, 1)
    crossNotebookCandidate.relations[0].evidenceChunkId = `chunk-${otherDocument}`

    expect(() =>
      repository.replaceDocumentGraph(documentA, crossNotebookCandidate, provenance)
    ).toThrow('Legal graph candidate crosses notebook boundary')
  })

  it('traverses inbound and outbound paths without cycles', () => {
    const graphCandidate = candidate(documentA, 3)
    graphCandidate.relations[2].relationType = 'sanction_for'
    repository.replaceDocumentGraph(documentA, graphCandidate, provenance)
    const graph = repository.getDocumentGraph(documentA)
    const articleNodeId = graph.nodes.find((node) => node.canonicalKey.endsWith(':node:0'))!.id
    const sanctionNodeId = graph.nodes.find((node) => node.canonicalKey.endsWith(':node:3'))!.id

    const outbound = repository.traverse({
      notebookId,
      seedNodeIds: [articleNodeId],
      relationTypes: ['requires', 'references', 'sanction_for'],
      maxDepth: 4,
      maxPaths: 20,
      minimumConfidence: 0.75
    })
    expect(outbound[0].steps.map((step) => step.relationType)).toEqual([
      'requires',
      'references',
      'sanction_for'
    ])
    expect(outbound[0].steps.every((step) => step.direction === 'outbound')).toBe(true)
    expect(outbound.every((path) => new Set(path.nodeIds).size === path.nodeIds.length)).toBe(true)

    const inbound = repository.traverse({
      notebookId,
      seedNodeIds: [sanctionNodeId],
      relationTypes: ['requires', 'references', 'sanction_for'],
      maxDepth: 4,
      maxPaths: 20,
      minimumConfidence: 0.75
    })
    expect(inbound[0].steps.map((step) => step.relationType)).toEqual([
      'sanction_for',
      'references',
      'requires'
    ])
    expect(inbound[0].steps.every((step) => step.direction === 'inbound')).toBe(true)
  })

  it('invalidates notebook adjacency cache after replacement and deletion', () => {
    const graphCandidate = candidate(documentA, 3)
    graphCandidate.relations[2].relationType = 'sanction_for'
    repository.replaceDocumentGraph(documentA, graphCandidate, provenance)
    const seedNodeId = repository
      .getDocumentGraph(documentA)
      .nodes.find((node) => node.canonicalKey.endsWith(':node:0'))!.id
    const firstRevision = repository.getNotebookRevision(notebookId)

    expect(
      repository.traverse({
        notebookId,
        seedNodeIds: [seedNodeId],
        relationTypes: ['requires', 'references', 'sanction_for'],
        maxDepth: 4,
        maxPaths: 20,
        minimumConfidence: 0.75
      })[0].steps
    ).toHaveLength(3)

    repository.replaceDocumentGraph(documentA, candidate(documentA, 1), provenance)
    expect(repository.getNotebookRevision(notebookId)).toBe(firstRevision + 1)
    expect(
      repository.traverse({
        notebookId,
        seedNodeIds: [seedNodeId],
        relationTypes: ['requires', 'references', 'sanction_for'],
        maxDepth: 4,
        maxPaths: 20,
        minimumConfidence: 0.75
      })[0].steps
    ).toHaveLength(1)

    repository.deleteDocumentGraph(documentA)
    expect(repository.getNotebookRevision(notebookId)).toBe(firstRevision + 2)
    expect(
      repository.traverse({
        notebookId,
        seedNodeIds: [seedNodeId],
        relationTypes: ['requires', 'references', 'sanction_for'],
        maxDepth: 4,
        maxPaths: 20,
        minimumConfidence: 0.75
      })
    ).toEqual([])
  })

  it('keeps traversal inside the requested notebook', () => {
    repository.replaceDocumentGraph(otherDocument, candidate(otherDocument, 1), provenance)
    const otherNodeId = repository.getDocumentGraph(otherDocument).nodes[0].id

    expect(
      repository.traverse({
        notebookId,
        seedNodeIds: [otherNodeId],
        relationTypes: ['requires'],
        maxDepth: 4,
        maxPaths: 20,
        minimumConfidence: 0.75
      })
    ).toEqual([])
  })

  it('backfills only missing or stale legal graph versions while preserving ready graph', () => {
    database
      .prepare('UPDATE documents SET metadata = ? WHERE id = ?')
      .run(JSON.stringify({ legalStructure: { articleCount: 1 } }), documentA)

    expect(repository.enqueueStaleDocuments(provenance)).toBe(1)
    expect(repository.getJob(documentA)?.status).toBe('pending')
    repository.replaceDocumentGraph(documentA, candidate(documentA, 1), provenance)
    expect(repository.enqueueStaleDocuments(provenance)).toBe(0)

    expect(repository.enqueueStaleDocuments({ ...provenance, extractorVersion: '2' })).toBe(1)
    expect(repository.getJob(documentA)?.status).toBe('pending')
    expect(repository.getDocumentGraph(documentA).relations).toHaveLength(1)
  })

  it('updates progress only for lease owner and releases worker leases', () => {
    const now = new Date('2026-07-22T00:00:00.000Z')
    repository.enqueueDocument(documentA, notebookId)
    const job = repository.claimNextJob('worker-1', now, 30_000)!

    expect(repository.updateJobProgress(job.id, 'worker-2', 1, 2, now, 30_000)).toBe(false)
    expect(repository.updateJobProgress(job.id, 'worker-1', 1, 2, now, 30_000)).toBe(true)
    expect(repository.getJob(documentA)).toMatchObject({
      processedUnitCount: 1,
      sourceUnitCount: 2
    })

    expect(repository.releaseWorkerLeases('worker-1', now)).toBe(1)
    expect(repository.getJob(documentA)).toMatchObject({ status: 'retry', leaseOwner: null })
  })
})
