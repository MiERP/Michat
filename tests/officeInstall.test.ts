import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyOfficeManifests,
  resolveOfficeManifestPath
} from '../src/main/ipc/officeManifestInstaller'

let tempDir: string | null = null

describe('Office manifest installer helpers', () => {
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  it('prefers packaged host manifest folders and copies canonical install names', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'michat-office-'))
    const sourceDir = join(tempDir, 'source')
    const installDir = join(tempDir, 'install')
    mkdirSync(join(sourceDir, 'word'), { recursive: true })
    mkdirSync(join(sourceDir, 'excel'), { recursive: true })
    writeFileSync(join(sourceDir, 'word', 'manifest.xml'), '<OfficeApp><Id>word</Id></OfficeApp>')
    writeFileSync(join(sourceDir, 'excel', 'manifest.xml'), '<OfficeApp><Id>excel</Id></OfficeApp>')

    const installed = copyOfficeManifests(sourceDir, installDir)

    expect(installed.map((item) => item.host)).toEqual(['word', 'excel'])
    expect(readFileSync(join(installDir, 'word-manifest.xml'), 'utf8')).toContain('<Id>word</Id>')
    expect(readFileSync(join(installDir, 'excel-manifest.xml'), 'utf8')).toContain('<Id>excel</Id>')
  })

  it('starts the Office bridge in HTTPS mode before installing manifests', () => {
    const handlers = readFileSync(join(process.cwd(), 'src/main/ipc/officeHandlers.ts'), 'utf8')

    expect(handlers).toContain('await bridgeService.start(18327, { secure: true })')
    expect(handlers).toContain('if (!bridgeService.running)')
  })


  it('refuses to install manifests when HTTPS is unavailable', () => {
    const handlers = readFileSync(join(process.cwd(), 'src/main/ipc/officeHandlers.ts'), 'utf8')

    expect(handlers).toContain("if (!bridgeService.address.startsWith('https://'))")
    expect(handlers).toContain('Office add-ins require the local bridge to run over trusted HTTPS')
  })

  it('does not clear Office ribbon cache while Word or Excel is running', () => {
    const handlers = readFileSync(join(process.cwd(), 'src/main/ipc/officeHandlers.ts'), 'utf8')
    const runningCheckIndex = handlers.indexOf('const officeHostRunning = isOfficeHostRunning()')
    const clearIndex = handlers.indexOf('clearOfficeAddinCache(addinIds)')

    expect(runningCheckIndex).toBeGreaterThan(-1)
    expect(clearIndex).toBeGreaterThan(runningCheckIndex)
    expect(handlers).toContain('if (officeHostRunning)')
    expect(handlers).toContain('} else {\n        clearOfficeAddinCache(addinIds)')
  })

  it('registers the install directory as a trusted shared folder catalog on Windows', () => {
    const handlers = readFileSync(join(process.cwd(), 'src/main/ipc/officeHandlers.ts'), 'utf8')

    expect(handlers).toContain('registerTrustedOfficeCatalog(installRoot)')
    expect(handlers).toContain('HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\TrustedCatalogs')
    expect(handlers).toContain('toOfficeCatalogUncPath')
    expect(handlers).toContain('catalogPath: trustedCatalogPath')
  })

  it('requires host-scoped manifest folders', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'michat-office-'))
    const sourceDir = join(tempDir, 'source')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'word-manifest.xml'), '<OfficeApp><Id>word</Id></OfficeApp>')

    expect(() => resolveOfficeManifestPath(sourceDir, 'word')).toThrow(
      `Missing word Office manifest in ${sourceDir}`
    )
  })
})
