/**
 * FileParserService
 * File parsing service that handles all document formats uniformly with the Loader pattern
 */

import { extname } from 'path'
import Logger from '../../shared/utils/logger'
import { PdfLoader } from './loaders/PdfLoader'
import { MarkdownLoader } from './loaders/MarkdownLoader'
import { DocxLoader } from './loaders/DocxLoader'
import { PptLoader } from './loaders/PptLoader'
import { ExcelLoader } from './loaders/ExcelLoader'
import { WebLoader } from './loaders/WebLoader'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions } from './loaders/types'

/**
 * Supported file types
 */
export type SupportedFileType =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'pptx'
  | 'ppt'
  | 'xlsx'
  | 'txt'
  | 'md'
  | 'markdown'
  | 'text'

/**
 * File parsing service
 * Supports PDF, Word, PowerPoint, Markdown, and plain text
 */
export class FileParserService {
  private loaders: Map<string, IDocumentLoader>
  private allLoaders: IDocumentLoader[]

  constructor() {
    // Initialize all loaders
    this.allLoaders = [
      new PdfLoader(),
      new MarkdownLoader(),
      new DocxLoader(),
      new PptLoader(),
      new ExcelLoader(),
      new WebLoader()
    ]

    // Register loaders by extension and MIME type
    this.loaders = new Map()
    for (const loader of this.allLoaders) {
      // Register extensions
      for (const ext of loader.supportedExtensions) {
        this.loaders.set(ext.toLowerCase(), loader)
      }
      // Register MIME types
      for (const mime of loader.supportedMimeTypes) {
        this.loaders.set(mime, loader)
      }
    }

    Logger.info('FileParserService', `Registered ${this.allLoaders.length} document loaders`)
  }

  /**
   * Detect the format from the file path and parse it
   */
  async parseFile(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const ext = extname(filePath).toLowerCase().slice(1)
    const loader = this.getLoaderByExtension(ext)

    if (!loader) {
      throw new Error(`Unsupported file type: ${ext}`)
    }

    Logger.info('FileParserService', `Parsing file with ${loader.constructor.name}`)
    return await loader.loadFromPath(filePath, options)
  }

  /**
   * Parse a Buffer by file type
   */
  async parseBuffer(
    buffer: Buffer,
    fileType: SupportedFileType,
    options?: LoadOptions
  ): Promise<DocumentLoadResult> {
    const loader = this.getLoaderByExtension(fileType)

    if (!loader) {
      throw new Error(`Unsupported file type: ${fileType}`)
    }

    Logger.info('FileParserService', `Parsing buffer with ${loader.constructor.name}`)
    return await loader.loadFromBuffer(buffer, options)
  }

  /**
   * Parse plain text/Markdown
   */
  parseText(content: string, mimeType: string = 'text/plain'): DocumentLoadResult {
    return {
      content: content.trim(),
      mimeType,
      metadata: {
        lineCount: content.split('\n').length,
        characterCount: content.length
      }
    }
  }

  /**
   * Check whether the file type is supported
   */
  isSupported(fileType: string): boolean {
    return this.loaders.has(fileType.toLowerCase())
  }

  /**
   * Get the file type from the MIME type
   */
  getFileTypeFromMime(mimeType: string): SupportedFileType | null {
    const mimeMap: Record<string, SupportedFileType> = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'text/plain': 'txt',
      'text/markdown': 'md'
    }
    return mimeMap[mimeType] || null
  }

  /**
   * Get the MIME type
   */
  getMimeType(fileType: string): string {
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt: 'application/vnd.ms-powerpoint',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain',
      text: 'text/plain',
      md: 'text/markdown',
      markdown: 'text/markdown'
    }
    return mimeMap[fileType.toLowerCase()] || 'application/octet-stream'
  }

  /**
   * Get a loader by extension
   */
  private getLoaderByExtension(ext: string): IDocumentLoader | undefined {
    // Handle the plain-text special case
    if (ext === 'txt' || ext === 'text') {
      return this.loaders.get('md') // Use MarkdownLoader for plain text
    }
    return this.loaders.get(ext.toLowerCase())
  }
}

// Export types (kept for backward compatibility)
export type { DocumentLoadResult as ParseResult, LoadOptions }
