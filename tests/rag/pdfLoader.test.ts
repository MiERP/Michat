import { describe, expect, it } from 'vitest'
import { joinPdfTextItems } from '../../src/main/services/loaders/PdfLoader'

describe('PdfLoader', () => {
  it('preserves explicit PDF line breaks used by legal headings', () => {
    const text = joinPdfTextItems([
      { str: 'CHƯƠNG I', hasEOL: true, transform: [1, 0, 0, 1, 0, 700] },
      { str: 'QUY ĐỊNH CHUNG', hasEOL: true, transform: [1, 0, 0, 1, 0, 680] },
      { str: 'Điều 1. Phạm vi điều chỉnh', hasEOL: false, transform: [1, 0, 0, 1, 0, 660] }
    ])

    expect(text).toBe('CHƯƠNG I\nQUY ĐỊNH CHUNG\nĐiều 1. Phạm vi điều chỉnh')
  })
})
