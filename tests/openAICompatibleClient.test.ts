import { beforeEach, describe, expect, it, vi } from 'vitest'
import { embed, embedMany, streamText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  OpenAICompatibleClient,
  withDirectAnswerTemplate
} from '../src/main/ai/OpenAICompatibleClient'
import type { ChatClientDescriptor, ClientConfig, GenerationOptions } from '../src/main/ai/types'
import type { APIMessage } from '../src/shared/types/chat'

vi.mock('ai', () => ({
  streamText: vi.fn(),
  embed: vi.fn(),
  embedMany: vi.fn()
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() =>
    Object.assign((modelId: string) => ({ modelId }), {
      textEmbeddingModel: (modelId: string) => ({ modelId })
    })
  )
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

describe('OpenAICompatibleClient chat template', () => {
  it('disables template thinking so models answer directly', () => {
    expect(withDirectAnswerTemplate({ model: 'chat-model', messages: [] })).toEqual({
      model: 'chat-model',
      messages: [],
      chat_template_kwargs: { enable_thinking: false }
    })
  })

  it('keeps other template kwargs but forces thinking off', () => {
    expect(
      withDirectAnswerTemplate({
        chat_template_kwargs: { enable_thinking: true, custom: 'value' }
      })
    ).toEqual({
      chat_template_kwargs: { enable_thinking: false, custom: 'value' }
    })
  })

  it('does not mutate the request body it receives', () => {
    const input = { model: 'chat-model', chat_template_kwargs: { custom: 'value' } }

    const result = withDirectAnswerTemplate(input)

    expect(result).not.toBe(input)
    expect(input.chat_template_kwargs).toEqual({ custom: 'value' })
  })

  it('wires the transform into the chat provider', () => {
    configuredClient()

    const calls = vi.mocked(createOpenAICompatible).mock.calls
    const options = calls[calls.length - 1]?.[0] as
      | { transformRequestBody?: typeof withDirectAnswerTemplate }
      | undefined

    expect(options?.transformRequestBody).toBe(withDirectAnswerTemplate)
  })

  it('does not apply the chat transform to the separate embedding provider', () => {
    const client = new InspectableClient(DESCRIPTOR)
    client.configure({
      baseUrl: 'http://127.0.0.1:1234/v1',
      embeddingBaseUrl: 'http://127.0.0.1:8081/v1',
      model: 'chat-model'
    })

    const calls = vi.mocked(createOpenAICompatible).mock.calls
    const chatOptions = calls.at(-2)?.[0] as { transformRequestBody?: unknown } | undefined
    const embeddingOptions = calls.at(-1)?.[0] as { transformRequestBody?: unknown } | undefined

    expect(chatOptions?.transformRequestBody).toBe(withDirectAnswerTemplate)
    expect(embeddingOptions?.transformRequestBody).toBeUndefined()
  })
})

describe('OpenAICompatibleClient embedding timeouts', () => {
  beforeEach(() => {
    vi.mocked(embed).mockReset()
    vi.mocked(embedMany).mockReset()
  })

  it('bounds single and batch embedding requests with an abort signal', async () => {
    vi.mocked(embed).mockResolvedValue({
      embedding: new Array(1024).fill(0),
      usage: { tokens: 1 }
    } as never)
    vi.mocked(embedMany).mockResolvedValue({
      embeddings: [new Array(1024).fill(0)],
      usage: { tokens: 1 }
    } as never)

    const client = new InspectableClient(DESCRIPTOR)
    client.configure({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'embed-model' })

    await client.createEmbedding('one text')
    await client.createEmbeddings(['one text'])

    const singleCall = vi.mocked(embed).mock.calls.at(-1)?.[0] as unknown as {
      abortSignal?: AbortSignal
    }
    const batchCall = vi.mocked(embedMany).mock.calls.at(-1)?.[0] as unknown as {
      abortSignal?: AbortSignal
    }

    // A local server that stops responding must not hang indexing or the
    // shutdown barrier forever.
    expect(singleCall.abortSignal).toBeInstanceOf(AbortSignal)
    expect(batchCall.abortSignal).toBeInstanceOf(AbortSignal)
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
