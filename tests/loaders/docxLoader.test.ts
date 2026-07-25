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
