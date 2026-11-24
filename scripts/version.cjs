#!/usr/bin/env node
/**
 * Single source of truth for the application version.
 *
 * Usage:
 *   node scripts/version.cjs show
 *   node scripts/version.cjs bump patch|minor|major [--note "text"]
 *   node scripts/version.cjs set <x.y.z> [--note "text"]
 *   node scripts/version.cjs check
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PACKAGE_PATH = path.join(ROOT, 'package.json')
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md')
const BUILDER_PATH = path.join(ROOT, 'electron-builder.yml')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function readPackage() {
  return JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'))
}

function writePackage(pkg) {
  fs.writeFileSync(PACKAGE_PATH, `${JSON.stringify(pkg, null, 4)}\n`, 'utf8')
}

function noteFromArgs(args) {
  const index = args.indexOf('--note')
  return index >= 0 ? args[index + 1] || '' : ''
}

function bumpVersion(current, release) {
  const [major, minor, patch] = current.split('.').map(Number)
  if (release === 'major') return `${major + 1}.0.0`
  if (release === 'minor') return `${major}.${minor + 1}.0`
  if (release === 'patch') return `${major}.${minor}.${patch + 1}`
  return null
}

function ensureChangelogHeader(text) {
  if (text.trim().length > 0) return text
  return `# Changelog\n\nAll notable changes to MiChat are documented in this file.\n`
}

function addChangelogEntry(version, note) {
  const date = new Date().toISOString().slice(0, 10)
  const heading = `## [${version}] - ${date}`
  let text = fs.existsSync(CHANGELOG_PATH)
    ? fs.readFileSync(CHANGELOG_PATH, 'utf8')
    : ''
  text = ensureChangelogHeader(text)
  if (text.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md already contains ${version}`)
  }

  const entry = `${heading}\n\n### Changed\n\n- ${note || 'Release update.'}\n`
  const firstSection = text.search(/^## \[/m)
  const next = firstSection >= 0
    ? `${text.slice(0, firstSection)}${entry}\n${text.slice(firstSection)}`
    : `${text.trimEnd()}\n\n${entry}`
  fs.writeFileSync(CHANGELOG_PATH, next, 'utf8')
}

function currentVersion() {
  return String(readPackage().version || '')
}

function check() {
  const pkg = readPackage()
  const version = String(pkg.version || '')
  const problems = []

  if (!SEMVER.test(version)) problems.push(`package.json version is not semver: ${version}`)

  if (!fs.existsSync(CHANGELOG_PATH)) {
    problems.push('CHANGELOG.md is missing')
  } else {
    const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8')
    if (!changelog.includes(`## [${version}]`)) {
      problems.push(`CHANGELOG.md has no entry for ${version}`)
    }
  }

  const builder = fs.readFileSync(BUILDER_PATH, 'utf8')
  if (!builder.includes('${version}')) {
    problems.push('electron-builder.yml artifact names must use ${version}')
  }

  if (problems.length > 0) {
    console.error('[version] consistency check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('[version] run: pnpm version:bump <patch|minor|major> --note "..."')
    process.exit(1)
  }

  console.log(`[version] ${version} is consistent (package.json, CHANGELOG.md, electron-builder)`)
  console.log(`[version] installer: dist/michat-${version}-setup.exe`)
}

function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'show' || !command) {
    console.log(currentVersion())
    return
  }

  if (command === 'check') {
    check()
    return
  }

  if (command === 'bump') {
    const release = args[1]
    const current = currentVersion()
    if (!SEMVER.test(current)) throw new Error(`Current version is invalid: ${current}`)
    const next = bumpVersion(current, release)
    if (!next) throw new Error('Release must be patch, minor, or major')
    const pkg = readPackage()
    pkg.version = next
    writePackage(pkg)
    addChangelogEntry(next, noteFromArgs(args))
    console.log(`[version] ${current} -> ${next}`)
    return
  }

  if (command === 'set') {
    const next = String(args[1] || '').replace(/^v/, '')
    if (!SEMVER.test(next)) throw new Error(`Invalid version: ${args[1]}`)
    const pkg = readPackage()
    pkg.version = next
    writePackage(pkg)
    addChangelogEntry(next, noteFromArgs(args))
    console.log(`[version] set to ${next}`)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

try {
  main()
} catch (error) {
  console.error(`[version] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
