import { describe, expect, it } from 'vitest'
import { ChatSchemas } from '../src/main/ipc/validation'

describe('chat image upload removal', () => {
  it('does not pass image attachments through send-message validation', () => {
    const parsed = ChatSchemas.sendMessage.parse({
      sessionId: 'session_1',
      content: 'hello',
      images: [
        {
          name: 'screen.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aGVsbG8='
        }
      ]
    })

    expect(parsed).toEqual({ sessionId: 'session_1', content: 'hello', mode: 'chat' })
  })
})
