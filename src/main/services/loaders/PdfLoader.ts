/**
 * PdfLoader
 * Dùng pdfjs-dist để phân tích PDF, trích xuất văn bản và thông tin số trang
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
// Dùng bản legacy build cho môi trường Node.js
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, PageInfo } from './types'

export interface PdfTextItem {
  str: string
  hasEOL?: boolean
  transform?: ArrayLike<number>
}

export function joinPdfTextItems(items: PdfTextItem[]): string {
  let text = ''
  let previousY: number | undefined
  let previousHasEOL = false

  for (const item of items) {
    if (!item.str) continue

    const currentY = item.transform?.[5]
    const movedToNewLine =
      previousY !== undefined && currentY !== undefined && Math.abs(previousY - currentY) > 2
    if (text) text += previousHasEOL || movedToNewLine ? '\n' : ' '

    text += item.str
    previousY = currentY
    previousHasEOL = item.hasEOL === true
  }

  return text
}

/**
 * Bộ nạp tài liệu PDF
 * Dựa trên PDF.js của Mozilla (thuần JavaScript)
 */
export class PdfLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/pdf']
  readonly supportedExtensions = ['pdf']

  constructor() {
    // Cấu hình PDF.js worker (dùng legacy build)
    // Trong môi trường Electron/Node.js cần dùng phiên bản legacy
    try {
      // Dùng dynamic import thay cho require
      import('pdfjs-dist/legacy/build/pdf.worker.mjs')
        .then((pdfjsWorker) => {
          if (pdfjsWorker) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
          }
        })
        .catch(() => {
          Logger.warn('PdfLoader', 'Không thể tải PDF.js worker, chuyển sang chế độ inline')
        })
    } catch {
      // Nếu không tải được worker, dùng chế độ inline
      Logger.warn('PdfLoader', 'Không thể tải PDF.js worker, chuyển sang chế độ inline')
    }
  }

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

        // Trích xuất nội dung văn bản của trang
        const pageText = joinPdfTextItems(
          textContent.items.filter((item): item is TextItem => 'str' in item)
        )

        // Làm sạch văn bản
        const cleanedText = this.cleanPDFText(pageText)
        const pageTextWithNewline = cleanedText + '\n\n'

        // Ghi nhận thông tin trang
        if (opts.preserveStructure) {
          pages.push({
            pageNumber: pageNum,
            content: cleanedText,
            startOffset: currentOffset,
            endOffset: currentOffset + cleanedText.length,
            metadata: {
              width: viewport.width,
              height: viewport.height
            }
          })
        }

        fullText += pageTextWithNewline
        currentOffset += pageTextWithNewline.length

        // Giải phóng tài nguyên trang
        page.cleanup()
      }

      // Dọn dẹp tài liệu
      await pdfDoc.cleanup()
      await pdfDoc.destroy()

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
   * Làm sạch văn bản trích xuất từ PDF
   */
  private cleanPDFText(text: string): string {
    return (
      text
        // Loại bỏ khoảng trắng dư thừa
        .replace(/[ \t]+/g, ' ')
        // Sửa lỗi xuống dòng (nhiều dòng thực ra có thể cùng một đoạn)
        // Chuẩn hóa nhiều dòng trống thành 2 dòng
        .replace(/\n{3,}/g, '\n\n')
        // Loại bỏ khoảng trắng đầu/cuối
        .trim()
    )
  }
}
