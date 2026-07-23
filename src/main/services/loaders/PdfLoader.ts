/**
 * PdfLoader
 * Dùng pdfjs-dist để phân tích PDF, trích xuất văn bản và thông tin số trang
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import { createCanvas } from '@napi-rs/canvas'
// Dùng bản legacy build cho môi trường Node.js
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import Logger from '../../../shared/utils/logger'
import { TesseractOcrService } from '../ocr/TesseractOcrService'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, PageInfo } from './types'

export interface PdfTextItem {
  str: string
  hasEOL?: boolean
  transform?: ArrayLike<number>
  width?: number
  height?: number
}

interface PdfLine {
  text: string
  x: number
  y: number
  endX: number
}

export interface PdfTextQuality {
  score: number
  needsOcr: boolean
}

export function assessPdfTextQuality(text: string): PdfTextQuality {
  const normalized = text.normalize('NFC').trim()
  if (!normalized) return { score: 0, needsOcr: true }

  const characters = [...normalized]
  const alphaNumeric = characters.filter((character) => /[\p{L}\p{N}]/u.test(character)).length
  const replacements = characters.filter((character) => character === '�').length
  const alphaNumericRatio = alphaNumeric / characters.length
  const replacementRatio = replacements / characters.length
  const lengthScore = Math.min(normalized.length / 80, 1)
  const score = Math.max(
    0,
    Math.min(1, lengthScore * 0.35 + alphaNumericRatio * 0.65 - replacementRatio * 2)
  )

  return {
    score,
    needsOcr: normalized.length < 20 || alphaNumericRatio < 0.45 || replacementRatio > 0.02 || score < 0.55
  }
}

function buildPdfLines(items: PdfTextItem[]): PdfLine[] {
  const lines: Array<PdfLine & { parts: Array<{ text: string; x: number }> }> = []

  for (const item of items) {
    const text = item.str.trim()
    const x = Number(item.transform?.[4] ?? 0)
    const y = Number(item.transform?.[5] ?? 0)
    if (!text) continue

    const itemEndX = x + Number(item.width ?? text.length * 6)
    let line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - y) <= 3 &&
        x <= candidate.endX + 60 &&
        itemEndX >= candidate.x - 60
    )
    if (!line) {
      line = { text: '', x, y, endX: x, parts: [] }
      lines.push(line)
    }
    line.parts.push({ text, x })
    line.x = Math.min(line.x, x)
    line.endX = Math.max(line.endX, itemEndX)
  }

  return lines.map((line) => ({
    text: line.parts
      .sort((left, right) => left.x - right.x)
      .map((part) => part.text)
      .join(' '),
    x: line.x,
    y: line.y,
    endX: line.endX
  }))
}

export function orderPdfTextItems(
  items: PdfTextItem[],
  pageWidth: number
): { text: string; layout: 'single-column' | 'two-column' | 'unknown' } {
  const lines = buildPdfLines(items)
  if (lines.length === 0) return { text: '', layout: 'unknown' }

  const splitX = pageWidth / 2
  const left = lines.filter((line) => line.endX < splitX * 0.96)
  const right = lines.filter((line) => line.x > splitX * 1.04)
  const spanning = lines.filter((line) => !left.includes(line) && !right.includes(line))
  const twoColumn = left.length >= 2 && right.length >= 2
  const sortTopDown = (values: PdfLine[]): PdfLine[] =>
    values.slice().sort((first, second) => second.y - first.y || first.x - second.x)

  if (!twoColumn) {
    return {
      text: sortTopDown(lines)
        .map((line) => line.text)
        .join('\n'),
      layout: 'single-column'
    }
  }

  const bodyTop = Math.max(...left.map((line) => line.y), ...right.map((line) => line.y))
  const bodyBottom = Math.min(...left.map((line) => line.y), ...right.map((line) => line.y))
  const headers = spanning.filter((line) => line.y > bodyTop)
  const footers = spanning.filter((line) => line.y < bodyBottom)
  const bodySpanning = spanning.filter((line) => line.y <= bodyTop && line.y >= bodyBottom)
  const ordered = [
    ...sortTopDown(headers),
    ...sortTopDown(left),
    ...sortTopDown(bodySpanning),
    ...sortTopDown(right),
    ...sortTopDown(footers)
  ]

  return { text: ordered.map((line) => line.text).join('\n'), layout: 'two-column' }
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
    const opts = { preserveStructure: true, ocrEnabled: true, ...options }
    const ocrService = opts.ocrEnabled ? new TesseractOcrService() : undefined

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
        const textItems = textContent.items.filter((item): item is TextItem => 'str' in item)
        const orderedText = orderPdfTextItems(textItems, viewport.width)
        const pageText = orderedText.text || joinPdfTextItems(textItems)

        // Làm sạch văn bản
        const extractedText = this.cleanPDFText(pageText)
        const quality = assessPdfTextQuality(extractedText)
        let cleanedText = extractedText
        let extractionMethod: 'text' | 'ocr' | 'mixed' = 'text'
        let ocrConfidence: number | undefined
        const warnings: string[] = []

        if (ocrService && quality.needsOcr) {
          try {
            const image = await this.renderPageForOcr(page)
            const ocrResult = await ocrService.recognizeImage(image)
            const ocrText = this.cleanPDFText(ocrResult.text)
            if (ocrText) {
              cleanedText = ocrText
              extractionMethod = extractedText ? 'mixed' : 'ocr'
              ocrConfidence = ocrResult.confidence
            }
          } catch (error) {
            warnings.push(`OCR failed: ${(error as Error).message}`)
            Logger.warn('PdfLoader', `OCR trang ${pageNum} thất bại:`, error)
          }
        }
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
              height: viewport.height,
              extractionMethod,
              textQuality: quality.score,
              ocrConfidence,
              layout: orderedText.layout,
              warnings
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
      await ocrService?.dispose()

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
      await ocrService?.dispose().catch(() => undefined)
      Logger.error('PdfLoader', 'Không thể phân tích PDF:', error)
      throw new Error(`Failed to parse PDF: ${(error as Error).message}`)
    }
  }

  private async renderPageForOcr(page: PDFPageProxy): Promise<Buffer> {
    const baseViewport = page.getViewport({ scale: 1.5 })
    const maxPixels = 12_000_000
    const pixelCount = baseViewport.width * baseViewport.height
    const scale = pixelCount > maxPixels ? 1.5 * Math.sqrt(maxPixels / pixelCount) : 1.5
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')

    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: 'white'
    }).promise

    return Buffer.from(await canvas.encode('png'))
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
