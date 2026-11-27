import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempUserData, closeAndRemove } from './helpers/tempUserData'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  userDataDir: '',
  chunkCount: 0,
  capturedMessages: [] as Array<{ role: string; content: string }>,
  getAllSettings: vi.fn(),
  getChatProvider: vi.fn(),
  getEmbeddingProvider: vi.fn(),
  sendMessageStream: vi.fn(),
  searchMetadataAware: vi.fn(),
  search: vi.fn(),
  searchDirectEvidence: vi.fn(),
  searchDefinitionEvidence: vi.fn(),
  getArticleContext: vi.fn(),
  onComplete: null as (() => Promise<void>) | null,
  recordTokenUsageAndCheckSwitch: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  },
  app: {
    isPackaged: false,
    getPath: () => state.userDataDir
  }
}))

vi.mock('../src/main/config', () => ({
  settingsManager: { getAllSettings: state.getAllSettings }
}))

vi.mock('../src/main/services/SessionAutoSwitchService', () => ({
  SessionAutoSwitchService: class {
    static estimateTokens(): number {
      return 1
    }
    async recordTokenUsageAndCheckSwitch(): Promise<null> {
      return null
    }
  }
}))

import { closeDatabase, getSqlite, initDatabase, runMigrations } from '../src/main/db'
import * as queries from '../src/main/db/queries'
import { registerChatHandlers } from '../src/main/ipc/chatHandlers'

interface SendResult {
  messageId: string
  userMessageId?: string
  content?: string
  error?: string
}

interface DeleteResult {
  success: boolean
  deletedMessageIds: string[]
  error?: string
}

