import { create } from 'zustand'
import type { ChatSession, ChatMessage } from '../types/notebook'
import Logger from '../../../shared/utils/logger'

interface ChatStore {
  // Current session
  currentSession: ChatSession | null

  // Session list (grouped by notebook)
  sessions: ChatSession[]

  // Message list (current session)
  messages: ChatMessage[]

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

  addMessage: (message: ChatMessage) => void
  updateMessageContent: (messageId: string, content: string) => void
  updateMessageReasoningContent: (messageId: string, reasoningContent: string) => void
  setStreamingMessage: (notebookId: string, messageId: string | null) => void
  isNotebookStreaming: (notebookId: string) => boolean

  loadSessions: (notebookId: string) => Promise<void>
  loadActiveSession: (notebookId: string) => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  createSession: (notebookId: string, title: string) => Promise<ChatSession>
  sendMessage: (sessionId: string, content: string, mode?: 'chat' | 'ask') => Promise<void>
  abortMessage: (notebookId: string) => Promise<void>
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  streamingMessages: {},
  messageToNotebook: {},

  setCurrentSession: (session) => set({ currentSession: session }),
  setSessions: (sessions) => set({ sessions }),
  setMessages: (messages) => set({ messages }),

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
        newStreamingMessages[notebookId] = messageId
      } else {
        delete newStreamingMessages[notebookId]
      }

      return {
        streamingMessages: newStreamingMessages,
        messages: state.messages.map((msg) => ({
          ...msg,
          isStreaming: msg.id === messageId && !!messageId,
          isReasoningStreaming: msg.id === messageId && !!messageId
        }))
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
    const activeSession = await window.api.getActiveSession(notebookId)

    if (activeSession) {
      set({ currentSession: activeSession })
      await get().loadMessages(activeSession.id)
    } else {
      const newSession = await get().createSession(notebookId, `Session ${Date.now()}`)
      set({ currentSession: newSession })
    }
  },

  loadMessages: async (sessionId) => {
    const dbMessages = await window.api.getMessages(sessionId)

    const state = get()
    const messages = dbMessages.map((msg: ChatMessage) => {
      const cached = state.messageToNotebook[msg.id]
      if (cached && cached.content) {
        return { ...msg, content: cached.content, isStreaming: true }
      }
      return msg
    })

    set({ messages })
  },

  createSession: async (notebookId, title) => {
    const session = await window.api.createChatSession(notebookId, title)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSession: session
    }))
    return session
  },

  sendMessage: async (sessionId, content, mode = 'chat') => {
    const session = get().currentSession
    if (!session) return

    const notebookId = session.notebookId

    const userMessage: ChatMessage = {
      id: `temp_user_${Date.now()}`,
      sessionId,
      notebookId,
      role: 'user',
      content,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    const messageId = await window.api.sendMessage(sessionId, content, mode)

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
    get().addMessage(assistantMessage)
    get().setStreamingMessage(notebookId, messageId)

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

      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, isStreaming: false, isReasoningStreaming: false } : msg
        )
      }))

      const result = await window.api.abortMessage(messageId)

      if (result.success) {
        Logger.info('ChatStore', 'Message aborted successfully')

        state.setStreamingMessage(notebookId, null)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = state.messageToNotebook
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

    switch (type) {
      case 'reasoning-start':
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

        store.setStreamingMessage(cached.notebookId, null)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = store.messageToNotebook
        useChatStore.setState({ messageToNotebook: rest })
        break
      }
    }
  })

  const cleanupError = window.api.onMessageError((data) => {
    const { messageId, error } = data
    const store = useChatStore.getState()

    const errorContent = `❌ Error: ${error}`

    // Update cache
    const cached = store.messageToNotebook[messageId]
    if (cached) {
      useChatStore.setState((state) => ({
        messageToNotebook: {
          ...state.messageToNotebook,
          [messageId]: { ...cached, content: errorContent }
        }
      }))

      // If message is in current messages, also update it
      const message = store.messages.find((m) => m.id === messageId)
      if (message) {
        store.updateMessageContent(messageId, errorContent)
      }

      // Clear streaming status and cache
      store.setStreamingMessage(cached.notebookId, null)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [messageId]: _removed, ...rest } = store.messageToNotebook
      useChatStore.setState({ messageToNotebook: rest })
    }
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
    cleanupError()
    cleanupAutoSwitch()
  }
}
