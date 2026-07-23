const STOP_WORDS = new Set([
  'bao', 'ban', 'cac', 'cho', 'cua', 'dinh', 'duoc', 'gi', 'hay', 'khong', 'la', 'luat',
  'muc', 'nam', 'nao', 'neu', 'nghi', 'nhieu', 'notebook', 'quy', 'tai', 'tat', 'theo',
  'thong', 'tom', 'trong', 'tu', 'van', 've', 'voi'
])

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/giu, 'd')
    .toLocaleLowerCase('vi-VN')
}

function compact(value: string): string {
  return normalize(value).replace(/[^a-z0-9]/g, '')
}

function identifiers(query: string): { articles: string[]; documents: string[] } {
  const normalized = normalize(query)
  const documentNumbers = normalized.match(/\b\d{1,4}[\/_.-]\d{4}(?:[\/_.-][a-z0-9-]+)*/gu) || []
  const articleNumbers = [...normalized.matchAll(/\b(?:dieu|khoan)\s+(\d+[a-z]?)/gu)].map(
    (match) => match[1]
  )
  const standaloneYears = normalized.match(/\b(?:19|20)\d{2}\b/gu) || []
  return {
    articles: [...new Set(articleNumbers.map(compact))],
    documents: [...new Set([...documentNumbers, ...standaloneYears].map(compact))]
  }
}

function meaningfulTokens(query: string): string[] {
  return [...new Set(
    normalize(query)
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  )]
}

export function filterRelevantEvidence<T extends { content: string; documentTitle: string }>(
  query: string,
  results: T[]
): T[] {
  const requiredIdentifiers = identifiers(query)
  const queryTokens = meaningfulTokens(query)
  if (
    queryTokens.length <= 1 &&
    requiredIdentifiers.articles.length === 0 &&
    requiredIdentifiers.documents.length === 0
  ) return results
  const titlesContainDocumentNumber = results.some((result) => /(?:19|20)\d{2}/u.test(result.documentTitle))
  const documentRelationFallback =
    requiredIdentifiers.documents.length >= 2 && !titlesContainDocumentNumber
  const rareTokens = queryTokens.filter((token) => token.length >= 7)

  return results.filter((result) => {
    const haystack = normalize(`${result.documentTitle}\n${result.content}`)
    const compactHaystack = compact(haystack)
    const matchesDocumentIdentifier = requiredIdentifiers.documents.some((identifier) =>
      compactHaystack.includes(identifier)
    )
    if (requiredIdentifiers.articles.length > 0 && !requiredIdentifiers.articles.some(
      (identifier) => compactHaystack.includes(identifier)
    )) {
      return false
    }
    if (
      titlesContainDocumentNumber &&
      requiredIdentifiers.documents.length > 0 &&
      !matchesDocumentIdentifier
    ) return false
    if (matchesDocumentIdentifier) return true
    if (rareTokens.length > 0 && !rareTokens.some((token) => haystack.includes(token))) return false
    if (documentRelationFallback) return true
    if (queryTokens.length <= 1) return true
    const overlap = queryTokens.filter((token) => haystack.includes(token)).length
    return overlap / queryTokens.length >= 0.1
  })
}
