/**
 * PdfLoader
 * Dùng pdfjs-dist để phân tích PDF, trích xuất văn bản và thông tin số trang
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, PageInfo } from './types'

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfJsModule> | undefined

function ensurePdfDomGlobals(): void {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      readonly a = 1
      readonly b = 0
      readonly c = 0
      readonly d = 1
      readonly e = 0
      readonly f = 0
    } as typeof DOMMatrix
  }
}

async function getPdfJs(): Promise<PdfJsModule> {
  ensurePdfDomGlobals()

  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(async (pdfjsLib) => {
      try {
        await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
      } catch {
        Logger.warn('PdfLoader', 'Không thể tải PDF.js worker, chuyển sang chế độ inline')
      }

      return pdfjsLib
    })
  }

  return pdfjsPromise
}

/**
 * Bộ nạp tài liệu PDF
 * Dựa trên PDF.js của Mozilla (thuần JavaScript)
 */
export class PdfLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/pdf']
  readonly supportedExtensions = ['pdf']

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.includes(extname(lower).slice(1))
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const buffer = await readFile(filePath)
    return this.loadFromBuffer(buffer, options)
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options }

    try {
      const pdfjsLib = await getPdfJs()

      // Nạp tài liệu PDF
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        password: opts.password,
        // Giảm cảnh báo "Ensure that the standardFontDataUrl API parameter is provided"
        // trong môi trường Electron/Node.
        standardFontDataUrl: new URL('pdfjs-dist/standard_fonts/', import.meta.url).toString()
      })
      const pdfDoc: PDFDocumentProxy = await loadingTask.promise

      Logger.info('PdfLoader', `Đang tải PDF với ${pdfDoc.numPages} trang`)

      // Trích xuất metadata
      const metadata = await pdfDoc.getMetadata().catch(() => null)
      const metadataInfo = metadata?.info as Record<string, unknown> | undefined
      const title = (metadataInfo?.Title as string) || undefined

      // Trích xuất văn bản theo từng trang
      const pages: PageInfo[] = []
      let fullText = ''
      let currentOffset = 0

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1.0 })

        // Nhóm text items thành dòng kèm font size để phát hiện heading
        const lines = this.groupTextItemsIntoLines(textContent.items)
        const bodyFontSize = this.estimateBodyFontSize(lines)
        const pageText = this.linesToMarkdown(lines, bodyFontSize)

        // Ghi nhận thông tin trang
        if (opts.preserveStructure) {
          pages.push({
            pageNumber: pageNum,
            content: pageText,
            startOffset: currentOffset,
            endOffset: currentOffset + pageText.length,
            metadata: {
              width: viewport.width,
              height: viewport.height
            }
          })
        }

        const pageTextWithNewline = pageText + '\n\n'
        fullText += pageTextWithNewline
        currentOffset += pageTextWithNewline.length

        // Giải phóng tài nguyên trang
        page.cleanup()
      }

      // Dọn dẹp tài liệu (PDF.js 6 chuyển destroy() lên loading task)
      await pdfDoc.cleanup()
      await loadingTask.destroy()

      if (!fullText.trim()) {
        const ocrMessage = opts.ocrEnabled
          ? 'OCR was requested but no bundled offline OCR engine is configured'
          : 'PDF contains no extractable text and requires OCR before it can be indexed'
        throw new Error(ocrMessage)
      }

      return {
        content: fullText.trim(),
        title,
        mimeType: 'application/pdf',
        structure: opts.preserveStructure
          ? {
              type: 'pages',
              pages
            }
          : undefined,
        metadata: {
          pageCount: pdfDoc.numPages,
          author: metadataInfo?.Author,
          creator: metadataInfo?.Creator,
          producer: metadataInfo?.Producer,
          creationDate: metadataInfo?.CreationDate,
          subject: metadataInfo?.Subject,
          keywords: metadataInfo?.Keywords
        }
      }
    } catch (error) {
      Logger.error('PdfLoader', 'Không thể phân tích PDF:', error)
      throw new Error(`Failed to parse PDF: ${(error as Error).message}`)
    }
  }

  /**
   * Nhóm text items thành các dòng kèm kích thước font lớn nhất trong dòng
   */
  private groupTextItemsIntoLines(
    items: unknown[]
  ): Array<{ text: string; size: number; bold: boolean }> {
    const lines: Array<{ text: string; size: number; bold: boolean }> = []
    let current = { text: '', size: 0, bold: false }

    for (const raw of items) {
      const item = raw as {
        str?: unknown
        hasEOL?: boolean
        transform?: number[]
        fontName?: unknown
      } | null
      if (!item || typeof item.str !== 'string') continue

      const transform = Array.isArray(item.transform) ? item.transform : []
      const size = Math.max(Math.hypot(transform[0] ?? 0, transform[2] ?? 0), 1) || 12
      const fontName = typeof item.fontName === 'string' ? item.fontName : ''
      const bold = fontName.toLowerCase().includes('bold')

      current.text += item.str
      current.size = Math.max(current.size, size)
      if (bold) current.bold = true

      if (item.hasEOL) {
        lines.push(current)
        current = { text: '', size: 0, bold: false }
      }
    }

    if (current.text.trim()) {
      lines.push(current)
    }

    return lines
  }

  /**
   * Ước tính kích thước font của nội dung chính (body) bằng median
   * của các dòng có độ dài đáng kể.
   */
  private estimateBodyFontSize(lines: Array<{ text: string; size: number }>): number {
    const meaningful = lines
      .filter((line) => line.text.trim().length >= 10)
      .map((line) => line.size)

    if (meaningful.length === 0) {
      return lines.length > 0 ? Math.max(...lines.map((l) => l.size)) : 12
    }

    const sorted = [...meaningful].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  /**
   * Chuyển dòng thành markdown: dòng có font lớn hơn hẳn body và ngắn
   * được coi là heading, chèn marker `#` tương ứng.
   */
  private linesToMarkdown(
    lines: Array<{ text: string; size: number; bold: boolean }>,
    bodyFontSize: number
  ): string {
    const rendered = lines.map((line) => {
      const text = this.cleanPDFText(line.text)
      return { ...line, text }
    })

    const headingCount = rendered.filter((line) => this.isHeadingLine(line, bodyFontSize)).length

    // Nếu quá nhiều "heading" thì heuristic sai — giữ nguyên text phẳng
    if (headingCount > Math.max(2, rendered.length * 0.35)) {
      return rendered
        .map((line) => line.text)
        .join('\n')
        .trim()
    }

    return rendered
      .map((line) => {
        if (!this.isHeadingLine(line, bodyFontSize)) return line.text

        const ratio = line.size / Math.max(bodyFontSize, 1)
        const level = ratio >= 1.5 ? 1 : ratio >= 1.25 ? 2 : 3
        return `${'#'.repeat(level)} ${line.text}`
      })
      .join('\n')
      .trim()
  }

  private isHeadingLine(
    line: { text: string; size: number; bold: boolean },
    bodyFontSize: number
  ): boolean {
    const text = line.text.trim()
    if (!text || text.length > 90) return false
    if (line.size < bodyFontSize * 1.12) return false
    if (/[.,;:!?]$/.test(text)) return false
    return true
  }

  /**
   * Làm sạch văn bản trích xuất từ PDF
   */
  private cleanPDFText(text: string): string {
    return (
      text
        // Loại bỏ khoảng trắng dư thừa
        .replace(/[ \t]+/g, ' ')
        // Chuẩn hóa nhiều dòng trống thành 2 dòng
        .replace(/\n{3,}/g, '\n\n')
        // Loại bỏ khoảng trắng đầu/cuối
        .trim()
    )
  }
}
