import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempUserData, closeAndRemove } from './helpers/tempUserData'

let userDataDir = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => userDataDir }
}))

import { closeDatabase, getDatabase, getSqlite, initDatabase, runMigrations } from '../src/main/db'
import { chatMessages } from '../src/main/db/schema'
import * as queries from '../src/main/db/queries'
import { findPairedReplyId } from '../src/main/utils/messagePairs'

describe('chat message persistence', () => {
  beforeEach(async () => {
    userDataDir = await createTempUserData('michat-message-db')
    initDatabase()
    runMigrations()
  })

  afterEach(async () => {
    if (userDataDir) {
      await closeAndRemove(userDataDir, () => {
        const connection = getSqlite()
        closeDatabase()
        if (connection?.open) connection.close()
      })
    }
  })

  it('adds the feedback columns through the real migration', () => {
    const columns = getSqlite()!.prepare('PRAGMA table_info(chat_messages)').all() as Array<{
      name: string
      notnull: number
      dflt_value: string | null
    }>
    const feedback = columns.find((column) => column.name === 'feedback')
    const feedbackAt = columns.find((column) => column.name === 'feedback_at')
    expect(feedback?.notnull).toBe(0)
    expect(feedbackAt?.notnull).toBe(0)
    expect(feedback?.dflt_value).toBeNull()
    expect(feedbackAt?.dflt_value).toBeNull()
  })

  it('stores, replaces, and clears an assistant answer rating', () => {
    const notebook = queries.createNotebook('Feedback notebook')
    const session = queries.createSession(notebook.id, 'Feedback chat')
    const user = queries.createMessage(session.id, 'user', 'Câu hỏi?')
    const assistant = queries.createMessage(session.id, 'assistant', 'Câu trả lời.')

    queries.updateMessageFeedback(assistant.id, 'like')
    const liked = queries.getMessageById(assistant.id)
    expect(liked?.feedback).toBe('like')
    expect(liked?.feedbackAt).toBeInstanceOf(Date)
    expect(
      queries.getMessagesBySession(session.id).find((message) => message.id === assistant.id)
        ?.feedback
    ).toBe('like')

    queries.updateMessageFeedback(assistant.id, 'dislike')
    expect(queries.getMessageById(assistant.id)?.feedback).toBe('dislike')

    queries.updateMessageFeedback(assistant.id, null)
    const cleared = queries.getMessageById(assistant.id)
    expect(cleared?.feedback).toBeNull()
    expect(cleared?.feedbackAt).toBeNull()
    // The user message stays untouched.
    expect(queries.getMessageById(user.id)?.feedback).toBeNull()
  })

  it('deletes a user message and reply without touching the next turn', () => {
    const notebook = queries.createNotebook('Delete notebook')
    const session = queries.createSession(notebook.id, 'Delete chat')
    const userOne = queries.createMessage(session.id, 'user', 'First')
    const replyOne = queries.createMessage(session.id, 'assistant', 'First reply')
    const userTwo = queries.createMessage(session.id, 'user', 'Second')
    const replyTwo = queries.createMessage(session.id, 'assistant', 'Second reply')

    queries.deleteMessagesByIds([userOne.id, replyOne.id])

    const remaining = queries.getAllMessagesBySession(session.id).map((message) => message.id)
    expect(remaining).toEqual([userTwo.id, replyTwo.id])
  })

  it('keeps uncapped insertion order for pairing in long sessions', () => {
    const notebook = queries.createNotebook('Long notebook')
    const session = queries.createSession(notebook.id, 'Long chat')
    const db = getDatabase()
    const fixedTime = new Date('2026-01-01T00:00:00Z')
    const ids: string[] = []

    for (let index = 0; index < 205; index += 1) {
      const id = `msg_long_${index}`
      ids.push(id)
      db.insert(chatMessages)
        .values({
          id,
          sessionId: session.id,
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: String(index),
          createdAt: fixedTime
        })
        .run()
    }

    const all = queries.getAllMessagesBySession(session.id)
    expect(all.map((message) => message.id)).toEqual(ids)
    expect(findPairedReplyId(all, ids[0])).toBe(ids[1])
    // The display query remains capped; only the pairing query is uncapped.
    expect(queries.getMessagesBySession(session.id)).toHaveLength(200)
  })
})
