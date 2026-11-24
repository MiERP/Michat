import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { validateImportableFile } from '../../src/main/services/import/fileValidation'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'michat-import-'))
})

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function write(name: string, content: Buffer | string): Promise<string> {
  const filePath = join(directory, name)
  await writeFile(filePath, content)
  return filePath
}

describe('validateImportableFile', () => {
  it('accepts a DOCX file with the ZIP magic bytes', async () => {
    const filePath = await write('doc.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))

    const info = await validateImportableFile(filePath)

    expect(info.extension).toBe('docx')
    expect(info.mimeType).toContain('wordprocessingml')
  })

  it('accepts a PDF file with the PDF magic bytes', async () => {
    const filePath = await write('doc.pdf', '%PDF-1.7\n')
    const info = await validateImportableFile(filePath)
    expect(info.mimeType).toBe('application/pdf')
  })

  it('rejects content that does not match the extension', async () => {
    const filePath = await write('fake.docx', 'not a zip file')
    await expect(validateImportableFile(filePath)).rejects.toThrow(/does not match/i)
  })

  it('rejects unsupported extensions', async () => {
    const filePath = await write('payload.exe', 'MZ')
    await expect(validateImportableFile(filePath)).rejects.toThrow(/unsupported file type/i)
  })

  it('rejects files above the configured size limit', async () => {
    const filePath = await write('large.txt', 'x'.repeat(2048))
    await expect(validateImportableFile(filePath, { maxBytes: 1024 })).rejects.toThrow(/too large/i)
  })

  it('rejects a disguised PDF imported as DOCX when magic bytes are absent', async () => {
    const filePath = await write('disguised.docx', '%PDF-1.7\n')
    await expect(validateImportableFile(filePath)).rejects.toThrow(/does not match/i)
  })
})
