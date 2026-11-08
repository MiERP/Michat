import { describe, expect, it } from 'vitest'
import { canonicalizeSlides, PptLoader } from '../../src/main/services/loaders/PptLoader'

describe('PptLoader', () => {
  it('claims .pptx and .ppt but rejects .docx', () => {
    const loader = new PptLoader()
    expect(loader.canLoad('deck.pptx')).toBe(true)
    expect(loader.canLoad('deck.ppt')).toBe(true)
    expect(loader.canLoad('report.docx')).toBe(false)
  })

  it('gives an actionable error for legacy .ppt instead of a parser crash', async () => {
    const loader = new PptLoader()
    await expect(loader.loadFromPath('/tmp/legacy.ppt')).rejects.toThrow(/Save the file as \.pptx/i)
  })

  it('turns each slide into a canonical section with a stable slide page location', () => {
    const result = canonicalizeSlides([
      { slideNumber: 1, text: 'Kế hoạch\nMục tiêu quý 1' },
      { slideNumber: 2, text: 'Rủi ro\nKiểm soát chất lượng' }
    ])

    expect(result.content).toContain('# Slide 1: Kế hoạch')
    expect(result.content).toContain('# Slide 2: Rủi ro')
    expect(result.pages).toEqual([
      expect.objectContaining({
        pageNumber: 1,
        content: expect.stringContaining('Mục tiêu quý 1')
      }),
      expect.objectContaining({
        pageNumber: 2,
        content: expect.stringContaining('Kiểm soát chất lượng')
      })
    ])
    expect(result.pages[0].endOffset).toBeLessThanOrEqual(result.pages[1].startOffset)
  })
})
