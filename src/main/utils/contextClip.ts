import { clipTextToTokens, estimateTokens } from '../../shared/utils/tokenEstimate'

/**
 * Normalize text for comparing a source chunk with the sanitized prompt text.
 * `sanitizePromptText` removes spaces before newlines, so raw chunk text must be
 * normalized the same way before using `includes`.
 */
export function normalizeForMatch(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isPrimaryVisible(safeClipped: string, matchedContent?: string): boolean {
  const primary = normalizeForMatch(matchedContent ?? '')
  if (!primary) return true
  return normalizeForMatch(safeClipped).includes(primary.slice(0, 120))
}

/**
 * Clip an expanded section while keeping the matched clause visible. Parts are
 * added outward from the matched clause and then re-joined in document order so
 * legal clause numbering stays intact.
 */
export function clipSectionAroundPrimary(
  content: string,
  matchedContent: string | undefined,
  maxTokens: number
): string {
  const primaryText = normalizeForMatch(matchedContent ?? '')
  if (!primaryText) return clipTextToTokens(content, maxTokens)

  const separator = '\n...\n'
  const parts = content.split(separator)
  const primaryIndex = parts.findIndex((part) => normalizeForMatch(part) === primaryText)
  if (primaryIndex < 0) return clipTextToTokens(content, maxTokens)

  const selected = new Set<number>([primaryIndex])
  let tokens = estimateTokens(parts[primaryIndex])
  if (tokens > maxTokens) return clipTextToTokens(parts[primaryIndex], maxTokens)
  let before = primaryIndex - 1
  let after = primaryIndex + 1

  while (tokens < maxTokens && (before >= 0 || after < parts.length)) {
    let added = false

    if (before >= 0) {
      const cost = estimateTokens(parts[before])
      if (tokens + cost <= maxTokens) {
        selected.add(before)
        tokens += cost
        before -= 1
        added = true
      } else {
        before = -1
      }
    }

    if (!added && after < parts.length) {
      const cost = estimateTokens(parts[after])
      if (tokens + cost > maxTokens) break
      selected.add(after)
      tokens += cost
      after += 1
    }
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => parts[index])
    .join(separator)
}
