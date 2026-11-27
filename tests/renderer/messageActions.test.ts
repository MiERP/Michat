import { describe, expect, it } from 'vitest'
import {
  isPersistedMessageId,
  nextFeedbackRating
} from '../../src/renderer/src/components/notebook/chat/messageActions'

describe('message action helpers', () => {
  it('only treats persisted ids as deletable/ratable', () => {
    expect(isPersistedMessageId('msg_123')).toBe(true)
    expect(isPersistedMessageId('temp_user_123')).toBe(false)
    expect(isPersistedMessageId('temp_error_123')).toBe(false)
  })

  it('toggles the active rating off and switches between ratings', () => {
    expect(nextFeedbackRating(null, 'like')).toBe('like')
    expect(nextFeedbackRating('like', 'like')).toBeNull()
    expect(nextFeedbackRating('like', 'dislike')).toBe('dislike')
    expect(nextFeedbackRating('dislike', 'like')).toBe('like')
    expect(nextFeedbackRating(undefined, 'dislike')).toBe('dislike')
  })
})
