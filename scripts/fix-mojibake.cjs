#!/usr/bin/env node
/**
 * One-off repair for UTF-8 text that was decoded through Windows-1252.
 * It only rewrites a line when repeated cp1252-byte -> utf8 decoding removes
 * every known mojibake marker; otherwise the line is left for manual review.
 */
const fs = require('fs')

const FILES = [
  'src/main/providers/base/AISDKProvider.ts',
  'src/main/db/index.ts',
  'src/main/ipc/chatHandlers.ts',
  'src/main/services/loaders/DocxLoader.ts',
  'tests/rag/knowledgeService.test.ts'
]

const CP1252_SPECIAL = '\\u0080-\\u00BF\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2020\\u2021\\u2030\\u2039\\u203A\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC'
const MOJIBAKE = [
  new RegExp(`Ã[${CP1252_SPECIAL}\\u00C0-\\u00FF]`),
  new RegExp(`Â[${CP1252_SPECIAL}]`),
  /â€/,
  /ð[^\s]/,
  /[æåäç][€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/,
  /[èé][€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/,
  /\uFFFD/,
  /Ä‘/
]

const CP1252 = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86],
  ['‡', 0x87], ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c],
  ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95],
  ['–', 0x96], ['—', 0x97], ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b],
  ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f]
])

function hasMojibake(text) {
  return MOJIBAKE.some((pattern) => pattern.test(text))
}

function toCp1252Bytes(text) {
  const bytes = []
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code <= 0xff) {
      bytes.push(code)
    } else if (CP1252.has(char)) {
      bytes.push(CP1252.get(char))
    } else {
      return null
    }
  }
  return Buffer.from(bytes)
}

function repairLine(line) {
  if (!hasMojibake(line)) return line

  let current = line
  for (let attempt = 0; attempt < 6; attempt++) {
    const bytes = toCp1252Bytes(current)
    if (!bytes) return line
    const next = bytes.toString('utf8')
    if (next.includes('\uFFFD')) return line
    if (next === current) break
    current = next
    if (!hasMojibake(current)) return current
  }
  return hasMojibake(current) ? line : current
}

let changed = 0
for (const file of FILES) {
  if (!fs.existsSync(file)) continue
  const original = fs.readFileSync(file, 'utf8')
  const lines = original.split(/\r?\n/)
  const repaired = lines.map((line) => {
    const next = repairLine(line)
    if (next !== line) changed++
    return next
  })
  const output = repaired.join('\n')
  if (output !== original) {
    fs.writeFileSync(file, output, 'utf8')
    console.log(`[fix-mojibake] rewrote ${file}`)
  }
}

console.log(`[fix-mojibake] ${changed} line(s) repaired`)
