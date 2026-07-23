import type {
  LegalGraphDocumentStatus,
  LegalReasoningEvidence,
  LegalReasoningIntent,
  LegalReasoningPath,
  LegalReasoningResult,
  LegalRelationType
} from '../../../shared/types/legalReasoning'
import { LEGAL_RELATION_TYPES } from '../../../shared/types/legalReasoning'
import {
  LegalComparisonService,
  getCanonicalLegalWorkKey,
  isLegalApplicabilityQuery,
  type LegalComparisonEvidence
} from '../LegalComparisonService'
import type {
  LegalDocumentGraph,
  LegalGraphTraversalOptions,
  LegalGraphTraversalPath,
  LegalGraphRepository
} from './LegalGraphRepository'

const MINIMUM_RELATION_CONFIDENCE = 0.75
const MAX_REASONING_PATHS = 3
const MAX_EXPANDED_EVIDENCE = 8

export interface LegalReasoningSeed extends LegalComparisonEvidence {
  notebookId: string
}

export type { LegalReasoningEvidence }

export type LegalReasoningEvidenceLoader = (
  notebookId: string,
  chunkIds: string[]
) => LegalReasoningEvidence[]

interface LegalReasoningRepository {
  getDocumentGraphStatus(documentId: string): LegalGraphDocumentStatus
  getDocumentGraph(documentId: string): LegalDocumentGraph
  traverse(options: LegalGraphTraversalOptions): LegalGraphTraversalPath[]
}

const predicatesByIntent = {
  sanction: [
    'requires',
    'prohibits',
    'condition_for',
    'exception_to',
    'sanction_for',
    'references'
  ],
  obligation: ['requires', 'condition_for', 'exception_to', 'references'],
  permission: ['permits', 'condition_for', 'exception_to', 'references'],
  prohibition: ['prohibits', 'exception_to', 'sanction_for', 'references'],
  definition: ['defines', 'references'],
  condition: ['condition_for', 'requires', 'permits', 'prohibits', 'references'],
  exception: ['exception_to', 'condition_for', 'references'],
  comparison: ['amends', 'replaces', 'repeals', 'references'],
  applicability: ['amends', 'replaces', 'repeals', 'applies_to', 'exception_to']
} satisfies Partial<Record<LegalReasoningIntent, LegalRelationType[]>>

const primaryPredicatesByIntent: Partial<Record<LegalReasoningIntent, LegalRelationType[]>> = {
  sanction: ['sanction_for'],
  obligation: ['requires'],
  permission: ['permits'],
  prohibition: ['prohibits'],
  definition: ['defines'],
  condition: ['condition_for'],
  exception: ['exception_to'],
  comparison: ['amends', 'replaces', 'repeals'],
  applicability: ['applies_to', 'amends', 'replaces', 'repeals']
}

function normalizedQuery(query: string): string {
  return query.normalize('NFC').toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ').trim()
}

export function classifyLegalReasoningIntent(query: string): LegalReasoningIntent {
  const normalized = normalizedQuery(query)
  if (/xử\s*lý|xử\s*phạt|bị\s*phạt|phạt\s*(tiền)?|chế\s*tài|hậu\s*quả/iu.test(normalized)) {
    return 'sanction'
  }
  if (/không\s*được|nghiêm\s*cấm|\bcấm\b/iu.test(normalized)) return 'prohibition'
  if (/có\s*quyền|được\s*phép|được\s*quyền|quyền\s*gì/iu.test(normalized)) {
    return 'permission'
  }
  if (/nghĩa\s*vụ|trách\s*nhiệm|\bphải\b|bắt\s*buộc/iu.test(normalized)) {
    return 'obligation'
  }
  if (/ngoại\s*lệ|trừ\s*trường\s*hợp|loại\s*trừ/iu.test(normalized)) return 'exception'
  if (/điều\s*kiện|khi\s*nào|trong\s*trường\s*hợp/iu.test(normalized)) return 'condition'
  if (/định\s*nghĩa|được\s*hiểu|khái\s*niệm|là\s*gì/iu.test(normalized)) {
    return 'definition'
  }
  if (isLegalApplicabilityQuery(normalized)) return 'applicability'
  if (/so\s*sánh|đối\s*chiếu|khác\s*nhau|mâu\s*thuẫn|xung\s*đột|quan\s*hệ|viện\s*dẫn|tham\s*chiếu/iu.test(normalized)) {
    return 'comparison'
  }
  return 'general'
}

