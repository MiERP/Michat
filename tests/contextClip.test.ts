import { describe, expect, it } from 'vitest'
import {
  clipSectionAroundPrimary,
  isPrimaryVisible,
  normalizeForMatch
} from '../src/main/utils/contextClip'

describe('contextClip', () => {
  it('normalizes spaces before newlines the same way the prompt sanitizer does', () => {
    expect(normalizeForMatch('alpha \nbeta\r\ngamma  ')).toBe('alpha beta gamma')
  })

  it('keeps a primary clause that survives sanitization', () => {
    expect(isPrimaryVisible('alpha \nbeta', 'beta')).toBe(true)
    expect(isPrimaryVisible('x\ny', 'x \ny')).toBe(true)
    expect(isPrimaryVisible('alpha', 'beta')).toBe(false)
    expect(isPrimaryVisible('anything', undefined)).toBe(true)
  })

  it('clips around the primary clause and keeps document order', () => {
    const before = `${'B'.repeat(400)} \nend`
    const primary = 'PRIMARY \nTEXT'
    const after = 'A'.repeat(400)
    const content = [before, primary, after].join('\n...\n')

    const clipped = clipSectionAroundPrimary(content, primary, 60)

    expect(normalizeForMatch(clipped)).toContain('PRIMARY TEXT')
    expect(normalizeForMatch(clipped)).not.toContain('BBBB')
  })

  it('keeps all parts in source order when the budget allows it', () => {
    const content = ['first', 'PRIMARY \nTEXT', 'last'].join('\n...\n')
    const clipped = clipSectionAroundPrimary(content, 'PRIMARY \nTEXT', 1000)

    expect(clipped).toBe(content)
  })

  it('finds the primary when content is sanitized but the matched text is raw', () => {
    const content = ['before', 'x\ny', 'after'].join('\n...\n')

    expect(clipSectionAroundPrimary(content, 'x \ny', 1000)).toBe(content)
  })

  it('keeps a relevant window near the end of a long contiguous article', () => {
    const primary = 'Thời hạn giải quyết hồ sơ là bảy ngày làm việc kể từ ngày nhận đủ hồ sơ.'
    const content = `${'F'.repeat(20_000)}\n\n${primary}\n\n${'G'.repeat(20_000)}`

    const clipped = clipSectionAroundPrimary(content, primary, 300)

    expect(normalizeForMatch(clipped)).toContain('bảy ngày làm việc')
    expect(clipped.length).toBeLessThan(content.length)
  })

  it('keeps the primary visible when it is longer than the token budget', () => {
    const primary = `Thời hạn giải quyết hồ sơ là bảy ngày làm việc. ${'Nội dung bổ sung. '.repeat(30)}`
    const content = `${'F'.repeat(5000)}\n${primary}\n${'G'.repeat(5000)}`

    const clipped = clipSectionAroundPrimary(content, primary, 50)

    expect(isPrimaryVisible(clipped, primary)).toBe(true)
  })

  it('finds a raw primary window inside sanitized long content', () => {
    const primary = 'Thời hạn giải quyết hồ sơ là bảy ngày làm việc.'
    const sanitized = `${'F'.repeat(20_000)}\n${primary}\n${'G'.repeat(20_000)}`
    const rawPrimary = `Thời hạn giải quyết hồ sơ là bảy ngày làm việc.   \n\n\n`

    const clipped = clipSectionAroundPrimary(sanitized, rawPrimary, 300)

    expect(normalizeForMatch(clipped)).toContain('bảy ngày làm việc')
    expect(isPrimaryVisible(clipped, rawPrimary)).toBe(true)
  })
})
