// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizePastedHtml } from '../../src/renderer/src/lib/sanitizePastedHtml'

describe('sanitizePastedHtml', () => {
  it('removes inline event handlers from pasted HTML', () => {
    const output = sanitizePastedHtml('<img src="x" onerror="alert(1)"><p onclick="alert(2)">x</p>')

    expect(output).not.toContain('onerror')
    expect(output).not.toContain('onclick')
  })

  it('removes javascript: URLs but keeps the link text', () => {
    const output = sanitizePastedHtml('<a href="javascript:alert(1)">click</a>')

    expect(output).not.toContain('javascript:')
    expect(output).toContain('click')
  })

  it('drops script, style, iframe, object and embed elements', () => {
    const output = sanitizePastedHtml(
      '<script>alert(1)</script><style>body{}</style><iframe src="https://x"></iframe><object></object><embed>'
    )

    expect(output).not.toMatch(/<(script|style|iframe|object|embed)/i)
  })

  it('keeps safe formatting and table markup', () => {
    const output = sanitizePastedHtml(
      '<strong>bold</strong><table><tbody><tr><td>cell</td></tr></tbody></table>'
    )

    expect(output).toContain('<strong>bold</strong>')
    expect(output).toContain('<table>')
    expect(output).toContain('<td>cell</td>')
  })
})
