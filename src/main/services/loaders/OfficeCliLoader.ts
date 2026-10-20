import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import { extname, join, basename } from 'path'
import Logger from '../../../shared/utils/logger'
import type { OfficeCliOutline, OfficeCliService } from '../officecli/OfficeCliService'
import { DocxLoader } from './DocxLoader'
import { PptLoader } from './PptLoader'
import type { DocumentLoadResult, DocumentStructure, IDocumentLoader, LoadOptions } from './types'
import { buildSectionHierarchy, type FlatSectionInput } from './sections'

/**
 * Document loader backed by the officecli engine.
 *
 * Compared with the legacy loaders it adds: heading/style structure from
 * `view outline`, and paragraph-accurate text from `view text --json`. It is a
 * *preference*, never a dependency — any failure (engine unavailable, command
 * error, empty result) falls back to the legacy loader so ingestion keeps working.
 *
 * Excel is deliberately left to ExcelLoader: exceljs already yields clean table
 * rows, whereas officecli's cell-oriented text view (`B2=120000`) chunks worse.
 */
export class OfficeCliLoader implements IDocumentLoader {
  readonly supportedMimeTypes: string[]
  readonly supportedExtensions: string[]

  private readonly service: OfficeCliService
  private readonly fallbacks: Record<string, IDocumentLoader>

  constructor(service: OfficeCliService) {
    this.service = service
    this.supportedExtensions = ['docx', 'pptx']
    this.supportedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
    this.fallbacks = {
      docx: new DocxLoader(),
      pptx: new PptLoader()
    }
  }

  canLoad(filePathOrMimeType: string): boolean {
    const ext = extname(filePathOrMimeType).toLowerCase().slice(1)
    return (
      this.supportedExtensions.includes(ext) || this.supportedMimeTypes.includes(filePathOrMimeType)
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const ext = extname(filePath).toLowerCase().slice(1)

    if (!this.service.available) {
      return this.loadWithFallback(ext, filePath, options)
    }

    try {
      const result = await this.extract(filePath)
      if (!result.content.trim()) {
        Logger.warn('OfficeCliLoader', `Empty extraction for ${filePath}, falling back`)
        return this.loadWithFallback(ext, filePath, options)
      }
      return result
    } catch (error) {
      Logger.warn('OfficeCliLoader', `Extraction failed, falling back: ${String(error)}`)
      return this.loadWithFallback(ext, filePath, options)
    }
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    // officecli addresses documents by path, so a buffer is materialised first.
    // The temp file lives only for the duration of the extraction.
    const dir = mkdtempSync(join(os.tmpdir(), 'michat-officeloader-'))
    const ext = 'docx'
    const tempFile = join(dir, `buffer.${ext}`)
    try {
      writeFileSync(tempFile, buffer)
      return await this.loadFromPath(tempFile, options)
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  }

  private async loadWithFallback(
    ext: string,
    filePath: string,
    options?: LoadOptions
  ): Promise<DocumentLoadResult> {
    const fallback = this.fallbacks[ext]
    if (!fallback) {
      throw new Error(`Unsupported file type for OfficeCliLoader: ${ext}`)
    }
    return fallback.loadFromPath(filePath, options)
  }

  private async extract(filePath: string): Promise<DocumentLoadResult> {
    const text = await this.service.viewText(filePath)
    const outline = await this.service.viewOutline(filePath)

    const fromElements = (text.data?.elements ?? [])
      .map((element) => (element.text ?? '').trim())
      .filter((line) => line.length > 0)
    const fromSlides = (text.data?.slides ?? [])
      .flatMap((slide) => slide.texts ?? [])
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const content = (fromElements.length > 0 ? fromElements : fromSlides).join('\n\n')

    const structure = this.buildStructure(outline.data, content)
    const title =
      outline.data?.headings?.[0]?.text ??
      outline.data?.slides?.[0]?.title ??
      basename(filePath, extname(filePath))

    return {
      content,
      title,
      mimeType: this.mimeTypeFor(extname(filePath).toLowerCase().slice(1)),
      structure,
      metadata: {
        source: 'officecli',
        version: this.service.status.version,
        headings: outline.data?.headings?.length ?? 0,
        slides: outline.data?.totalSlides ?? 0,
        paragraphs: outline.data?.paragraphs ?? 0
      }
    }
  }

  private buildStructure(
    outline: OfficeCliOutline | undefined,
    content: string
  ): DocumentStructure | undefined {
    if (!outline) return undefined

    const headings = outline.headings as
      | { line: number; text: string; style: string; level: number }[]
      | undefined
    if (headings && headings.length > 0) {
      // officecli trả `line` là SỐ DÒNG, không phải offset ký tự. Dùng nó làm
      // offset sẽ khiến mọi bước neo heading/trang ở hạ nguồn sai (hoặc bị bỏ).
      // Nên ánh xạ tuần tự tiêu đề → vị trí ký tự thật trong `content`.
      const flat: FlatSectionInput[] = []
      let cursor = 0

      for (const heading of headings) {
        const title = (heading.text || '').trim()
        if (!title) continue

        const found = content.indexOf(title, cursor)
        if (found < 0) continue

        cursor = found + title.length
        flat.push({
          level: heading.level,
          title,
          startOffset: found,
          endOffset: content.length
        })
      }

      if (flat.length === 0) return { type: 'flat' }

      // endOffset của mỗi heading = startOffset của heading kế tiếp.
      for (let i = 0; i < flat.length - 1; i++) {
        flat[i].endOffset = flat[i + 1].startOffset
      }

      return { type: 'sections', sections: buildSectionHierarchy(flat) }
    }

    const slides = outline.slides as { index: number; title: string }[] | undefined
    if (slides && slides.length > 0) {
      const located: Array<{ pageNumber: number; title: string; startOffset: number }> = []
      let cursor = 0

      for (const slide of slides) {
        const title = (slide.title || '').trim()
        if (!title) continue

        const found = content.indexOf(title, cursor)
        if (found < 0) continue

        cursor = found + title.length
        located.push({ pageNumber: slide.index, title, startOffset: found })
      }

      // Không ánh xạ được tiêu đề nào vào text view → giữ cấu trúc trang như cũ.
      // Offset 0 nghĩa là "chưa có toạ độ": hạ nguồn bỏ qua chứ không gán sai trang.
      if (located.length === 0) {
        return {
          type: 'pages',
          pages: slides.map((slide) => ({
            pageNumber: slide.index,
            content: slide.title,
            startOffset: 0,
            endOffset: 0
          }))
        }
      }

      return {
        type: 'pages',
        pages: located.map((slide, index) => ({
          pageNumber: slide.pageNumber,
          content: slide.title,
          startOffset: slide.startOffset,
          endOffset: located[index + 1]?.startOffset ?? content.length
        }))
      }
    }

    return { type: 'flat' }
  }

  private mimeTypeFor(ext: string): string {
    return ext === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
}
