import { describe, expect, it } from 'vitest'
import { findPairedReplyId } from '../src/main/utils/messagePairs'

describe('message pairing', () => {
  const rows = [
    { id: 'u1', role: 'user' as const },
    { id: 'a1', role: 'assistant' as const },
    { id: 'sys', role: 'system' as const },
    { id: 'u2', role: 'user' as const },
    { id: 'a2', role: 'assistant' as const }
  ]

  it('finds the assistant row created right after the user message', () => {
    expect(findPairedReplyId(rows, 'u1')).toBe('a1')
    expect(findPairedReplyId(rows, 'u2')).toBe('a2')
  })

  it('skips a system notice between the user row and its reply', () => {
    const withNotice = [
      { id: 'u1', role: 'user' as const },
      { id: 'sys', role: 'system' as const },
      { id: 'a1', role: 'assistant' as const }
    ]
    expect(findPairedReplyId(withNotice, 'u1')).toBe('a1')
  })

  it('does not cross into the next user turn when no reply exists', () => {
    const orphan = [
      { id: 'u1', role: 'user' as const },
      { id: 'u2', role: 'user' as const },
      { id: 'a2', role: 'assistant' as const }
    ]
    expect(findPairedReplyId(orphan, 'u1')).toBeNull()
  })

  it('returns null for an unknown or assistant message', () => {
    expect(findPairedReplyId(rows, 'missing')).toBeNull()
    expect(findPairedReplyId(rows, 'a1')).toBeNull()
  })
})
