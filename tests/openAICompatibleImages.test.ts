import { describe, expect, it } from 'vitest'
import { convertToOpenAICompatibleMessages } from '../src/main/providers/base/AISDKProvider'
import type { APIMessage } from '../src/shared/types/chat'

describe('OpenAI-compatible image messages', () => {
  it('sends image attachments as image_url data URLs for llama.cpp', () => {
    const messages: APIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this image.' },
          {
            type: 'image',
            image: {
              name: 'screen.png',
              mimeType: 'image/png',
              dataUrl: 'data:image/png;base64,aGVsbG8='
            }
          }
        ]
      }
    ]

    expect(convertToOpenAICompatibleMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this image.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
        ]
      }
    ])
  })
})
