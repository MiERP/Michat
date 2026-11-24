import { create } from 'zustand'
import type { ChatSession, ChatMessage, ChatScope } from '../types/notebook'
import Logger from '../../../shared/utils/logger'

let activeSessionRequest = 0

interface ChatStore {
  // Current session
  currentSession: ChatSession | null

  // Session list (grouped by notebook)
  sessions: ChatSession[]

  // Message list (current session)
  messages: ChatMessage[]

  // Phạm vi tri thức cho lượt hỏi kế tiếp (đúng tài liệu → đúng mục → đúng trang)
  ragScope: ChatScope | null

  // Streaming message status: managed by notebookId
  streamingMessages: Record<string, string>

  // messageId -> {notebookId, content, reasoningContent} mapping, used to clean up streaming status and restore content after switching notebook
  messageToNotebook: Record<
    string,
    { notebookId: string; content: string; reasoningContent: string }
  >

  // Actions
  setCurrentSession: (session: ChatSession | null) => void
  setSessions: (sessions: ChatSession[]) => void
  setMessages: (messages: ChatMessage[]) => void
  setRagScope: (scope: ChatScope | null) => void

  addMessage: (message: ChatMessage) => void
  updateMessageContent: (messageId: string, content: string) => void
  updateMessageReasoningContent: (messageId: string, reasoningContent: string) => void
  setStreamingMessage: (notebookId: string, messageId: string | null) => void
  isNotebookStreaming: (notebookId: string) => boolean

  // Async operations
  loadSessions: (notebookId: string) => Promise<void>
  loadActiveSession: (notebookId: string) => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  createSession: (notebookId: string, title: string) => Promise<ChatSession>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  abortMessage: (notebookId: string) => Promise<void>
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  ragScope: null,
  streamingMessages: {},
  messageToNotebook: {},

