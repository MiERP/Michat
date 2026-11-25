import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { appendSwitch } = vi.hoisted(() => ({ appendSwitch: vi.fn() }))

vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'michat-compat-test-default'),
    commandLine: { appendSwitch }
  }
}))

import {
  applyCompatMode,
  buildRelaunchArgs,
  clearCompatMode,
  compatMarkerPath,
  isCompatModeRequested,
  requestCompatMode,
  shouldAttemptCompatFallback,
  shouldReportRendererExit
} from '../src/main/compatMode'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'michat-compat-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  appendSwitch.mockClear()
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('compatibility mode marker', () => {
  it('writes and clears the no-sandbox marker', async () => {
    const dir = await tempDir()

    expect(compatMarkerPath(dir)).toBe(join(dir, 'compat-no-sandbox'))
    expect(isCompatModeRequested(dir)).toBe(false)
    expect(requestCompatMode(dir)).toBe(true)
    expect(isCompatModeRequested(dir)).toBe(true)
    expect(clearCompatMode(dir)).toBe(true)
    expect(isCompatModeRequested(dir)).toBe(false)
  })

  it('adds the Chromium switch only when the marker exists', async () => {
    const dir = await tempDir()

    expect(applyCompatMode(dir)).toBe(false)
    expect(appendSwitch).not.toHaveBeenCalled()

    requestCompatMode(dir)
    expect(applyCompatMode(dir)).toBe(true)
    expect(appendSwitch).toHaveBeenCalledWith('no-sandbox')
  })

  it('allows exactly one pre-paint fallback and never for a second launch', () => {
    const base = {
      windowShown: false,
      alreadyCompat: false,
      noSandboxSwitch: false
    }

    expect(shouldAttemptCompatFallback({ ...base, reason: 'crashed' })).toBe(true)
    expect(shouldAttemptCompatFallback({ ...base, reason: 'launch-failed' })).toBe(true)
    expect(shouldAttemptCompatFallback({ ...base, reason: 'killed' })).toBe(true)
    expect(shouldAttemptCompatFallback({ ...base, reason: 'abnormal-exit' })).toBe(true)
    expect(shouldAttemptCompatFallback({ ...base, reason: 'integrity-failure' })).toBe(false)
    expect(shouldAttemptCompatFallback({ ...base, reason: 'crashed', alreadyCompat: true })).toBe(
      false
    )
    expect(shouldAttemptCompatFallback({ ...base, reason: 'crashed', noSandboxSwitch: true })).toBe(
      false
    )
    expect(shouldAttemptCompatFallback({ ...base, reason: 'crashed', windowShown: true })).toBe(
      false
    )
  })

  it('reports non-clean exits and strips every sandbox override from relaunch args', () => {
    expect(shouldReportRendererExit('clean-exit')).toBe(false)
    expect(shouldReportRendererExit('killed')).toBe(true)

    expect(
      buildRelaunchArgs([
        'michat.exe',
        '--remote-debugging-port=9250',
        '--no-sandbox',
        '--no-sandbox=true',
        '--foo'
      ])
    ).toEqual(['--remote-debugging-port=9250', '--foo'])
  })
})
