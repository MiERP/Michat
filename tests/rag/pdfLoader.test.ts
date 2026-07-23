import { describe, expect, it } from 'vitest'
import {
  assessPdfTextQuality,
  joinPdfTextItems,
  orderPdfTextItems
} from '../../src/main/services/loaders/PdfLoader'

describe('PdfLoader', () => {
  it('preserves explicit PDF line breaks used by legal headings', () => {
    const text = joinPdfTextItems([
      { str: 'CHƯƠNG I', hasEOL: true, transform: [1, 0, 0, 1, 0, 700] },
      { str: 'QUY ĐỊNH CHUNG', hasEOL: true, transform: [1, 0, 0, 1, 0, 680] },
      { str: 'Điều 1. Phạm vi điều chỉnh', hasEOL: false, transform: [1, 0, 0, 1, 0, 660] }
    ])

    expect(text).toBe('CHƯƠNG I\nQUY ĐỊNH CHUNG\nĐiều 1. Phạm vi điều chỉnh')
  })

  it('reads a two-column legal page down the left column before the right column', () => {
    const result = orderPdfTextItems(
      [
        { str: 'LUẬT THỬ NGHIỆM', transform: [1, 0, 0, 1, 160, 780], width: 220 },
        { str: 'Điều 1. Phạm vi', transform: [1, 0, 0, 1, 30, 700], width: 150 },
        { str: '1. Quy định bên trái', transform: [1, 0, 0, 1, 30, 670], width: 170 },
        { str: 'Điều 2. Đối tượng', transform: [1, 0, 0, 1, 320, 700], width: 160 },
        { str: '1. Quy định bên phải', transform: [1, 0, 0, 1, 320, 670], width: 180 }
      ],
      540
    )

    expect(result.layout).toBe('two-column')
    expect(result.text).toBe(
      'LUẬT THỬ NGHIỆM\nĐiều 1. Phạm vi\n1. Quy định bên trái\nĐiều 2. Đối tượng\n1. Quy định bên phải'
    )
  })

  it('requests OCR only for pages with unusable extracted text', () => {
    expect(assessPdfTextQuality('').needsOcr).toBe(true)
    expect(assessPdfTextQuality('��� 123').needsOcr).toBe(true)
    expect(
      assessPdfTextQuality(
        'Điều 15. Doanh nghiệp phải lưu trữ hồ sơ và cung cấp cho cơ quan có thẩm quyền.'
      ).needsOcr
    ).toBe(false)
  })
})
