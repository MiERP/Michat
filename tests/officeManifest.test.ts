import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const manifests = [
  'src/office-addin/word/manifest.xml',
  'src/office-addin/excel/manifest.xml'
]

describe('Office add-in manifests', () => {
  it('includes the icon asset in the canonical source tree', () => {
    expect(existsSync(join(process.cwd(), 'src/office-addin/office/assets/logo.png'))).toBe(true)
  })

  it('uses the renderer logo for the Office ribbon icon source', () => {
    const officeIcon = readFileSync(join(process.cwd(), 'src/office-addin/office/assets/logo.png'))
    const rendererLogo = readFileSync(join(process.cwd(), 'src/renderer/src/assets/logo.png'))

    expect(officeIcon.equals(rendererLogo)).toBe(true)
  })

  it('keeps Office add-in resources generated from src only', () => {
    const builderConfig = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')

    expect(builderConfig).toContain('from: src/office-addin')
    expect(builderConfig).toContain('to: office-addin')
    expect(existsSync(join(process.cwd(), 'src/office-addin/word-manifest.xml'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'src/office-addin/excel-manifest.xml'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'resources/office-addin'))).toBe(false)
  })

  it('point to an existing secure localhost icon asset', () => {
    for (const manifest of manifests) {
      const content = readFileSync(join(process.cwd(), manifest), 'utf8')

      expect(content).toContain('https://localhost:18327/office/assets/logo.png')
      expect(content).not.toContain('icon-32.png')
      expect(content).not.toContain('icon-80.png')
    }
  })
  it('bumps manifest versions so Office refreshes cached ribbon icons', () => {
    for (const manifest of manifests) {
      const content = readFileSync(join(process.cwd(), manifest), 'utf8')

      expect(content).toMatch(/<Version>1\.0\.[4-9]\.0<\/Version>/)
    }
  })

  it('use valid GUID manifest IDs', () => {
    const guidPattern = /<Id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}<\/Id>/i

    for (const manifest of manifests) {
      const content = readFileSync(join(process.cwd(), manifest), 'utf8')

      expect(content).toMatch(guidPattern)
    }
  })
  it('expose the Excel ribbon button on the Home tab', () => {
    const content = readFileSync(join(process.cwd(), 'src/office-addin/excel/manifest.xml'), 'utf8')

    expect(content).toContain('<Host xsi:type="Workbook">')
    expect(content).toContain('<ExtensionPoint xsi:type="PrimaryCommandSurface">')
    expect(content).toContain('<OfficeTab id="TabHome">')
    expect(content).toContain('<bt:String id="CommandsGroup.Label" DefaultValue="MiChat"/>')
    expect(content).toContain('<bt:String id="TaskpaneButton.Label" DefaultValue="Open MiChat"/>')
    expect(content).toContain('<FunctionFile resid="Commands.Url"/>')
    expect(content).toContain('<bt:Url id="Commands.Url" DefaultValue="https://localhost:18327/excel/taskpane.html"/>')
    expect(content).toContain('<Action xsi:type="ShowTaskpane">')
    expect(content).toContain('<SourceLocation resid="Taskpane.Url"/>')
    expect(content).toContain('https://localhost:18327/excel/taskpane.html')
  })

  it('expose the Word ribbon button on the Home tab', () => {
    const content = readFileSync(join(process.cwd(), 'src/office-addin/word/manifest.xml'), 'utf8')

    expect(content).toContain('<ExtensionPoint xsi:type="PrimaryCommandSurface">')
    expect(content).toContain('<OfficeTab id="TabHome">')
    expect(content).toContain('<bt:String id="CommandsGroup.Label" DefaultValue="MiChat"/>')
    expect(content).toContain('<bt:String id="TaskpaneButton.Label" DefaultValue="Open MiChat"/>')
    expect(content).toContain('<Action xsi:type="ShowTaskpane">')
    expect(content).toContain('<SourceLocation resid="Taskpane.Url"/>')
    expect(content).toContain('https://localhost:18327/word/taskpane.html')
  })

  it('keeps Word and Excel on separate taskpane entrypoints', () => {
    expect(existsSync(join(process.cwd(), 'src/office-addin/word/taskpane.html'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'src/office-addin/excel/taskpane.html'))).toBe(true)

    for (const manifest of ['src/office-addin/word/manifest.xml']) {
      const content = readFileSync(join(process.cwd(), manifest), 'utf8')
      expect(content).toContain('https://localhost:18327/word/taskpane.html')
      expect(content).not.toContain('https://localhost:18327/shared/taskpane.html')
    }

    for (const manifest of ['src/office-addin/excel/manifest.xml']) {
      const content = readFileSync(join(process.cwd(), manifest), 'utf8')
      expect(content).toContain('https://localhost:18327/excel/taskpane.html')
      expect(content).not.toContain('https://localhost:18327/shared/taskpane.html')
    }
  })
})
