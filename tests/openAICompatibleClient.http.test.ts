import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { OpenAICompatibleClient } from '../src/main/ai/OpenAICompatibleClient'
import type { ChatClientDescriptor } from '../src/main/ai/types'

const DESCRIPTOR: ChatClientDescriptor = {
  name: 'test-openai-compatible',
  defaultBaseUrl: 'http://127.0.0.1:1234/v1',
  defaultChatModel: 'shared-model',
  defaultEmbeddingModel: 'shared-model',
  capabilities: { chat: true, embedding: true }
}

interface CapturedRequest {
  url: string
  body: Record<string, unknown>
}

function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'shared-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`
}

describe('OpenAICompatibleClient HTTP payloads', () => {
  it('sends chat_template_kwargs on chat requests but not embedding requests', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        requests.push({
          url: request.url ?? '',
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        })

        if (request.url?.endsWith('/embeddings')) {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(
            JSON.stringify({
              data: [{ embedding: [0, 0, 0, 0] }],
              usage: { prompt_tokens: 1 }
            })
          )
          return
        }

        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
        response.write(sseChunk({ role: 'assistant', content: '' }))
        response.write(sseChunk({ content: 'Xin chào' }))
        response.write(sseChunk({}, 'stop'))
        response.write('data: [DONE]\n\n')
        response.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    try {
      const client = new OpenAICompatibleClient(DESCRIPTOR)
      client.configure({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'shared-model' })

      await client.createEmbedding('hello')
      await new Promise<void>((resolve, reject) => {
        client.sendMessageStream(
          [{ role: 'user', content: 'Xin chào' }],
          () => undefined,
          reject,
          resolve
        )
      })

      const embedding = requests.find((entry) => entry.url.endsWith('/embeddings'))
      const chat = requests.find((entry) => entry.url.endsWith('/chat/completions'))

      expect(embedding?.body).toMatchObject({ model: 'shared-model' })
      expect(embedding?.body).not.toHaveProperty('chat_template_kwargs')
      expect(chat?.body.chat_template_kwargs).toEqual({ enable_thinking: false })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
