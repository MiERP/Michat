import type { MessageFeedbackRating } from '../../../../../shared/types/chat'

/** Optimistic UI rows use a temp_ id until the main process returns the row id. */
export function isPersistedMessageId(messageId: string): boolean {
  return !messageId.startsWith('temp_')
}

/**
 * Clicking the active rating clears it; clicking the other rating switches to
 * it. Keeping this pure makes the toggle behavior testable without a DOM.
 */
export function nextFeedbackRating(
  current: MessageFeedbackRating | null | undefined,
  clicked: MessageFeedbackRating
): MessageFeedbackRating | null {
  return current === clicked ? null : clicked
}
