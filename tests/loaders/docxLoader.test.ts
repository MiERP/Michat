import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocxLoader } from '../../src/main/services/loaders/DocxLoader'

const extract = vi.fn().mockResolvedValue({
  getBody: () => 'Noi dung tai lieu Word cu'
})

vi.mock('word-extractor', () => ({
  default: class {
    extract = extract
  }
}))

describe('DocxLoader', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = ''
    extract.mockClear()
  })

  it('extracts text from DOCX files with structure enabled', async () => {
    const filePath = join(
      process.cwd(),
      'node_modules',
      'mammoth',
      'test',
      'test-data',
      'tables.docx'
    )

    const result = await new DocxLoader().loadFromPath(filePath)

    expect(result.content).toContain('Top left')
    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('extracts text from legacy .doc files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'michat-doc-loader-'))
    const filePath = join(tempDir, 'legacy.doc')
    await writeFile(filePath, 'legacy document fixture')

    const result = await new DocxLoader().loadFromPath(filePath)

    expect(result.content).toBe('Noi dung tai lieu Word cu')
    expect(result.mimeType).toBe('application/msword')
    expect(result.metadata).toMatchObject({ parser: 'word-extractor' })
    expect(extract).toHaveBeenCalledWith(filePath)
  })
})
