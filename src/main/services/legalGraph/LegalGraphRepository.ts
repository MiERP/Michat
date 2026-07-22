import { createHash, randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { LegalExtractionJob, LegalNode, LegalRelation } from '../../db/schema'
import {
  LEGAL_NODE_TYPES,
  LEGAL_RELATION_TYPES,
  type LegalGraphDocumentStatus,
  type LegalNodeType,
  type LegalRelationType
} from '../../../shared/types/legalReasoning'

const MAX_ERROR_LENGTH = 500
const MAX_RETRY_DELAY_MS = 30 * 60 * 1000
const BASE_RETRY_DELAY_MS = 5_000

export interface LegalGraphCandidateNode {
  localId: string
  nodeType: LegalNodeType
  canonicalKey: string
  label: string
  aliases: string[]
  chunkId?: string
  articleNumber?: string
  clauseNumber?: string
  pointNumber?: string
  startOffset?: number
  endOffset?: number
  metadata?: Record<string, unknown>
}

export interface LegalGraphCandidateRelation {
  sourceLocalId: string
  targetLocalId: string
  relationType: LegalRelationType
  evidenceChunkId: string
  evidenceText: string
  evidenceStartOffset: number
  evidenceEndOffset: number
  confidence: number
  qualifiers?: Record<string, unknown>
}

export interface LegalGraphCandidate {
  nodes: LegalGraphCandidateNode[]
  relations: LegalGraphCandidateRelation[]
  sourceUnitCount?: number
  processedUnitCount?: number
}

export interface LegalGraphProvenance {
  model: string
  promptVersion: string
  extractorVersion: string
  ontologyVersion: string
}

export interface LegalDocumentGraph {
  nodes: LegalNode[]
  relations: LegalRelation[]
}

type DatabaseRow = Record<string, unknown>

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  return JSON.parse(value) as T
}

function toDate(value: unknown): Date | null {
  return typeof value === 'number' ? new Date(value) : null
}

function sanitizeError(error: Error): string {
  return Array.from(error.message, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH)
}

function mapJob(row: DatabaseRow): LegalExtractionJob {
  return {
    id: String(row.id),
    notebookId: String(row.notebook_id),
    documentId: String(row.document_id),
    status: row.status as LegalExtractionJob['status'],
    extractorVersion: String(row.extractor_version),
    promptVersion: String(row.prompt_version),
    ontologyVersion: String(row.ontology_version),
    model: row.model == null ? null : String(row.model),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    sourceUnitCount: Number(row.source_unit_count),
    processedUnitCount: Number(row.processed_unit_count),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseExpiresAt: toDate(row.lease_expires_at),
    nextRunAt: toDate(row.next_run_at),
    startedAt: toDate(row.started_at),
    completedAt: toDate(row.completed_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at))
  }
}

function mapNode(row: DatabaseRow): LegalNode {
  return {
    id: String(row.id),
    notebookId: String(row.notebook_id),
    documentId: row.document_id == null ? null : String(row.document_id),
    chunkId: row.chunk_id == null ? null : String(row.chunk_id),
    nodeType: row.node_type as LegalNode['nodeType'],
    canonicalKey: String(row.canonical_key),
    label: String(row.label),
    aliases: parseJson(row.aliases, []),
    articleNumber: row.article_number == null ? null : String(row.article_number),
    clauseNumber: row.clause_number == null ? null : String(row.clause_number),
    pointNumber: row.point_number == null ? null : String(row.point_number),
    startOffset: row.start_offset == null ? null : Number(row.start_offset),
    endOffset: row.end_offset == null ? null : Number(row.end_offset),
    metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at))
  }
}

function mapRelation(row: DatabaseRow): LegalRelation {
  return {
    id: String(row.id),
    notebookId: String(row.notebook_id),
    sourceNodeId: String(row.source_node_id),
    targetNodeId: String(row.target_node_id),
    relationType: row.relation_type as LegalRelation['relationType'],
    documentId: String(row.document_id),
    evidenceChunkId: String(row.evidence_chunk_id),
    evidenceText: String(row.evidence_text),
    evidenceStartOffset: Number(row.evidence_start_offset),
    evidenceEndOffset: Number(row.evidence_end_offset),
    confidence: Number(row.confidence),
    qualifiers: parseJson<Record<string, unknown> | null>(row.qualifiers, null),
    model: String(row.model),
    promptVersion: String(row.prompt_version),
    extractorVersion: String(row.extractor_version),
    ontologyVersion: String(row.ontology_version),
    fingerprint: String(row.fingerprint),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at))
  }
}

