#!/usr/bin/env node
/**
 * Fail when CJK characters remain in tracked text files.
 *
 * Chinese comments/strings are not part of this project's supported surface;
 * keeping them makes the codebase harder to maintain and review.
 *
 * Usage:
 *   node scripts/check-cjk.cjs                 # scan the whole repository
 *   node scripts/check-cjk.cjs src/main        # scan specific paths
 */
const fs = require('fs')
const path = require('path')

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF01-\uFF60]/
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.ps1',
  '.txt',
  '.plist',
  '.sql'
])
const SKIP_DIRS = new Set([
  'node_modules',
  'out',
  'dist',
  'coverage',
  '.git',
  '.commandcode',
  '.freebuff'
])

function walk(target, files = []) {
  const stats = fs.statSync(target)
  if (stats.isFile()) {
    if (TEXT_EXTENSIONS.has(path.extname(target))) files.push(target)
    return files
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    walk(path.join(target, entry.name), files)
  }
  return files
}

const args = process.argv.slice(2)
const targets = args.length > 0 ? args : ['.']
const files = targets.flatMap((target) => walk(target))
const offenders = []

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (CJK.test(line)) {
      offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`)
    }
  })
}

if (offenders.length > 0) {
  console.error(`[cjk] found ${offenders.length} line(s) containing CJK characters:`)
  for (const offender of offenders) console.error(offender)
  console.error('[cjk] replace Chinese comments/strings with English before committing.')
  process.exit(1)
}

console.log(`[cjk] clean (${files.length} text files scanned)`)
