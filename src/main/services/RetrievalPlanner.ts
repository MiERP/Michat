import type { RetrievalPlan, MetadataConstraint } from '../../shared/types/retrieval'
import { detectQueryMetadata, normalizeMetadataValue } from '../utils/queryMetadata'

export interface RetrievalPlanningDocument {
  id: string
  metadata?: Record<string, unknown> | null
}

export interface ExplicitRetrievalScope {
  documentIds?: string[]
  documentTypes?: string[]
  sourceUriContains?: string
  sectionPath?: string[]
  pageRange?: { from: number; to: number }
  documentMetadata?: Record<string, string>
}

function rootMetadataFor(document: RetrievalPlanningDocument): Record<string, unknown> {
  const metadata = document.metadata
  return metadata && typeof metadata === 'object' ? metadata : {}
}

function metadataFor(document: RetrievalPlanningDocument): Record<string, unknown> {
  const legal = rootMetadataFor(document).documentMetadata
  return legal && typeof legal === 'object' && !Array.isArray(legal)
    ? (legal as Record<string, unknown>)
    : {}
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
}

function genericMetadataValues(
  document: RetrievalPlanningDocument
): Array<{ field: 'entity' | 'keyword' | 'tag' | 'issuedAt' | 'documentTitle'; value: string }> {
  const root = rootMetadataFor(document)
  const legal = metadataFor(document)
  const enrichment =
    root.enrichment && typeof root.enrichment === 'object' && !Array.isArray(root.enrichment)
      ? (root.enrichment as Record<string, unknown>)
      : {}

  const values: Array<{
    field: 'entity' | 'keyword' | 'tag' | 'issuedAt' | 'documentTitle'
    value: string
  }> = []
  for (const value of stringList(enrichment.entities)) values.push({ field: 'entity', value })
  for (const value of stringList(enrichment.keywords)) values.push({ field: 'keyword', value })
  for (const value of stringList(root.tags)) values.push({ field: 'tag', value })
  if (typeof legal.issuedAt === 'string') values.push({ field: 'issuedAt', value: legal.issuedAt })
  if (typeof legal.documentTitle === 'string') {
    values.push({ field: 'documentTitle', value: legal.documentTitle })
  }
  return values
}

function queryContainsMetadataValue(query: string, field: string, value: string): boolean {
  const normalizedQuery = normalizeMetadataValue(query)
  const normalizedValue = normalizeMetadataValue(value)
  if (normalizedValue.length < 3) return false
  if (normalizedQuery.includes(normalizedValue)) return true

  if (field === 'issuedAt') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return false
    return normalizedQuery.includes(normalizeMetadataValue(`${match[3]}/${match[2]}/${match[1]}`))
  }

  return false
}

function equalsMetadata(actual: unknown, expected: string): boolean {
  return (
    typeof actual === 'string' &&
    normalizeMetadataValue(actual) === normalizeMetadataValue(expected)
  )
}

function matchesDocumentNumber(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false

  const stored = normalizeMetadataValue(actual)
  const target = normalizeMetadataValue(expected)
  const targetHasYear = /^\d{1,4}\s*\/\s*\d{4}\s*\//.test(expected)

  if (targetHasYear) return stored === target

  // A common user shorthand omits the year: 15/NĐ-CP should still resolve
  // 15/2024/NĐ-CP when that number is unique in the scoped corpus.
  const storedWithoutYear = stored.replace(/^(\d{1,4})\d{4}(?=[A-Z])/, '$1')
  return storedWithoutYear === target
}

/**
 * Metadata inferred from a question is only a ranking hint. The broad result
 * set therefore remains the candidate set; the preferred pass may reorder
 * candidates already found broadly and may fill empty slots, but cannot evict
 * semantic evidence solely because it lacks the inferred metadata.
 */
export function mergePreferredAndBroadResults<T extends { chunkId: string }>(
  preferred: T[],
  broad: T[],
  limit: number
): T[] {
  const safeLimit = Math.max(0, limit)
  if (safeLimit === 0) return []

  const preferredRank = new Map(preferred.map((result, index) => [result.chunkId, index + 1]))
  const rankedBroad = broad
    .map((result, index) => {
      const broadScore = 2 / (60 + index + 1)
      const hintRank = preferredRank.get(result.chunkId)
      const preferredScore = hintRank === undefined ? 0 : 1 / (60 + hintRank)
      return { result, fusedScore: broadScore + preferredScore, broadRank: index }
    })
    .sort((left, right) => right.fusedScore - left.fusedScore || left.broadRank - right.broadRank)
    .map(({ result }) => result)

  const seen = new Set(rankedBroad.map((result) => result.chunkId))
  for (const result of preferred) {
    if (rankedBroad.length >= safeLimit) break
    if (seen.has(result.chunkId)) continue
    rankedBroad.push(result)
    seen.add(result.chunkId)
  }

  return rankedBroad.slice(0, safeLimit)
}

