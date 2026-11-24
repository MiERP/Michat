/**
 * PptLoader
 * Dùng officeparser 7 để bóc tách PowerPoint (.pptx), giữ cấu trúc theo slide.
 */

import { extname } from 'path'
import { OfficeParser, type OfficeContentNode, type SlideMetadata } from 'officeparser'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, PageInfo } from './types'

/** officeparser chỉ hỗ trợ .pptx (OOXML); .ppt nhị phân cũ không nằm trong SupportedFileType. */
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export interface ExtractedSlide {
  slideNumber: number
  text: string
}

/**
 * Makes slide boundaries visible to the common Markdown normalizer. This keeps
 * page citations and hierarchical section retrieval on the same offset system.
 */
export function canonicalizeSlides(slides: ExtractedSlide[]): {
  content: string
  pages: PageInfo[]
} {
  const blocks: string[] = []
  const pages: PageInfo[] = []
  let offset = 0

  for (const slide of slides) {
    const body = slide.text.trim()
    if (!body) continue
    const title = body.split('\n')[0].trim().slice(0, 160) || `Slide ${slide.slideNumber}`
    const block = `# Slide ${slide.slideNumber}: ${title}\n\n${body}`
    blocks.push(block)
    pages.push({
      pageNumber: slide.slideNumber,
      content: block,
      startOffset: offset,
      endOffset: offset + block.length,
      metadata: { slideNumber: slide.slideNumber, title }
    })
    offset += block.length + 2
  }

  return { content: blocks.join('\n\n'), pages }
}

/**
 * PowerPoint document loader
 */
export class PptLoader implements IDocumentLoader {
  readonly supportedMimeTypes = [PPTX_MIME, 'application/vnd.ms-powerpoint']
  readonly supportedExtensions = ['pptx', 'ppt']

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.includes(extname(lower).slice(1))
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    if (extname(filePath).toLowerCase() === '.ppt') {
      throw new Error(
        'Legacy .ppt files are not supported by the PowerPoint parser. Save the file as .pptx and import it again.'
      )
    }

    // Parse từ đường dẫn để officeparser dùng được cả magic bytes lẫn phần mở rộng;
    // fileType được khai báo tường minh vì .pptx/.docx/.xlsx đều là ZIP.
    return this.parse(filePath, options)
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    return this.parse(buffer, options)
  }

  private async parse(source: string | Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options }

    try {
      const document = await OfficeParser.parseOffice(source, { fileType: 'pptx' })
      const slides = opts.preserveStructure ? this.extractSlides(document.content) : []
      const canonical = canonicalizeSlides(slides)
      const content = canonical.content || document.toText().trim()

      if (!content) {
        throw new Error('No readable text content found in PowerPoint document')
      }

      const pages = canonical.pages.length > 0 ? canonical.pages : this.buildPages(slides, content)

      const title = this.extractTitle(slides, content)
      const slideCount = pages.length || slides.length

      return {
        content,
        title,
        mimeType: PPTX_MIME,
        structure: pages.length > 0 ? { type: 'pages', pages } : undefined,
        metadata: {
          slideCount,
          characterCount: content.length,
          warnings: document.warnings
        }
      }
    } catch (error) {
      Logger.error('PptLoader', 'Failed to parse PPT:', error)
      throw new Error(`Failed to parse PPT: ${(error as Error).message}`)
    }
  }

  /** Thu thập các node 'slide' trong AST, kèm số thứ tự slide thật. */
  private extractSlides(nodes: OfficeContentNode[] | undefined): ExtractedSlide[] {
    const slides: ExtractedSlide[] = []

    const visit = (list: OfficeContentNode[] | undefined): void => {
      if (!list) return
      for (const node of list) {
        if (node.type === 'slide') {
          const meta = node.metadata as SlideMetadata | undefined
          slides.push({
            slideNumber: meta?.slideNumber ?? slides.length + 1,
            text: this.slideText(node)
          })
        }
        if (node.children?.length) visit(node.children)
      }
    }

    visit(nodes)
    return slides
  }

  /**
   * officeparser trả `text` rỗng cho node container (slide), nội dung nằm ở
   * các node con — nên ghép lại từ children.
   */
  private slideText(node: OfficeContentNode): string {
    if (node.text && node.text.trim()) return node.text.trim()
    return (node.children ?? [])
      .map((child) => (child.text ?? '').trim())
      .filter((line) => line.length > 0)
      .join('\n')
  }

  /**
   * Dựng PageInfo với offset trỏ đúng vị trí trong `content`, để điều hướng
   * citation nhảy đúng trang.
   */
  private buildPages(slides: ExtractedSlide[], content: string): PageInfo[] {
    const pages: PageInfo[] = []
    let cursor = 0

    for (const slide of slides) {
      if (!slide.text) continue

      const found = content.indexOf(slide.text, cursor)
      const startOffset = found >= 0 ? found : cursor
      pages.push({
        pageNumber: slide.slideNumber,
        content: slide.text,
        startOffset,
        endOffset: startOffset + slide.text.length
      })
      cursor = startOffset + slide.text.length
    }

    return pages
  }

  private extractTitle(slides: ExtractedSlide[], content: string): string | undefined {
    const firstSlideLine = slides[0]?.text.split('\n')[0]?.trim()
    if (firstSlideLine && firstSlideLine.length < 100) return firstSlideLine

    const firstLine = content.split('\n')[0]?.trim()
    return firstLine && firstLine.length < 100 ? firstLine : undefined
  }
}
