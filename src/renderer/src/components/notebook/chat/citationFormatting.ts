import type { ChatCitation } from '../../../../../shared/types/chat'

export function ensureInlineCitationPlacement(content: string, citations: ChatCitation[]): string {
  if (!content || citations.length === 0) return content

  const cleaned = normalizeCitationMarkers(removeCitationBoilerplateLines(content), citations)
  const validIndexes = new Set(citations.map((citation) => citation.index))
  const hasValidMarker = [...cleaned.matchAll(/\[(\d+)\](?!\s*\()/g)].some((match) =>
    validIndexes.has(Number(match[1]))
  )

  if (hasValidMarker) return cleaned

  // The server only supplies citations for chunks included in the RAG prompt and
  // orders them by retrieval rank. If a model ignores the citation instruction,
  // retain provenance by attaching the strongest available source to the answer.
  const primaryCitation = citations.reduce((primary, citation) =>
    citation.index < primary.index ? citation : primary
  )
  return `${cleaned} [${primaryCitation.index}]`
}

/** Convert a model's trailing “(1)” footnote into the single supported [1] marker. */
function normalizeCitationMarkers(content: string, citations: ChatCitation[]): string {
  const validIndexes = new Set(citations.map((citation) => citation.index))
  const normalized = content.replace(
    /([.!?])\s*\((\d+)\)(?=\s|$)/g,
    (match, punctuation, rawIndex) => {
      const index = Number(rawIndex)
      return validIndexes.has(index) ? `${punctuation} [${index}]` : match
    }
  )
  return normalized.replace(/\[(\d+)\](?:\s+\[\1\])+/g, '[$1]')
}

/** Bỏ dấu tiếng Việt để khớp cả "thông tin" lẫn "thong tin". */
function stripVietnameseDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
}

function removeCitationBoilerplateLines(content: string): string {
  const boilerplatePrefixes = [
    'thong tin nay duoc tim thay',
    'thong tin tren duoc tim thay',
    'nguon thong tin nay',
    'this information was found',
    'the information was found',
    'source:'
  ]

  const filtered = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      const ascii = stripVietnameseDiacritics(trimmed.toLowerCase())
      return !boilerplatePrefixes.some((prefix) => ascii.startsWith(prefix))
    })
    .join('\n')

  return filtered.replace(/\n{3,}/g, '\n\n').trim()
}