function includesNormalized(content: string, evidenceText: string): boolean {
  return content.normalize('NFC').includes(evidenceText.normalize('NFC'))
}

function matchingSeedNodeIds(
  graph: LegalDocumentGraph,
  seed: LegalReasoningSeed
): string[] {
  const articleNumber = seed.legalContext?.articleNumber
  const clauseNumber = seed.legalContext?.clauseNumber
  const pointNumber = seed.legalContext?.pointNumber
  const coordinateMatches = graph.nodes.filter((node) => {
    if (!articleNumber || node.articleNumber !== articleNumber) return false
    if (pointNumber) {
      return node.clauseNumber === clauseNumber && node.pointNumber === pointNumber
    }
    if (clauseNumber) {
      return node.clauseNumber === clauseNumber && !node.pointNumber
    }
    return !node.clauseNumber && !node.pointNumber
  })

  if (coordinateMatches.length > 0) return coordinateMatches.map((node) => node.id)
  return graph.nodes.filter((node) => node.chunkId === seed.chunkId).map((node) => node.id)
}

function graphStatusForSeeds(
  repository: LegalReasoningRepository,
  seeds: LegalReasoningSeed[]
): {
  status: LegalReasoningResult['graphStatus']
  readyDocumentIds: Set<string>
  limitations: string[]
} {
  const statuses = new Map<string, LegalGraphDocumentStatus>()
  for (const seed of seeds) {
    if (!statuses.has(seed.documentId)) {
      statuses.set(seed.documentId, repository.getDocumentGraphStatus(seed.documentId))
    }
  }
  const readyDocumentIds = new Set(
    [...statuses.entries()]
      .filter((entry) => entry[1].status === 'ready' || entry[1].relationCount > 0)
      .map((entry) => entry[0])
  )
  if (readyDocumentIds.size > 0) {
    const limitations: string[] = []
    if (
      [...statuses.values()].some(
        (item) =>
          item.relationCount > 0 &&
          (item.status === 'pending' || item.status === 'processing' || item.status === 'retry')
      )
    ) {
      limitations.push('Legal graph refresh is pending; existing verified graph remains in use.')
    }
    if ([...statuses.values()].some((item) => item.relationCount > 0 && item.status === 'failed')) {
      limitations.push('Legal graph refresh failed; existing verified graph remains in use.')
    }
    return { status: 'ready', readyDocumentIds, limitations }
  }

  const values = [...statuses.values()].map((item) => item.status)
  if (
    values.some((status) => status === 'pending' || status === 'processing' || status === 'retry')
  ) {
    return { status: 'pending', readyDocumentIds, limitations: [] }
  }
  if (values.some((status) => status === 'failed')) {
    return { status: 'failed', readyDocumentIds, limitations: [] }
  }
  return { status: 'unavailable', readyDocumentIds, limitations: [] }
}

function buildContext(paths: LegalReasoningPath[]): string {
  if (paths.length === 0) return ''
  const sections = paths.map((path, pathIndex) => {
    const lines = path.steps.map((step) => {
      const citations = step.citationIds.map((citationId) => `[${citationId}]`).join('')
      return `${citations} ${step.sourceLabel} --${step.relationType}--> ${step.targetLabel}`
    })
    return [`\u0110\u01af\u1edcNG D\u1eaaN B\u1eb0NG CH\u1ee8NG ${pathIndex + 1}`, ...lines].join(
      '\n'
    )
  })
  sections.push(
    'Ch\u1ec9 d\u00f9ng quan h\u1ec7 tr\u00ean khi tr\u00edch d\u1eabn ngu\u1ed3n t\u01b0\u01a1ng \u1ee9ng. Kh\u00f4ng t\u1ea1o quan h\u1ec7 m\u1edbi.'
  )
  return sections.join('\n\n')
}

