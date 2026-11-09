#!/usr/bin/env node
/**
 * Ensure every recent migration has a drizzle snapshot. Older snapshots are
 * intentionally absent in this repository (0012-0019 were generated
 * incrementally); the latest snapshot still anchors future generate runs.
 */
const fs = require('fs')
const path = require('path')

const migrationsDir = path.join(process.cwd(), 'src/main/db/migrations')
const metaDir = path.join(migrationsDir, 'meta')
const journalPath = path.join(metaDir, '_journal.json')

if (!fs.existsSync(journalPath)) {
  console.error('[migrations] meta/_journal.json is missing')
  process.exit(1)
}

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
const requiredFrom = 20
const missing = []

for (const entry of journal.entries ?? []) {
  if (entry.idx < requiredFrom) continue
  const snapshot = path.join(metaDir, `${String(entry.idx).padStart(4, '0')}_snapshot.json`)
  if (!fs.existsSync(snapshot)) {
    missing.push(`${entry.tag} (expected ${path.basename(snapshot)})`)
  }
}

if (missing.length > 0) {
  console.error('[migrations] missing snapshots:')
  for (const item of missing) console.error(`  - ${item}`)
  process.exit(1)
}

console.log(`[migrations] snapshots present for ${journal.entries.length} journal entries`)
