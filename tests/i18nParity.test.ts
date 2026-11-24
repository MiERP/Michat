import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const localesDir = join(process.cwd(), 'src', 'renderer', 'src', 'locales')

type LocaleTree = Record<string, unknown>

function flatten(tree: LocaleTree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value as LocaleTree, path))
    } else {
      result[path] = String(value)
    }
  }
  return result
}

function loadNamespace(language: string, namespace: string): Record<string, string> {
  const file = join(localesDir, language, `${namespace}.json`)
  return flatten(JSON.parse(readFileSync(file, 'utf8')) as LocaleTree)
}

const namespaces = readdirSync(join(localesDir, 'en-US'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))

describe('locale parity', () => {
  it.each(namespaces)('%s has the same keys in en-US and vi-VN', (namespace) => {
    const en = loadNamespace('en-US', namespace)
    const vi = loadNamespace('vi-VN', namespace)

    const missing = Object.keys(en).filter((key) => !(key in vi))
    const extra = Object.keys(vi).filter((key) => !(key in en))

    expect(missing, `missing vi-VN keys in ${namespace}`).toEqual([])
    expect(extra, `extra vi-VN keys in ${namespace}`).toEqual([])
  })

  it.each(namespaces)(
    '%s has no empty translations in vi-VN where en-US is filled',
    (namespace) => {
      const en = loadNamespace('en-US', namespace)
      const vi = loadNamespace('vi-VN', namespace)
      const empty = Object.entries(vi)
        .filter(([key, value]) => value.trim() === '' && (en[key] ?? '').trim() !== '')
        .map(([key]) => key)

      expect(empty, `empty vi-VN values in ${namespace}`).toEqual([])
    }
  )
})
