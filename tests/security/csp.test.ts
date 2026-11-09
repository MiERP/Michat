import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from '../../src/main/security/csp'

describe('content security policy', () => {
  it('keeps production connections and scripts restricted to self', () => {
    const csp = buildContentSecurityPolicy({ isDev: false })

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).not.toContain('localhost')
    expect(csp).not.toContain('openai')
    expect(csp).not.toContain('anthropic')
    expect(csp).not.toContain('googleapis')
    expect(csp).not.toContain('fonts.google')
  })

  it('adds only the Vite dev origins in development', () => {
    const csp = buildContentSecurityPolicy({ isDev: true })

    expect(csp).toContain("connect-src 'self' http://localhost:* ws://localhost:*")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('openai')
  })
})
