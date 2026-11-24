import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../src/main/ai/apiClient'
import type { ApiConfigManager } from '../src/main/ai/apiConfigManager'

function managerWith(overrides: Record<string, unknown> = {}): ApiConfigManager {
  return {
    getConfig: async () => ({
      baseUrl: 'http://127.0.0.1:1234/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      contextWindow: 8192,
      ...overrides
    }),
    getContextWindowSync: () => 8192
  } as unknown as ApiConfigManager
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiClient connection test', () => {
  it('reports available models from /models', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [{ id: 'chat-model' }, { id: 'embed-model' }] })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(managerWith())
    const result = await client.testConnection()

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['chat-model', 'embed-model'])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns a failure for HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }))
    )

    const result = await new ApiClient(managerWith()).testConnection()

    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
  })

  it('rejects non-loopback endpoints', async () => {
    const result = await new ApiClient(
      managerWith({ baseUrl: 'https://example.com/v1' })
    ).testConnection()

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/loopback|localhost|127/i)
  })

  it('does not return chat/embedding clients when models are missing', async () => {
    const client = new ApiClient(managerWith({ chatModel: '', embeddingModel: '' }))
    expect(await client.getChatProvider()).toBeNull()
    expect(await client.getEmbeddingProvider()).toBeNull()
  })
})
