import { describe, expect, it } from 'vitest'
import { fitChatPrompt, estimateChatTokens } from '../../src/main/services/ChatPromptBudget'
import type { APIMessage } from '../../src/shared/types/chat'

describe('fitChatPrompt', () => {
  const history: APIMessage[] = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `history-${index} ${'h'.repeat(500)}`
  }))

  it.each([4096, 8192])('never exceeds %i-token context', (contextWindow) => {
    const result = fitChatPrompt({
      system: `system ${'s'.repeat(3000)}`,
      history,
      query: 'Câu hỏi hiện tại',
      evidence: `evidence ${'e'.repeat(12000)}`,
      graph: `graph ${'g'.repeat(5000)}`,
      contextWindow,
      maxOutputTokens: 320,
      safetyTokens: 256,
      maxHistoryMessages: 4
    })

    expect(result.estimatedPromptTokens + 320 + 256).toBeLessThanOrEqual(contextWindow)
    expect(estimateChatTokens(result.messages)).toBe(result.estimatedPromptTokens)
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: 'Câu hỏi hiện tại' })
  })

  it('drops history before graph and evidence', () => {
    const result = fitChatPrompt({
      system: 'system',
      history,
      query: 'query',
      evidence: `evidence ${'e'.repeat(3000)}`,
      graph: `graph ${'g'.repeat(1200)}`,
      contextWindow: 2048,
      maxOutputTokens: 320,
      safetyTokens: 256,
      maxHistoryMessages: 12
    })

    expect(result.droppedHistoryMessages).toBeGreaterThan(0)
    expect(result.messages.some((message) => message.content.startsWith('graph'))).toBe(true)
    expect(result.messages.some((message) => message.content.startsWith('evidence'))).toBe(true)
  })
})
