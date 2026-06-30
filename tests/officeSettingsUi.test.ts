import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('Office settings UI', () => {
  it('explains packaged Office add-in installation requirements', () => {
    const content = readFileSync(join(process.cwd(), 'src/renderer/src/components/settings/OfficeIntegrationSettings.tsx'), 'utf8')

    expect(content).toContain('local HTTPS bridge')
    expect(content).toContain('Registered trusted Office add-in catalog')
    expect(content).toContain('Keep MiChat running')
    expect(content).toContain('close and reopen Word/Excel')
    expect(content).toContain('Insert > Add-ins > My Add-ins')
  })
})
