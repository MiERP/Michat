import { createHash } from 'crypto'
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai'
import type { Chunk, Document } from '../../db/schema'
import type { LegalNodeType } from '../../../shared/types/legalReasoning'
import type {
  LegalGraphCandidate,
  LegalGraphCandidateNode,
  LegalGraphCandidateRelation
} from './LegalGraphRepository'
import {
  buildLegalGraphPrompt,
  legalGraphOutputSchema,
  type LegalGraphModelOutput,
  type LegalGraphPromptSourceNode
} from './legalGraphPrompt'

export interface ActiveLegalGraphModel {
  model: LanguageModel
  provenance: string
}

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

function semanticKey(type: string, label: string): string {
  return `${type}:${normalizeText(label).toLocaleLowerCase('vi-VN')}`
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
}

function locateNormalizedEvidence(
  sourceText: string,
  evidenceText: string
): { text: string; start: number; end: number } | undefined {
  const normalizedEvidence = evidenceText.normalize('NFC')
  const normalizedSource = sourceText.normalize('NFC')
  const normalizedStart = normalizedSource.indexOf(normalizedEvidence)
  if (normalizedStart < 0) return undefined

  const boundaries = [0]
  let offset = 0
  for (const character of sourceText) {
    offset += character.length
    boundaries.push(offset)
  }

  const candidateStarts = boundaries.filter(
    (boundary) => sourceText.slice(0, boundary).normalize('NFC').length === normalizedStart
  )
  for (const start of candidateStarts) {
    for (const end of boundaries) {
      if (end <= start) continue
      const slice = sourceText.slice(start, end)
      if (slice.normalize('NFC') === normalizedEvidence) {
        return { text: slice, start, end }
      }
      if (slice.normalize('NFC').length > normalizedEvidence.length) break
    }
  }
  return undefined
}

