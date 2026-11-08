/* eslint-disable no-irregular-whitespace */
/**
 * DocxLoader
 * Ã¤Â½Â¿Ã§â€Â¨ mammoth Ã¨Â§Â£Ã¦Å¾Â Word Ã¦â€“â€¡Ã¦Â¡Â£Ã¯Â¼Å’Ã¥Â¹Â¶Ã¦ÂÂÃ¥Ââ€“Ã§Â»â€œÃ¦Å¾â€žÃ¤Â¿Â¡Ã¦ÂÂ¯
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import WordExtractor from 'word-extractor'
import { OfficeParser } from 'officeparser'
import TurndownService from 'turndown'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/**
 * Word Ã¦â€"â€¡Ã¦Â¡Â£Ã¥Å Â Ã¨Â½Â½Ã¥â„¢Â¨
 * Ã¥Å¸ÂºÃ¤ÂºÅ½ mammothÃ¯Â¼Å'Ã¦â€Â¯Ã¦Å'Â DOCX Ã¥â€™Å' DOC
 */
export class DocxLoader implements IDocumentLoader {
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
  readonly supportedExtensions = ['docx', 'doc']

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.includes(extname(lower).slice(1))
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const extension = extname(filePath).toLowerCase()

    if (extension === '.doc') {
      return this.loadLegacyDoc(filePath)
    }

