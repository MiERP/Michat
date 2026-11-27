export interface OrderedMessageRole {
  id: string
  role: 'user' | 'assistant' | 'system'
}

/**
 * Find the assistant reply paired with a user message.
 *
 * Messages are stored in conversation order: the assistant placeholder is
 * created immediately after the user row. Skipping system notices keeps the
 * pairing correct when a maintenance message sits between the two rows.
 */
export function findPairedReplyId(
  messages: OrderedMessageRole[],
  userMessageId: string
): string | null {
  const userIndex = messages.findIndex(
    (message) => message.id === userMessageId && message.role === 'user'
  )
  if (userIndex < 0) return null

  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user') return null
    if (message.role === 'assistant') return message.id
  }

  return null
}
