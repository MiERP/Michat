import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const wordExtractorMock = vi.hoisted(() => ({
  extract: vi.fn()
}))

const officeParserMock = vi.hoisted(() => ({
  parseOffice: vi.fn()
}))

vi.mock('word-extractor', () => ({
  default: class WordExtractor {
    extract(source: string | Buffer): Promise<{ getBody(): string }> {
      return wordExtractorMock.extract(source)
    }
  }
}))

vi.mock('officeparser', () => ({
  OfficeParser: {
    parseOffice: officeParserMock.parseOffice
  }
}))

import { DocxLoader } from '../../src/main/services/loaders/DocxLoader'

const temporaryDirectories: string[] = []

afterEach(async () => {
  wordExtractorMock.extract.mockReset()
  officeParserMock.parseOffice.mockReset()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('DocxLoader DOCX support', () => {
  it('extracts .docx text with OfficeParser', async () => {
    const content = 'DOCX document content'
    officeParserMock.parseOffice.mockResolvedValue({
      toText: () => `  ${content}  `,
      warnings: []
    })
    const buffer = Buffer.from('docx-placeholder')

    const result = await new DocxLoader().loadFromBuffer(buffer, { preserveStructure: false })

    expect(officeParserMock.parseOffice).toHaveBeenCalledWith(buffer)
    expect(result).toEqual({
      content,
      title: undefined,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      structure: undefined,
      metadata: {
        warnings: [],
        characterCount: content.length,
        wordCount: 3
      }
    })
  })

  it('preserves Word table rows and columns as canonical GFM markdown', async () => {
    officeParserMock.parseOffice.mockResolvedValue({
      to: async () => ({
        value:
          '<html><body><h1>Báo cáo</h1><table><tr><th>Mã</th><th>Nội dung</th></tr><tr><td>A-01</td><td>Dữ liệu quan trọng</td></tr></table></body></html>'
      }),
      toText: () => 'Báo cáo Mã Nội dung A-01 Dữ liệu quan trọng',
      warnings: []
    })

    const result = await new DocxLoader().loadFromBuffer(Buffer.from('docx-table'))

    expect(result.content).toContain('| Mã | Nội dung |')
    expect(result.content).toContain('| --- | --- |')
    expect(result.content).toContain('| A-01 | Dữ liệu quan trọng |')
  })

  it('keeps a rectangular grid when a Word table uses merged cells', async () => {
    officeParserMock.parseOffice.mockResolvedValue({
      to: async () => ({
        value:
          '<body><table><tr><th colspan="2">Phạm vi</th><th>Ghi chú</th></tr><tr><td rowspan="2">A</td><td>Điều 1</td><td>Áp dụng</td></tr><tr><td>Điều 2</td><td>Tiếp tục</td></tr></table></body>'
      }),
      toText: () => 'Phạm vi Ghi chú A Điều 1 Áp dụng Điều 2 Tiếp tục',
      warnings: []
    })

    const result = await new DocxLoader().loadFromBuffer(Buffer.from('docx-merged-table'))

    expect(result.content).toContain('| Phạm vi |  | Ghi chú |')
    expect(result.content).toContain('| A | Điều 1 | Áp dụng |')
    expect(result.content).toContain('| A | Điều 2 | Tiếp tục |')
  })
})

describe('DocxLoader legacy DOC support', () => {
  it('extracts legacy .doc text with word-extractor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'michat-doc-loader-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'legal-document.doc')
    await writeFile(filePath, Buffer.from('legacy-doc-placeholder'))
    wordExtractorMock.extract.mockResolvedValue({
      getBody: () => '  Nội dung văn bản pháp luật  '
    })

    const result = await new DocxLoader().loadFromPath(filePath)

    expect(wordExtractorMock.extract).toHaveBeenCalledWith(filePath)
    expect(result).toEqual({
      content: 'Nội dung văn bản pháp luật',
      mimeType: 'application/msword',
      structure: undefined,
      metadata: {
        characterCount: 26,
        wordCount: 6,
        parser: 'word-extractor'
      }
    })
  })
})
