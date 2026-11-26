/**
 * Helpers for turning overlapping legal-document chunks into clean context.
 *
 * Chunks overlap so a sentence split across a boundary can still be read.
 * When several adjacent chunks are sent to the model, that overlap must be
 * removed or the model sees duplicated clauses and can invent an extra list
 * item.
 */

export interface OffsetChunk {
  content: string
  startOffset: number
  endOffset: number
}

function normalizeLawText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when the question names a concrete law, not a generic "luật này" or
 * "luật hiện hành". Used to stop structural retrieval from falling back to an
 * unrelated law that happens to have the same article number.
 *
 * The list only needs to be right in one direction: treating a specific law
 * as generic is safe (normal seed/whole-notebook behaviour), while treating a
 * generic phrase as specific makes the guards below return nothing. So the
 * stopword list is deliberately generous and includes the interrogative and
 * verb forms questions actually start with ("Luật nào...", "Luật gồm...",
 * "Luật có hiệu lực...").
 */
const GENERIC_LAW_PHRASES =
  /^(?:nay|do|hien hanh|sua doi|khac|quy dinh|duoc|noi|tren|bo sung|thong tu|nghi dinh|phap|viet nam|su|le|thoi|chung|nha nuoc|nao|gi|gom|co|sao|bao gio|khi nao|the nao|tu khi|nhung|cac|ve)\b/u

export function namesSpecificLaw(query: string): boolean {
  const normalized = normalizeLawText(query)
  const match = normalized.match(/\b(?:bo\s+)?luat\s+(.+)$/u)
  if (!match) return false
  const rest = match[1].trim()
  if (!rest) return false
  if (/\d{4}/.test(rest)) return true
  return !GENERIC_LAW_PHRASES.test(rest)
}

/**
 * Longest suffix of `previous` that is also a prefix of `next`.
 *
 * Source offsets are a useful ordering hint but can be a few characters off
 * after whitespace normalization. Comparing the actual text is exact and also
 * handles chunk overlaps that begin or end mid-word.
 */
function textOverlap(previous: string, next: string): number {
  const max = Math.min(400, previous.length, next.length)
  for (let length = max; length >= 12; length -= 1) {
    if (previous.endsWith(next.slice(0, length))) return length
  }
  return 0
}

/** Merge chunks by source order, removing the overlapping text exactly once. */
export function mergeOverlappingChunks(chunks: OffsetChunk[]): string {
  if (chunks.length === 0) return ''

  const ordered = [...chunks].sort((left, right) => left.startOffset - right.startOffset)
  let merged = ''

  for (const chunk of ordered) {
    if (!merged) {
      merged = chunk.content
      continue
    }
    merged += chunk.content.slice(textOverlap(merged, chunk.content))
  }

  return merged
}

/**
 * Extract the term from a definition question.
 *
 * Examples:
 * - "Luật Dữ liệu định nghĩa dữ liệu quan trọng là gì?" -> "dữ liệu quan trọng"
 * - "Thế nào là dữ liệu cốt lõi?" -> "dữ liệu cốt lõi"
 */
export function extractDefinitionTerm(query: string): string | null {
  const cleaned = query.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null

  // "Định nghĩa dữ liệu quan trọng" (no "là gì" suffix).
  const directDefinition = cleaned.match(
    /^(?:định nghĩa|khái niệm|giải thích(?:\s+từ\s+ngữ)?)\s+(?:về\s+)?(.+)$/iu
  )
  if (directDefinition && !/là\s+gì/iu.test(cleaned)) {
    const term = directDefinition[1].trim().replace(/[.,;:]+$/u, '')
    if (term.length >= 3) return term
  }

  // Strip a leading "Định nghĩa tại Điều 3," / "Khái niệm về" prefix before
  // looking for the term itself.
  const withoutDefinitionPrefix = cleaned.replace(
    /^(?:định nghĩa|khái niệm|giải thích(?:\s+từ\s+ngữ)?)(?:\s+tại\s+[^,]+,\s*|\s+về\s+)?/iu,
    ''
  )

  const patterns = [
    /^(.+?)\s+(?:được\s+)?(?:định nghĩa|hiểu)\s+là\s+gì\??\s*$/iu,
    /(?:định nghĩa|khái niệm|giải thích(?:\s+từ\s+ngữ)?)\s+(?:về\s+)?(.+?)(?:\s+là\s+gì|\s+như\s+thế\s+nào|\?|$)/iu,
    /^(.+?)\s+là\s+gì\??\s*$/iu,
    /^\s*thế\s+nào\s+là\s+(.+?)\??\s*$/iu
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(withoutDefinitionPrefix)
    let term = match?.[1]?.trim().replace(/[.,;:]+$/u, '')
    if (!term) continue
    term = term
      .replace(/\s+(?:được\s+)?(?:định nghĩa|hiểu)$/iu, '')
      .replace(/^(?:theo\s+[^,]+,\s*)/iu, '')
      .trim()
    if (term && term.length >= 3) return term
  }

  return null
}

/**
 * Remove the leading text of `next` that repeats the end of a recently
 * included chunk in the same section. This is the fallback for retrieval paths
 * that do not expose source offsets; article/definition blocks use
 * `mergeOverlappingChunks` for exact offset-based merging.
 *
 * Chunker overlap only bridges adjacent chunks, so comparing against the last
 * few entries is enough and keeps the scan away from quadratic behaviour on
 * adversarial document content.
 */
export function trimOverlappingPrefix(previous: string[], next: string): string {
  if (previous.length === 0 || next.length === 0) return next

  const recent = previous.slice(-3)
  const max = Math.min(240, next.length)
  for (let length = max; length >= 8; length -= 1) {
    const prefix = next.slice(0, length)
    if (recent.some((content) => content.endsWith(prefix))) {
      return next.slice(length).replace(/^\s+/u, '')
    }
  }

  return next
}