  setCurrentSession: (session) =>
    set((state) => ({
      currentSession: session,
      // Đổi sổ tay → phạm vi cũ trỏ vào tài liệu của sổ tay khác, phải bỏ đi
      // nếu không RAG sẽ lọc về rỗng một cách khó hiểu.
      ragScope: session?.notebookId !== state.currentSession?.notebookId ? null : state.ragScope
    })),
  setSessions: (sessions) => set({ sessions }),
  setMessages: (messages) => set({ messages }),
  setRagScope: (ragScope) => set({ ragScope }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message]
    })),

  updateMessageContent: (messageId, content) =>
    set((state) => ({
      messages: state.messages.map((msg) => (msg.id === messageId ? { ...msg, content } : msg))
    })),

  updateMessageReasoningContent: (messageId, reasoningContent) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, reasoningContent } : msg
      )
    })),

  setStreamingMessage: (notebookId, messageId) =>
    set((state) => {
      const newStreamingMessages = { ...state.streamingMessages }

      if (messageId) {
        // Set the streaming message for this notebook
        newStreamingMessages[notebookId] = messageId
      } else {
        // Clear the streaming message for this notebook
        delete newStreamingMessages[notebookId]
      }

      return {
        streamingMessages: newStreamingMessages,
        messages: state.messages.map((msg) =>
          msg.notebookId !== notebookId
            ? msg
            : {
                ...msg,
                isStreaming: msg.id === messageId && !!messageId,
                isReasoningStreaming: msg.id === messageId && !!messageId
              }
        )
      }
    }),

  isNotebookStreaming: (notebookId) => {
    const state = get()
    return !!state.streamingMessages[notebookId]
  },

  loadSessions: async (notebookId) => {
    const sessions = await window.api.getChatSessions(notebookId)
    set({ sessions })
  },

  loadActiveSession: async (notebookId) => {
    const request = ++activeSessionRequest
    if (get().currentSession?.notebookId !== notebookId) {
      get().setCurrentSession(null)
      set({ messages: [], sessions: [] })
    }
    let session = await window.api.getActiveSession(notebookId)
    if (request !== activeSessionRequest) return
    if (!session) {
      session = await window.api.createChatSession(notebookId, `Session ${Date.now()}`)
      if (request !== activeSessionRequest) return
      set((state) => ({ sessions: [session!, ...state.sessions] }))
    }
    get().setCurrentSession(session)
    await get().loadMessages(session.id)
  },

  loadMessages: async (sessionId) => {
    const dbMessages = await window.api.getMessages(sessionId)

    // Restore in-flight streaming message content from the cache
    const state = get()
    if (state.currentSession?.id !== sessionId) return
    const messages = dbMessages.map((msg: ChatMessage) => {
      // Database rows carry sessionId; notebookId belongs to the session.
      const message = { ...msg, notebookId: state.currentSession!.notebookId }
      const cached = state.messageToNotebook[msg.id]
      if (cached) {
        // If the cache has content, the message is still streaming; use the cached content
        return {
          ...message,
          content: cached.content,
          reasoningContent: cached.reasoningContent,
          isStreaming: true,
          isReasoningStreaming: !cached.content
        }
      }
      return message
    })

    set({ messages })
  },

  createSession: async (notebookId, title) => {
    const session = await window.api.createChatSession(notebookId, title)
    get().setCurrentSession(session)
    set((state) => ({ sessions: [session, ...state.sessions], messages: [] }))
    return session
  },

  sendMessage: async (sessionId, content) => {
    // 1. Find the notebookId for the session
    const session = get().currentSession
    if (!session || session.id !== sessionId) return

    const notebookId = session.notebookId

    // 2. Add the user message to the UI
    const userMessage: ChatMessage = {
      id: `temp_user_${Date.now()}`,
      sessionId,
      notebookId,
      role: 'user',
      content,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    // 3. Send the message and get the assistant messageId (with the selected knowledge scope)
    let result: Awaited<ReturnType<typeof window.api.sendMessage>>
    try {
      result = await window.api.sendMessage(sessionId, content, get().ragScope ?? undefined)
    } catch (error) {
      result = { messageId: '', error: (error as Error).message }
    }

    if (result.error || !result.messageId) {
      const errorMessage: ChatMessage = {
        id: `temp_error_${Date.now()}`,
        sessionId,
        notebookId,
        role: 'assistant',
        content: `❌ Error: ${result.error ?? 'Failed to start the response'}`,
        createdAt: new Date()
      }
      if (get().currentSession?.id === sessionId) get().addMessage(errorMessage)
      return
    }

    const messageId = result.messageId

    // 4. Add the assistant message placeholder (including reasoning fields)
    const assistantMessage: ChatMessage = {
      id: messageId,
      sessionId,
      notebookId,
      role: 'assistant',
      content: '',
      reasoningContent: undefined,
      createdAt: new Date(),
      isStreaming: true,
      isReasoningStreaming: true
    }
    if (
      get().currentSession?.id === sessionId &&
      !get().messages.some((message) => message.id === messageId)
    ) {
      get().addMessage(assistantMessage)
    }
    get().setStreamingMessage(notebookId, messageId)

    // 5. Initialize the cache mapping messageId -> {notebookId, content, reasoningContent}
    set((state) => ({
      messageToNotebook: {
        ...state.messageToNotebook,
        [messageId]: { notebookId, content: '', reasoningContent: '' }
      }
    }))
  },

  abortMessage: async (notebookId: string) => {
    const state = get()
    const messageId = state.streamingMessages[notebookId]

    if (!messageId) {
      console.warn('[ChatStore] No streaming message to abort for notebook:', notebookId)
      return
    }

    try {
      Logger.info('ChatStore', `Aborting message: ${messageId}`)

      // Optimistic update: immediately mark the message as not streaming
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, isStreaming: false, isReasoningStreaming: false } : msg
        )
      }))

      // Call IPC to abort the request
      const result = await window.api.abortMessage(messageId)

      if (result.success) {
        Logger.info('ChatStore', 'Message aborted successfully')

        // Clean up the streaming state immediately
        state.setStreamingMessage(notebookId, null)

        // Clean up the cache
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = get().messageToNotebook
        set({ messageToNotebook: rest })
      } else {
        Logger.warn('ChatStore', `Failed to abort: ${result.reason}`)
      }
    } catch (error) {
      Logger.error('ChatStore', 'Error aborting message:', error)
    }
  }
}))

/**
 * Set up the streaming message listener (based on the AI SDK streaming protocol)
 * Call once at app startup
 * Returns a cleanup function
 */
