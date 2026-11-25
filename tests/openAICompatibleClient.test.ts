import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import { OpenAICompatibleClient } from '../src/main/ai/OpenAICompatibleClient'
import type { ChatClientDescriptor, ClientConfig, GenerationOptions } from '../src/main/ai/types'
import type { APIMessage } from '../src/shared/types/chat'

vi.mock('ai', () => ({
  streamText: vi.fn(),
  embed: vi.fn(),
  embedMany: vi.fn()
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => (modelId: string) => ({ modelId }))
}))

class InspectableClient extends OpenAICompatibleClient {
  get generationDefaults(): ClientConfig {
    return this.config
  }
}

const DESCRIPTOR: ChatClientDescriptor = {
  name: 'test-openai-compatible',
  defaultBaseUrl: 'http://127.0.0.1:1234/v1',
  defaultChatModel: 'chat-model',
  defaultEmbeddingModel: 'embed-model',
  capabilities: { chat: true, embedding: true }
}

type StreamCallOptions = { temperature?: number; maxOutputTokens?: number }

function configuredClient(): InspectableClient {
  const client = new InspectableClient(DESCRIPTOR)
  client.configure({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'chat-model' })
  return client
}

function installSuccessfulStream(): void {
  const finalResult = {
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
    finishReason: Promise.resolve('stop')
  }

  vi.mocked(streamText).mockReturnValue({
    fullStream: [],
    then: (resolve: (value: typeof finalResult) => void) => resolve(finalResult)
  } as never)
}

async function captureStreamOptions(
  client: OpenAICompatibleClient,
  options?: GenerationOptions
): Promise<StreamCallOptions | undefined> {
  installSuccessfulStream()

  const completed = new Promise<void>((resolve, reject) => {
    const messages: APIMessage[] = [{ role: 'user', content: 'Xin chào' }]
    client
      .sendMessageStream(
        messages,
        () => undefined,
        (error) => reject(error),
        () => resolve(),
        options
      )
      .catch(reject)
  })
  await completed

  const calls = vi.mocked(streamText).mock.calls
  return calls[calls.length - 1]?.[0] as unknown as StreamCallOptions | undefined
}

describe('OpenAICompatibleClient generation defaults', () => {
  it('uses a low temperature and a bounded output budget', () => {
    const client = new InspectableClient(DESCRIPTOR)

    expect(client.generationDefaults.temperature).toBe(0.2)
    expect(client.generationDefaults.maxTokens).toBe(2048)
  })

  it('keeps the generation defaults when only connection settings are configured', () => {
    const client = new InspectableClient(DESCRIPTOR)

    client.configure({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'chat-model' })

    expect(client.generationDefaults.temperature).toBe(0.2)
    expect(client.generationDefaults.maxTokens).toBe(2048)
  })
})

describe('OpenAICompatibleClient per-request generation options', () => {
  beforeEach(() => {
    vi.mocked(streamText).mockReset()
  })

  it('passes per-request overrides to the AI SDK', async () => {
    const call = await captureStreamOptions(configuredClient(), {
      temperature: 0.35,
      maxTokens: 1400
    })

    expect(call?.temperature).toBe(0.35)
    expect(call?.maxOutputTokens).toBe(1400)
  })

  it('falls back to the client defaults when the request has no options', async () => {
    const call = await captureStreamOptions(configuredClient())

    expect(call?.temperature).toBe(0.2)
    expect(call?.maxOutputTokens).toBe(2048)
  })
})
