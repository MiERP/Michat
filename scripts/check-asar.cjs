#!/usr/bin/env node
/**
 * Verify that a packaged app.asar contains only runtime files and that the
 * entries the app needs at runtime (main bundle + isolated parser worker) are
 * present. Run after `electron-builder --dir` in release verification.
 */
const asar = require('@electron/asar')

const archivePath = process.argv[2]
if (!archivePath) {
  console.error('Usage: node scripts/check-asar.cjs <path-to-app.asar>')
  process.exit(1)
}

let files
try {
  files = asar.listPackage(archivePath, { isPack: false })
} catch {
  files = asar.listPackage(archivePath)
}

const normalized = files.map((file) => file.replace(/\\/g, '/'))

const forbidden = normalized.filter(
  (file) =>
    /^\/(tests|docs|coverage|scripts|src|build)(\/|$)/.test(file) ||
    /^\/(\.env|\$null|.*\.tsbuildinfo)/.test(file) ||
    /\.map$/.test(file)
)

if (forbidden.length > 0) {
  console.error('[asar] forbidden files found:')
  for (const file of forbidden) console.error(`  - ${file}`)
  process.exit(1)
}

const required = ['/out/main/index.js', '/out/main/parserWorker.js', '/package.json']
const missing = required.filter((entry) => !normalized.includes(entry))

if (missing.length > 0) {
  console.error('[asar] required runtime entries are missing:')
  for (const entry of missing) console.error(`  - ${entry}`)
  process.exit(1)
}

console.log(
  `[asar] ${files.length} entries; runtime entries present, no source/test/docs/coverage files found`
)
