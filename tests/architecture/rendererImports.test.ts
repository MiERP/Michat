import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOTS = ['src/renderer/src', 'src/preload']
const EXTENSIONS = new Set(['.ts', '.tsx'])

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (EXTENSIONS.has(fullPath.slice(fullPath.lastIndexOf('.')))) {
      files.push(fullPath)
    }
  }
  return files
}

function runtimeMainImports(source: string): string[] {
  const imports: string[] = []
  let pending = ''

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (pending) {
      pending += ` ${trimmed}`
      const match = pending.match(/from\s+['"]([^'"]+)['"]/)
      if (match) {
        if (match[1].includes('/main/')) imports.push(match[1])
        pending = ''
      }
      continue
    }

    if (trimmed.startsWith('import type ') || !trimmed.startsWith('import ')) continue

    if (trimmed.includes(' from ')) {
      const match = trimmed.match(/from\s+['"]([^'"]+)['"]/)
      if (match && match[1].includes('/main/')) imports.push(match[1])
    } else {
      pending = trimmed
    }
  }

  return imports
}

describe('renderer/main boundary', () => {
  it('does not runtime-import main-process modules from renderer or preload', () => {
    const offenders: string[] = []

    for (const root of ROOTS) {
      for (const file of walk(join(process.cwd(), root))) {
        const source = readFileSync(file, 'utf8')
        for (const specifier of runtimeMainImports(source)) {
          offenders.push(`${file}: ${specifier}`)
        }
        if (/import\(\s*['"][^'"]*\/main\//.test(source)) {
          offenders.push(`${file}: dynamic main import`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
