/** Bỏ dấu tiếng Việt để so khớp nhận cả "chào" lẫn "chao". */
function stripVietnameseDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
}

/** Remove punctuation/emoji and collapse whitespace, preserving letters and digits. */
function normalizeSymbols(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Accent-insensitive form used for greetings and intent detection. */
function normalizeFolded(query: string): string {
  return normalizeSymbols(stripVietnameseDiacritics(query.trim().toLowerCase()))
}

/** Original-script form used where diacritics distinguish a word from another. */
function normalizeRaw(query: string): string {
  return normalizeSymbols(query.trim().toLowerCase())
}

const GREETING_PATTERN =
  /^(xin chao( ban| cac ban| moi nguoi)?|chao (ban|cac ban|ca nha|moi nguoi|tat ca moi nguoi|anh|chi|em|ong|ba)|hello( there| everyone| everybody| my friend| friend| ban)?|hi( there| everyone| everybody| my friend| friend| ban)?|hey( there| everyone| everybody| my friend| friend| ban)?|good morning( everyone| everybody)?|good afternoon( everyone| everybody)?|good evening( everyone| everybody)?)( nhe| nha| a| nhi)?(?=\s|$)/u

function coreSmallTalk(q: string): boolean {
  const patterns = [
    /^cam on( (anh|chi|em|ong|ba|ban|moi nguoi|ca nha))?( (?:(?:rat )?nhieu|so much|very much|a lot|for your help))?( (?:nhe|nha|a|nhi))?$/u,
    /^(thank you|thanks)( so much| very much| a lot| for your help)?( friend| buddy| everyone)?$/u,
    /^ban (la|ten)( la)? (ai|gi)( vay| the| nhi)?$/u,
    /^ban co the (lam|giup) (gi|duoc gi)( vay)?$/u,
    /^ban (co )?khoe khong( a)?$/u,
    /^(who are you|what can you do|how are you)( doing)?$/u
  ]
  return patterns.some((pattern) => pattern.test(q))
}

/**
 * True only when the WHOLE message is small talk. A greeting prefix is removed
 * once, then the remainder must also be small talk (or empty). This prevents
 * "chào bạn, Điều 8 quy định gì?" from bypassing grounding while still accepting
 * "chào bạn, bạn khỏe không?".
 */
export function isSmallTalkQuery(query: string): boolean {
  const raw = normalizeRaw(query)
  if (!raw) return true

  // Acknowledgments are matched with diacritics intact: "vàng"/"đá"/"cháo"/
  // "dược"/"u" are ordinary nouns and must not be treated as "vâng"/"dạ"/... .
  if (/^(ừ|uh|uhm|ok|oke|okay|vâng|dạ|được|dạ vâng|vâng dạ)( (ạ|a|nhé|nha|nhi))?$/u.test(raw)) {
    return true
  }

  // Bare "chào" is a greeting; bare "chao"/"cháo" stays ambiguous and is not
  // whitelisted unless it carries an explicit pronoun.
  if (
    /^chào( (anh|chị|em|ông|bà|bạn|các bạn|mọi người|cả nhà))?( (ạ|a|nhé|nha|nhi))?$/u.test(raw)
  ) {
    return true
  }

  const q = normalizeFolded(query)
  if (coreSmallTalk(q)) return true

  const greeting = q.match(GREETING_PATTERN)
  if (!greeting) return false
  const remainder = q.slice(greeting[0].length).trim()
  return remainder === '' || coreSmallTalk(remainder)
}

/**
 * Explicit legal references are never chit-chat, even when the query is short.
 * Supports digits, Roman numerals, and Vietnamese number words ("Điều tám").
 */
export function mentionsLegalReference(query: string): boolean {
  const ascii = normalizeFolded(query)
  const legalReference =
    /\b(dieu|khoan|chuong|muc)\b\s*(?:thu\s+)?(?:[0-9]+[a-z]?|[ivxlcdm]+|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\b/u
  const englishLegalReference =
    /\b(article|section|clause|chapter)\b\s*(?:[0-9]+[a-z]?|[ivxlcdm]+)\b/u
  return (
    legalReference.test(ascii) ||
    englishLegalReference.test(ascii) ||
    /\b(luat|bo luat|nghi dinh|thong tu)\b/u.test(ascii)
  )
}

/**
 * Detect questions/instructions that need knowledge even when the message is
 * short. Keeps a greeting prefix from turning a real question into chit-chat.
 */
function mentionsKnowledgeIntent(query: string): boolean {
  if (query.includes('?')) return true
  const ascii = normalizeFolded(query)
  if (mentionsLegalReference(query)) return true
  if (/\b(dieu|khoan|chuong|muc)\b/u.test(ascii)) return true
  return /(la gi|nhu the nao|bao nhieu|tai sao|khi nao|o dau|tom tat|giai thich|quy dinh|what|why|how|when|where|summarize|explain|article|section|clause|chapter)/u.test(
    ascii
  )
}

/**
 * Detect greetings/short talk for the RAG skip heuristic. A short message that
 * carries no knowledge intent can be skipped for latency, but anything with a
 * legal reference or a question word is still retrieved.
 */
export function isLikelyChitChat(query: string, shortQueryLength: number): boolean {
  const q = query.trim()
  if (!q) return true
  if (isSmallTalkQuery(q)) return true
  return q.length < shortQueryLength && !mentionsKnowledgeIntent(q)
}
