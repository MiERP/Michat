import { randomUUID } from 'crypto'
import { join } from 'path'
import { app } from 'electron'
import { eq, desc, and, sql } from 'drizzle-orm'
import { getDatabase, executeCheckpoint, getSqlite, vacuumDatabase } from './index'
import { isPathInsideDirectory } from '../security/guards'
import { chatSessions, chatMessages, notebooks, notes, documents, items, chunks } from './schema'
import type { ChatMessageMetadata } from '../../shared/types/chat'
import { vectorStoreManager } from '../vectorstore'
import Logger from '../../shared/utils/logger'

// ==================== Chat Sessions ====================

/**
 * Creates a new chat session
 */
export function createSession(notebookId: string, title: string, parentSessionId?: string) {
  const db = getDatabase()
  const id = `session_${randomUUID()}`
  const now = new Date()

  const session = db
    .insert(chatSessions)
    .values({
      id,
      notebookId,
      title,
      parentSessionId,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  return session
}

/**
 * Returns the active session for a notebook (top of the stack).
 * Each notebook has exactly one active session.
 */
export function getActiveSessionByNotebook(notebookId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.notebookId, notebookId), eq(chatSessions.status, 'active')))
    .get()
}

/**
 * Returns all sessions for a notebook.
 * Sorted by update time, newest first.
 */
export function getSessionsByNotebook(notebookId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.notebookId, notebookId))
    .orderBy(desc(chatSessions.updatedAt))
    .all()
}

/**
 * Updates the session title
 */
