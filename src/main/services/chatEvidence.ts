import type { ChatCitation } from '../../shared/types/chat'

const SOURCE_TAG_PATTERN =
  /<\/?(?:doc|legal-evidence|comparison-evidence|deterministic-matrix|resolution|evidence)\b[^>]*>/giu
const EMPTY_SOURCE_FOOTER_PATTERN =
  /(?:^|\r?\n)\s*Nguồn trích dẫn\s*:\s*(?:\r?\n\s*(?:[-*+]\s*)?)*$/iu
const CITATION_PATTERN = /\[(\d+)\]/g
const INSUFFICIENT_EVIDENCE_PATTERN =
  /(?:chưa đủ căn cứ|không đủ dữ liệu|không tìm thấy|không có thông tin)/iu

export function finalizeChatEvidence(
  content: string,
  citations: ChatCitation[],
  options: { requireCitation?: boolean; addMissingClaimCitations?: boolean } = {}
): { content: string; citations: ChatCitation[] } {
  const allowedIds = new Set(citations.map((citation) => citation.index))
  const cleanedContent = content
    .replace(SOURCE_TAG_PATTERN, '')
    .replace(EMPTY_SOURCE_FOOTER_PATTERN, '')
    .replace(CITATION_PATTERN, (marker, rawId: string) =>
      allowedIds.has(Number(rawId)) ? marker : ''
    )
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (!cleanedContent && options.requireCitation) {
    return {
      content: 'Chưa đủ căn cứ trong tài liệu đã nhập để trả lời câu hỏi này.',
      citations: []
    }
  }

  if (options.requireCitation && INSUFFICIENT_EVIDENCE_PATTERN.test(cleanedContent)) {
    return { content: cleanedContent, citations: [] }
  }

  const existingIds = new Set(
    [...cleanedContent.matchAll(CITATION_PATTERN)].map((match) => Number(match[1]))
  )
  const citationOrder = [
    ...citations.filter((citation) => !existingIds.has(citation.index)),
    ...citations.filter((citation) => existingIds.has(citation.index))
  ]
  let citationCursor = 0
  const contentWithCitation = options.requireCitation && citations.length > 0 && options.addMissingClaimCitations !== false
    ? cleanedContent
        .split('\n')
        .map((line) => {
          CITATION_PATTERN.lastIndex = 0
          if (!line.trim() || CITATION_PATTERN.test(line) || line.trim().length < 20) return line
          const citation = citationOrder[citationCursor % citationOrder.length]
          citationCursor += 1
          return `${line.trimEnd()} [${citation.index}]`
        })
        .join('\n')
    : cleanedContent
  CITATION_PATTERN.lastIndex = 0
  const usedIds = new Set(
    [...contentWithCitation.matchAll(CITATION_PATTERN)].map((match) => Number(match[1]))
  )

  return {
    content: contentWithCitation,
    citations: citations.filter((citation) => usedIds.has(citation.index))
  }
}
