import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { WebLoader } from '../../src/main/services/loaders/WebLoader'

describe('WebLoader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'michat-web-loader-'))

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads a local HTML file from disk', async () => {
    const file = join(dir, 'page.html')
    writeFileSync(
      file,
      [
        '<!doctype html>',
        '<html><head><title>QA page</title></head>',
        '<body><article><h1>Heading</h1><p>Body text for QA.</p></article></body></html>'
      ].join(''),
      'utf-8'
    )

    const result = await new WebLoader().loadFromPath(file)

    expect(result.content).toContain('Body text for QA.')
    expect(result.title).toBe('QA page')
  })
})