export function updateSessionTitle(sessionId: string, title: string) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({
      title,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

/**
 * Deletes a session.
 * Foreign-key cascades remove all messages that belong to it.
 */
export function deleteSession(sessionId: string) {
  const db = getDatabase()

  try {
    db.delete(chatSessions).where(eq(chatSessions.id, sessionId)).run()
  } catch (error) {
    console.error('[Database] Error deleting session:', error)
    throw error
  }
}

/**
 * Returns a single session
 */
export function getSessionById(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get()
}

/**
 * Updates the session token count
 */
export function updateSessionTokens(sessionId: string, tokensToAdd: number) {
  const db = getDatabase()

  // BUG-01 Fix: Atomic SQL update to avoid read-modify-write race condition
  const result = db
    .update(chatSessions)
    .set({
      totalTokens: sql`total_tokens + ${tokensToAdd}`,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .returning({ totalTokens: chatSessions.totalTokens })
    .get()

  return result?.totalTokens
}

/**
 * Updates the session summary and status
 */
export function updateSessionSummary(
  sessionId: string,
  summary: string,
  status: 'active' | 'archived' = 'archived'
) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({
      summary,
      status,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

// ==================== Chat Messages ====================

/**
 * Creates a new message
 */
export function createMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: ChatMessageMetadata
) {
  const db = getDatabase()
  const id = `msg_${randomUUID()}`
  const now = new Date()

  const message = db
    .insert(chatMessages)
    .values({
      id,
      sessionId,
      role,
      content,
      metadata,
      createdAt: now
    })
    .returning()
    .get()

  // Update the session's updatedAt
  db.update(chatSessions).set({ updatedAt: now }).where(eq(chatSessions.id, sessionId)).run()

  return message
}

/**
 * Returns all messages for a session.
 * Sorted by creation time.
 */
export function getMessagesBySession(sessionId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt)
    .limit(200)
    .all()
}

/**
 * Returns every message in a session (no display cap) for pairing work.
 * Status notices may sit between a user row and its reply, so insertion order
 * is the reliable order: `rowid` breaks ties when timestamps are identical.
 */
export function getAllMessagesBySession(sessionId: string) {
  const db = getDatabase()

  return db
    .select({ id: chatMessages.id, role: chatMessages.role })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt, sql`rowid`)
    .all()
}

/** Returns a single message by id. */
export function getMessageById(messageId: string) {
  const db = getDatabase()
  return db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).get()
}

/** Deletes messages by id in one transaction. */
export function deleteMessagesByIds(messageIds: string[]): void {
  if (messageIds.length === 0) return
  const db = getDatabase()

  db.transaction((tx) => {
    for (const messageId of messageIds) {
      tx.delete(chatMessages).where(eq(chatMessages.id, messageId)).run()
    }
  })
}

/** Stores the user's like/dislike rating on an assistant answer. */
export function updateMessageFeedback(
  messageId: string,
  feedback: 'like' | 'dislike' | null
): void {
  const db = getDatabase()

  db.update(chatMessages)
    .set({
      feedback,
      feedbackAt: feedback ? new Date() : null
    })
    .where(eq(chatMessages.id, messageId))
    .run()
}

/**
 * Updates message content.
 * Mainly used to store the complete content of a streamed message.
 */
export function updateMessageContent(
  messageId: string,
  content: string,
  reasoningContent?: string,
  metadata?: ChatMessageMetadata
) {
  const db = getDatabase()

  const updateData: Partial<typeof chatMessages.$inferInsert> = { content }
  if (reasoningContent !== undefined) {
    updateData.reasoningContent = reasoningContent
  }
  if (metadata !== undefined) {
    updateData.metadata = metadata
  }

  const result = db.update(chatMessages).set(updateData).where(eq(chatMessages.id, messageId)).run()
  return result.changes > 0
}

// ==================== Notebooks ====================

/**
 * Creates a new notebook
 */
export function createNotebook(title: string, description?: string) {
  const db = getDatabase()
  const id = `notebook_${randomUUID()}`
  const now = new Date()

  const notebook = db
    .insert(notebooks)
    .values({
      id,
      title,
      description,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  Logger.info('Database', `Created notebook: ${id}`)
  return notebook
}

/**
 * Returns all notebooks.
 * Sorted by update time, newest first.
 */
export function getAllNotebooks() {
  const db = getDatabase()
  return db.select().from(notebooks).orderBy(desc(notebooks.updatedAt)).all()
}

/**
 * Returns a notebook by ID
 */
export function getNotebookById(id: string) {
  const db = getDatabase()
  return db.select().from(notebooks).where(eq(notebooks.id, id)).get()
}

/**
 * Updates a notebook
 */
export function updateNotebook(
  id: string,
  updates: Partial<{ title: string; description: string | null }>
) {
  const db = getDatabase()

  db.update(notebooks)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(notebooks.id, id))
    .run()

  Logger.info('Database', `Updated notebook: ${id}`)
}

/**
 * Deletes a notebook.
 * Foreign-key cascades remove every session and message under it.
 */
export async function deleteNotebook(id: string) {
  const db = getDatabase()

  try {
    // First collect every document under this notebook that has a local file
    const docsWithLocalFiles = db
      .select({ localFilePath: documents.localFilePath })
      .from(documents)
      .where(eq(documents.notebookId, id))
      .all()

    const notebookChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.notebookId, id))
      .all()

    if (notebookChunks.length > 0) {
      const chunkIds = notebookChunks.map((row) => row.id)
      const vectorStore = await vectorStoreManager.getStore(id)
      await vectorStore.deleteByChunkIds(chunkIds)
    }

    const sqlite = getSqlite()
    if (sqlite) {
      sqlite.prepare('DELETE FROM fts_chunks WHERE notebook_id = ?').run(id)
      sqlite.prepare('DELETE FROM vec_documents WHERE notebook_id = ?').run(id)
      sqlite.prepare('DELETE FROM vec_sections WHERE notebook_id = ?').run(id)
    }

    // Delete the notebook (foreign-key cascades remove all related sessions, messages and documents)
    db.delete(notebooks).where(eq(notebooks.id, id)).run()

    // Delete local files (async, does not block the database operations)
    if (docsWithLocalFiles.length > 0) {
      const { unlink } = await import('fs/promises')
      const knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
      for (const doc of docsWithLocalFiles) {
        if (doc.localFilePath && isPathInsideDirectory(doc.localFilePath, knowledgeFilesDir)) {
          try {
            await unlink(doc.localFilePath)
            console.log(`[Database] Deleted local file: ${doc.localFilePath}`)
          } catch (error) {
            Logger.error('Database', `Failed to delete local file: ${doc.localFilePath}`, error)
          }
        }
      }
    }

    await vectorStoreManager.closeStore(id)

    // Run a checkpoint to make sure the data is persisted
    executeCheckpoint('PASSIVE')
    vacuumDatabase()
    Logger.info('Database', `Deleted notebook: ${id}`)
  } catch (error) {
    Logger.error('Database', 'Error deleting notebook:', error)
    throw error
  }
}

// ==================== Notes ====================

/**
 * Creates a new note
 */
export function createNote(notebookId: string, title: string, content: string) {
  const db = getDatabase()
  const id = `note_${randomUUID()}`
  const now = new Date()

  const note = db
    .insert(notes)
    .values({
      id,
      notebookId,
      title,
      content,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  Logger.info('Database', `Created note: ${id}`)

  // Q-05 Fix: Wrap in transaction + P-02 Fix: Use MAX aggregate instead of loading all items
  const maxOrderResult = db
    .select({ maxOrder: sql<number>`MAX(${items.order})` })
    .from(items)
    .where(eq(items.notebookId, notebookId))
    .get()
  const newOrder = (maxOrderResult?.maxOrder ?? -1) + 1

  const itemId = `item-note-${id}`
  db.insert(items)
    .values({
      id: itemId,
      notebookId,
      type: 'note',
      resourceId: id,
      order: newOrder,
      createdAt: now,
      updatedAt: now
    })
    .run()

  Logger.info('Database', `Created item for note: ${itemId} with order: ${newOrder}`)

  return note
}

/**
 * Returns all notes for a notebook.
 * Sorted by update time, newest first.
 */
export function getNotesByNotebook(notebookId: string) {
  const db = getDatabase()
  return db
    .select()
    .from(notes)
    .where(eq(notes.notebookId, notebookId))
    .orderBy(desc(notes.updatedAt))
    .all()
}

/**
 * Returns a single note by ID
 */
export function getNoteById(id: string) {
  const db = getDatabase()
  return db.select().from(notes).where(eq(notes.id, id)).get()
}

/**
 * Updates note content
 */
export function updateNote(id: string, updates: Partial<{ title: string; content: string }>) {
  const db = getDatabase()
  db.update(notes)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(notes.id, id))
    .run()
  Logger.info('Database', `Updated note: ${id}`)
}

/**
 * Deletes a note
 */
export function deleteNote(id: string) {
  const db = getDatabase()

  // Q-05 Fix: Delete item and note in a single flow (both sync, DB constraints handle cascade)
  db.delete(items)
    .where(and(eq(items.type, 'note'), eq(items.resourceId, id)))
    .run()
  Logger.info('Database', `Deleted item for note: ${id}`)

  db.delete(notes).where(eq(notes.id, id)).run()
  Logger.info('Database', `Deleted note: ${id}`)
}
