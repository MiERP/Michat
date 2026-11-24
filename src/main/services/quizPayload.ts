/**
 * Lenient JSON extraction for quiz answers from local models. Models often wrap
 * the object in prose/markdown or leave trailing commas; streamObject could not
 * survive that, so we parse the text ourselves.
 */

/** Extract balanced JSON objects/arrays from a model answer (handles fences/prose). */
export function extractJsonObjects(raw: string): string[] {
  const results: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (char === '}' || char === ']') {
      if (depth === 0) continue
      depth--
      if (depth === 0 && start >= 0) {
        results.push(raw.slice(start, i + 1))
        start = -1
      }
    }
  }

  return results.sort((a, b) => b.length - a.length)
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    // Local models often leave a trailing comma before } or ].
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))
    } catch {
      return null
    }
  }
}

/** Parse a quiz payload (`{ questions: [...] }` or a bare array). */
export function parseQuizPayload(raw: string): unknown | null {
  for (const candidate of extractJsonObjects(raw)) {
    const parsed = tryParse(candidate)
    if (Array.isArray(parsed)) return { questions: parsed }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'questions' in parsed &&
      Array.isArray(parsed.questions)
    ) {
      return parsed
    }
  }
  return null
}

export interface SanitizedQuizQuestion {
  id: string
  questionText: string
  options: string[]
  correctAnswer: number
  explanation: string
  hints: string[]
  metadata?: { chunkIds: string[] }
}

/**
 * Coerce a model answer into the shape the app expects instead of rejecting it
 * on length limits: local models routinely exceed the requested caps.
 */
export function sanitizeQuizQuestions(payload: unknown, maxCount: number): SanitizedQuizQuestion[] {
  const container = payload as { questions?: unknown } | null
  const rawQuestions = Array.isArray(container?.questions) ? container.questions : []
  const result: SanitizedQuizQuestion[] = []

  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>

    const questionText = String(item.questionText ?? '')
      .trim()
      .slice(0, 500)
    const optionsRaw = Array.isArray(item.options) ? item.options : []
    const options = optionsRaw.slice(0, 4).map((option) =>
      String(option ?? '')
        .trim()
        .slice(0, 200)
    )
    if (!questionText || options.length !== 4) continue

    let correctAnswer = Number(item.correctAnswer)
    if (!Number.isFinite(correctAnswer)) {
      const letter = String(item.correctAnswer ?? '')
        .trim()
        .toUpperCase()
      correctAnswer = letter.length === 1 ? letter.charCodeAt(0) - 65 : 0
    }
    correctAnswer = Math.min(3, Math.max(0, Math.floor(correctAnswer)))

    const hints = Array.isArray(item.hints)
      ? item.hints
          .slice(0, 2)
          .map((hint) =>
            String(hint ?? '')
              .trim()
              .slice(0, 200)
          )
          .filter(Boolean)
      : []

    const metadataRaw = item.metadata as { chunkIds?: unknown } | undefined
    const chunkIds =
      metadataRaw && Array.isArray(metadataRaw.chunkIds)
        ? metadataRaw.chunkIds
            .slice(0, 20)
            .map((id) => String(id ?? '').trim())
            .filter(Boolean)
        : []

    result.push({
      id: String(item.id ?? `q_${result.length + 1}`).slice(0, 100),
      questionText,
      options,
      correctAnswer,
      explanation: String(item.explanation ?? '')
        .trim()
        .slice(0, 500),
      hints,
      ...(chunkIds.length > 0 ? { metadata: { chunkIds } } : {})
    })

    if (result.length >= maxCount) break
  }

  return result
}
