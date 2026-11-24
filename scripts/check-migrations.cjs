#!/usr/bin/env node
/**
 * Ensure every migration in the journal has a matching drizzle snapshot.
 *
 * Usage:
 *   node scripts/check-migrations.cjs
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
const entries = journal.entries ?? []
const present = []
const missing = []

for (const entry of entries) {
  const snapshot = path.join(metaDir, `${String(entry.idx).padStart(4, '0')}_snapshot.json`)
  if (fs.existsSync(snapshot)) {
    present.push(entry)
  } else {
    missing.push(entry)
  }
}

if (missing.length > 0) {
  console.error('[migrations] missing snapshots:')
  for (const entry of missing) {
    console.error(
      `  - ${entry.tag} (expected ${String(entry.idx).padStart(4, '0')}_snapshot.json)`
    )
  }
  process.exit(1)
}

console.log(`[migrations] snapshots present for ${present.length}/${entries.length} journal entries`)
console.log('[migrations] every journal entry has a matching snapshot')
