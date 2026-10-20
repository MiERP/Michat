/**
 * Ước tính số token cho văn bản trộn CJK / tiếng Việt / tiếng Anh.
 *
 * Dùng chung cho:
 *  - ChunkingService: ngưỡng token an toàn của mỗi chunk.
 *  - RAG context budget: giới hạn ngữ cảnh đưa vào prompt theo TOKEN thay vì
 *    theo ký tự (tiếng Việt ~2 ký tự/token, tiếng Anh ~4).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0

  let cjkChars = 0
  let otherChars = 0

  for (const char of text) {
    const code = char.charCodeAt(0)
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK cơ bản
      (code >= 0x3400 && code <= 0x4dbf) || // CJK mở rộng A
      (code >= 0xf900 && code <= 0xfaff) || // CJK tương thích
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      cjkChars++
    } else {
      otherChars++
    }
  }

  return Math.ceil(cjkChars / 1.5 + otherChars / 4)
}

/**
 * Cắt văn bản theo ngân sách token (cắt từ đầu, thêm "...").
 */
export function clipTextToTokens(value: string, maxTokens: number): string {
  if (maxTokens <= 0) return ''
  if (estimateTokens(value) <= maxTokens) return value

  let low = 0
  let high = value.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (estimateTokens(value.slice(0, mid)) <= maxTokens) low = mid
    else high = mid - 1
  }

  if (low <= 0) return ''
  return `${value.slice(0, low).trimEnd()}...`
}
