#!/usr/bin/env node
'use strict'

/**
 * Smoke test for the built document parser worker bundle.
 *
 * Loads `out/main/parserWorker.js` the same way Electron's utility process
 * does (through `process.parentPort`), so a bundling mistake in the loaders —
 * the failure mode that only appears after packaging — fails here instead of in
 * the field.
 *
 * Usage: node scripts/smoke-parser-worker.cjs [--worker=path]
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const workerArg = process.argv.find((arg) => arg.startsWith('--worker='))
const workerPath = workerArg
  ? path.resolve(ROOT, workerArg.slice('--worker='.length))
  : path.join(ROOT, 'out', 'main', 'parserWorker.js')

/** Minimal single-page PDF with a correct xref table. */
function buildPdf(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

function fail(message) {
  console.error(`[parser-smoke] FAIL ${message}`)
  process.exit(1)
}

if (!fs.existsSync(workerPath)) {
  fail(`worker bundle not found at ${workerPath} (run the main build first)`)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'michat-parser-smoke-'))
const responses = []
let listener = null

process.parentPort = {
  on(event, callback) {
    if (event === 'message') listener = callback
  },
  postMessage(message) {
    responses.push(message)
  }
}

function send(filePath) {
  if (!listener) fail('worker did not subscribe to parentPort messages')
  const id = responses.length + 1
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const match = responses.find((response) => response && response.id === id)
      if (match) return resolve(match)
      if (Date.now() - started > 120_000) {
        return reject(new Error(`timed out parsing ${path.basename(filePath)}`))
      }
      setTimeout(tick, 100)
    }
    listener({ data: { id, filePath } })
    tick()
  })
}

async function main() {
  const markdownPath = path.join(scratch, 'smoke.md')
  fs.writeFileSync(markdownPath, '# Parser worker\n\nLocal-first parsing smoke content.', 'utf8')

  const pdfPath = path.join(scratch, 'smoke.pdf')
  fs.writeFileSync(pdfPath, buildPdf('Parser smoke PDF'))

  require(workerPath)

  const markdown = await send(markdownPath)
  if (!markdown.ok) fail(`markdown parse failed: ${markdown.error}`)
  if (!String(markdown.result.content).includes('Local-first parsing smoke content')) {
    fail('markdown result did not contain the fixture text')
  }
  if (markdown.result.structure?.sections?.[0]?.title !== 'Parser worker') {
    fail('markdown structure was not preserved through the worker boundary')
  }

  const pdf = await send(pdfPath)
  if (!pdf.ok) fail(`PDF parse failed: ${pdf.error}`)
  if (pdf.result.mimeType !== 'application/pdf') fail('PDF mime type was not preserved')
  if (!String(pdf.result.content).includes('Parser smoke PDF')) {
    fail(`PDF text was not extracted: ${JSON.stringify(pdf.result.content).slice(0, 200)}`)
  }

  const unsupportedPath = path.join(scratch, 'payload.exe')
  fs.writeFileSync(unsupportedPath, 'MZ')
  const rejected = await send(unsupportedPath)
  if (rejected.ok) fail('unsupported file type was accepted')
  if (!/unsupported file type/i.test(rejected.error)) {
    fail(`unexpected rejection reason: ${rejected.error}`)
  }

  console.log(
    `[parser-smoke] OK markdown=${markdown.result.content.length}B pdfPages=${pdf.result.metadata?.pageCount ?? '?'}`
  )
}

main()
  .then(() => {
    fs.rmSync(scratch, { recursive: true, force: true })
  })
  .catch((error) => {
    fs.rmSync(scratch, { recursive: true, force: true })
    fail(error && error.message ? error.message : String(error))
  })
