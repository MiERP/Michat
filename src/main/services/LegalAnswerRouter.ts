export type LegalAnswerRoute =
  | 'no_evidence'
  | 'direct_lookup'
  | 'compact_synthesis'
  | 'deep_reasoning'
  | 'remote_complex'

export interface LegalAnswerEvidenceRef {
  documentId: string
}

export interface LegalAnswerRoutingInput {
  query: string
  evidence: LegalAnswerEvidenceRef[]
  allowRemote?: boolean
  remoteAvailable?: boolean
}

export interface LegalAnswerRoutingDecision {
  route: LegalAnswerRoute
  requiresModel: boolean
  useGraph: boolean
  maxOutputTokens: number
  maxHistoryMessages: number
}

function normalizeQuery(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/giu, 'd')
    .toLocaleLowerCase('vi-VN')
}

export function matchesLegalDocumentMention(
  query: string,
  title: string,
  documentNumber?: string
): boolean {
  const normalizedQuery = normalizeQuery(query)
  const compactQuery = normalizedQuery.replace(/[^a-z0-9]/g, '')
  if (documentNumber && compactQuery.includes(normalizeQuery(documentNumber).replace(/[^a-z0-9]/g, ''))) {
    return true
  }
  const titleTokens = normalizeQuery(title.replace(/\.[^.]+$/u, ''))
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2 && !/^(?:luat|nghi|dinh|qh\d+|nd|cp|pdf|docx)$/u.test(token))
  const distinctive = titleTokens.filter((token) => !/^\d+$/u.test(token))
  const keywordMatches = distinctive.filter((token) => normalizedQuery.includes(token)).length
  const titleYears = titleTokens.filter((token) => /^(?:19|20)\d{2}$/u.test(token))
  return keywordMatches >= 2 && (titleYears.length === 0 || titleYears.some((year) => normalizedQuery.includes(year)))
}

export function matchesExplicitLegalFileMention(query: string, title: string): boolean {
  const compactQuery = normalizeQuery(query).replace(/[^a-z0-9]/g, '')
  const compactTitle = normalizeQuery(title).replace(/[^a-z0-9]/g, '')
  return compactTitle.length > 0 && compactQuery.includes(compactTitle)
}

export function selectFallbackLegalChunks<T extends { chunkIndex: number; content: string }>(
  query: string,
  chunks: T[],
  limit = 2
): T[] {
  const tokens = normalizeQuery(query).split(/[^a-z0-9]+/u).filter((token) => token.length >= 3)
  return chunks
    .map((chunk) => {
      const content = normalizeQuery(chunk.content)
      const overlap = tokens.filter((token) => content.includes(token)).length
      const scopeBonus = /pham vi dieu chinh|doi tuong ap dung/u.test(content) ? 10 : 0
      const openingBonus = chunk.chunkIndex < 12 ? 2 : 0
      return { chunk, score: overlap + scopeBonus + openingBonus }
    })
    .sort((left, right) => right.score - left.score || left.chunk.chunkIndex - right.chunk.chunkIndex)
    .slice(0, limit)
    .map((item) => item.chunk)
}

export function interleaveEvidenceGroups<T>(groups: T[][]): T[] {
  const result: T[] = []
  const maxLength = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      if (group[index] !== undefined) result.push(group[index])
    }
  }
  return result
}

function isDirectLookup(query: string): boolean {
  const normalized = normalizeQuery(query)
  return (
    /\b(dieu|khoan)\s+\d+[a-z]?\b/u.test(normalized) ||
    /\b(la gi|dinh nghia|khai niem)\b/u.test(normalized)
  )
}

export function isCompleteDirectLookup(query: string): boolean {
  const normalized = normalizeQuery(query)
  return /\b(day du|tat ca|khong bo sot|toan bo)\b/u.test(normalized)
}

export function isNarrowLegalScopeComparison(query: string): boolean {
  const normalized = normalizeQuery(query)
  return /\bpham vi dieu chinh\b/u.test(normalized) && /\b(so sanh|doi chieu|khac nhau)\b/u.test(normalized)
}

export function routeLegalAnswer(input: LegalAnswerRoutingInput): LegalAnswerRoutingDecision {
  if (input.evidence.length === 0) {
    return {
      route: 'no_evidence',
      requiresModel: false,
      useGraph: false,
      maxOutputTokens: 0,
      maxHistoryMessages: 0
    }
  }

  if (isDirectLookup(input.query)) {
    return {
      route: 'direct_lookup',
      requiresModel: false,
      useGraph: false,
      maxOutputTokens: 0,
      maxHistoryMessages: 0
    }
  }

  const documentCount = new Set(input.evidence.map((item) => item.documentId)).size
  if (documentCount === 1) {
    return {
      route: 'compact_synthesis',
      requiresModel: true,
      useGraph: false,
      maxOutputTokens: 64,
      maxHistoryMessages: 2
    }
  }

  if (input.allowRemote && input.remoteAvailable) {
    return {
      route: 'remote_complex',
      requiresModel: true,
      useGraph: true,
      maxOutputTokens: 512,
      maxHistoryMessages: 4
    }
  }

  return {
    route: 'deep_reasoning',
    requiresModel: true,
    useGraph: !isNarrowLegalScopeComparison(input.query),
    maxOutputTokens: 128,
    maxHistoryMessages: 4
  }
}
