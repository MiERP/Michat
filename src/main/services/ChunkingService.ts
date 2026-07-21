/**
 * ChunkingService
 * Dịch vụ chia nhỏ tài liệu thông minh, giữ nguyên ngữ nghĩa
 */

import Logger from '../../shared/utils/logger'

/**
 * Tùy chọn chia đoạn
 */
export interface ChunkOptions {
  chunkSize?: number // Số ký tự mục tiêu cho mỗi đoạn, mặc định 500
  chunkOverlap?: number // Số ký tự chồng lặp giữa các đoạn, mặc định 50
  separators?: string[] // Danh sách dấu phân tách theo mức ưu tiên
  minChunkSize?: number // Kích thước đoạn tối thiểu, mặc định 100
  maxChunkTokens?: number // Ngưỡng token an toàn cho mỗi chunk, mặc định 96
  maxTableRowsPerChunk?: number // Số dòng dữ liệu bảng tối đa trong mỗi chunk, mặc định 3
}

/**
 * Kết quả chia đoạn
 */
export interface ChunkResult {
  content: string // Nội dung đoạn
  index: number // Chỉ mục đoạn
  startOffset: number // Vị trí bắt đầu trong văn bản gốc
  endOffset: number // Vị trí kết thúc trong văn bản gốc
  tokenCount: number // Số token ước tính
  metadata?: Record<string, unknown>
}

/**
 * Dịch vụ chia nhỏ tài liệu
 * Hỗ trợ chia đoạn thông minh để giữ nguyên ngữ nghĩa
 */
export class ChunkingService {
  private defaultOptions: Required<ChunkOptions> = {
    // Giữ kích thước đoạn an toàn để tránh vượt giới hạn token mỗi input của embedding server
    // (ví dụ một số server llama.cpp cục bộ có thể từ chối input > 128 token)
    chunkSize: 300,
    chunkOverlap: 30,
    minChunkSize: 50,
    maxChunkTokens: 96,
    maxTableRowsPerChunk: 3,
    separators: [
      '\n\n\n', // Nhiều dòng trống (ngăn cách chương/mục)
      '\n\n', // Ngắt đoạn văn
      '\n', // Ngắt dòng
      '。', // Dấu chấm tiếng Trung
      '.', // Dấu chấm tiếng Anh
      '！',
      '!',
      '？',
      '?',
      '；',
      ';',
      '，',
      ',',
      ' ' // Khoảng trắng (biện pháp cuối cùng)
    ]
  }

  /**
   * Chia văn bản thành các đoạn
   */
  chunk(text: string, options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }
    const { minChunkSize } = opts

    // Tiền xử lý: loại bỏ khoảng trắng dư thừa
    const cleanedText = this.preprocessText(text)

    if (!cleanedText || cleanedText.length === 0) {
      return []
    }

    // Nếu văn bản ngắn hơn kích thước tối thiểu, trả về toàn bộ văn bản
    if (cleanedText.length <= minChunkSize) {
      return [
        {
          content: cleanedText,
          index: 0,
          startOffset: 0,
          endOffset: cleanedText.length,
          tokenCount: this.estimateTokens(cleanedText)
        }
      ]
    }

    const blocks = this.extractBlocks(cleanedText)
    const chunks: ChunkResult[] = []

    for (const block of blocks) {
      const generated =
        block.type === 'table'
          ? this.chunkTableBlock(block.content, block.startOffset, opts)
          : this.chunkPlainTextWithOffset(block.content, block.startOffset, opts)

      for (const chunk of generated) {
        if (chunk.content.length >= minChunkSize) {
          chunks.push({
            ...chunk,
            index: chunks.length
          })
        }
      }
    }

