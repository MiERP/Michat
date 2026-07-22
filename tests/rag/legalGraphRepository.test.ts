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
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE
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
})