describe('chat IPC handlers', () => {
  beforeEach(async () => {
    state.userDataDir = await createTempUserData('michat-chat-handlers')
    initDatabase()
    runMigrations()
    state.handlers.clear()
    state.chunkCount = 0
    state.capturedMessages = []

    state.getAllSettings.mockReset()
    state.getAllSettings.mockResolvedValue({
      language: 'vi-VN',
      ragEnableChitChatHeuristic: true,
      ragSkipShortQueryLength: 12,
      prompts: {}
    })

    const provider = { sendMessageStream: state.sendMessageStream }
    state.getChatProvider.mockReset()
    state.getChatProvider.mockResolvedValue(provider)
    state.getEmbeddingProvider.mockReset()
    state.getEmbeddingProvider.mockResolvedValue(null)
    state.sendMessageStream.mockReset()
    state.sendMessageStream.mockImplementation(
      async (
        messages: Array<{ role: string; content: string }>,
        _onChunk: unknown,
        _onError: unknown,
        onComplete: () => Promise<void>
      ) => {
        state.capturedMessages = messages
        state.onComplete = onComplete
        return new AbortController()
      }
    )
    state.onComplete = null
    state.recordTokenUsageAndCheckSwitch.mockReset()
    state.searchMetadataAware.mockReset()
    state.searchMetadataAware.mockResolvedValue({ results: [] })
    state.search.mockReset()
    state.searchDirectEvidence.mockReset()
    state.searchDirectEvidence.mockReturnValue([])
    state.searchDefinitionEvidence.mockReset()
    state.searchDefinitionEvidence.mockReturnValue([])
    state.getArticleContext.mockReset()
    state.getArticleContext.mockReturnValue([])

    const knowledgeService = {
      getStats: () => ({
        documentCount: state.chunkCount > 0 ? 1 : 0,
        chunkCount: state.chunkCount,
        embeddingCount: state.chunkCount
      }),
      searchMetadataAware: state.searchMetadataAware,
      search: state.search,
      searchDirectEvidence: state.searchDirectEvidence,
      searchDefinitionEvidence: state.searchDefinitionEvidence,
      getArticleContext: state.getArticleContext
    }
    const apiClient = {
      getChatProvider: state.getChatProvider,
      getEmbeddingProvider: state.getEmbeddingProvider,
      getContextWindow: async () => 8192
    }
    const sessionAutoSwitch = {
      recordTokenUsageAndCheckSwitch: state.recordTokenUsageAndCheckSwitch
    }

    registerChatHandlers(apiClient as never, sessionAutoSwitch as never, knowledgeService as never)
  })

  afterEach(async () => {
    if (state.userDataDir) {
      await closeAndRemove(state.userDataDir, () => {
        const connection = getSqlite()
        closeDatabase()
        if (connection?.open) connection.close()
      })
    }
  })

  function createChat(): { sessionId: string } {
    const notebook = queries.createNotebook('Handler notebook')
    const session = queries.createSession(notebook.id, 'Handler session')
    return { sessionId: session.id }
  }

  function event(): { sender: { send: ReturnType<typeof vi.fn> }; senderFrame: { url: string } } {
    return {
      sender: { send: vi.fn() },
      senderFrame: { url: 'file:///index.html' }
    }
  }

  function handler(channel: string): (evt: unknown, args: unknown) => Promise<unknown> {
    const registered = state.handlers.get(channel)
    if (!registered) throw new Error(`${channel} is not registered`)
    return registered as (evt: unknown, args: unknown) => Promise<unknown>
  }

  async function send(sessionId: string, content: string): Promise<SendResult> {
    return (await handler('send-message')(event(), { sessionId, content })) as SendResult
  }

  it('refuses a factual question deterministically when the notebook has no chunks', async () => {
    const { sessionId } = createChat()
    const evt = event()

    const result = (await handler('send-message')(evt, {
      sessionId,
      content: 'tóm tắt luật hôn nhân và gia đình'
    })) as SendResult

    expect(result.content).toContain('chưa có nội dung')
    expect(result.userMessageId).toBeTruthy()
    expect(state.sendMessageStream).not.toHaveBeenCalled()
    expect(evt.sender.send).not.toHaveBeenCalledWith('message-created', expect.anything())

    const rows = queries.getAllMessagesBySession(sessionId)
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant'])
    expect(queries.getMessageById(result.messageId)?.content).toBe(result.content)
  })

  it('uses the configured language for the deterministic refusal', async () => {
    state.getAllSettings.mockResolvedValue({
      language: 'en-US',
      ragEnableChitChatHeuristic: true,
      ragSkipShortQueryLength: 12,
      prompts: {}
    })
    const { sessionId } = createChat()

    const result = await send(sessionId, 'summarize family law')

    expect(result.content).toContain('no indexed content')
  })

  it('still lets a greeting reach the model in an empty notebook', async () => {
    const { sessionId } = createChat()
    const evt = event()

    const result = (await handler('send-message')(evt, {
      sessionId,
      content: 'Chào'
    })) as SendResult

    expect(result.content).toBeUndefined()
    expect(state.sendMessageStream).toHaveBeenCalledTimes(1)
    expect(evt.sender.send).toHaveBeenCalledWith(
      'message-created',
      expect.objectContaining({ sessionId })
    )
  })

  it('refuses before requiring a chat provider when the notebook is empty', async () => {
    state.getChatProvider.mockResolvedValueOnce(null)
    const { sessionId } = createChat()

    const result = await send(sessionId, 'Điều 8 là gì?')

    expect(result.content).toContain('chưa có nội dung')
    expect(state.getChatProvider).not.toHaveBeenCalled()
    expect(state.sendMessageStream).not.toHaveBeenCalled()
    expect(queries.getAllMessagesBySession(sessionId)).toHaveLength(2)
  })

  it('refuses a greeting-prefixed knowledge question in an empty notebook', async () => {
    const { sessionId } = createChat()
    const evt = event()

    const result = (await handler('send-message')(evt, {
      sessionId,
      content: 'chào bạn, Điều 8 quy định gì?'
    })) as SendResult

    expect(result.content).toContain('chưa có nội dung')
    expect(state.sendMessageStream).not.toHaveBeenCalled()
    expect(evt.sender.send).not.toHaveBeenCalledWith('message-created', expect.anything())
    expect(queries.getMessageById(result.messageId)?.content).toBe(result.content)
  })

  it('adds a no-evidence instruction when a short knowledge query skipped RAG', async () => {
    state.chunkCount = 1
    state.getEmbeddingProvider.mockResolvedValue({})
    const { sessionId } = createChat()

    await send(sessionId, 'hôn nhân')

    expect(state.searchMetadataAware).not.toHaveBeenCalled()
    expect(state.sendMessageStream).toHaveBeenCalledTimes(1)
    expect(state.capturedMessages[0]).toMatchObject({ role: 'system' })
    expect(state.capturedMessages[0].content).toContain('no relevant evidence')
  })

  it('bypasses the short-query skip for an explicit legal reference', async () => {
    state.chunkCount = 1
    state.getEmbeddingProvider.mockResolvedValue({})
    state.searchMetadataAware.mockResolvedValue({
      results: [
        {
          chunkId: 'chunk-8',
          documentId: 'doc-law',
          documentTitle: 'Luật mẫu',
          chunkIndex: 0,
          score: 0.9,
          content: 'Điều 8. Nội dung điều luật.'
        }
      ]
    })
    const { sessionId } = createChat()

    await send(sessionId, 'Điều 8')

    expect(state.searchMetadataAware).toHaveBeenCalled()
    expect(state.capturedMessages[0].content).toContain('<doc id="1"')
    expect(state.capturedMessages[0].content).not.toContain('no relevant evidence')
  })

  it('retrieves for an English greeting-prefixed question with chunks', async () => {
    state.chunkCount = 1
    state.getEmbeddingProvider.mockResolvedValue({})
    state.searchMetadataAware.mockResolvedValue({
      results: [
        {
          chunkId: 'chunk-8',
          documentId: 'doc-law',
          documentTitle: 'Sample Law',
          chunkIndex: 0,
          score: 0.9,
          content: 'Article 8. Test provision.'
        }
      ]
    })
    const { sessionId } = createChat()

    await send(sessionId, 'Hi, what does Article 8 say?')

    expect(state.searchMetadataAware).toHaveBeenCalled()
    expect(state.capturedMessages[0].content).toContain('<doc id="1"')
    expect(state.capturedMessages[0].content).not.toContain('no relevant evidence')
  })

  it('deletes the user row and its paired assistant answer only', async () => {
    const { sessionId } = createChat()
    const userOne = queries.createMessage(sessionId, 'user', 'First')
    const replyOne = queries.createMessage(sessionId, 'assistant', 'First reply')
    const userTwo = queries.createMessage(sessionId, 'user', 'Second')
    const replyTwo = queries.createMessage(sessionId, 'assistant', 'Second reply')

    const result = (await handler('delete-message')(event(), {
      messageId: userOne.id
    })) as DeleteResult

    expect(result).toEqual({
      success: true,
      deletedMessageIds: [userOne.id, replyOne.id]
    })
    expect(queries.getAllMessagesBySession(sessionId).map((row) => row.id)).toEqual([
      userTwo.id,
      replyTwo.id
    ])
  })

  it('rejects deleting an assistant row or an unknown id', async () => {
    const { sessionId } = createChat()
    const assistant = queries.createMessage(sessionId, 'assistant', 'Answer')

    const assistantResult = (await handler('delete-message')(event(), {
      messageId: assistant.id
    })) as DeleteResult
    const missingResult = (await handler('delete-message')(event(), {
      messageId: 'missing'
    })) as DeleteResult

    expect(assistantResult.success).toBe(false)
    expect(assistantResult.deletedMessageIds).toEqual([])
    expect(missingResult.success).toBe(false)
    expect(queries.getAllMessagesBySession(sessionId)).toHaveLength(1)
  })

  it('aborts an active stream before deleting its pair', async () => {
    state.chunkCount = 1
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, 'abort')
    state.sendMessageStream.mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        state.capturedMessages = messages
        return controller
      }
    )
    const { sessionId } = createChat()

    const sent = await send(sessionId, 'hello')
    expect(sent.userMessageId).toBeTruthy()
    expect(sent.messageId).toBeTruthy()

    const deleted = (await handler('delete-message')(event(), {
      messageId: sent.userMessageId
    })) as DeleteResult

    expect(deleted.success).toBe(true)
    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(queries.getAllMessagesBySession(sessionId)).toEqual([])

    const abortResult = (await handler('abort-message')(event(), {
      messageId: sent.messageId
    })) as { success: boolean }
    expect(abortResult.success).toBe(false)
  })

  it('skips token accounting when the reply row was deleted mid-stream', async () => {
    state.chunkCount = 1
    const { sessionId } = createChat()
    const sent = await send(sessionId, 'hello')
    expect(sent.userMessageId).toBeTruthy()
    expect(state.onComplete).toBeTruthy()

    await handler('delete-message')(event(), { messageId: sent.userMessageId })
    await state.onComplete?.()

    expect(state.recordTokenUsageAndCheckSwitch).not.toHaveBeenCalled()
    expect(queries.getMessagesBySession(sessionId)).toEqual([])
  })

  it('retrieves for a question-marked short query with chunks', async () => {
    state.chunkCount = 1
    state.getEmbeddingProvider.mockResolvedValue({})
    state.searchMetadataAware.mockResolvedValue({
      results: [
        {
          chunkId: 'chunk-divorce',
          documentId: 'doc-law',
          documentTitle: 'Luật mẫu',
          chunkIndex: 0,
          score: 0.9,
          content: 'Ly hôn là chấm dứt quan hệ hôn nhân.'
        }
      ]
    })
    const { sessionId } = createChat()

    await send(sessionId, 'ly hôn?')

    expect(state.searchMetadataAware).toHaveBeenCalled()
    expect(state.capturedMessages[0].content).toContain('<doc id="1"')
    expect(state.capturedMessages[0].content).not.toContain('no relevant evidence')
  })

  it('lets a polite thanks reach the model in an empty notebook', async () => {
    const { sessionId } = createChat()

    const result = await send(sessionId, 'cảm ơn anh')

    expect(result.content).toBeUndefined()
    expect(state.sendMessageStream).toHaveBeenCalledTimes(1)
  })

  it('only accepts feedback for an existing assistant message', async () => {
    const { sessionId } = createChat()
    const user = queries.createMessage(sessionId, 'user', 'Question')
    const assistant = queries.createMessage(sessionId, 'assistant', 'Answer')

    const userResult = (await handler('set-message-feedback')(event(), {
      messageId: user.id,
      rating: 'like'
    })) as { success: boolean }
    const missingResult = (await handler('set-message-feedback')(event(), {
      messageId: 'missing',
      rating: 'like'
    })) as { success: boolean }
    const assistantResult = (await handler('set-message-feedback')(event(), {
      messageId: assistant.id,
      rating: 'like'
    })) as { success: boolean }

    expect(userResult.success).toBe(false)
    expect(missingResult.success).toBe(false)
    expect(assistantResult.success).toBe(true)
    expect(queries.getMessageById(assistant.id)?.feedback).toBe('like')

    await handler('set-message-feedback')(event(), { messageId: assistant.id, rating: null })
    expect(queries.getMessageById(assistant.id)?.feedback).toBeNull()
  })
})
