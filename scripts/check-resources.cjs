#!/usr/bin/env node
'use strict'

/**
 * Fail-fast check for runtime assets that are intentionally gitignored:
 *   resources/models/*.gguf
 *   resources/llama-bin/llama-server[.exe]
 *
 * Usage:
 *   node scripts/check-resources.cjs                 # strict, current platform
 *   node scripts/check-resources.cjs --warn          # report only, exit 0
 *   node scripts/check-resources.cjs --platform=mac-arm64,linux-x64
 *   node scripts/check-resources.cjs --root=./resources
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const warnOnly = argv.includes('--warn')
const wantsHelp = argv.includes('--help') || argv.includes('-h')
const platformArg = argv.find((arg) => arg.startsWith('--platform='))
const rootArg = argv.find((arg) => arg.startsWith('--root='))

const resourcesRoot = rootArg
  ? path.resolve(ROOT, rootArg.slice('--root='.length))
  : path.join(ROOT, 'resources')

const EMBEDDING_NAME = /(bge|embed|embedding|e5)/i

function hostPlatformKeys() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  const os =
    process.platform === 'win32'
      ? 'win'
      : process.platform === 'darwin'
        ? 'mac'
        : process.platform === 'linux'
          ? 'linux'
          : null
  if (!arch || !os) return null
  return [`${os}-${arch}`]
}

function targetKeys() {
  if (platformArg) {
    return platformArg
      .slice('--platform='.length)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  return hostPlatformKeys()
}

function listModels(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.gguf'))
      .map((name) => path.join(dir, name))
      .filter((filePath) => {
        try {
          return fs.statSync(filePath).size > 0
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

function binaryName(base, platformKey) {
  return platformKey.startsWith('win') ? `${base}.exe` : base
}

function printHelp() {
  console.log(`Usage: node scripts/check-resources.cjs [options]

Options:
  --warn                  Report missing assets but exit 0 (used by dev)
  --platform=<keys>       Comma-separated platform keys, e.g. win-x64,mac-arm64
  --root=<dir>            Resources directory (default: <repo>/resources)
  -h, --help              Show this help
`)
}

function main() {
  if (wantsHelp) {
    printHelp()
    return 0
  }

  const keys = targetKeys()
  if (!keys || keys.length === 0) {
    console.error(`[resources] Unsupported platform: ${process.platform}-${process.arch}`)
    return 1
  }

  const checks = []
  const modelsDir = path.join(resourcesRoot, 'models')
  const models = listModels(modelsDir)
  const embeddingModels = models.filter((filePath) => EMBEDDING_NAME.test(path.basename(filePath)))
  const chatModels = models.filter((filePath) => !EMBEDDING_NAME.test(path.basename(filePath)))

  checks.push({
    label: 'models/chat',
    ok: chatModels.length > 0,
    detail: chatModels[0] || `no chat .gguf in ${modelsDir}`
  })
  checks.push({
    label: 'models/embedding',
    ok: embeddingModels.length > 0,
    detail: embeddingModels[0] || `no bge/e5/embed .gguf in ${modelsDir}`
  })

  const backend = process.env.KN_LLAMA_BACKEND || 'llama-bin'
  for (const key of keys) {
    const serverBin = path.join(resourcesRoot, backend, binaryName('llama-server', key))
    checks.push({
      label: `llama-server ${key}`,
      ok: fs.existsSync(serverBin),
      detail: serverBin
    })
  }

  const failed = checks.filter((check) => !check.ok)

  console.log(`[resources] root: ${resourcesRoot}`)
  for (const check of checks) {
    console.log(`  ${check.ok ? 'OK  ' : 'FAIL'} ${check.label.padEnd(26)} ${check.detail}`)
  }

  if (failed.length === 0) {
    console.log('[resources] OK')
    return 0
  }

  console.error('')
  console.error(
    `[resources] ${failed.length} required asset(s) missing for: ${keys.join(', ')}`
  )
  console.error('[resources] These paths are gitignored, so a fresh clone has none of them.')
  console.error('[resources] See resources/README.md, or override with KN_LLAMA_SERVER_BIN.')

  if (warnOnly) {
    console.warn('[resources] --warn: continuing anyway')
    return 0
  }
  return 1
}

process.exit(main())
