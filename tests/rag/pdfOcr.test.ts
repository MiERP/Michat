import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { runLocalPdfOcr } from '../../src/main/services/loaders/PdfLoader'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  delete process.env.KN_OCR_PDF_COMMAND
  delete process.env.KN_OCR_PDF_ARGS
})

describe('local PDF OCR hook', () => {
  it('runs configured local OCR command with input placeholder', async () => {
    dir = join(tmpdir(), 'michat-ocr-' + Date.now())
    await mkdir(dir, { recursive: true })
    const pdfPath = join(dir, 'scan.pdf')
    const scriptPath = join(dir, 'ocr.js')
    await writeFile(pdfPath, 'fake pdf')
    await writeFile(scriptPath, "const path = require('path'); console.log('OCR text for ' + path.basename(process.argv[2]))")
    process.env.KN_OCR_PDF_COMMAND = process.execPath
    process.env.KN_OCR_PDF_ARGS = scriptPath + ' {input}'

    await expect(runLocalPdfOcr(pdfPath)).resolves.toBe('OCR text for scan.pdf')
  })
})
