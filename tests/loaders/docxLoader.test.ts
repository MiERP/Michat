import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DocxLoader,
  extractVietnameseLegalSections
} from '../../src/main/services/loaders/DocxLoader'

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

  it('detects Vietnamese legal headings when DOCX has no semantic heading tags', () => {
    const content = `CHƯƠNG I
QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
Luật này quy định phạm vi thử nghiệm.
Điều 2. Đối tượng áp dụng
Doanh nghiệp và cơ quan nhà nước.`

    const sections = extractVietnameseLegalSections(content)

    expect(sections[0]).toMatchObject({ level: 1, title: 'CHƯƠNG I' })
    expect(sections[0].children?.map((section) => section.title)).toEqual([
      'Điều 1. Phạm vi điều chỉnh',
      'Điều 2. Đối tượng áp dụng'
    ])
  })
})
