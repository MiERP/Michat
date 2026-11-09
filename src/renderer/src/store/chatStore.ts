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

  // 异步操作
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
        // 设置该Notebook的流式消息
        newStreamingMessages[notebookId] = messageId
      } else {
        // 清除该Notebook的流式消息
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

    // 从缓存中恢复正在流式传输的消息内容
    const state = get()
    if (state.currentSession?.id !== sessionId) return
    const messages = dbMessages.map((msg: ChatMessage) => {
      // Database rows carry sessionId; notebookId belongs to the session.
      const message = { ...msg, notebookId: state.currentSession!.notebookId }
      const cached = state.messageToNotebook[msg.id]
      if (cached) {
        // 如果缓存中有内容，说明这条消息正在流式传输，使用缓存的内容
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
    // 1. 找到session对应的notebookId
    const session = get().currentSession
    if (!session || session.id !== sessionId) return

    const notebookId = session.notebookId

    // 2. 添加用户消息到 UI
    const userMessage: ChatMessage = {
      id: `temp_user_${Date.now()}`,
      sessionId,
      notebookId,
      role: 'user',
      content,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    // 3. 发送消息并获取 assistant messageId (kèm phạm vi tri thức đang chọn)
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

    // 4. 添加 assistant 消息占位符（包含推理字段）
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

    // 5. 初始化缓存，记录 messageId -> {notebookId, content, reasoningContent}
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

      // 乐观更新: 立即标记消息为非流式
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, isStreaming: false, isReasoningStreaming: false } : msg
        )
      }))

      // 调用 IPC 中止请求
      const result = await window.api.abortMessage(messageId)

      if (result.success) {
        Logger.info('ChatStore', 'Message aborted successfully')

        // 立即清理流状态
        state.setStreamingMessage(notebookId, null)

        // 清理缓存
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
 * 设置流式消息监听器（基于 AI SDK 流式协议）
 * 在应用启动时调用一次
 * 返回清理函数
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

    // 处理不同类型的流式部分
    switch (type) {
      case 'reasoning-start':
        // 推理块开始，标记推理状态
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
        // 推理块结束
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

        // 流式传输完成
        store.setStreamingMessage(cached.notebookId, null)

        // 清理缓存
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

  // 监听错误
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
              ? { ...message, content: errorContent, isStreaming: false, isReasoningStreaming: false }
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
