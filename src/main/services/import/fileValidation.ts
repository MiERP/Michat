import { lstat, open } from 'fs/promises'
import { extname } from 'path'

export const MAX_IMPORT_BYTES = 100 * 1024 * 1024

export const ALLOWED_IMPORT_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'doc',
  'pptx',
  'xlsx',
  'txt',
  'md',
  'markdown',
  'html',
  'htm'
])

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html'
}

export interface ImportableFileInfo {
  path: string
  extension: string
  size: number
  mimeType: string
}

export async function validateImportableFile(
  filePath: string,
  options: { maxBytes?: number } = {}
): Promise<ImportableFileInfo> {
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES
  const stats = await lstat(filePath)

  if (stats.isSymbolicLink()) {
    throw new Error('Symbolic links are not supported for document import')
  }
  if (!stats.isFile()) {
    throw new Error('Document import requires a regular file')
  }
  if (stats.size > maxBytes) {
    throw new Error(`File is too large (${stats.size} bytes; maximum is ${maxBytes} bytes)`)
  }

  const extension = extname(filePath).toLowerCase().slice(1)
  if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type: ${extension || '(none)'}`)
  }

  const handle = await open(filePath, 'r')
  const header = Buffer.alloc(8)
  try {
    await handle.read(header, 0, header.length, 0)
  } finally {
    await handle.close()
  }

  if (extension === 'pdf' && header.toString('latin1', 0, 5) !== '%PDF-') {
    throw new Error('File content does not match the .pdf extension')
  }
  if (
    ['docx', 'pptx', 'xlsx'].includes(extension) &&
    !(header[0] === 0x50 && header[1] === 0x4b)
  ) {
    throw new Error(`File content does not match the .${extension} extension`)
  }
  if (extension === 'doc') {
    const ole = header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0
    const rtf = header.toString('latin1', 0, 5) === '{\\rtf'
    if (!ole && !rtf) {
      throw new Error('File content does not match the .doc extension')
    }
  }

  return {
    path: filePath,
    extension,
    size: stats.size,
    mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  }
}
