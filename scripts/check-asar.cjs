#!/usr/bin/env node
/**
 * Verify that a packaged app.asar contains only runtime files. Run after
 * `electron-builder --dir` in release verification.
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

const forbidden = files.filter((file) => {
  const normalized = file.replace(/\\/g, '/')
  return (
    /^\/(tests|docs|coverage|scripts)(\/|$)/.test(normalized) ||
    /^\/(\.env|\$null|.*\.tsbuildinfo)/.test(normalized) ||
    /\.map$/.test(normalized)
  )
})

if (forbidden.length > 0) {
  console.error('[asar] forbidden files found:')
  for (const file of forbidden) console.error(`  - ${file}`)
  process.exit(1)
}

console.log(`[asar] ${files.length} entries; no source/test/docs/coverage files found`)
