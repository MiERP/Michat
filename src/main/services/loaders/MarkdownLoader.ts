/**
 * MarkdownLoader
 * Parses Markdown with remark/unified while preserving the AST structure
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/** Minimal position shape from a unist AST (line/column are always present). */
type MarkdownPoint = {
  line: number
  column: number
  offset?: number
}

type MarkdownNode = {
  type: string
  depth?: number
  value?: string
  children?: MarkdownNode[]
  position?: {
    start: MarkdownPoint
    end: MarkdownPoint
  }
}

type Root = MarkdownNode
type Heading = MarkdownNode & { depth: number }
type Content = MarkdownNode

/**
 * Markdown document loader
 * Parses with unified/remark and supports GFM
 */
export class MarkdownLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['text/markdown']
  readonly supportedExtensions = ['md', 'markdown']

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
    const content = buffer.toString('utf-8')

    try {
      // Parse the Markdown AST
      // Handle ESM/CommonJS compatibility: resolve the correct function at runtime
      const remarkFn =
        typeof remark === 'function'
          ? remark
          : ((remark as unknown as { remark?: typeof remark }).remark ?? remark)
      const remarkGfmPlugin =
        typeof remarkGfm === 'function'
          ? remarkGfm
          : ((remarkGfm as unknown as { default?: typeof remarkGfm }).default ?? remarkGfm)
      const processor = remarkFn().use(remarkGfmPlugin)
      const ast = processor.parse(content) as Root

      // Extract the title
      const title = this.extractTitle(ast)

      // Extract the section structure
      const sections = opts.preserveStructure ? this.extractSections(content, ast) : undefined

      return {
        content: content.trim(),
        title,
        mimeType: 'text/markdown',
        structure: sections
          ? {
              type: 'sections',
              sections
            }
          : undefined,
        metadata: {
          lineCount: content.split('\n').length,
          hasCodeBlocks: this.hasCodeBlocks(ast),
          hasTables: this.hasTables(ast)
        }
      }
    } catch (error) {
      Logger.error('MarkdownLoader', 'Failed to parse Markdown:', error)
      throw new Error(`Failed to parse Markdown: ${(error as Error).message}`)
    }
  }

  /**
   * Extract the document title (first h1)
   */
  private extractTitle(ast: Root): string | undefined {
    let title: string | undefined

    visit(ast, 'heading', (node: MarkdownNode) => {
      if (!title && node.depth === 1) {
        title = this.nodeToText(node)
        return false // Stop traversal
      }
      return undefined // Continue traversal
    })

    return title
  }

  /**
   * Extract the section structure
   */
  private extractSections(content: string, ast: Root): SectionInfo[] {
    const sections: SectionInfo[] = []
    const stack: { section: SectionInfo; level: number }[] = []

    visit(ast, (node) => {
      if (node.type === 'heading') {
        const heading = node as Heading
        const title = this.nodeToText(heading)
        const startOffset = node.position?.start.offset ?? 0
        const endOffset = node.position?.end.offset ?? startOffset

        const section: SectionInfo = {
          level: heading.depth,
          title,
          content: '',
          startOffset,
          endOffset,
          children: []
        }

        // Maintain the section hierarchy
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.depth) {
          stack.pop()
        }

        if (stack.length === 0) {
          sections.push(section)
        } else {
          stack[stack.length - 1].section.children!.push(section)
        }

        stack.push({ section, level: heading.depth })
      }
    })

    // Extract the content of each section
    this.fillSectionContent(sections, content)

    return sections
  }

  /**
   * Fill in section content
   */
  private fillSectionContent(sections: SectionInfo[], fullContent: string): void {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const nextSectionStart =
        i + 1 < sections.length ? sections[i + 1].startOffset : fullContent.length

      // Capture the content from the current heading to the next same-level heading
      section.content = fullContent.substring(section.startOffset, nextSectionStart).trim()
      section.endOffset = nextSectionStart

      // Recursively process subsections
      if (section.children && section.children.length > 0) {
        this.fillSectionContent(section.children, section.content)
      }
    }
  }

  /**
   * Convert an AST node to plain text
   */
  private nodeToText(node: Content | Heading): string {
    if ('value' in node && typeof node.value === 'string') {
      return node.value
    }
    if ('children' in node && Array.isArray(node.children)) {
      return node.children.map((child) => this.nodeToText(child)).join('')
    }
    return ''
  }

  /**
   * Check whether there are code blocks
   */
  private hasCodeBlocks(ast: Root): boolean {
    let hasCode = false
    visit(ast, 'code', () => {
      hasCode = true
      return false
    })
    return hasCode
  }

  /**
   * Check whether there are tables
   */
  private hasTables(ast: Root): boolean {
    let hasTable = false
    visit(ast, 'table', () => {
      hasTable = true
      return false
    })
    return hasTable
  }
}
