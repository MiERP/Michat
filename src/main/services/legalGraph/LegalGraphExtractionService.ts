import { createHash } from 'crypto'
import type { Chunk, Document } from '../../db/schema'
import { getCanonicalLegalWorkKey, getLegalDocumentMetadata } from '../LegalComparisonService'
import type {
  LegalGraphCandidate,
  LegalGraphCandidateNode,
  LegalGraphCandidateRelation
} from './LegalGraphRepository'
import { extractVietnameseLegalSemantics } from './VietnameseLegalSemanticExtractor'

export class LegalGraphRetryableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LegalGraphRetryableError'
  }
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function normalizeText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function getLegalContext(chunk: Chunk): Record<string, string> {
  const context = chunk.metadata?.legalContext
  if (!context || typeof context !== 'object') return {}
  return Object.fromEntries(
    Object.entries(context).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

function workKey(document: Document): string {
  const metadata = (document.metadata as Record<string, unknown> | null) || {}
  return (
    (typeof metadata.canonicalLegalWorkKey === 'string' && metadata.canonicalLegalWorkKey) ||
    getCanonicalLegalWorkKey(getLegalDocumentMetadata(metadata)) ||
    `source:${document.id}`
  )
}

function relationFingerprint(relation: LegalGraphCandidateRelation): string {
  return JSON.stringify([
    relation.sourceLocalId,
    relation.relationType,
    relation.targetLocalId,
    relation.evidenceChunkId,
    relation.evidenceStartOffset,
    relation.evidenceEndOffset
  ])
}

export class LegalGraphExtractionService {
  async extractDocument(
    document: Document,
    chunks: Chunk[],
    abortSignal?: AbortSignal,
    onSourceUnitProcessed?: (processedUnitCount: number, sourceUnitCount: number) => void
  ): Promise<LegalGraphCandidate> {
    for (const chunk of chunks) {
      if (chunk.documentId !== document.id || chunk.notebookId !== document.notebookId) {
        throw new Error('Legal graph source crosses document or notebook boundary')
      }
      if (
        chunk.startOffset == null ||
        chunk.endOffset == null ||
        chunk.startOffset < 0 ||
        chunk.endOffset < chunk.startOffset
      ) {
        throw new Error('Legal graph source chunk lacks stable offsets')
      }
    }

    const canonicalWorkKey = workKey(document)
    const nodesByLocalId = new Map<string, LegalGraphCandidateNode>()
    const coordinateNodeIds = new Map<string, string>()
    const relations: LegalGraphCandidateRelation[] = []
    const relationFingerprints = new Set<string>()
    const documentLocalId = `source:document:${stableHash(canonicalWorkKey)}`
    nodesByLocalId.set(documentLocalId, {
      localId: documentLocalId,
      nodeType: 'document',
      canonicalKey: `document:${canonicalWorkKey}`,
      label: document.title,
      aliases: []
    })

    for (const chunk of chunks) {
      if (abortSignal?.aborted) throw new LegalGraphRetryableError('Legal graph extraction cancelled')
      const context = getLegalContext(chunk)
      const articleNumber = context.articleNumber
      const clauseNumber = context.clauseNumber
      const pointNumber = context.pointNumber
      if (!articleNumber) continue

      const articleKey = `article:${articleNumber}`
      const articleLocalId = this.ensureNode(nodesByLocalId, coordinateNodeIds, articleKey, {
        localId: `source:article:${stableHash(`${canonicalWorkKey}:${articleNumber}`)}`,
        nodeType: 'article',
        canonicalKey: `article:${canonicalWorkKey}:${articleNumber}`,
        label: context.articleTitle
          ? `Điều ${articleNumber}: ${context.articleTitle}`
          : `Điều ${articleNumber}`,
        aliases: [],
        chunkId: chunk.id,
        articleNumber,
        startOffset: chunk.startOffset ?? undefined,
        endOffset: chunk.endOffset ?? undefined
      })

      if (clauseNumber) {
        const clauseKey = `article:${articleNumber}:clause:${clauseNumber}`
        this.ensureNode(nodesByLocalId, coordinateNodeIds, clauseKey, {
          localId: `source:clause:${stableHash(`${canonicalWorkKey}:${articleNumber}:${clauseNumber}`)}`,
          nodeType: 'clause',
          canonicalKey: `clause:${canonicalWorkKey}:${articleNumber}:${clauseNumber}`,
          label: `Khoản ${clauseNumber}, Điều ${articleNumber}`,
          aliases: [],
          chunkId: chunk.id,
          articleNumber,
          clauseNumber,
          startOffset: chunk.startOffset ?? undefined,
          endOffset: chunk.endOffset ?? undefined
        })
      }

      if (clauseNumber && pointNumber) {
        const pointKey = `article:${articleNumber}:clause:${clauseNumber}:point:${pointNumber}`
        this.ensureNode(nodesByLocalId, coordinateNodeIds, pointKey, {
          localId: `source:point:${stableHash(`${canonicalWorkKey}:${articleNumber}:${clauseNumber}:${pointNumber}`)}`,
          nodeType: 'point',
          canonicalKey: `point:${canonicalWorkKey}:${articleNumber}:${clauseNumber}:${pointNumber}`,
          label: `Điểm ${pointNumber}, Khoản ${clauseNumber}, Điều ${articleNumber}`,
          aliases: [],
          chunkId: chunk.id,
          articleNumber,
          clauseNumber,
          pointNumber,
          startOffset: chunk.startOffset ?? undefined,
          endOffset: chunk.endOffset ?? undefined
        })
      }

      const sourceLocalId =
        (clauseNumber && pointNumber
          ? coordinateNodeIds.get(
              `article:${articleNumber}:clause:${clauseNumber}:point:${pointNumber}`
            )
          : undefined) ||
        (clauseNumber
          ? coordinateNodeIds.get(`article:${articleNumber}:clause:${clauseNumber}`)
          : undefined) ||
        articleLocalId
      this.addReferences(
        document,
        canonicalWorkKey,
        chunk,
        articleNumber,
        sourceLocalId,
        nodesByLocalId,
        coordinateNodeIds,
        relations,
        relationFingerprints
      )
      const semantics = extractVietnameseLegalSemantics(chunk, sourceLocalId, canonicalWorkKey)
      for (const node of semantics.nodes) nodesByLocalId.set(node.localId, node)
      for (const relation of semantics.relations) {
        this.pushRelation(relation, relations, relationFingerprints)
      }
    }

    const articleUnits = new Set(
      chunks.map((chunk) => getLegalContext(chunk).articleNumber).filter(Boolean)
    )
    const sourceUnitCount = articleUnits.size || chunks.length
    for (let processedUnitCount = 1; processedUnitCount <= sourceUnitCount; processedUnitCount++) {
      if (abortSignal?.aborted) throw new LegalGraphRetryableError('Legal graph extraction cancelled')
      onSourceUnitProcessed?.(processedUnitCount, sourceUnitCount)
    }

    return {
      nodes: [...nodesByLocalId.values()],
      relations,
      sourceUnitCount,
      processedUnitCount: sourceUnitCount
    }
  }

  private ensureNode(
    nodesByLocalId: Map<string, LegalGraphCandidateNode>,
    coordinateNodeIds: Map<string, string>,
    coordinateKey: string,
    node: LegalGraphCandidateNode
  ): string {
    const existing = coordinateNodeIds.get(coordinateKey)
    if (existing) return existing
    coordinateNodeIds.set(coordinateKey, node.localId)
    nodesByLocalId.set(node.localId, node)
    return node.localId
  }

  private addReferences(
    document: Document,
    canonicalWorkKey: string,
    chunk: Chunk,
    currentArticleNumber: string,
    sourceLocalId: string,
    nodesByLocalId: Map<string, LegalGraphCandidateNode>,
    coordinateNodeIds: Map<string, string>,
    relations: LegalGraphCandidateRelation[],
    relationFingerprints: Set<string>
  ): void {
    const internalPattern = /(?:^|[^\p{L}\p{N}_])(điều\s+(\d+[a-z]?))/giu
    for (const match of chunk.content.matchAll(internalPattern)) {
      const targetArticleNumber = match[2].toUpperCase()
      if (targetArticleNumber === currentArticleNumber.toUpperCase()) continue
      const coordinateKey = `article:${targetArticleNumber}`
      const targetLocalId = this.ensureNode(nodesByLocalId, coordinateNodeIds, coordinateKey, {
        localId: `source:article:${stableHash(`${canonicalWorkKey}:${targetArticleNumber}`)}`,
        nodeType: 'article',
        canonicalKey: `article:${canonicalWorkKey}:${targetArticleNumber}`,
        label: `Điều ${targetArticleNumber}`,
        aliases: [],
        articleNumber: targetArticleNumber
      })
      this.pushRelation(
        {
          sourceLocalId,
          targetLocalId,
          relationType: 'references',
          evidenceChunkId: chunk.id,
          evidenceText: normalizeText(match[1]),
          evidenceStartOffset:
            (chunk.startOffset ?? 0) + (match.index ?? 0) + match[0].indexOf(match[1]),
          evidenceEndOffset:
            (chunk.startOffset ?? 0) +
            (match.index ?? 0) +
            match[0].indexOf(match[1]) +
            match[1].length,
          confidence: 1,
          qualifiers: { extractor: 'deterministic' }
        },
        relations,
        relationFingerprints
      )
    }

    const currentNumber = getLegalDocumentMetadata(document.metadata).documentNumber
      ?.replace(/\s+/gu, '')
      .toLocaleUpperCase('vi-VN')
    const documentPattern = /\b\d+[A-Z]?\/\d{4}\/[A-ZĐ0-9.-]+(?:\/[A-ZĐ0-9.-]+)?/giu
    for (const match of chunk.content.matchAll(documentPattern)) {
      const targetNumber = match[0].replace(/\s+/gu, '').toLocaleUpperCase('vi-VN')
      if (targetNumber === currentNumber) continue
      const targetLocalId = `external:document:${stableHash(targetNumber)}`
      if (!nodesByLocalId.has(targetLocalId)) {
        nodesByLocalId.set(targetLocalId, {
          localId: targetLocalId,
          nodeType: 'external_reference',
          canonicalKey: `external-document:${targetNumber}`,
          label: targetNumber,
          aliases: [],
          metadata: { documentNumber: targetNumber, unresolved: true }
        })
      }
      this.pushRelation(
        {
          sourceLocalId,
          targetLocalId,
          relationType: 'references',
          evidenceChunkId: chunk.id,
          evidenceText: match[0],
          evidenceStartOffset: (chunk.startOffset ?? 0) + (match.index ?? 0),
          evidenceEndOffset: (chunk.startOffset ?? 0) + (match.index ?? 0) + match[0].length,
          confidence: 1,
          qualifiers: { extractor: 'deterministic' }
        },
        relations,
        relationFingerprints
      )
    }
  }

  private pushRelation(
    relation: LegalGraphCandidateRelation,
    relations: LegalGraphCandidateRelation[],
    relationFingerprints: Set<string>
  ): void {
    const fingerprint = relationFingerprint(relation)
    if (relationFingerprints.has(fingerprint)) return
    relationFingerprints.add(fingerprint)
    relations.push(relation)
  }
}
