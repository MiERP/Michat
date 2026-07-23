import { describe, expect, it } from 'vitest'
import { redactSensitiveText } from '../../src/main/security/piiRedaction'

describe('redactSensitiveText', () => {
  it('removes common Vietnamese PII and local source paths', () => {
    const result = redactSensitiveText(
      'Email a@b.vn, SĐT 0912345678, CCCD 012345678901, file C:\\Users\\Lan\\luat.pdf'
    )
    expect(result).not.toContain('a@b.vn')
    expect(result).not.toContain('0912345678')
    expect(result).not.toContain('012345678901')
    expect(result).not.toContain('C:\\Users\\Lan')
  })
})