    const buffer = await readFile(filePath)
    return this.loadFromBuffer(buffer, options)
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options }

    try {
      const document = await OfficeParser.parseOffice(buffer)

      let content: string
      let sections: SectionInfo[] | undefined
      let title: string | undefined

      if (opts.preserveStructure) {
        // Parse DOCX -> HTML rồi chuyển sang markdown để giữ cấu trúc heading/bảng.
        const htmlResult = await document.to('html')
        const html = typeof htmlResult.value === 'string' ? htmlResult.value : ''
        if (html) {
          const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
          })
          // Turndown's base rules flatten tables to consecutive paragraphs.
          // Emit a deterministic GFM table so table rows remain retrievable
          // and may subsequently be chunked with their columns intact.
          turndownService.addRule('word-table-to-gfm', {
            filter: 'table',
            replacement: (_content, node) => this.tableToMarkdown(node as Element)
          })
          // OfficeParser trả về cả trang HTML (head + CSS). Nếu đưa nguyên vào
          // turndown, phần CSS sẽ thành nội dung và bảng quốc hiệu/số hiệu ở
          // đầu văn bản bị mất. Chỉ lấy <body> và bỏ style/script.
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
          const bodyHtml = (bodyMatch ? bodyMatch[1] : html)
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
          content = turndownService.turndown(bodyHtml).trim()

          const firstH1 = content.match(/^#\s+(.+)$/m)
          title = firstH1 ? firstH1[1].trim() : undefined
          sections = this.extractSectionsFromMarkdown(content)
        } else {
          content = document.toText().trim()
        }
      } else {
        content = document.toText().trim()
      }

      if (!content) {
        throw new Error('No readable text content found in Word document')
      }

      return {
        content,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        structure: sections
          ? {
              type: 'sections',
              sections
            }
          : undefined,
        metadata: {
          warnings: document.warnings,
          characterCount: content.length,
          wordCount: content.split(/\s+/).length
        }
      }
    } catch (error) {
      Logger.error('DocxLoader', 'Failed to parse Word document:', error)
      throw new Error(`Failed to parse Word document: ${(error as Error).message}`)
    }
  }

  /**
   * Trích sections trực tiếp từ markdown (offsets luôn khớp với content).
   */
  private extractSectionsFromMarkdown(content: string): SectionInfo[] {
    const headingRegex = /^(#{1,6})\s+(.+?)\s*$/gm
    const flat: SectionInfo[] = []
    let cursor = 0
    let match: RegExpExecArray | null

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length
      const title = match[2].trim()
      const startOffset = match.index
      if (startOffset < cursor) continue
      cursor = startOffset + match[0].length

      flat.push({
        level,
        title,
        content: '',
        startOffset,
        endOffset: content.length
      })
    }

    if (flat.length === 0) return []

    // Tính endOffset theo heading kế tiếp (bất kỳ cấp nào)
    for (let i = 0; i < flat.length - 1; i++) {
      flat[i].endOffset = flat[i + 1].startOffset
      flat[i].content = content.slice(flat[i].startOffset, flat[i].endOffset).trim()
    }
    flat[flat.length - 1].content = content.slice(flat[flat.length - 1].startOffset).trim()

    return this.buildHierarchy(flat)
  }

  private tableToMarkdown(table: Element): string {
    const activeRowSpans = new Map<number, { remaining: number; value: string }>()
    const rows: string[][] = []
    for (const sourceRow of Array.from(table.getElementsByTagName('tr'))) {
      const row: string[] = []
      let column = 0
      const fillRowSpans = (): void => {
        while (activeRowSpans.has(column)) {
          const span = activeRowSpans.get(column)!
          row[column] = span.value
          if (span.remaining <= 1) activeRowSpans.delete(column)
          else activeRowSpans.set(column, { ...span, remaining: span.remaining - 1 })
          column += 1
        }
      }

      for (const cell of Array.from(sourceRow.children).filter(
        (child) => child.tagName === 'TH' || child.tagName === 'TD'
      )) {
        fillRowSpans()
        const value = (cell.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\\/g, '\\\\')
          .replace(/\|/g, '\\|')
        const columnSpan = Math.max(
          1,
          Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1
        )
        const rowSpan = Math.max(1, Number.parseInt(cell.getAttribute('rowspan') || '1', 10) || 1)
        for (let offset = 0; offset < columnSpan; offset += 1) {
          const cellValue = offset === 0 ? value : ''
          row[column + offset] = cellValue
          if (rowSpan > 1) {
            activeRowSpans.set(column + offset, { remaining: rowSpan - 1, value: cellValue })
          }
        }
        column += columnSpan
      }
      fillRowSpans()
      if (row.some(Boolean)) rows.push(row)
    }
    if (rows.length === 0) return ''

    const columnCount = Math.max(...rows.map((row) => row.length))
    const normalizedRows = rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => row[index] || '')
    )
    const toRow = (cells: string[]) => `| ${cells.join(' | ')} |`
    const header = normalizedRows[0]
    const separator = Array.from({ length: columnCount }, () => '---')
    const body = normalizedRows.slice(1).map(toRow)

    return `\n\n${[toRow(header), toRow(separator), ...body].join('\n')}\n\n`
  }

  /**
   * Ã¦Å¾â€žÃ¥Â»ÂºÃ§Â«Â Ã¨Å â€šÃ¥Â±â€šÃ§ÂºÂ§Ã¥â€¦Â³Ã§Â³Â»
   */
  private buildHierarchy(flatSections: SectionInfo[]): SectionInfo[] {
    const root: SectionInfo[] = []
    const stack: SectionInfo[] = []

    for (const section of flatSections) {
      // Ã¥Â¼Â¹Ã¥â€¡ÂºÃ¦Â¯â€Ã¥Â½â€œÃ¥â€°ÂÃ§Â«Â Ã¨Å â€šÃ§ÂºÂ§Ã¥Ë†Â«Ã©Â«ËœÃ§Å¡â€žÃ¨Å â€šÃ§â€šÂ¹
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop()
      }

      if (stack.length === 0) {
        // Ã©Â¡Â¶Ã§ÂºÂ§Ã§Â«Â Ã¨Å â€š
        root.push(section)
      } else {
        // Ã¥Â­ÂÃ§Â«Â Ã¨Å â€š
        const parent = stack[stack.length - 1]
        if (!parent.children) {
          parent.children = []
        }
        parent.children.push(section)
      }

      stack.push(section)
    }

    return root
  }

  private async loadLegacyDoc(filePath: string): Promise<DocumentLoadResult> {
    Logger.info('DocxLoader', `Parsing legacy .doc file: ${filePath}`)
    try {
      const document = await new WordExtractor().extract(filePath)
      const content = document.getBody().trim()
      if (!content) throw new Error('No readable text content found in legacy .doc file')
      return {
        content,
        mimeType: 'application/msword',
        structure: undefined,
        metadata: {
          characterCount: content.length,
          wordCount: content.split(/\s+/).length,
          parser: 'word-extractor'
        }
      }
    } catch (error) {
      Logger.error('DocxLoader', 'Failed to parse legacy .doc file:', error)
      throw new Error(`Failed to parse .doc file: ${(error as Error).message}`)
    }
  }
}