function userConstraints(scope?: ExplicitRetrievalScope): MetadataConstraint[] {
  if (!scope) return []
  const constraints: MetadataConstraint[] = []
  const add = (field: string, values: string[]) => {
    if (values.length)
      constraints.push({
        field,
        values,
        mode: 'hard',
        source: 'user',
        confidence: 1,
        reason: 'Explicit user scope'
      })
  }
  add('documentIds', scope.documentIds ?? [])
  add('documentTypes', scope.documentTypes ?? [])
  add('sectionPath', scope.sectionPath ?? [])
  if (scope.sourceUriContains) add('sourceUriContains', [scope.sourceUriContains])
  if (scope.pageRange) add('pageRange', [`${scope.pageRange.from}-${scope.pageRange.to}`])
  for (const [field, value] of Object.entries(scope.documentMetadata ?? {})) add(field, [value])
  return constraints
}

function matchesScope(
  document: RetrievalPlanningDocument,
  scope?: ExplicitRetrievalScope
): boolean {
  if (!scope) return true
  if (scope.documentIds && !scope.documentIds.includes(document.id)) return false
  return true
}

/**
 * Resolves query metadata conservatively. Ambiguous semantic signals are hints;
 * only a unique, exact document number is allowed to narrow the corpus.
 */
export function createRetrievalPlan(
  query: string,
  documents: RetrievalPlanningDocument[],
  explicitScope?: ExplicitRetrievalScope
): RetrievalPlan {
  const hardConstraints = userConstraints(explicitScope)
  const preferredConstraints: MetadataConstraint[] = []
  const signals = detectQueryMetadata(query)
  const scopedDocuments = documents.filter((document) => matchesScope(document, explicitScope))
  let preferredDocumentIds: string[] = []

  if (signals.documentNumber) {
    const exact = scopedDocuments.filter((document) =>
      matchesDocumentNumber(metadataFor(document).documentNumber, signals.documentNumber!)
    )
    if (exact.length === 1) {
      const documentNumber = String(metadataFor(exact[0]).documentNumber)
      hardConstraints.push({
        field: 'documentNumber',
        values: [documentNumber],
        mode: 'hard',
        source: 'query-resolver',
        confidence: 1,
        reason: 'Unique exact document number in the indexed corpus'
      })
      preferredDocumentIds = [exact[0].id]
    }
  }

  const preferredMatches = new Set<string>()
  const addPreferred = (field: 'documentType' | 'issuer', normalizedValues: string[]) => {
    for (const value of normalizedValues) {
      const matching = scopedDocuments.filter((document) =>
        equalsMetadata(metadataFor(document)[field], value)
      )
      if (!matching.length) continue
      preferredConstraints.push({
        field,
        values: [String(metadataFor(matching[0])[field])],
        mode: 'preferred',
        source: 'query-resolver',
        confidence: 0.7,
        reason: 'Semantic metadata signal; broad retrieval remains available'
      })
      matching.forEach((document) => preferredMatches.add(document.id))
    }
  }
  addPreferred('documentType', signals.documentTypes)
  addPreferred('issuer', signals.issuers)

  const seenGeneric = new Set<string>()
  for (const document of scopedDocuments) {
    for (const entry of genericMetadataValues(document)) {
      if (!queryContainsMetadataValue(query, entry.field, entry.value)) continue
      preferredMatches.add(document.id)
      const key = `${entry.field}:${normalizeMetadataValue(entry.value)}`
      if (seenGeneric.has(key)) continue
      seenGeneric.add(key)
      preferredConstraints.push({
        field: entry.field,
        values: [entry.value],
        mode: 'preferred',
        source: 'query-resolver',
        confidence: entry.field === 'issuedAt' ? 0.9 : 0.75,
        reason: `Indexed ${entry.field} appears in the query; broad retrieval remains available`
      })
    }
  }
  if (!preferredDocumentIds.length) preferredDocumentIds = Array.from(preferredMatches)

  return { version: 1, hardConstraints, preferredConstraints, preferredDocumentIds }
}
