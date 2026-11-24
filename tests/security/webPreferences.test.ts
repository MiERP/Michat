import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getSecureWebPreferences } from '../../src/main/security/appHardening'

describe('Electron hardening', () => {
  it('returns explicit secure webPreferences', () => {
    const prefs = getSecureWebPreferences('/tmp/preload.js')

    expect(prefs).toMatchObject({
      preload: '/tmp/preload.js',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    })
  })

  it('does not contain a preload fallback that assigns Node APIs to window', () => {
    const source = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf8')

    expect(source).not.toContain('window.electron =')
    expect(source).not.toContain("exposeInMainWorld('electron'")
  })
})
