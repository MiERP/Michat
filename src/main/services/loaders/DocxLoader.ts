/**
 * DocxLoader
 * Ã¤Â½Â¿Ã§â€Â¨ mammoth Ã¨Â§Â£Ã¦Å¾Â Word Ã¦â€“â€¡Ã¦Â¡Â£Ã¯Â¼Å’Ã¥Â¹Â¶Ã¦ÂÂÃ¥Ââ€“Ã§Â»â€œÃ¦Å¾â€žÃ¤Â¿Â¡Ã¦ÂÂ¯
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import WordExtractor from 'word-extractor'
import { OfficeParser } from 'officeparser'
import * as cheerio from 'cheerio'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/**
 * Word Ã¦â€“â€¡Ã¦Â¡Â£Ã¥Å Â Ã¨Â½Â½Ã¥â„¢Â¨
 * Ã¥Å¸ÂºÃ¤ÂºÅ½ mammothÃ¯Â¼Å’Ã¦â€Â¯Ã¦Å’Â DOCX Ã¥â€™Å’ DOC
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
      // Ã¦ÂÂÃ¥Ââ€“Ã§ÂºÂ¯Ã¦â€“â€¡Ã¦Å“Â¬
      const document = await OfficeParser.parseOffice(buffer)
      const content = document.toText().trim()

      // Ã¦ÂÂÃ¥Ââ€“Ã§Â»â€œÃ¦Å¾â€žÃ¤Â¿Â¡Ã¦ÂÂ¯Ã¯Â¼Ë†Ã¥Â°â€ Ã¦â€“â€¡Ã¦Â¡Â£Ã¨Â½Â¬Ã¦ÂÂ¢Ã¤Â¸Âº HTMLÃ¯Â¼Å’Ã¤Â»Å½Ã¤Â¸Â­Ã¦ÂÂÃ¥Ââ€“Ã¦Â â€¡Ã©Â¢ËœÃ¯Â¼â€°
      let sections: SectionInfo[] | undefined
      let title: string | undefined

      if (opts.preserveStructure) {
        const htmlResult = await document.to('html')
        const html = typeof htmlResult.value === 'string' ? htmlResult.value : ''
        const $ = cheerio.load(html)

        // Ã¦ÂÂÃ¥Ââ€“Ã§Â¬Â¬Ã¤Â¸â‚¬Ã¤Â¸ÂªÃ¦Â â€¡Ã©Â¢ËœÃ¤Â½Å“Ã¤Â¸ÂºÃ¦â€“â€¡Ã¦Â¡Â£Ã¦Â â€¡Ã©Â¢Ëœ
        const firstH1 = $('h1').first().text().trim()
        title = firstH1 || undefined

        // Ã¦ÂÂÃ¥Ââ€“Ã§Â«Â Ã¨Å â€šÃ§Â»â€œÃ¦Å¾â€ž
        sections = this.extractSectionsFromHtml($, content)
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
   * Ã¤Â»Å½ HTML Ã¤Â¸Â­Ã¦ÂÂÃ¥Ââ€“Ã§Â«Â Ã¨Å â€šÃ§Â»â€œÃ¦Å¾â€ž
   */
  private extractSectionsFromHtml($: cheerio.CheerioAPI, fullContent: string): SectionInfo[] {
    const sections: SectionInfo[] = []
    const headings = $('h1, h2, h3, h4, h5, h6').toArray()

    for (let i = 0; i < headings.length; i++) {
      const heading = $(headings[i])
      const tagName = heading.prop('tagName')?.toLowerCase()
      const level = tagName ? parseInt(tagName.charAt(1)) : 1
      const title = heading.text().trim()

      if (!title) continue

      // Ã¥Â°ÂÃ¨Â¯â€¢Ã¥Å“Â¨Ã¥â€¦Â¨Ã¦â€“â€¡Ã¤Â¸Â­Ã¥Â®Å¡Ã¤Â½ÂÃ¨Â¿â„¢Ã¤Â¸ÂªÃ¦Â â€¡Ã©Â¢Ëœ
      const startOffset = fullContent.indexOf(title)
      if (startOffset === -1) continue

      // Ã¨Â®Â¡Ã§Â®â€”Ã¥Ë†Â°Ã¤Â¸â€¹Ã¤Â¸â‚¬Ã¤Â¸ÂªÃ¥ÂÅ’Ã§ÂºÂ§Ã¦Ë†â€“Ã¦â€ºÂ´Ã©Â«ËœÃ§ÂºÂ§Ã¦Â â€¡Ã©Â¢ËœÃ§Å¡â€žÃ¥â€ â€¦Ã¥Â®Â¹
      let endOffset = fullContent.length
      for (let j = i + 1; j < headings.length; j++) {
        const nextHeading = $(headings[j])
        const nextTagName = nextHeading.prop('tagName')?.toLowerCase()
        const nextLevel = nextTagName ? parseInt(nextTagName.charAt(1)) : 1

        if (nextLevel <= level) {
          const nextTitle = nextHeading.text().trim()
          const nextStart = fullContent.indexOf(nextTitle, startOffset + title.length)
          if (nextStart !== -1) {
            endOffset = nextStart
            break
          }
        }
      }

      const sectionContent = fullContent.substring(startOffset, endOffset).trim()

      sections.push({
        level,
        title,
        content: sectionContent,
        startOffset,
        endOffset
      })
    }

    // Ã¦Å¾â€žÃ¥Â»ÂºÃ¥Â±â€šÃ§ÂºÂ§Ã¥â€¦Â³Ã§Â³Â»
    return this.buildHierarchy(sections)
  }

  /**
   * Ã¦Å¾â€žÃ¥Â»ÂºÃ§Â«Â Ã¨Å â€šÃ¥Â±â€šÃ§ÂºÂ§Ã¥â€¦Â³Ã§Â³Â»
   */
  private buildHierarchy(flatSections: SectionInfo[]): SectionInfo[] {
    const root: SectionInfo[] = []
    const stack: SectionInfo[] = []

    for (const section of flatSections) {
      // Ã¥Â¼Â¹Ã¥â€¡ÂºÃ¦Â¯â€Ã¥Â½â€œÃ¥â€°ÂÃ§Â«Â Ã¨Å â€šÃ§ÂºÂ§Ã¥Ë†Â«Ã©Â«ËœÃ§Å¡â€žÃ¨Å â€šÃ§â€šÂ¹
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop()
      }

      if (stack.length === 0) {
        // Ã©Â¡Â¶Ã§ÂºÂ§Ã§Â«Â Ã¨Å â€š
        root.push(section)
      } else {
        // Ã¥Â­ÂÃ§Â«Â Ã¨Å â€š
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
