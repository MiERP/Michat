import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../src/renderer/src/store/chatStore'
import type { ChatMessage, ChatSession } from '../../src/renderer/src/types/notebook'

const session = (id: string, notebookId = id): ChatSession =>
  ({
    id,
    notebookId,
    title: id,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }) as ChatSession
const message = (id: string, notebookId: string): ChatMessage => ({
  id,
  notebookId,
  sessionId: notebookId,
  role: 'assistant',
  content: '',
  feedback: null,
  feedbackAt: null,
  createdAt: new Date(),
  isStreaming: true,
  isReasoningStreaming: true
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('chat navigation and concurrent streams', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState(), true)
    vi.stubGlobal('window', {
      api: {
        getActiveSession: vi.fn(async (id: string) => session(id)),
        getMessages: vi.fn(async () => []),
        createChatSession: vi.fn(async (id: string) => session(id)),
        sendMessage: vi.fn(async () => ({ messageId: 'reply', userMessageId: 'user-reply' })),
        deleteMessage: vi.fn(async () => ({ success: true, deletedMessageIds: [] })),
        setMessageFeedback: vi.fn(async () => ({ success: true }))
      }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('clears the previous notebook scope when loading another active session', async () => {
    useChatStore.getState().setCurrentSession(session('a'))
    useChatStore.getState().setRagScope({ documentIds: ['doc-a'] })
    await useChatStore.getState().loadActiveSession('b')
    expect(useChatStore.getState().ragScope).toBeNull()
  })

  it('ignores an older notebook load that resolves after the latest navigation', async () => {
    const pending = deferred<ChatSession>()
    vi.mocked(window.api.getActiveSession).mockImplementationOnce(() => pending.promise)
    const oldLoad = useChatStore.getState().loadActiveSession('a')
    await useChatStore.getState().loadActiveSession('b')
    pending.resolve(session('a'))
    await oldLoad
    expect(useChatStore.getState().currentSession?.notebookId).toBe('b')
  })

  it('does not restore messages from a session that is no longer selected', async () => {
    const pending = deferred<ChatMessage[]>()
    useChatStore.getState().setCurrentSession(session('a'))
    vi.mocked(window.api.getMessages).mockReturnValueOnce(pending.promise)
    const oldLoad = useChatStore.getState().loadMessages('a')
    await useChatStore.getState().loadActiveSession('b')
    pending.resolve([message('old', 'a')])
    await oldLoad
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('clears old messages when a notebook needs its first session', async () => {
    useChatStore.setState({ currentSession: session('a'), messages: [message('old', 'a')] })
    vi.mocked(window.api.getActiveSession).mockResolvedValueOnce(undefined)
    await useChatStore.getState().loadActiveSession('b')
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('finishing a background notebook stream preserves the visible stream flags', () => {
    useChatStore.setState({
      messages: [message('reply-b', 'b')],
      streamingMessages: { a: 'reply-a', b: 'reply-b' }
    })
    useChatStore.getState().setStreamingMessage('a', null)
    expect(useChatStore.getState().messages[0].isStreaming).toBe(true)
    expect(useChatStore.getState().messages[0].isReasoningStreaming).toBe(true)
  })

  it('restores a reasoning-only stream when returning to its notebook', async () => {
    useChatStore.setState({
      currentSession: session('a'),
      messageToNotebook: { reply: { notebookId: 'a', content: '', reasoningContent: 'thinking' } }
    })
    vi.mocked(window.api.getMessages).mockResolvedValueOnce([
      {
        ...message('reply', 'a'),
        isStreaming: false,
        isReasoningStreaming: false
      }
    ])
    await useChatStore.getState().loadMessages('a')
    expect(useChatStore.getState().messages[0]).toMatchObject({
      reasoningContent: 'thinking',
      isStreaming: true
    })
  })

  it('keeps a delayed send response out of a different notebook', async () => {
    const pending = deferred<string>()
    vi.mocked(window.api.sendMessage).mockReturnValueOnce(pending.promise)
    useChatStore.getState().setCurrentSession(session('a'))
    const sending = useChatStore.getState().sendMessage('a', 'hello')
    await useChatStore.getState().loadActiveSession('b')
    pending.resolve({ messageId: 'reply-a' })
    await sending
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().streamingMessages.a).toBe('reply-a')
  })

  it('finishes a restored stream when database messages omit notebookId', async () => {
    useChatStore.setState({
      currentSession: session('a'),
      messageToNotebook: { reply: { notebookId: 'a', content: 'partial', reasoningContent: '' } }
    })
    const stored = { ...message('reply', 'a'), notebookId: undefined } as unknown as ChatMessage
    vi.mocked(window.api.getMessages).mockResolvedValueOnce([stored])
    await useChatStore.getState().loadMessages('a')
    useChatStore.getState().setStreamingMessage('a', null)
    expect(useChatStore.getState().messages[0].isStreaming).toBe(false)
  })

  it('renders a preflight error without leaving a streaming placeholder', async () => {
    vi.mocked(window.api.sendMessage).mockResolvedValueOnce({
      messageId: '',
      error: 'AI Provider not configured'
    })
    useChatStore.getState().setCurrentSession(session('a'))

    await useChatStore.getState().sendMessage('a', 'hello')

    const state = useChatStore.getState()
    expect(state.streamingMessages.a).toBeUndefined()
    expect(
      state.messages.some((message) => message.content.includes('AI Provider not configured'))
    ).toBe(true)
  })

  it('preserves a new stream cache when an earlier abort finishes', async () => {
    const pending = deferred<{ success: boolean }>()
    window.api.abortMessage = vi.fn(() => pending.promise)
    useChatStore.setState({
      streamingMessages: { a: 'reply-a' },
      messageToNotebook: { 'reply-a': { notebookId: 'a', content: '', reasoningContent: '' } }
    })
    const aborting = useChatStore.getState().abortMessage('a')
    const replyB = { notebookId: 'b', content: 'keep', reasoningContent: '' }
    useChatStore.setState((state) => ({
      messageToNotebook: { ...state.messageToNotebook, 'reply-b': replyB }
    }))
    pending.resolve({ success: true })
    await aborting
    expect(useChatStore.getState().messageToNotebook['reply-b']).toEqual(replyB)
  })

  it('replaces the optimistic user id with the persisted row id', async () => {
    useChatStore.getState().setCurrentSession(session('a'))

    await useChatStore.getState().sendMessage('a', 'hello')

    const userMessage = useChatStore.getState().messages.find((item) => item.role === 'user')
    expect(userMessage?.id).toBe('user-reply')
  })

  it('renders a deterministic no-knowledge-base reply without a stream', async () => {
    vi.mocked(window.api.sendMessage).mockResolvedValueOnce({
      messageId: 'reply',
      userMessageId: 'user-reply',
      content: 'No documents in this notebook.'
    })
    useChatStore.getState().setCurrentSession(session('a'))

    await useChatStore.getState().sendMessage('a', 'what is in the law?')

    const reply = useChatStore
      .getState()
      .messages.find((item) => item.id === 'reply' && item.role === 'assistant')
    expect(reply?.content).toBe('No documents in this notebook.')
    expect(reply?.isStreaming).toBeUndefined()
    expect(useChatStore.getState().streamingMessages.a).toBeUndefined()
  })

  it('deletes a user message and its paired reply from the visible list', async () => {
    useChatStore.setState({
      messages: [{ ...message('user-1', 'a'), role: 'user' }, message('reply-1', 'a')],
      streamingMessages: { a: 'reply-1' },
      messageToNotebook: { 'reply-1': { notebookId: 'a', content: '', reasoningContent: '' } }
    })
    vi.mocked(window.api.deleteMessage).mockResolvedValueOnce({
      success: true,
      deletedMessageIds: ['user-1', 'reply-1']
    })

    const deleted = await useChatStore.getState().deleteUserMessage('user-1')

    expect(deleted).toBe(true)
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().streamingMessages.a).toBeUndefined()
    expect(useChatStore.getState().messageToNotebook['reply-1']).toBeUndefined()
  })

  it('stores a like on the assistant message and allows clearing it', async () => {
    useChatStore.setState({ messages: [message('reply-1', 'a')] })

    await useChatStore.getState().setMessageFeedback('reply-1', 'like')
    expect(useChatStore.getState().messages[0].feedback).toBe('like')

    await useChatStore.getState().setMessageFeedback('reply-1', null)
    expect(useChatStore.getState().messages[0].feedback).toBeNull()
  })

  it('restores a persisted rating when the session reloads', async () => {
    useChatStore.getState().setCurrentSession(session('a'))
    vi.mocked(window.api.getMessages).mockResolvedValueOnce([
      {
        ...message('reply-1', 'a'),
        feedback: 'like',
        isStreaming: false,
        isReasoningStreaming: false
      }
    ])

    await useChatStore.getState().loadMessages('a')

    expect(useChatStore.getState().messages[0].feedback).toBe('like')
  })

  it('keeps the visible messages when deleting fails or throws', async () => {
    const initialMessages = [
      { ...message('user-1', 'a'), role: 'user' as const },
      message('reply-1', 'a')
    ]
    useChatStore.setState({
      messages: initialMessages,
      streamingMessages: { a: 'reply-1' },
      messageToNotebook: { 'reply-1': { notebookId: 'a', content: '', reasoningContent: '' } }
    })

    vi.mocked(window.api.deleteMessage).mockResolvedValueOnce({
      success: false,
      deletedMessageIds: [],
      error: 'not found'
    })
    expect(await useChatStore.getState().deleteUserMessage('user-1')).toBe(false)
    expect(useChatStore.getState().messages).toEqual(initialMessages)

    vi.mocked(window.api.deleteMessage).mockRejectedValueOnce(new Error('ipc failed'))
    expect(await useChatStore.getState().deleteUserMessage('user-1')).toBe(false)
    expect(useChatStore.getState().messages).toEqual(initialMessages)
    expect(useChatStore.getState().streamingMessages.a).toBe('reply-1')
  })

  it('removes only the ids reported by the main process', async () => {
    useChatStore.setState({
      messages: [{ ...message('user-1', 'a'), role: 'user' }, message('reply-1', 'a')]
    })
    vi.mocked(window.api.deleteMessage).mockResolvedValueOnce({
      success: true,
      deletedMessageIds: ['user-1']
    })

    await useChatStore.getState().deleteUserMessage('user-1')

    expect(useChatStore.getState().messages.map((item) => item.id)).toEqual(['reply-1'])
  })

  it('keeps the previous rating when feedback persistence fails', async () => {
    useChatStore.setState({ messages: [{ ...message('reply-1', 'a'), feedback: 'like' }] })
    vi.mocked(window.api.setMessageFeedback).mockResolvedValueOnce({ success: false })

    expect(await useChatStore.getState().setMessageFeedback('reply-1', 'dislike')).toBe(false)
    expect(useChatStore.getState().messages[0].feedback).toBe('like')
  })
})
