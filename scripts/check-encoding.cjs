#!/usr/bin/env node
/**
 * Detect UTF-8 mojibake left behind by a wrong code page. This is a source
 * hygiene gate, not a runtime check: corrupted comments and test strings hide
 * intent and can silently change assertions.
 */
const fs = require('fs')
const path = require('path')

const ROOTS = ['src', 'tests']
const EXTENSIONS = new Set(['.ts', '.tsx'])
const CP1252_SPECIAL = '\\u0080-\\u00BF\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2020\\u2021\\u2030\\u2039\\u203A\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC'
const PATTERNS = [
  new RegExp(`Ã[${CP1252_SPECIAL}\\u00C0-\\u00FF]`),
  new RegExp(`Â[${CP1252_SPECIAL}]`),
  /â€/,
  /ð[^\s]/,
  /[æåäç][€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/,
  /[èé][€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/,
  /\uFFFD/,
  /Ä‘/
]

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'coverage') continue
      walk(fullPath, files)
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

const offenders = []

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (PATTERNS.some((pattern) => pattern.test(line))) {
        offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`)
      }
    })
  }
}

if (offenders.length > 0) {
  console.error(`[encoding] found ${offenders.length} mojibake line(s):`)
  for (const offender of offenders) console.error(offender)
  console.error('[encoding] fix the source text; do not add an allowlist entry.')
  process.exit(1)
}

console.log('[encoding] no mojibake sequences found')
