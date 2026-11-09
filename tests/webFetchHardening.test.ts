import { describe, expect, it } from 'vitest'
import { readBodyWithLimit } from '../src/main/services/WebFetchService'

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    }
  })
}

describe('readBodyWithLimit', () => {
  it('reads a body below the limit', async () => {
    const text = await readBodyWithLimit({ body: streamOf('hello') }, 32)
    expect(text).toBe('hello')
  })

  it('rejects a body above the limit', async () => {
    await expect(readBodyWithLimit({ body: streamOf('x'.repeat(64)) }, 32)).rejects.toThrow(
      /maximum size/i
    )
  })

  it('returns an empty string for an empty body', async () => {
    const text = await readBodyWithLimit({ body: null }, 32)
    expect(text).toBe('')
  })
})
