/**
 * Article-number helpers for legal documents.
 *
 * Vietnamese legal questions often name an article ("Điều 8", "Điều 26",
 * "Điều 198b"). Retrieval is semantic, so the matching article may rank below
 * generic chunks. These helpers keep explicitly requested articles in front of
 * the context window after retrieval.
 */

const ARTICLE_REF_REGEX = /Điều\s+(\d+[a-z]?)/giu
const ARTICLE_HEADING_REGEX = /(?:^|\n)\s*#{1,4}\s*Điều\s+(\d+[a-z]?)\b/giu

export interface ArticleMatchable {
  sectionPath?: string[]
  content: string
  score: number
}

export function extractArticleRefs(query: string): string[] {
  const refs = new Set<string>()
  for (const match of query.matchAll(ARTICLE_REF_REGEX)) {
    refs.add(match[1].toLowerCase())
    if (refs.size >= 8) break
  }
  return [...refs]
}

/**
 * Find article headings that begin a retrieved chunk. This lets MiChat expand
 * an article whose section metadata was cut at the chapter boundary, without
 * treating every "Điều N" reference inside body text as a new article.
 */
export function extractArticleRefsFromContent(content: string, max = 2): string[] {
  const refs = new Set<string>()
  for (const match of content.matchAll(ARTICLE_HEADING_REGEX)) {
    refs.add(match[1].toLowerCase())
    if (refs.size >= max) break
  }
  return [...refs]
}

export function matchesArticleRef(text: string, refs: string[]): boolean {
  if (refs.length === 0) return false
  const haystack = text.toLowerCase()
  return refs.some((ref) => new RegExp(`Điều\\s+${ref}(?![0-9a-z])`, 'iu').test(haystack))
}

export function prioritizeArticleMatches<T extends ArticleMatchable>(
  refs: string[],
  results: T[]
): T[] {
  if (refs.length === 0 || results.length <= 1) return results

  return [...results].sort((left, right) => {
    const leftMatch = matchesArticleRef(
      [...(left.sectionPath ?? []), left.content.slice(0, 240)].join(' '),
      refs
    )
    const rightMatch = matchesArticleRef(
      [...(right.sectionPath ?? []), right.content.slice(0, 240)].join(' '),
      refs
    )
    if (leftMatch !== rightMatch) return leftMatch ? -1 : 1
    return right.score - left.score
  })
}

/**
 * Merge hierarchical and flat retrieval results by chunk id, keeping the
 * higher score. Hierarchical section scoping can miss an exact definition
 * chunk; the flat pass guarantees it stays in the candidate pool.
 */
export function mergeSearchResults<T extends { chunkId: string; score: number }>(
  primary: T[],
  secondary: T[]
): T[] {
  const byChunk = new Map<string, T>()
  for (const result of [...primary, ...secondary]) {
    const existing = byChunk.get(result.chunkId)
    if (!existing || result.score > existing.score) byChunk.set(result.chunkId, result)
  }
  return [...byChunk.values()].sort((left, right) => right.score - left.score)
}
