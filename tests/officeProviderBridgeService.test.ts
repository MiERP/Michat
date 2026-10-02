import { afterEach, describe, expect, it } from 'vitest'
import { OfficeProviderBridgeService } from '../src/main/services/office/OfficeProviderBridgeService'
import type { LlamaService } from '../src/main/services/LlamaService'

let service: OfficeProviderBridgeService | null = null

afterEach(() => {
  service?.stop()
  service = null
})

describe('OfficeProviderBridgeService', () => {
  it('exposes only MiChat local model endpoints', async () => {
    service = new OfficeProviderBridgeService()
    service.setLlamaService({
      ensureChatStarted: async () => false,
      getRuntimeInfo: () => ({ chatPort: 8000 })
    } as LlamaService)
    await service.start(0)

    const health = await fetch(`${service.address}/health`)
    expect(await health.json()).toEqual({ status: 'ok', provider: 'michat-local' })

    const taskpane = await fetch(`${service.address}/taskpane.html`)
    expect(taskpane.status).toBe(404)

    const unsupported = await fetch(`${service.address}/v1/embeddings`, { method: 'POST' })
    expect(unsupported.status).toBe(404)

    const unavailable = await fetch(`${service.address}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'michat-local', messages: [] })
    })
    expect(unavailable.status).toBe(503)
  })
})