function sourceNode(
  localId: string,
  nodeType: Extract<LegalNodeType, 'document' | 'article' | 'clause' | 'point'>,
  canonicalKey: string,
  label: string,
  chunk: Chunk | undefined,
  coordinates: { articleNumber?: string; clauseNumber?: string; pointNumber?: string }
): LegalGraphCandidateNode {
  return {
    localId,
    nodeType,
    canonicalKey,
    label,
    aliases: [],
    chunkId: chunk?.id,
    articleNumber: coordinates.articleNumber,
    clauseNumber: coordinates.clauseNumber,
    pointNumber: coordinates.pointNumber,
    startOffset: chunk?.startOffset ?? undefined,
    endOffset: chunk?.endOffset ?? undefined
  }
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

export class LegalGraphExtractionService {
  async extractDocument(
    document: Document,
    chunks: Chunk[],
    activeModel: ActiveLegalGraphModel,
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

    const nodeByLocalId = new Map<string, LegalGraphCandidateNode>()
    const semanticNodeByKey = new Map<string, LegalGraphCandidateNode>()
    const relations: LegalGraphCandidateRelation[] = []
    const relationFingerprints = new Set<string>()
    const documentLocalId = `source:document:${document.id}`
    nodeByLocalId.set(
      documentLocalId,
      sourceNode(
        documentLocalId,
        'document',
        `document:${document.id}`,
        document.title,
        undefined,
        {}
      )
    )

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const promptSourceNodes = this.addSourceNodes(document, chunk, nodeByLocalId)
      const output = await this.extractSourceUnit(
        document.title,
        promptSourceNodes,
        chunk.content,
        activeModel.model,
        abortSignal
      )
      this.mergeSourceUnit(
        chunk,
        output,
        nodeByLocalId,
        semanticNodeByKey,
        relations,
        relationFingerprints
      )
      onSourceUnitProcessed?.(chunkIndex + 1, chunks.length)
    }

    return {
      nodes: [...nodeByLocalId.values()],
      relations,
      sourceUnitCount: chunks.length,
      processedUnitCount: chunks.length
    }
  }

  private addSourceNodes(
    document: Document,
    chunk: Chunk,
    nodeByLocalId: Map<string, LegalGraphCandidateNode>
  ): LegalGraphPromptSourceNode[] {
    const context = getLegalContext(chunk)
    const sourceNodes: LegalGraphPromptSourceNode[] = [
      {
        localId: `source:document:${document.id}`,
        type: 'document',
        label: document.title
      }
    ]
    const articleNumber = context.articleNumber
    const clauseNumber = context.clauseNumber
    const pointNumber = context.pointNumber

    if (articleNumber) {
      const localId = `source:article:${document.id}:${articleNumber}`
      const label = context.articleTitle
        ? `Article ${articleNumber}: ${context.articleTitle}`
        : `Article ${articleNumber}`
      nodeByLocalId.set(
        localId,
        sourceNode(localId, 'article', `article:${document.id}:${articleNumber}`, label, chunk, {
          articleNumber
        })
      )
      sourceNodes.push({ localId, type: 'article', label })
    }

    if (articleNumber && clauseNumber) {
      const localId = `source:clause:${document.id}:${articleNumber}:${clauseNumber}`
      const label = `Clause ${clauseNumber}, Article ${articleNumber}`
      nodeByLocalId.set(
        localId,
        sourceNode(
          localId,
          'clause',
          `clause:${document.id}:${articleNumber}:${clauseNumber}`,
          label,
          chunk,
          { articleNumber, clauseNumber }
        )
      )
      sourceNodes.push({ localId, type: 'clause', label })
    }

    if (articleNumber && clauseNumber && pointNumber) {
      const localId = `source:point:${document.id}:${articleNumber}:${clauseNumber}:${pointNumber}`
      const label = `Point ${pointNumber}, Clause ${clauseNumber}, Article ${articleNumber}`
      nodeByLocalId.set(
        localId,
        sourceNode(
          localId,
          'point',
          `point:${document.id}:${articleNumber}:${clauseNumber}:${pointNumber}`,
          label,
          chunk,
          { articleNumber, clauseNumber, pointNumber }
        )
      )
      sourceNodes.push({ localId, type: 'point', label })
    }

    return sourceNodes
  }

  private async extractSourceUnit(
    documentTitle: string,
    sourceNodes: LegalGraphPromptSourceNode[],
    sourceText: string,
    model: LanguageModel,
    abortSignal?: AbortSignal
  ): Promise<LegalGraphModelOutput> {
    const timeoutSignal = AbortSignal.timeout(90_000)
    const combinedSignal = abortSignal
      ? AbortSignal.any([abortSignal, timeoutSignal])
      : timeoutSignal

    try {
      const result = await generateText({
        model,
        experimental_output: Output.object({ schema: legalGraphOutputSchema }),
        prompt: buildLegalGraphPrompt(documentTitle, sourceNodes, sourceText),
        maxRetries: 2,
        abortSignal: combinedSignal
      })
      if (!result.experimental_output) {
        throw new LegalGraphRetryableError('No legal graph object generated')
      }
      return legalGraphOutputSchema.parse(result.experimental_output)
    } catch (error) {
      if (error instanceof LegalGraphRetryableError) throw error
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new LegalGraphRetryableError('Model did not produce a legal graph object', {
          cause: error
        })
      }
      if (error instanceof Error && error.name === 'ZodError') throw error
      throw new LegalGraphRetryableError('Legal graph model request failed', { cause: error })
    }
  }

  private mergeSourceUnit(
    chunk: Chunk,
    output: LegalGraphModelOutput,
    nodeByLocalId: Map<string, LegalGraphCandidateNode>,
    semanticNodeByKey: Map<string, LegalGraphCandidateNode>,
    relations: LegalGraphCandidateRelation[],
    relationFingerprints: Set<string>
  ): void {
    const endpointMap = new Map<string, string>()
    for (const sourceLocalId of nodeByLocalId.keys()) endpointMap.set(sourceLocalId, sourceLocalId)

    const outputLocalIds = new Set<string>()
    for (const node of output.nodes) {
      if (outputLocalIds.has(node.localId) || nodeByLocalId.has(node.localId)) {
        throw new Error('Duplicate legal graph extracted node ID')
      }
      outputLocalIds.add(node.localId)
      const canonicalKey = semanticKey(node.type, node.label)
      let candidateNode = semanticNodeByKey.get(canonicalKey)
      if (!candidateNode) {
        const localId = `semantic:${node.type}:${stableHash(canonicalKey)}`
        candidateNode = {
          localId,
          nodeType: node.type,
          canonicalKey,
          label: normalizeText(node.label),
          aliases: uniqueStrings(node.aliases),
          chunkId: chunk.id,
          startOffset: chunk.startOffset ?? undefined,
          endOffset: chunk.endOffset ?? undefined
        }
        semanticNodeByKey.set(canonicalKey, candidateNode)
        nodeByLocalId.set(localId, candidateNode)
      } else {
        candidateNode.aliases = uniqueStrings([...candidateNode.aliases, ...node.aliases])
      }
      endpointMap.set(node.localId, candidateNode.localId)
    }

    for (const relation of output.relations) {
      const sourceLocalId = this.resolveEndpoint(relation.source, endpointMap, nodeByLocalId)
      const targetLocalId = this.resolveEndpoint(relation.target, endpointMap, nodeByLocalId)
      const evidence = locateNormalizedEvidence(chunk.content, relation.evidenceText)
      if (!evidence) throw new Error('Evidence text is not present in source chunk')

      const fingerprint = JSON.stringify([
        sourceLocalId,
        relation.type,
        targetLocalId,
        chunk.id,
        evidence.start,
        evidence.end
      ])
      if (relationFingerprints.has(fingerprint)) continue
      relationFingerprints.add(fingerprint)
      relations.push({
        sourceLocalId,
        targetLocalId,
        relationType: relation.type,
        evidenceChunkId: chunk.id,
        evidenceText: evidence.text,
        evidenceStartOffset: (chunk.startOffset ?? 0) + evidence.start,
        evidenceEndOffset: (chunk.startOffset ?? 0) + evidence.end,
        confidence: relation.confidence,
        qualifiers: relation.qualifiers
      })
    }
  }

  private resolveEndpoint(
    endpoint: string,
    endpointMap: Map<string, string>,
    nodeByLocalId: Map<string, LegalGraphCandidateNode>
  ): string {
    const resolved = endpointMap.get(endpoint)
    if (resolved) return resolved
    if (!endpoint.startsWith('external:')) {
      throw new Error('Legal graph relation references an unknown extracted node')
    }

    const label = normalizeText(endpoint.slice('external:'.length))
    if (!label) throw new Error('Legal graph external reference is empty')
    const canonicalKey = semanticKey('external_reference', label)
    const localId = `semantic:external_reference:${stableHash(canonicalKey)}`
    if (!nodeByLocalId.has(localId)) {
      nodeByLocalId.set(localId, {
        localId,
        nodeType: 'external_reference',
        canonicalKey,
        label,
        aliases: [],
        metadata: { unresolved: true }
      })
    }
    endpointMap.set(endpoint, localId)
    return localId
  }
}
