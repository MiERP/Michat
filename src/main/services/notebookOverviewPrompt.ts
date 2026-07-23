export const NOTEBOOK_OVERVIEW_PROMPT_LIMITS = {
  overviewInputChars: 6000
} as const

export interface NotebookOverviewSourceChunk {
  chunkIndex: number
  content: string
}

export interface NotebookOverviewSourceDocument {
  index: number
  citationId?: number
  title: string
  chunks: NotebookOverviewSourceChunk[]
}

const TRUNCATION_MARKER = '\n[...truncated...]\n'
const LEGAL_SIGNAL_PATTERN =
  /\b(điều|khoản|mục|chương|sửa đổi|bổ sung|quy định|quyền|nghĩa vụ|trách nhiệm|xử phạt|mức phạt|định nghĩa|hiệu lực|kết luận|khuyến nghị)\b/giu
const NUMBER_SIGNAL_PATTERN = /\b\d[\d./-]*\b/g

function normalizeSourceText(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

function chunkSignalScore(content: string): number {
  const legalSignals = content.match(LEGAL_SIGNAL_PATTERN)?.length || 0
  const numberSignals = content.match(NUMBER_SIGNAL_PATTERN)?.length || 0
  const headingSignal =
    content.length <= 180 && /[:：]|^(điều|chương|mục)\s+\w+/iu.test(content) ? 2 : 0
  return legalSignals * 4 + Math.min(numberSignals, 4) + headingSignal
}

export function limitPromptContent(content: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (content.length <= maxChars) return content
  if (maxChars <= TRUNCATION_MARKER.length) return content.slice(0, maxChars)

  const headLength = Math.floor((maxChars - TRUNCATION_MARKER.length) * 0.65)
  const tailLength = maxChars - TRUNCATION_MARKER.length - headLength
  return content.slice(0, headLength) + TRUNCATION_MARKER + content.slice(-tailLength)
}

export function selectRepresentativeChunks<T extends NotebookOverviewSourceChunk>(
  chunks: T[],
  maxChars: number
): T[] {
  if (maxChars <= 0) return []

  const seen = new Set<string>()
  const uniqueChunks = chunks.filter((chunk) => {
    const normalized = normalizeSourceText(chunk.content)
    if (!normalized) return false
    const key = normalized.slice(0, 200).toLocaleLowerCase('vi')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (uniqueChunks.length === 0) return []

  const targetCount = Math.min(
    uniqueChunks.length,
    Math.max(1, Math.min(12, Math.floor(maxChars / 220)))
  )
  const selected = new Map<number, T>()
  const add = (index: number): void => {
    const chunk = uniqueChunks[index]
    if (chunk) selected.set(chunk.chunkIndex, chunk)
  }

  if (targetCount >= 3) {
    add(0)
    add(Math.floor(uniqueChunks.length / 2))
    add(uniqueChunks.length - 1)
  } else {
    add(0)
    if (targetCount === 2) add(uniqueChunks.length - 1)
  }

  const ranked = uniqueChunks
    .filter((chunk) => !selected.has(chunk.chunkIndex))
    .sort((left, right) => {
      const scoreDifference = chunkSignalScore(right.content) - chunkSignalScore(left.content)
      return scoreDifference || left.chunkIndex - right.chunkIndex
    })

  for (const chunk of ranked) {
    if (selected.size >= targetCount) break
    selected.set(chunk.chunkIndex, chunk)
  }

  return [...selected.values()].sort((left, right) => left.chunkIndex - right.chunkIndex)
}

function buildDocumentSection(document: NotebookOverviewSourceDocument, maxChars: number): string {
  if (maxChars <= 0) return ''

  const header =
    'Tài liệu [' +
    (document.citationId ?? document.index) +
    ']: ' +
    normalizeSourceText(document.title).slice(0, 120) +
    '\n'
  if (header.length >= maxChars) return header.slice(0, maxChars)

  const bodyBudget = maxChars - header.length
  const selectedChunks = selectRepresentativeChunks(document.chunks, bodyBudget)
  if (selectedChunks.length === 0) return header.trimEnd()

  const separatorsLength = selectedChunks.length - 1
  const available = Math.max(0, bodyBudget - separatorsLength)
  const baseBudget = Math.floor(available / selectedChunks.length)
  let remainder = available % selectedChunks.length
  const body = selectedChunks
    .map((chunk) => {
      const chunkBudget = baseBudget + (remainder-- > 0 ? 1 : 0)
      return limitPromptContent(normalizeSourceText(chunk.content), chunkBudget)
    })
    .join('\n')

  return (header + body).slice(0, maxChars)
}

export function buildNotebookOverviewSource(
  documents: NotebookOverviewSourceDocument[],
  maxChars = NOTEBOOK_OVERVIEW_PROMPT_LIMITS.overviewInputChars
): string {
  if (documents.length === 0 || maxChars <= 0) return ''

  const separator = '\n\n'
  const separatorsLength = separator.length * (documents.length - 1)
  const available = Math.max(0, maxChars - separatorsLength)
  const baseBudget = Math.floor(available / documents.length)
  let remainder = available % documents.length

  return documents
    .map((document) => buildDocumentSection(document, baseBudget + (remainder-- > 0 ? 1 : 0)))
    .join(separator)
    .slice(0, maxChars)
}

export function limitWords(content: string, maxWords: number): string {
  if (maxWords <= 0) return ''

  let wordCount = 0
  let endIndex = content.length
  for (const match of content.matchAll(/\S+/g)) {
    wordCount++
    if (wordCount > maxWords) {
      endIndex = match.index
      break
    }
  }
  return content.slice(0, endIndex).trimEnd()
}
