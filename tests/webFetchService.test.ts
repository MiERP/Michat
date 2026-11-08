import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebFetchService } from '../src/main/services/WebFetchService'

describe('WebFetchService security', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a redirect from a public URL to a private address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(new WebFetchService().fetchUrl('https://1.1.1.1/page')).rejects.toThrow(
      /private network address/i
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