export class LegalGraphRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly versions: LegalGraphProvenance
  ) {}

  enqueueDocument(documentId: string, notebookId: string): void {
    this.assertDocumentNotebook(documentId, notebookId)
    const now = Date.now()
    this.database
      .prepare(
        `INSERT INTO legal_extraction_jobs (
          id, notebook_id, document_id, status, extractor_version, prompt_version,
          ontology_version, attempts, max_attempts, source_unit_count,
          processed_unit_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, 5, 0, 0, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          notebook_id = excluded.notebook_id,
          status = 'pending',
          extractor_version = excluded.extractor_version,
          prompt_version = excluded.prompt_version,
          ontology_version = excluded.ontology_version,
          model = NULL,
          attempts = 0,
          source_unit_count = 0,
          processed_unit_count = 0,
          lease_owner = NULL,
          lease_expires_at = NULL,
          next_run_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          last_error = NULL,
          updated_at = excluded.updated_at`
      )
      .run(
        randomUUID(),
        notebookId,
        documentId,
        this.versions.extractorVersion,
        this.versions.promptVersion,
        this.versions.ontologyVersion,
        now,
        now
      )
  }

  claimNextJob(workerId: string, now: Date, leaseMs: number): LegalExtractionJob | undefined {
    if (!workerId.trim() || leaseMs <= 0) return undefined

    return this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT * FROM legal_extraction_jobs
           WHERE status IN ('pending', 'retry')
             AND attempts < max_attempts
             AND (next_run_at IS NULL OR next_run_at <= ?)
           ORDER BY COALESCE(next_run_at, created_at), created_at
           LIMIT 1`
        )
        .get(now.getTime()) as DatabaseRow | undefined

      if (!row) return undefined

      const result = this.database
        .prepare(
          `UPDATE legal_extraction_jobs
           SET status = 'processing', attempts = attempts + 1, lease_owner = ?,
               lease_expires_at = ?, started_at = COALESCE(started_at, ?),
               completed_at = NULL, last_error = NULL, updated_at = ?
           WHERE id = ? AND status IN ('pending', 'retry')`
        )
        .run(workerId, now.getTime() + leaseMs, now.getTime(), now.getTime(), row.id)

      if (result.changes !== 1) return undefined
      return this.getJobById(String(row.id))
    })()
  }

  heartbeat(jobId: string, workerId: string, now: Date, leaseMs: number): boolean {
    if (leaseMs <= 0) return false
    const result = this.database
      .prepare(
        `UPDATE legal_extraction_jobs
         SET lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'processing' AND lease_owner = ?`
      )
      .run(now.getTime() + leaseMs, now.getTime(), jobId, workerId)
    return result.changes === 1
  }

  markJobRetry(jobId: string, error: Error, now: Date): void {
    const job = this.getJobById(jobId)
    if (!job) return
    if (job.attempts >= job.maxAttempts) {
      this.markJobFailed(jobId, error, now)
      return
    }

    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      BASE_RETRY_DELAY_MS * 2 ** Math.max(0, job.attempts - 1)
    )
    this.database
      .prepare(
        `UPDATE legal_extraction_jobs
         SET status = 'retry', lease_owner = NULL, lease_expires_at = NULL,
             next_run_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now.getTime() + delay, sanitizeError(error), now.getTime(), jobId)
  }

  markJobFailed(jobId: string, error: Error, now: Date): void {
    this.database
      .prepare(
        `UPDATE legal_extraction_jobs
         SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
             next_run_at = NULL, completed_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now.getTime(), sanitizeError(error), now.getTime(), jobId)
  }

  recoverExpiredLeases(now: Date): number {
    const result = this.database
      .prepare(
        `UPDATE legal_extraction_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry' END,
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_run_at = CASE WHEN attempts >= max_attempts THEN NULL ELSE ? END,
             completed_at = CASE WHEN attempts >= max_attempts THEN ? ELSE completed_at END,
             last_error = 'Worker lease expired',
             updated_at = ?
         WHERE status = 'processing' AND lease_expires_at < ?`
      )
      .run(now.getTime(), now.getTime(), now.getTime(), now.getTime())
    return result.changes
  }

  replaceDocumentGraph(
    documentId: string,
    candidate: LegalGraphCandidate,
    provenance: LegalGraphProvenance
  ): void {
    const notebookId = this.getDocumentNotebook(documentId)
    this.validateCandidate(documentId, notebookId, candidate)

    this.database.transaction(() => {
      const now = Date.now()
      const previousNodeIds = this.database
        .prepare('SELECT id FROM legal_nodes WHERE document_id = ?')
        .all(documentId)
        .map((row) => String((row as DatabaseRow).id))

      this.database.prepare('DELETE FROM legal_relations WHERE document_id = ?').run(documentId)

      const nodeIds = new Map<string, string>()
      const upsertNode = this.database.prepare(
        `INSERT INTO legal_nodes (
          id, notebook_id, document_id, chunk_id, node_type, canonical_key, label,
          aliases, article_number, clause_number, point_number, start_offset,
          end_offset, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(notebook_id, node_type, canonical_key) DO UPDATE SET
          label = excluded.label,
          aliases = excluded.aliases,
          chunk_id = COALESCE(excluded.chunk_id, legal_nodes.chunk_id),
          article_number = COALESCE(excluded.article_number, legal_nodes.article_number),
          clause_number = COALESCE(excluded.clause_number, legal_nodes.clause_number),
          point_number = COALESCE(excluded.point_number, legal_nodes.point_number),
          start_offset = COALESCE(excluded.start_offset, legal_nodes.start_offset),
          end_offset = COALESCE(excluded.end_offset, legal_nodes.end_offset),
          metadata = COALESCE(excluded.metadata, legal_nodes.metadata),
          updated_at = excluded.updated_at`
      )

      for (const node of candidate.nodes) {
        const nodeId = `legal-node:${hash([notebookId, node.nodeType, node.canonicalKey])}`
        nodeIds.set(node.localId, nodeId)
        upsertNode.run(
          nodeId,
          notebookId,
          documentId,
          node.chunkId ?? null,
          node.nodeType,
          node.canonicalKey,
          node.label,
          JSON.stringify(node.aliases),
          node.articleNumber ?? null,
          node.clauseNumber ?? null,
          node.pointNumber ?? null,
          node.startOffset ?? null,
          node.endOffset ?? null,
          node.metadata ? JSON.stringify(node.metadata) : null,
          now,
          now
        )
      }

      const insertRelation = this.database.prepare(
        `INSERT INTO legal_relations (
          id, notebook_id, source_node_id, target_node_id, relation_type, document_id,
          evidence_chunk_id, evidence_text, evidence_start_offset, evidence_end_offset,
          confidence, qualifiers, model, prompt_version, extractor_version,
          ontology_version, fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const relation of candidate.relations) {
        const sourceNodeId = nodeIds.get(relation.sourceLocalId)!
        const targetNodeId = nodeIds.get(relation.targetLocalId)!
        const fingerprint = hash([
          notebookId,
          sourceNodeId,
          relation.relationType,
          targetNodeId,
          relation.evidenceChunkId,
          relation.evidenceStartOffset,
          relation.evidenceEndOffset
        ])
        insertRelation.run(
          `legal-relation:${fingerprint}`,
          notebookId,
          sourceNodeId,
          targetNodeId,
          relation.relationType,
          documentId,
          relation.evidenceChunkId,
          relation.evidenceText,
          relation.evidenceStartOffset,
          relation.evidenceEndOffset,
          relation.confidence,
          relation.qualifiers ? JSON.stringify(relation.qualifiers) : null,
          provenance.model,
          provenance.promptVersion,
          provenance.extractorVersion,
          provenance.ontologyVersion,
          fingerprint,
          now,
          now
        )
      }

      const retainedNodeIds = new Set(nodeIds.values())
      const obsoleteNodeIds = previousNodeIds.filter((nodeId) => !retainedNodeIds.has(nodeId))
      if (obsoleteNodeIds.length > 0) {
        const placeholders = obsoleteNodeIds.map(() => '?').join(', ')
        this.database
          .prepare(
            `DELETE FROM legal_nodes
             WHERE id IN (${placeholders})
               AND NOT EXISTS (
                 SELECT 1 FROM legal_relations
                 WHERE source_node_id = legal_nodes.id OR target_node_id = legal_nodes.id
               )`
          )
          .run(...obsoleteNodeIds)
      }

      this.database
        .prepare(
          `UPDATE legal_extraction_jobs
           SET status = 'ready', model = ?, source_unit_count = ?, processed_unit_count = ?,
               lease_owner = NULL, lease_expires_at = NULL, next_run_at = NULL,
               completed_at = ?, last_error = NULL, updated_at = ?
           WHERE document_id = ?`
        )
        .run(
          provenance.model,
          candidate.sourceUnitCount ?? 0,
          candidate.processedUnitCount ?? candidate.sourceUnitCount ?? 0,
          now,
          now,
          documentId
        )
    })()
  }

  getDocumentGraph(documentId: string): LegalDocumentGraph {
    const nodes = this.database
      .prepare(
        `SELECT DISTINCT n.* FROM legal_nodes n
         LEFT JOIN legal_relations r
           ON (r.source_node_id = n.id OR r.target_node_id = n.id) AND r.document_id = ?
         WHERE n.document_id = ? OR r.id IS NOT NULL
         ORDER BY n.id`
      )
      .all(documentId, documentId)
      .map((row) => mapNode(row as DatabaseRow))
    const relations = this.database
      .prepare('SELECT * FROM legal_relations WHERE document_id = ? ORDER BY id')
      .all(documentId)
      .map((row) => mapRelation(row as DatabaseRow))
    return { nodes, relations }
  }

  getJob(documentId: string): LegalExtractionJob | undefined {
    const row = this.database
      .prepare('SELECT * FROM legal_extraction_jobs WHERE document_id = ?')
      .get(documentId) as DatabaseRow | undefined
    return row ? mapJob(row) : undefined
  }

  getDocumentGraphStatus(documentId: string): LegalGraphDocumentStatus {
    const job = this.getJob(documentId)
    if (!job) {
      return {
        status: 'unavailable',
        attempts: 0,
        sourceUnitCount: 0,
        processedUnitCount: 0,
        nodeCount: 0,
        relationCount: 0
      }
    }

    const counts = this.database
      .prepare(
        `SELECT
          (SELECT COUNT(DISTINCT n.id) FROM legal_nodes n
           LEFT JOIN legal_relations r
             ON (r.source_node_id = n.id OR r.target_node_id = n.id) AND r.document_id = ?
           WHERE n.document_id = ? OR r.id IS NOT NULL) AS node_count,
          (SELECT COUNT(*) FROM legal_relations WHERE document_id = ?) AS relation_count`
      )
      .get(documentId, documentId, documentId) as DatabaseRow

    return {
      status: job.status,
      attempts: job.attempts,
      sourceUnitCount: job.sourceUnitCount,
      processedUnitCount: job.processedUnitCount,
      nodeCount: Number(counts.node_count),
      relationCount: Number(counts.relation_count),
      model: job.model ?? undefined,
      extractorVersion: job.extractorVersion,
      promptVersion: job.promptVersion,
      ontologyVersion: job.ontologyVersion,
      nextRunAt: job.nextRunAt?.toISOString(),
      lastError: job.lastError ?? undefined
    }
  }

  retryDocument(documentId: string): void {
    const now = Date.now()
    this.database
      .prepare(
        `UPDATE legal_extraction_jobs
         SET status = 'pending', attempts = 0, lease_owner = NULL, lease_expires_at = NULL,
             next_run_at = NULL, started_at = NULL, completed_at = NULL,
             last_error = NULL, updated_at = ?
         WHERE document_id = ?`
      )
      .run(now, documentId)
  }

  deleteDocumentGraph(documentId: string): void {
    this.database.transaction(() => {
      const nodeIds = this.database
        .prepare('SELECT id FROM legal_nodes WHERE document_id = ?')
        .all(documentId)
        .map((row) => String((row as DatabaseRow).id))
      this.database.prepare('DELETE FROM legal_relations WHERE document_id = ?').run(documentId)
      if (nodeIds.length > 0) {
        const placeholders = nodeIds.map(() => '?').join(', ')
        this.database
          .prepare(
            `DELETE FROM legal_nodes
             WHERE id IN (${placeholders})
               AND NOT EXISTS (
                 SELECT 1 FROM legal_relations
                 WHERE source_node_id = legal_nodes.id OR target_node_id = legal_nodes.id
               )`
          )
          .run(...nodeIds)
      }
      this.database
        .prepare('DELETE FROM legal_extraction_jobs WHERE document_id = ?')
        .run(documentId)
    })()
  }

  private getJobById(jobId: string): LegalExtractionJob | undefined {
    const row = this.database
      .prepare('SELECT * FROM legal_extraction_jobs WHERE id = ?')
      .get(jobId) as DatabaseRow | undefined
    return row ? mapJob(row) : undefined
  }

  private getDocumentNotebook(documentId: string): string {
    const row = this.database
      .prepare('SELECT notebook_id FROM documents WHERE id = ?')
      .get(documentId) as DatabaseRow | undefined
    if (!row) throw new Error('Legal graph document does not exist')
    return String(row.notebook_id)
  }

  private assertDocumentNotebook(documentId: string, notebookId: string): void {
    if (this.getDocumentNotebook(documentId) !== notebookId) {
      throw new Error('Legal graph document crosses notebook boundary')
    }
  }

  private validateCandidate(
    documentId: string,
    notebookId: string,
    candidate: LegalGraphCandidate
  ): void {
    const localIds = new Set<string>()
    for (const node of candidate.nodes) {
      if (
        !node.localId ||
        localIds.has(node.localId) ||
        !node.canonicalKey ||
        !node.label ||
        !LEGAL_NODE_TYPES.includes(node.nodeType)
      ) {
        throw new Error('Invalid legal graph candidate node')
      }
      localIds.add(node.localId)
    }

    for (const relation of candidate.relations) {
      if (!localIds.has(relation.sourceLocalId) || !localIds.has(relation.targetLocalId)) {
        throw new Error('Legal graph relation references an unknown node')
      }
      if (
        !LEGAL_RELATION_TYPES.includes(relation.relationType) ||
        !Number.isFinite(relation.confidence) ||
        relation.confidence < 0 ||
        relation.confidence > 1 ||
        relation.evidenceStartOffset < 0 ||
        relation.evidenceEndOffset < relation.evidenceStartOffset
      ) {
        throw new Error('Invalid legal graph candidate relation')
      }
    }

    const chunkIds = [
      ...candidate.nodes.flatMap((node) => (node.chunkId ? [node.chunkId] : [])),
      ...candidate.relations.map((relation) => relation.evidenceChunkId)
    ]
    const uniqueChunkIds = [...new Set(chunkIds)]
    if (uniqueChunkIds.length === 0) return

    const placeholders = uniqueChunkIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(
        `SELECT c.id, c.document_id, d.notebook_id
         FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE c.id IN (${placeholders})`
      )
      .all(...uniqueChunkIds) as DatabaseRow[]

    if (rows.length !== uniqueChunkIds.length) {
      throw new Error('Legal graph candidate references an unknown chunk')
    }
    if (rows.some((row) => String(row.notebook_id) !== notebookId)) {
      throw new Error('Legal graph candidate crosses notebook boundary')
    }

    const evidenceChunkIds = new Set(
      candidate.relations.map((relation) => relation.evidenceChunkId)
    )
    if (
      rows.some(
        (row) => evidenceChunkIds.has(String(row.id)) && String(row.document_id) !== documentId
      )
    ) {
      throw new Error('Legal graph evidence must belong to source document')
    }
  }
}
