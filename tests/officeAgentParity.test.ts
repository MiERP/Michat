import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const moduleRoot = path.join(process.cwd(), 'modules', 'office-agents-word')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8')
}

describe('Office Agents source parity', () => {
  it('keeps the complete upstream monorepo', () => {
    for (const relativePath of [
      'packages/sdk/package.json',
      'packages/core/package.json',
      'packages/bridge/package.json',
      'packages/excel/package.json',
      'packages/powerpoint/package.json',
      'packages/word/package.json'
    ]) {
      expect(fs.existsSync(path.join(moduleRoot, relativePath))).toBe(true)
    }
  })

  it('keeps the original Word runtime, UI, and Office.js tools', () => {
    expect(read('packages/word/src/taskpane/components/app.svelte')).toContain('<ChatInterface')
    expect(read('packages/sdk/src/runtime.ts')).toContain('new Agent({')
    expect(read('packages/core/src/chat/chat-interface.svelte')).toContain('settings-panel')

    const tools = read('packages/word/src/lib/tools/index.ts')
    for (const tool of [
      'createReadTool',
      'createBashTool',
      'getDocumentTextTool',
      'getDocumentStructureTool',
      'createGetOoxmlTool',
      'screenshotDocumentTool',
      'createExecuteOfficeJsTool'
    ]) {
      expect(tools).toContain(tool)
    }
  })

  it('keeps upstream HTTPS hosting and only proxies the local provider', () => {
    const viteConfig = read('packages/word/vite.config.ts')
    const manifest = read('packages/word/manifest.xml')

    expect(viteConfig).toContain('getHttpsServerOptions')
    expect(viteConfig).toContain('port: 3002')
    expect(viteConfig).toContain('target: "http://127.0.0.1:18327"')
    expect(manifest).toContain('https://localhost:3002/')
    expect(manifest).not.toContain('18327')
  })

  it('forces MiChat local LLM without cloud provider controls', () => {
    const providerConfig = read('packages/sdk/src/provider-config.ts')
    const settingsPanel = read('packages/core/src/chat/settings-panel.svelte')

    expect(providerConfig).toContain('MICHAT_LOCAL_PROVIDER')
    expect(providerConfig).toContain('window.location.origin')
    expect(settingsPanel).toContain('MiChat local model')
    expect(settingsPanel).not.toContain('Select provider...')
    expect(settingsPanel).not.toContain('OAuth')
  })
  it('starts the upstream Word sideload with MiChat dev', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    )
    const devScript = fs.readFileSync(path.join(process.cwd(), 'scripts', 'dev.cjs'), 'utf8')

    expect(packageJson.scripts.dev).toBe('node scripts/dev.cjs')
    expect(devScript).toContain("run('office:start')")
    expect(devScript).toContain("run('dev:electron')")
    expect(devScript).toContain("['run', 'office:stop']")
  })
})
