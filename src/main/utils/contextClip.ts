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

  // Article blocks are plain, contiguous source text (no "...") separators.
  // Locate the relevant window by substring and keep it in the clipped slice
  // instead of always taking the first N tokens of a long article.
  if (primaryIndex < 0) {
    let directIndex = content.indexOf(matchedContent ?? '')
    if (directIndex < 0) {
      // The caller passes sanitized content but the raw matched window. Find
      // it by a whitespace-tolerant word match before falling back to the
      // first N tokens.
      const words = normalizeForMatch(matchedContent ?? '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 12)
      if (words.length > 0) {
        const pattern = new RegExp(
          words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'),
          'iu'
        )
        const match = pattern.exec(content)
        if (match) directIndex = match.index
      }
    }
    if (directIndex >= 0) {
      const tokensPerChar = estimateTokens(content) / Math.max(1, content.length)
      const maxChars = Math.max(500, Math.floor(maxTokens / Math.max(tokensPerChar, 0.01)))
      const matchedLength = (matchedContent ?? '').length
      const lead = Math.max(0, Math.floor((maxChars - matchedLength) / 3))
      const start = Math.max(0, directIndex - lead)
      return content.slice(start, Math.min(content.length, start + maxChars))
    }
    return clipTextToTokens(content, maxTokens)
  }

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
