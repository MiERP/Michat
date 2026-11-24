#!/usr/bin/env node
/**
 * Fail the build when a dependency known to have a security advisory is
 * installed below its patched floor. This complements `pnpm audit`, which
 * can miss advisories that were published after the lockfile was created.
 */
const fs = require('fs')
const path = require('path')

const FLOORS = {
  'prosemirror-view': '1.42.3',
  '@xmldom/xmldom': '0.9.12',
  'markdown-it': '14.3.3',
  'pdfjs-dist': '6.2.108',
  electron: '42.11.16',
  zod: '4.6.6',
  undici: '7.30.1',
  'fast-uri': '3.1.9',
  'js-yaml': '4.3.1',
  'builder-util-runtime': '9.7.0',
  nanoid: '3.3.18',
  // GHSA-866g-f22w-33x8: uncontrolled resource consumption in provider responses.
  '@ai-sdk/provider-utils': '3.0.28',
  // GHSA-238p-pmpm-9mq7: prototype pollution bypassing KaTeX trust restrictions.
  katex: '0.18.2',
  // GHSA-6jcc-5g8w-32mx: deepExtend recurses into inherited built-ins.
  i18next: '26.3.4'
}

function parseVersion(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * pnpm keeps virtual-store directories for removed versions until the store is
 * pruned, so directory names alone over-report. When pnpm's installed lockfile
 * is available it is the authoritative list of versions that are still linked.
 */
const LOCKFILE = path.join(process.cwd(), 'node_modules', '.pnpm', 'lock.yaml')

function readInstalledLockfile() {
  try {
    return fs.readFileSync(LOCKFILE, 'utf8')
  } catch {
    return null
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isStillInstalled(lockfile, packageName, version) {
  if (!lockfile) return true
  const pattern = new RegExp(
    `(^|[\\s'"])${escapeRegExp(packageName)}@${escapeRegExp(version)}(?=$|[\\s'"(:])`,
    'm'
  )
  return pattern.test(lockfile)
}

function installedVersions(packageName) {
  const root = path.join(process.cwd(), 'node_modules', '.pnpm')
  if (!fs.existsSync(root)) return []
  const lockfile = readInstalledLockfile()

  const prefix = packageName.startsWith('@')
    ? `${packageName.replace('/', '+')}@`
    : `${packageName}@`

  return fs
    .readdirSync(root)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length).split('_')[0])
    .filter((version) => parseVersion(version))
    .filter((version) => isStillInstalled(lockfile, packageName, version))
}

let failed = false

for (const [name, floor] of Object.entries(FLOORS)) {
  const versions = installedVersions(name)
  if (versions.length === 0) {
    console.error(`[dependency-floor] ${name} is not installed (expected >= ${floor})`)
    failed = true
    continue
  }

  const floorVersion = parseVersion(floor)
  for (const version of versions) {
    if (compare(parseVersion(version), floorVersion) < 0) {
      console.error(`[dependency-floor] ${name}@${version} is below the patched floor ${floor}`)
      failed = true
    }
  }
}

if (failed) {
  process.exit(1)
}

console.log('[dependency-floor] all audited dependencies meet their patched floors')
