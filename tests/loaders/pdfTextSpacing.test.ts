import { describe, expect, it, vi } from 'vitest'
import { PdfLoader } from '../../src/main/services/loaders/PdfLoader'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: () => ({
    destroy: async () => {},
    promise: Promise.resolve({
      numPages: 1,
      getMetadata: async () => ({ info: {} }),
      getPage: async () => ({
        getTextContent: async () => ({
          items: [
            { str: 'Ngh', hasEOL: false },
            { str: 'ị', hasEOL: false },
            { str: ' ', hasEOL: false },
            { str: 'quy', hasEOL: false },
            { str: 'ế', hasEOL: false },
            { str: 't 08-NQ/TW', hasEOL: true },
            { str: 'Bộ Chính tr', hasEOL: false },
            { str: 'ị', hasEOL: false }
          ]
        }),
        getViewport: () => ({ width: 100, height: 100 }),
        cleanup: () => {}
      }),
      cleanup: async () => {},
      destroy: async () => {}
    })
  })
}))

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({}))

describe('PdfLoader text spacing', () => {
  it('keeps PDF text fragments together and respects line breaks', async () => {
    const result = await new PdfLoader().loadFromBuffer(Buffer.from('pdf'))

    expect(result.content).toBe('Nghị quyết 08-NQ/TW\nBộ Chính trị')
    expect(result.structure?.pages?.[0].content).toBe(result.content)
  })
})
