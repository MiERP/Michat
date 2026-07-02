import { describe, expect, it } from 'vitest'
import { buildRAGContext } from '../../src/main/ipc/chatContext'
import { ChatSchemas } from '../../src/main/ipc/validation'


describe('chat ask/context upgrades', () => {
  it('deduplicates repeated chunks and content before building context', () => {
    const result = buildRAGContext([
      { chunkId: 'a', documentTitle: 'Doc A', content: 'same content', score: 0.9 },
      { chunkId: 'a', documentTitle: 'Doc A', content: 'same content changed', score: 0.8 },
      { chunkId: 'b', documentTitle: 'Doc B', content: 'same   content', score: 0.7 },
      { chunkId: 'c', documentTitle: 'Doc C', content: 'new content', score: 0.6 }
    ])

    expect(result.includedChunkIds).toEqual(new Set(['a', 'c']))
    expect(result.context).toContain('chunk="a"')
    expect(result.context).toContain('chunk="c"')
    expect(result.context).not.toContain('chunk="b"')
  })

  it('defaults send-message mode to chat and accepts ask', () => {
    expect(ChatSchemas.sendMessage.parse({ sessionId: 's1', content: 'hi' }).mode).toBe('chat')
    expect(ChatSchemas.sendMessage.parse({ sessionId: 's1', content: 'hi', mode: 'ask' }).mode).toBe('ask')
  })
})
