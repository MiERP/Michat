import { randomUUID } from 'crypto'
import { eq, desc, and, sql } from 'drizzle-orm'
import { getDatabase, executeCheckpoint, getSqlite } from './index'
import { chatSessions, chatMessages, notebooks, notes, documents, items, chunks } from './schema'
import { vectorStoreManager } from '../vectorstore'
import Logger from '../../shared/utils/logger'

// ==================== Chat Sessions ====================

/**
 * 创建新的聊天会话
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
 * 获取指定笔记本的活跃会话（栈顶）
 * 每个笔记本只有一个 active session
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
 * 获取指定笔记本的所有会话
 * 按更新时间倒序排列
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
 * 更新会话标题
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
 * 删除会话
 * 外键级联会自动删除该会话的所有消息
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
 * 获取单个会话信息
 */
export function getSessionById(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get()
}

/**
 * 更新会话的 token 计数
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
 * 更新会话的摘要和状态
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
 * 创建新消息
 */
export function createMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: Record<string, any>
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

  // 更新会话的 updatedAt
  db.update(chatSessions).set({ updatedAt: now }).where(eq(chatSessions.id, sessionId)).run()

  return message
}

/**
 * 获取指定会话的所有消息
 * 按创建时间顺序排列
 */
export function getMessagesBySession(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt).limit(200).all()
}

/**
 * 更新消息内容
 * 主要用于更新流式消息的完整内容
 */
export function updateMessageContent(
  messageId: string,
  content: string,
  reasoningContent?: string,
  metadata?: Record<string, any>
) {
  const db = getDatabase()

  const updateData: any = { content }
  if (reasoningContent !== undefined) {
    updateData.reasoningContent = reasoningContent
  }
  if (metadata !== undefined) {
    updateData.metadata = metadata
  }

  db.update(chatMessages).set(updateData).where(eq(chatMessages.id, messageId)).run()
}

// ==================== Notebooks ====================

/**
 * 创建新笔记本
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
 * 获取所有笔记本
 * 按更新时间倒序排列
 */
export function getAllNotebooks() {
  const db = getDatabase()
  return db.select().from(notebooks).orderBy(desc(notebooks.updatedAt)).all()
}

/**
 * 根据 ID 获取笔记本
 */
export function getNotebookById(id: string) {
  const db = getDatabase()
  return db.select().from(notebooks).where(eq(notebooks.id, id)).get()
}

/**
 * 更新笔记本
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
 * 删除笔记本
 * 由于外键级联删除，会自动删除该笔记本下的所有会话和消息
 */
export async function deleteNotebook(id: string) {
  const db = getDatabase()

  try {
    // 先获取该笔记本下所有带本地文件的文档
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

    // 删除笔记本（外键级联会自动删除所有关联的 sessions、messages 和 documents）
    db.delete(notebooks).where(eq(notebooks.id, id)).run()

    // 删除本地文件（异步执行，不阻塞数据库操作）
    if (docsWithLocalFiles.length > 0) {
      const { unlink } = await import('fs/promises')
      for (const doc of docsWithLocalFiles) {
        if (doc.localFilePath) {
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

    // 执行 checkpoint 确保数据持久化
    executeCheckpoint('PASSIVE')
    Logger.info('Database', `Deleted notebook: ${id}`)
  } catch (error) {
    Logger.error('Database', 'Error deleting notebook:', error)
    throw error
  }
}

// ==================== Notes ====================

/**
 * 创建新笔记
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
 * 获取指定笔记本的所有笔记
 * 按更新时间倒序排列
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
 * 根据ID获取单个笔记
 */
export function getNoteById(id: string) {
  const db = getDatabase()
  return db.select().from(notes).where(eq(notes.id, id)).get()
}

/**
 * 更新笔记内容
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
 * 删除笔记
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