function relationWeight(intent: LegalReasoningIntent, relationTypes: LegalRelationType[]): number {
  const primary = new Set(primaryPredicatesByIntent[intent] ?? [])
  return relationTypes.some((relationType) => primary.has(relationType)) ? 1 : 0.9
}

export class LegalReasoningService {
  private readonly repository: LegalReasoningRepository

  constructor(
    repository: LegalReasoningRepository | LegalGraphRepository,
    private readonly evidenceLoader: LegalReasoningEvidenceLoader,
    private readonly comparisonService = new LegalComparisonService()
  ) {
    this.repository = repository
  }

  reason(query: string, seeds: LegalReasoningSeed[]): LegalReasoningResult {
    const intent = classifyLegalReasoningIntent(query)
    const notebookIds = [...new Set(seeds.map((seed) => seed.notebookId))]
    const limitations: string[] = []
    const comparison =
      intent === 'comparison' || intent === 'applicability'
        ? this.comparisonService.compare(query, seeds)
        : undefined

    if (seeds.length === 0 || notebookIds.length !== 1) {
      return {
        intent,
        graphStatus: 'unavailable',
        paths: [],
        limitations: ['No notebook-scoped legal evidence was available.'],
        evidence: [],
        context: '',
        comparison
      }
    }

    const notebookId = notebookIds[0]
    const graphState = graphStatusForSeeds(this.repository, seeds)
    limitations.push(...graphState.limitations)
    if (graphState.status !== 'ready') {
      const messages = {
        pending: 'Legal graph extraction is still pending.',
        failed: 'Legal graph extraction failed; direct source evidence remains available.',
        unavailable: 'No ready legal graph is available for retrieved evidence.'
      } as const
      return {
        intent,
        graphStatus: graphState.status,
        paths: [],
        limitations: [messages[graphState.status]],
        evidence: seeds,
        context: '',
        comparison
      }
    }

    const canonicalSeedWorkByDocumentId = new Map(
      seeds.map((seed) => [
        seed.documentId,
        getCanonicalLegalWorkKey(seed.metadata) || `document:${seed.documentId}`
      ])
    )
    const graphByDocumentId = new Map<string, LegalDocumentGraph>()
    const nodeDocumentIdByNodeId = new Map<string, string>()
    for (const documentId of graphState.readyDocumentIds) {
      const graph = this.repository.getDocumentGraph(documentId)
      graphByDocumentId.set(documentId, graph)
      for (const node of graph.nodes) {
        if (node.documentId) nodeDocumentIdByNodeId.set(node.id, node.documentId)
      }
    }

    const seedScoreByNodeId = new Map<string, number>()
    for (const seed of seeds) {
      if (!graphState.readyDocumentIds.has(seed.documentId)) continue
      const graph = graphByDocumentId.get(seed.documentId)
      if (!graph) continue
      for (const nodeId of matchingSeedNodeIds(graph, seed)) {
        seedScoreByNodeId.set(nodeId, Math.max(seedScoreByNodeId.get(nodeId) ?? 0, seed.score))
      }
    }
    if (seedScoreByNodeId.size === 0) {
      return {
        intent,
        graphStatus: 'ready',
        paths: [],
        limitations: ['Retrieved chunks do not map to ready legal graph nodes.'],
        evidence: seeds,
        context: '',
        comparison
      }
    }

    const relationTypes = predicatesByIntent[intent] ?? [...LEGAL_RELATION_TYPES]
    const traversalPaths = this.repository.traverse({
      notebookId,
      seedNodeIds: [...seedScoreByNodeId.keys()],
      relationTypes,
      maxDepth: 4,
      maxPaths: 20,
      minimumConfidence: MINIMUM_RELATION_CONFIDENCE
    })
    const eligibleTraversalPaths =
      intent === 'comparison'
        ? traversalPaths.filter((path) => {
            const canonicalWorks = new Set(
              path.nodeIds.flatMap((nodeId) => {
                const documentId = nodeDocumentIdByNodeId.get(nodeId)
                const canonicalWork = documentId
                  ? canonicalSeedWorkByDocumentId.get(documentId)
                  : undefined
                return canonicalWork ? [canonicalWork] : []
              })
            )
            return canonicalWorks.size >= 2
          })
        : traversalPaths
    const requestedChunkIds = [
      ...new Set(
        eligibleTraversalPaths.flatMap((path) => path.steps.map((step) => step.evidenceChunkId))
      )
    ]
    const evidenceByChunkId = new Map<string, LegalReasoningEvidence>()
    for (const seed of seeds) evidenceByChunkId.set(seed.chunkId, seed)
    for (const evidence of this.evidenceLoader(notebookId, requestedChunkIds)) {
      if (evidence.notebookId === notebookId) evidenceByChunkId.set(evidence.chunkId, evidence)
    }

    const citationByChunkId = new Map(seeds.map((seed) => [seed.chunkId, seed.citationId]))
    let nextCitationId = Math.max(0, ...seeds.map((seed) => seed.citationId)) + 1
    let expandedEvidenceCount = 0
    let rejectedForInvalidEvidence = false
    const acceptedPaths: LegalReasoningPath[] = []

    for (const path of eligibleTraversalPaths) {
      if (path.steps.some((step) => step.confidence < MINIMUM_RELATION_CONFIDENCE)) continue
      let valid = true
      for (const step of path.steps) {
        const evidence = evidenceByChunkId.get(step.evidenceChunkId)
        if (!evidence || !includesNormalized(evidence.content, step.evidenceText)) {
          valid = false
          break
        }
        if (!citationByChunkId.has(step.evidenceChunkId)) {
          if (expandedEvidenceCount >= MAX_EXPANDED_EVIDENCE) {
            valid = false
            break
          }
          citationByChunkId.set(step.evidenceChunkId, nextCitationId++)
          expandedEvidenceCount++
        }
      }
      if (!valid) {
        rejectedForInvalidEvidence = true
        continue
      }

      const seedScore = seedScoreByNodeId.get(path.nodeIds[0]) ?? 0
      const confidenceProduct = path.steps.reduce((product, step) => product * step.confidence, 1)
      const depthDecay = 0.82 ** Math.max(0, path.steps.length - 1)
      const evidenceCoverage =
        path.steps.filter((step) => evidenceByChunkId.has(step.evidenceChunkId)).length /
        path.steps.length
      const intentWeight = relationWeight(
        intent,
        path.steps.map((step) => step.relationType)
      )
      acceptedPaths.push({
        score: Math.min(
          1,
          seedScore * confidenceProduct * depthDecay * evidenceCoverage * intentWeight
        ),
        minimumConfidence: Math.min(...path.steps.map((step) => step.confidence)),
        steps: path.steps.map((step) => ({
          relationId: step.relationId,
          relationType: step.relationType,
          sourceNodeId: step.sourceNodeId,
          sourceLabel: step.sourceLabel,
          targetNodeId: step.targetNodeId,
          targetLabel: step.targetLabel,
          confidence: step.confidence,
          citationIds: [citationByChunkId.get(step.evidenceChunkId)!]
        }))
      })
    }

    acceptedPaths.sort((left, right) => right.score - left.score)
    const bestMultiHopPath = acceptedPaths.find((path) => path.steps.length >= 2)
    const paths = [
      ...(bestMultiHopPath ? [bestMultiHopPath] : []),
      ...acceptedPaths.filter((path) => path !== bestMultiHopPath)
    ].slice(0, MAX_REASONING_PATHS)
    if (paths.length === 0 && rejectedForInvalidEvidence) {
      limitations.push('Graph paths were rejected because source evidence could not be validated.')
    }
    const usedCitationIds = new Set(
      paths.flatMap((path) => path.steps.flatMap((step) => step.citationIds))
    )
    const evidence = [...evidenceByChunkId.values()]
      .map((item) => ({ ...item, citationId: citationByChunkId.get(item.chunkId) }))
      .filter((item) => item.citationId != null && usedCitationIds.has(item.citationId))
      .sort((left, right) => left.citationId! - right.citationId!)

    return {
      intent,
      graphStatus: 'ready',
      paths,
      limitations,
      evidence,
      context: buildContext(paths),
      comparison
    }
  }
}
