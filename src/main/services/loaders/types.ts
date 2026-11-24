/**
 * DocumentLoader abstract interface and type definitions
 * Unified document loading and structure extraction
 */

/**
 * Page information (for paginated documents such as PDF and PPT)
 */
export interface PageInfo {
  pageNumber: number // Page number (1-based)
  content: string // Page text
  startOffset: number // Start position in the full text
  endOffset: number // End position in the full text
  metadata?: {
    width?: number
    height?: number
    hasImages?: boolean
    imageCount?: number
    [key: string]: unknown
  }
}

/**
 * Section information (for hierarchically structured documents such as Markdown and Word)
 */
export interface SectionInfo {
  level: number // Section level (1-6)
  title: string // Section title
  content: string // Section content (excluding subsections)
  startOffset: number // Start position
  endOffset: number // End position
  children?: SectionInfo[] // Subsections
}

/**
 * Document structure information
 */
export interface DocumentStructure {
  type: 'flat' | 'pages' | 'sections' // Structure type
  pages?: PageInfo[] // Paginated documents (PDF, PPT)
  sections?: SectionInfo[] // Sectioned documents (Markdown, Word)
}

/**
 * Document loading result (unified return format)
 */
export interface DocumentLoadResult {
  content: string // Full text content
  title?: string // Document title
  mimeType: string // MIME type
  structure?: DocumentStructure // Structure information (new)
  metadata?: Record<string, unknown> // Other metadata
}

/**
 * Loading options
 */
export interface LoadOptions {
  preserveStructure?: boolean // Whether to preserve structure information (default true)
  extractImages?: boolean // Whether to extract image information (default false, reserved)
  ocrEnabled?: boolean // Whether to enable OCR (default false, reserved)
  password?: string // PDF password (reserved)
}

/**
 * DocumentLoader abstract interface
 * All document loaders must implement this interface
 */
export interface IDocumentLoader {
  /**
   * Supported MIME types list
   */
  readonly supportedMimeTypes: string[]

  /**
   * Supported file extensions list
   */
  readonly supportedExtensions: string[]

  /**
   * Load from a file path
   */
  loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult>

  /**
   * Load from a Buffer
   */
  loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult>

  /**
   * Check whether the file is supported
   */
  canLoad(filePathOrMimeType: string): boolean
}
