import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chat image upload UI removal', () => {
  it('does not render a file input in the chat panel', () => {
    const source = readFileSync(resolve('src/renderer/src/components/notebook/ProcessPanel.tsx'), 'utf8')

    expect(source).not.toContain('type="file"')
    expect(source).not.toContain('accept="image/png,image/jpeg,image/webp,image/gif"')
  })
})
