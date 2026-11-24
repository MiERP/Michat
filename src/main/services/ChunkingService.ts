/**
 * ChunkingService
 * Dịch vụ chia nhỏ tài liệu thông minh, giữ nguyên ngữ nghĩa
 */

import Logger from '../../shared/utils/logger'
import { estimateTokens as estimateTextTokens } from '../../shared/utils/tokenEstimate'
import {
  findDeepestSection,
  sanitizeCompactSections,
  type CompactSection
} from './loaders/sections'

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
 * Ngữ cảnh cấu trúc để neo chunk vào mục/trang.
 * Offset trong đây tính trên CÙNG content truyền vào chunk() — không đổi
 * ranh giới cắt chunk, chỉ gắn nhãn (headingPath / pageStart / pageEnd).
 */
export interface ChunkStructureContext {
  sections?: CompactSection[]
  pages?: Array<{ pageNumber: number; startOffset: number; endOffset: number }>
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
      '\u3002', // Chinese full stop
      '.', // English full stop
      '\uFF01',
      '!',
      '\uFF1F',
      '?',
      '\uFF1B',
      ';',
      '\uFF0C',
      ',',
      ' ' // Khoảng trắng (biện pháp cuối cùng)
    ]
  }

  /**
   * Chia văn bản thành các đoạn
   *
   * @param structure Ngữ cảnh cấu trúc (sections/pages) để gắn headingPath và
   * khoảng trang cho từng chunk. Chỉ gắn nhãn — không thay đổi cách cắt.
   */
  chunk(text: string, options?: ChunkOptions, structure?: ChunkStructureContext): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }
    const { minChunkSize } = opts

    // Tiền xử lý: loại bỏ khoảng trắng dư thừa (kèm bản đồ offset để tra cấu trúc)
    const { text: cleanedText, offsets } = this.preprocessWithMap(text)

    if (!cleanedText || cleanedText.length === 0) {
      return []
    }

    const normalizedStructure = this.normalizeStructureContext(structure)

    // Nếu văn bản ngắn hơn kích thước tối thiểu, trả về toàn bộ văn bản
    if (cleanedText.length <= minChunkSize) {
      return [
        {
          content: cleanedText,
          index: 0,
          startOffset: 0,
          endOffset: cleanedText.length,
          tokenCount: this.estimateTokens(cleanedText),
          metadata: this.buildStructuralMetadata(
            0,
            cleanedText.length,
            offsets,
            text.length,
            normalizedStructure
          )
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
          const structural = this.buildStructuralMetadata(
            chunk.startOffset,
            chunk.endOffset,
            offsets,
            text.length,
            normalizedStructure
          )

          chunks.push({
            ...chunk,
            index: chunks.length,
            metadata:
              structural || chunk.metadata ? { ...chunk.metadata, ...structural } : undefined
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
   * Tiền xử lý văn bản (tương đương: chuẩn hóa CRLF, gộp 4+ newline thành 3, trim)
   * Trả kèm bản đồ offset: offsets[i] = vị trí của ký tự thứ i trong text GỐC.
   * Nhờ đó offset của chunk (tính trên text đã xử lý) vẫn tra được đúng
   * vị trí trong documents.content (nơi offset của section/page đang nằm).
   */
  private preprocessWithMap(text: string): { text: string; offsets: number[] } {
    const chars: string[] = []
    const offsets: number[] = []
    let i = 0

    while (i < text.length) {
      const ch = text[i]

      if (ch === '\r' || ch === '\n') {
        const runStart = i
        let count = 0

        while (i < text.length && (text[i] === '\r' || text[i] === '\n')) {
          i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1
          count++
        }

        const emitted = count >= 4 ? 3 : count
        for (let k = 0; k < emitted; k++) {
          chars.push('\n')
          offsets.push(runStart)
        }
        continue
      }

      chars.push(ch)
      offsets.push(i)
      i += 1
    }

    let start = 0
    let end = chars.length
    while (start < end && /\s/.test(chars[start])) start++
    while (end > start && /\s/.test(chars[end - 1])) end--

    return {
      text: chars.slice(start, end).join(''),
      offsets: offsets.slice(start, end)
    }
  }

  /**
   * Chuẩn hóa ngữ cảnh cấu trúc: bỏ offset không hợp lệ và sắp theo vị trí.
   */
  private normalizeStructureContext(
    structure?: ChunkStructureContext
  ): ChunkStructureContext | undefined {
    if (!structure) return undefined

    const sections = structure.sections?.length
      ? sanitizeCompactSections(structure.sections)
      : undefined
    const pages = structure.pages?.length
      ? structure.pages
          .filter(
            (page) =>
              Number.isFinite(page.startOffset) &&
              Number.isFinite(page.endOffset) &&
              page.endOffset > page.startOffset
          )
          .sort((a, b) => a.startOffset - b.startOffset)
      : undefined

    if (!sections?.length && !pages?.length) return undefined
    return { sections, pages }
  }

  /**
   * Gắn nhãn cấu trúc cho một chunk: headingPath/sectionTitle/sectionLevel
   * (theo section sâu nhất chứa offset bắt đầu) và pageStart/pageEnd.
   */
  private buildStructuralMetadata(
    startOffset: number,
    endOffset: number,
    offsets: number[],
    originalLength: number,
    structure?: ChunkStructureContext
  ): Record<string, unknown> | undefined {
    if (!structure) return undefined

    // Đưa offset của chunk về hệ toạ độ của content gốc (nơi section/page toạ độ)
    const originalStart = offsets[startOffset] ?? startOffset
    const originalEnd =
      endOffset < offsets.length ? (offsets[endOffset] ?? originalLength) : originalLength

    const meta: Record<string, unknown> = {}

    if (structure.sections?.length) {
      const section = findDeepestSection(structure.sections, originalStart)
      if (section) {
        meta.headingPath = section.headingPath
        meta.sectionTitle = section.title
        meta.sectionLevel = section.level
        // Khoảng offset của section để hạ nguồn mở rộng ngữ cảnh theo MỤC
        // (small-to-big) mà không cần tra lại cấu trúc tài liệu.
        meta.sectionStart = section.startOffset
        meta.sectionEnd = section.endOffset
      }
    }

    if (structure.pages?.length) {
      const overlapping = structure.pages.filter(
        (page) => originalStart < page.endOffset && originalEnd > page.startOffset
      )
      if (overlapping.length > 0) {
        meta.pageStart = overlapping[0].pageNumber
        meta.pageEnd = overlapping[overlapping.length - 1].pageNumber
      }
    }

    return Object.keys(meta).length > 0 ? meta : undefined
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
    const marker = lines[0] || ''
    const markerValue = (name: string): string | undefined =>
      marker.match(new RegExp(`${name}=([^;\\]]+)`))?.[1]?.trim()
    const sheetName = markerValue('sheet')
    const firstDataRow = Number(markerValue('firstDataRow') || '1')
    const tableMetadata = {
      type: 'table',
      ...(sheetName ? { sheetName } : {})
    }
    if (lines.length <= 4) {
      const normalized = lines.join('\n')
      return [
        {
          content: normalized,
          index: 0,
          startOffset,
          endOffset: startOffset + tableContent.length,
          tokenCount: this.estimateTokens(normalized),
          metadata: tableMetadata
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
    let estimatedTokens = this.estimateTokensStrict(
      [tableHeader, columnHeader, tableEnd].join('\n')
    )
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
          rowRange: [firstDataRow + rowStartIndex, firstDataRow + rowEndExclusive - 1],
          rowStart: firstDataRow + rowStartIndex,
          rowEnd: firstDataRow + rowEndExclusive - 1,
          ...(sheetName ? { sheetName } : {})
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

      if ((reachesLengthLimit || reachesTokenLimit || reachesRowLimit) && currentRows.length > 0) {
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
            metadata: tableMetadata
          }
        ]
  }

  /**
   * Tách câu
   */
  private splitIntoSentences(text: string): string[] {
    // Dùng regex để nhận diện dấu kết thúc câu
    const sentenceEndings = /([\u3002\uFF01\uFF1F.!?]+)/g
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
   * Ước tính số token (dùng chung với RAG context budget).
   */
  estimateTokens(text: string): number {
    return estimateTextTokens(text)
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