    Logger.debug('ChunkingService', `Split text into ${chunks.length} chunks`)
    return chunks
  }

  /**
   * Chia đoạn theo câu (chiến lược thận trọng hơn)
   */
  chunkBySentence(text: string, options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }

    // Tách câu
    const sentences = this.splitIntoSentences(text)
    const chunks: ChunkResult[] = []
    let currentChunk: string[] = []
    let currentLength = 0
    let currentStartOffset = 0

    for (const sentence of sentences) {
      const sentenceLength = sentence.length

      if (currentLength + sentenceLength > opts.chunkSize && currentChunk.length > 0) {
        // Lưu đoạn hiện tại
        const content = currentChunk.join('')
        chunks.push({
          content,
          index: chunks.length,
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + content.length,
          tokenCount: this.estimateTokens(content)
        })

        // Bắt đầu đoạn mới (có thể xét chồng lặp nếu cần)
        currentStartOffset += content.length
        currentChunk = []
        currentLength = 0
      }

      currentChunk.push(sentence)
      currentLength += sentenceLength
    }

    // Xử lý đoạn cuối cùng
    if (currentChunk.length > 0) {
      const content = currentChunk.join('')
      chunks.push({
        content,
        index: chunks.length,
        startOffset: currentStartOffset,
        endOffset: currentStartOffset + content.length,
        tokenCount: this.estimateTokens(content)
      })
    }

    return chunks
  }

  /**
   * Tiền xử lý văn bản
   */
  private preprocessText(text: string): string {
    return (
      text
        // Chuẩn hóa ký tự xuống dòng
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Loại bỏ các dòng trống liên tiếp quá nhiều (giữ tối đa 3 ký tự xuống dòng)
        .replace(/\n{4,}/g, '\n\n\n')
        // Loại bỏ khoảng trắng đầu/cuối
        .trim()
    )
  }

  private extractBlocks(text: string): Array<{
    type: 'text' | 'table'
    content: string
    startOffset: number
  }> {
    const tableRegex = /\[\[TABLE_START:[^\]]*\]\][\s\S]*?\[\[TABLE_END\]\]/g
    const blocks: Array<{ type: 'text' | 'table'; content: string; startOffset: number }> = []

    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = tableRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const plainPart = text.slice(lastIndex, match.index)
        if (plainPart.trim()) {
          blocks.push({ type: 'text', content: plainPart, startOffset: lastIndex })
        }
      }

      const tablePart = match[0]
      blocks.push({ type: 'table', content: tablePart, startOffset: match.index })
      lastIndex = match.index + tablePart.length
    }

    if (lastIndex < text.length) {
      const tail = text.slice(lastIndex)
      if (tail.trim()) {
        blocks.push({ type: 'text', content: tail, startOffset: lastIndex })
      }
    }

    if (blocks.length === 0) {
      blocks.push({ type: 'text', content: text, startOffset: 0 })
    }

    return blocks
  }

  private chunkPlainTextWithOffset(
    text: string,
    startOffset: number,
    options: Required<ChunkOptions>
  ): ChunkResult[] {
    const { chunkSize, chunkOverlap, separators } = options
    const chunks: ChunkResult[] = []
    let currentStart = 0

    while (currentStart < text.length) {
      let currentEnd = Math.min(currentStart + chunkSize, text.length)

      if (currentEnd < text.length) {
        const searchEnd = currentEnd
        const searchStart = Math.max(currentStart + Math.floor(chunkSize * 0.5), currentStart)

        let bestSplitPos = -1
        let bestSeparatorPriority = separators.length

        for (let i = searchEnd; i >= searchStart; i--) {
          for (let j = 0; j < separators.length; j++) {
            const sep = separators[j]
            if (text.slice(i, i + sep.length) === sep) {
              if (j < bestSeparatorPriority) {
                bestSplitPos = i + sep.length
                bestSeparatorPriority = j
              }
              break
            }
          }
          if (bestSeparatorPriority <= 2) break
        }

        if (bestSplitPos > currentStart) {
          currentEnd = bestSplitPos
        }
      }

      const content = text.slice(currentStart, currentEnd).trim()
      if (content) {
        chunks.push({
          content,
          index: 0,
          startOffset: startOffset + currentStart,
          endOffset: startOffset + currentEnd,
          tokenCount: this.estimateTokens(content)
        })
      }

      if (currentEnd >= text.length) break

      currentStart = Math.max(currentEnd - chunkOverlap, currentStart + 1)
    }

    return chunks
  }

  private chunkTableBlock(
    tableContent: string,
    startOffset: number,
    options: Required<ChunkOptions>
  ): ChunkResult[] {
    const lines = tableContent.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length <= 4) {
      const normalized = lines.join('\n')
      return [
        {
          content: normalized,
          index: 0,
          startOffset,
          endOffset: startOffset + tableContent.length,
          tokenCount: this.estimateTokens(normalized),
          metadata: { type: 'table' }
        }
      ]
    }

    const chunks: ChunkResult[] = []
    const tableHeader = lines[0]
    const columnHeader = lines[1]?.startsWith('header:') ? lines[1] : ''
    const rowLines = lines.filter((line) => line.startsWith('row '))
    const tableEnd = lines.find((line) => line.includes('[[TABLE_END]]')) || '[[TABLE_END]]'

    let currentRows: string[] = []
    let estimatedLength = tableHeader.length + columnHeader.length + tableEnd.length + 4
    let estimatedTokens = this.estimateTokensStrict([tableHeader, columnHeader, tableEnd].join('\n'))
    let rowStartIndex = 0

    const flushChunk = (rowEndExclusive: number) => {
      if (currentRows.length === 0) return
      const chunkLines = [tableHeader]
      if (columnHeader) chunkLines.push(columnHeader)
      chunkLines.push(...currentRows)
      chunkLines.push(tableEnd)

      const content = chunkLines.join('\n')
      const localStart = tableContent.indexOf(currentRows[0])
      const localEnd = localStart + content.length

      chunks.push({
        content,
        index: 0,
        startOffset: startOffset + Math.max(localStart, 0),
        endOffset: startOffset + Math.max(localEnd, 0),
        tokenCount: this.estimateTokens(content),
        metadata: {
          type: 'table',
          rowRange: [rowStartIndex + 1, rowEndExclusive]
        }
      })

      currentRows = []
      estimatedLength = tableHeader.length + columnHeader.length + tableEnd.length + 4
      estimatedTokens = this.estimateTokensStrict([tableHeader, columnHeader, tableEnd].join('\n'))
    }

    rowLines.forEach((rowLine, idx) => {
      const rowTokens = this.estimateTokensStrict(rowLine)
      const reachesLengthLimit = estimatedLength + rowLine.length > options.chunkSize
      const reachesTokenLimit = estimatedTokens + rowTokens > options.maxChunkTokens
      const reachesRowLimit = currentRows.length >= options.maxTableRowsPerChunk

      if (
        (reachesLengthLimit || reachesTokenLimit || reachesRowLimit) &&
        currentRows.length > 0
      ) {
        flushChunk(idx)
        rowStartIndex = idx
      }

      currentRows.push(rowLine)
      estimatedLength += rowLine.length + 1
      estimatedTokens += rowTokens
    })

    flushChunk(rowLines.length)
    return chunks.length > 0
      ? chunks
      : [
          {
            content: tableContent,
            index: 0,
            startOffset,
            endOffset: startOffset + tableContent.length,
            tokenCount: this.estimateTokens(tableContent),
            metadata: { type: 'table' }
          }
        ]
  }

  /**
   * Tách câu
   */
  private splitIntoSentences(text: string): string[] {
    // Dùng regex để nhận diện dấu kết thúc câu
    const sentenceEndings = /([。！？.!?]+)/g
    const parts = text.split(sentenceEndings)
    const sentences: string[] = []

    for (let i = 0; i < parts.length; i += 2) {
      const sentence = parts[i] + (parts[i + 1] || '')
      if (sentence.trim()) {
        sentences.push(sentence)
      }
    }

    return sentences
  }

  /**
   * Ước tính số token
   * Dựa trên công thức kinh nghiệm cho văn bản trộn CJK và tiếng Anh
   */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0

    let vietnamChars = 0
    let otherChars = 0

    for (const char of text) {
      const code = char.charCodeAt(0)
      // CJK Unified Ideographs và các vùng mở rộng
      if (
        (code >= 0x4e00 && code <= 0x9fff) || // CJK cơ bản
        (code >= 0x3400 && code <= 0x4dbf) || // CJK mở rộng A
        (code >= 0xf900 && code <= 0xfaff) || // CJK tương thích
        (code >= 0x3040 && code <= 0x309f) || // Hiragana
        (code >= 0x30a0 && code <= 0x30ff) || // Katakana
        (code >= 0xac00 && code <= 0xd7af) // Hangul
      ) {
        vietnamChars++
      } else {
        otherChars++
      }
    }

    // CJK ~1.5 ký tự/token, tiếng Anh ~4 ký tự/token
    return Math.ceil(vietnamChars / 1.5 + otherChars / 4)
  }

  /**
   * Ước tính token theo hướng bảo thủ hơn để tránh vượt ngưỡng input của embedding server.
   * Dùng để quyết định giới hạn chunk, không thay thế tokenCount hiển thị.
   */
  private estimateTokensStrict(text: string): number {
    return Math.ceil(this.estimateTokens(text) * 1.8)
  }

  /**
   * Cập nhật tùy chọn mặc định
   */
  setDefaultOptions(options: Partial<ChunkOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options }
  }
}
