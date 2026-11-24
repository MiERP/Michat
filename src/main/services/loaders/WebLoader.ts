/**
 * WebLoader
 * Uses @mozilla/readability to intelligently extract web page body content
 */

import { readFile } from 'fs/promises'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/**
 * Web page loader
 * Based on Mozilla Readability (Firefox Reader View)
 */
export class WebLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['text/html', 'application/xhtml+xml']
  readonly supportedExtensions = ['html', 'htm']

  private turndownService: TurndownService

  constructor() {
    // Initialize the HTML-to-Markdown service
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    })
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.some((ext) => lower.endsWith(`.${ext}`))
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const buffer = await readFile(filePath)
    return this.loadFromBuffer(buffer, options)
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options }
    const html = buffer.toString('utf-8')

    try {
      // Use Readability to intelligently extract the body content
      const dom = new JSDOM(html, { url: 'https://example.com' })
      const reader = new Readability(dom.window.document)
      const article = reader.parse()

      if (!article) {
        // Fallback: extract directly with cheerio
        Logger.warn('WebLoader', 'Readability failed, falling back to cheerio')
        return this.fallbackParse(html, opts)
      }

      // Convert to Markdown
      const markdown = this.turndownService.turndown(article.content || '')

      // Extract the section structure
      const sections = opts.preserveStructure
        ? this.extractSections(article.content || '')
        : undefined

      return {
        content: markdown.trim(),
        title: article.title || undefined,
        mimeType: 'text/html',
        structure: sections
          ? {
              type: 'sections',
              sections
            }
          : undefined,
        metadata: {
          excerpt: article.excerpt,
          byline: article.byline,
          siteName: article.siteName,
          length: article.length,
          publishedTime: article.publishedTime
        }
      }
    } catch (error) {
      Logger.error('WebLoader', 'Failed to parse web content:', error)
      throw new Error(`Failed to parse web content: ${(error as Error).message}`)
    }
  }

  /**
   * Fallback parsing (when Readability fails)
   */
  private fallbackParse(html: string, opts: LoadOptions): DocumentLoadResult {
    const $ = cheerio.load(html)

    // Remove scripts, styles, and similar elements
    $('script, style, nav, footer, aside').remove()

    // Try to find the main content area
    const mainContent =
      $('article').html() ||
      $('main').html() ||
      $('.content').html() ||
      $('#content').html() ||
      $('body').html() ||
      ''

    const markdown = this.turndownService.turndown(mainContent)

    // Extract the title
    const title = $('title').text().trim() || $('h1').first().text().trim() || undefined

    // Extract sections
    const sections = opts.preserveStructure ? this.extractSections(mainContent) : undefined

    return {
      content: markdown.trim(),
      title,
      mimeType: 'text/html',
      structure: sections
        ? {
            type: 'sections',
            sections
          }
        : undefined,
      metadata: {
        fallback: true
      }
    }
  }

  /**
   * Extract the section structure from HTML
   */
  private extractSections(html: string): SectionInfo[] {
    const $ = cheerio.load(html)
    const sections: SectionInfo[] = []
    const headings = $('h1, h2, h3, h4, h5, h6').toArray()

    for (const heading of headings) {
      const $heading = $(heading)
      const tagName = $heading.prop('tagName')?.toLowerCase()
      const level = tagName ? parseInt(tagName.charAt(1)) : 1
      const title = $heading.text().trim()

      if (!title) continue

      // Capture content after this heading up to the next same-level or higher-level heading
      let contentHtml = ''
      let nextSibling = $heading.next()
      while (nextSibling.length) {
        const nextTag = nextSibling.prop('tagName')?.toLowerCase()
        if (nextTag && /^h[1-6]$/.test(nextTag)) {
          const nextLevel = parseInt(nextTag.charAt(1))
          if (nextLevel <= level) break
        }
        contentHtml += $.html(nextSibling)
        nextSibling = nextSibling.next()
      }

      const contentMarkdown = this.turndownService.turndown(contentHtml).trim()

      sections.push({
        level,
        title,
        content: contentMarkdown,
        startOffset: 0, // Precise offsets are difficult to determine in HTML
        endOffset: 0
      })
    }

    return this.buildHierarchy(sections)
  }

  /**
   * Build the section hierarchy
   */
  private buildHierarchy(flatSections: SectionInfo[]): SectionInfo[] {
    const root: SectionInfo[] = []
    const stack: SectionInfo[] = []

    for (const section of flatSections) {
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop()
      }

      if (stack.length === 0) {
        root.push(section)
      } else {
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
}