export function setupChatListeners() {
  // Guard: only run in Electron context where window.api is available
  if (!window.api?.onMessageChunk) {
    Logger.warn('ChatStore', 'window.api not available, skipping chat listeners setup')
    return () => {}
  }

  // Listen for streaming message chunks (AI SDK fullStream format)
  const cleanupChunk = window.api.onMessageChunk((data) => {
    const { messageId, type, content, metadata } = data
    const store = useChatStore.getState()

    const cached = store.messageToNotebook[messageId]
    if (!cached) return

    // Handle the different stream part types
    switch (type) {
      case 'reasoning-start':
        // Reasoning block started; mark the reasoning state
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, isReasoningStreaming: true } : msg
          )
        }))
        break

      case 'reasoning-delta': {
        // BUG-04 Fix: Read cached from STATE inside setState callback to avoid stale closure
        useChatStore.setState((state) => {
          const freshCached = state.messageToNotebook[messageId]
          if (!freshCached) return state
          const newReasoningContent = freshCached.reasoningContent + content
          const newMessageToNotebook = {
            ...state.messageToNotebook,
            [messageId]: { ...freshCached, reasoningContent: newReasoningContent }
          }
          const newMessages = state.messages.some((m) => m.id === messageId)
            ? state.messages.map((msg) =>
                msg.id === messageId ? { ...msg, reasoningContent: newReasoningContent } : msg
              )
            : state.messages
          return { messageToNotebook: newMessageToNotebook, messages: newMessages }
        })
        break
      }

      case 'reasoning-end':
        // Reasoning block ended
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, isReasoningStreaming: false } : msg
          )
        }))
        break

      case 'text-delta': {
        // BUG-04 Fix: Read cached from STATE inside setState callback to avoid stale closure
        useChatStore.setState((state) => {
          const freshCached = state.messageToNotebook[messageId]
          if (!freshCached) return state
          const newTextContent = freshCached.content + content
          const newMessageToNotebook = {
            ...state.messageToNotebook,
            [messageId]: { ...freshCached, content: newTextContent }
          }
          const newMessages = state.messages.some((m) => m.id === messageId)
            ? state.messages.map((msg) =>
                msg.id === messageId ? { ...msg, content: newTextContent } : msg
              )
            : state.messages
          return { messageToNotebook: newMessageToNotebook, messages: newMessages }
        })
        break
      }

      case 'finish': {
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, metadata: metadata || msg.metadata } : msg
          )
        }))

        // Streaming complete
        store.setStreamingMessage(cached.notebookId, null)

        // Clean up the cache
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = store.messageToNotebook
        useChatStore.setState({ messageToNotebook: rest })
        break
      }
    }
  })

  // The assistant row exists before any provider/stream work. Creating the
  // cache here closes the race where an error arrived before sendMessage()
  // resolved in the renderer.
  const cleanupCreated = window.api.onMessageCreated((data) => {
    const { messageId, sessionId, notebookId } = data
    const state = useChatStore.getState()
    if (state.messageToNotebook[messageId]) return

    const placeholder: ChatMessage = {
      id: messageId,
      sessionId,
      notebookId,
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      isStreaming: true,
      isReasoningStreaming: true
    }

    useChatStore.setState((current) => ({
      messageToNotebook: {
        ...current.messageToNotebook,
        [messageId]: { notebookId, content: '', reasoningContent: '' }
      },
      messages:
        current.currentSession?.id === sessionId &&
        !current.messages.some((message) => message.id === messageId)
          ? [...current.messages, placeholder]
          : current.messages
    }))
    useChatStore.getState().setStreamingMessage(notebookId, messageId)
  })

  // Listen for errors
  const cleanupError = window.api.onMessageError((data) => {
    const { messageId, error } = data
    const store = useChatStore.getState()

    const errorContent = `❌ Error: ${error}`
    const cached = store.messageToNotebook[messageId]
    const notebookId = cached?.notebookId ?? data.notebookId

    useChatStore.setState((state) => ({
      messageToNotebook: {
        ...state.messageToNotebook,
        [messageId]: { notebookId, content: errorContent, reasoningContent: '' }
      },
      messages: state.messages.some((message) => message.id === messageId)
        ? state.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: errorContent,
                  isStreaming: false,
                  isReasoningStreaming: false
                }
              : message
          )
        : state.messages
    }))

    store.setStreamingMessage(notebookId, null)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [messageId]: _removed, ...rest } = store.messageToNotebook
    useChatStore.setState({ messageToNotebook: rest })
  })

  // Listen for session auto switch
  const cleanupAutoSwitch = window.api.onSessionAutoSwitched(async (data) => {
    const { newSessionId } = data
    const store = useChatStore.getState()

    Logger.info('ChatStore', `Session auto-switched to: ${newSessionId}`)

    // Silently switch to new session
    if (store.currentSession) {
      const newSession = await window.api.getActiveSession(store.currentSession.notebookId)

      if (newSession && newSession.id === newSessionId) {
        // Silently switch to new session, keep current message display, user unaware
        store.setCurrentSession(newSession)
      }
    }
  })

  // Return cleanup function
  return () => {
    cleanupChunk()
    cleanupCreated()
    cleanupError()
    cleanupAutoSwitch()
  }
}
