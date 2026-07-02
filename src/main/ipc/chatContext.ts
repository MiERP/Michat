const CONTROL_CHARS_PATTERN = new RegExp(
  '[' +
    String.fromCharCode(0) +
    '-' +
    String.fromCharCode(8) +
    String.fromCharCode(11) +
    String.fromCharCode(12) +
    String.fromCharCode(14) +
    '-' +
    String.fromCharCode(31) +
    String.fromCharCode(127) +
    ']',
  'g'
)

const RAG_MAX_CHARS_PER_DOC = 1600
const RAG_MAX_TOTAL_CONTEXT_CHARS = 12000

export interface RagContextInput {
  chunkId: string
  documentTitle: string
  content: string
  score: number
}

function sanitizePromptText(raw: string): string {
  return raw
    .replace(CONTROL_CHARS_PATTERN, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

export function buildRAGContext(
  searchResults: RagContextInput[]
): { context: string; includedChunkIds: Set<string> } {
  if (searchResults.length === 0) return { context: '', includedChunkIds: new Set() }

  const includedChunkIds = new Set<string>()
  const seenContent = new Set<string>()
  const contextParts: string[] = []
  let totalContentChars = 0

  for (const result of searchResults) {
    if (totalContentChars >= RAG_MAX_TOTAL_CONTEXT_CHARS) break
    if (includedChunkIds.has(result.chunkId)) continue

    const sanitized = sanitizePromptText(result.content)
    if (!sanitized) continue

    const contentKey = sanitized.toLowerCase().replace(/\s+/g, ' ').slice(0, 500)
    if (seenContent.has(contentKey)) continue

    const remaining = RAG_MAX_TOTAL_CONTEXT_CHARS - totalContentChars
    const targetChars = Math.min(RAG_MAX_CHARS_PER_DOC, remaining)
    if (targetChars <= 0) break

    const clipped = clipText(sanitized, targetChars)
    if (!clipped) continue

    includedChunkIds.add(result.chunkId)
    seenContent.add(contentKey)
    totalContentChars += clipped.length

    contextParts.push(
      `<doc id="${contextParts.length + 1}" chunk="${result.chunkId}" title="${result.documentTitle}" score="${result.score.toFixed(3)}">\n${clipped}\n</doc>`
    )
  }

  if (contextParts.length === 0) return { context: '', includedChunkIds }

  return {
    context: `\n\n[Notebook context]\n${contextParts.join('\n\n')}\n[/Notebook context]`,
    includedChunkIds
  }
}
