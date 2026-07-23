import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/config', () => ({
  settingsManager: {}
}))

import { LlamaService, shouldSkipLlamaWarmup } from '../../src/main/services/LlamaService'

type TestableLlamaService = {
  isServerUp(kind: 'chat' | 'embedding'): Promise<boolean>
  warmUpServer(kind: 'chat' | 'embedding'): Promise<void>
}

describe('LlamaService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bounds server health checks with an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const service = new LlamaService() as unknown as TestableLlamaService
    await service.isServerUp('chat')

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/v1/models', {
      method: 'GET',
      signal: expect.any(AbortSignal)
    })
  })

  it('warms both local models by default with explicit opt-out', () => {
    expect(shouldSkipLlamaWarmup('chat', {})).toBe(false)
    expect(shouldSkipLlamaWarmup('embedding', {})).toBe(false)
    expect(shouldSkipLlamaWarmup('chat', { KN_LLAMA_SKIP_CHAT_WARMUP: '1' })).toBe(true)
    expect(shouldSkipLlamaWarmup('embedding', { KN_LLAMA_SKIP_EMBED_WARMUP: '1' })).toBe(true)
  })

  it('warms chat completion and embedding endpoints', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'local-model' }] }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new LlamaService() as unknown as TestableLlamaService

    await service.warmUpServer('chat')
    await service.warmUpServer('embedding')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1/chat/completions',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('local-model') })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/v1/embeddings',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('local-model') })
    )
  })
})
