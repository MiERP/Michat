import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { resolveLlamaAutoRoot } from '../../src/main/services/llama/resourceRoot'

const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'

function validator(existing: string[]): (candidate: string) => boolean {
  const all = new Set(existing.map((entry) => join(entry)))
  return (candidate) => all.has(join(candidate))
}

function root(
  dir: string,
  overrides: Partial<Parameters<typeof resolveLlamaAutoRoot>[0]> = {}
): string {
  return resolveLlamaAutoRoot({
    env: {},
    cwd: join(dir, 'cwd'),
    dirname: join(dir, 'out', 'main'),
    resourcesPath: join(dir, 'packaged', 'resources'),
    isPackaged: false,
    exeName,
    exists: validator([]),
    ...overrides
  })
}

describe('resolveLlamaAutoRoot', () => {
  it('uses explicit environment overrides first', () => {
    const dir = join('/', 'tmp', 'michat-env')
    const envRoot = join(dir, 'env-root')
    const cwdRoot = join(dir, 'cwd', 'resources')
    const result = root(dir, {
      env: { KN_LLAMA_AUTO_ROOT: envRoot },
      exists: validator([join(envRoot, 'models'), join(envRoot, 'llama-bin', exeName), cwdRoot])
    })

    expect(result).toBe(envRoot)
  })

  it('prefers the packaged resources directory and ignores cwd', () => {
    const dir = join('/', 'tmp', 'michat-packaged')
    const packaged = join(dir, 'packaged', 'resources')
    const cwdRoot = join(dir, 'cwd', 'resources')
    const result = root(dir, {
      isPackaged: true,
      exists: validator([
        packaged,
        join(packaged, 'models'),
        join(packaged, 'llama-bin', exeName),
        join(cwdRoot, 'models'),
        join(cwdRoot, 'llama-bin', exeName)
      ])
    })

    expect(result).toBe(packaged)
  })

  it('never falls back to cwd in packaged builds', () => {
    const dir = join('/', 'tmp', 'michat-packaged-cwd')
    const cwdRoot = join(dir, 'cwd', 'resources')
    const result = root(dir, {
      isPackaged: true,
      exists: validator([join(cwdRoot, 'models'), join(cwdRoot, 'llama-bin', exeName)])
    })

    expect(result).toBe('')
  })

  it('keeps cwd-first resolution in development', () => {
    const dir = join('/', 'tmp', 'michat-dev')
    const cwdRoot = join(dir, 'cwd', 'resources')
    const packaged = join(dir, 'packaged', 'resources')
    const result = root(dir, {
      exists: validator([
        cwdRoot,
        join(cwdRoot, 'models'),
        join(cwdRoot, 'llama-bin', exeName),
        packaged,
        join(packaged, 'models'),
        join(packaged, 'llama-bin', exeName)
      ])
    })

    expect(result).toBe(cwdRoot)
  })

  it('requires both a models directory and the server binary', () => {
    const dir = join('/', 'tmp', 'michat-incomplete')
    const cwdRoot = join(dir, 'cwd', 'resources')
    const result = root(dir, {
      exists: validator([join(cwdRoot, 'models')])
    })

    expect(result).toBe('')
  })

  it('falls back to the bundle-relative resources directory', () => {
    const dir = join('/', 'tmp', 'michat-build-root')
    const dirname = join(dir, 'out', 'main')
    const buildRoot = join(dirname, '..', '..', 'resources')
    const result = root(dir, {
      dirname,
      exists: validator([join(buildRoot, 'models'), join(buildRoot, 'llama-bin', exeName)])
    })

    expect(result).toBe(buildRoot)
  })
})
