import { describe, expect, it } from 'vitest'

describe('PdfLoader main-process compatibility', () => {
  it('does not load pdfjs-dist during startup import', async () => {
    const originalDomMatrix = globalThis.DOMMatrix

    try {
      Reflect.deleteProperty(globalThis, 'DOMMatrix')

      const { PdfLoader } = await import('../src/main/services/loaders/PdfLoader')
      const loader = new PdfLoader()

      expect(loader.canLoad('sample.pdf')).toBe(true)
      expect(globalThis.DOMMatrix).toBeUndefined()
    } finally {
      if (originalDomMatrix) {
        globalThis.DOMMatrix = originalDomMatrix
      } else {
        Reflect.deleteProperty(globalThis, 'DOMMatrix')
      }
    }
  })

  it('installs DOMMatrix before parsing loads pdfjs-dist', async () => {
    const originalDomMatrix = globalThis.DOMMatrix

    try {
      Reflect.deleteProperty(globalThis, 'DOMMatrix')

      const { PdfLoader } = await import('../src/main/services/loaders/PdfLoader')
      const loader = new PdfLoader()

      await expect(loader.loadFromBuffer(Buffer.from('not a pdf'))).rejects.toThrow('Failed to parse PDF')
      expect(globalThis.DOMMatrix).toBeTypeOf('function')
    } finally {
      if (originalDomMatrix) {
        globalThis.DOMMatrix = originalDomMatrix
      } else {
        Reflect.deleteProperty(globalThis, 'DOMMatrix')
      }
    }
  })
})
