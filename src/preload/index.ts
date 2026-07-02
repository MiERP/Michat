import { contextBridge, ipcRenderer } from 'electron'

/**
 * @returns Promise
 */

type IpcListener = (event: unknown, ...args: unknown[]) => void

const electronAPI = {
  process: {
    versions: process.versions
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: IpcListener) => {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        listener(undefined, ...args)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    },
    once: (channel: string, listener: IpcListener) => {
      ipcRenderer.once(channel, (_event, ...args) => listener(undefined, ...args))
    },
    removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
  }
}
async function invokeWithTimeout<T>(channel: string, timeout: number, ...args: any[]): Promise<T> {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC call timeout: ${channel} (${timeout}ms)`)), timeout)
    )
  ])
}

// Custom APIs for renderer
const api = {
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  license: {
    getStatus: () => ipcRenderer.invoke('license:get-status')
  },

  openExternalUrl: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-external-url', url),

  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    update: (updates: any) => ipcRenderer.invoke('settings:update', { updates }),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', { key, value }),
    reset: () => ipcRenderer.invoke('settings:reset'),
    getDefaultPrompts: () => ipcRenderer.invoke('settings:getDefaultPrompts'),
    onSettingsChange: (callback: (newSettings: any, oldSettings: any) => void) => {
      const listener = (_event: any, newSettings: any, oldSettings: any) =>
        callback(newSettings, oldSettings)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },

  createNotebook: (title: string, description?: string) =>
    ipcRenderer.invoke('create-notebook', { title, description }),
  getAllNotebooks: () => ipcRenderer.invoke('get-all-notebooks'),
  getNotebook: (id: string) => ipcRenderer.invoke('get-notebook', { id }),
  updateNotebook: (id: string, updates: any) =>
    ipcRenderer.invoke('update-notebook', { id, updates }),
  deleteNotebook: (id: string) => ipcRenderer.invoke('delete-notebook', { id }),

  createNote: (notebookId: string, content: string, customTitle?: string) =>
    ipcRenderer.invoke('create-note', { notebookId, title: customTitle || '', content }),
  getNotes: (notebookId: string) => ipcRenderer.invoke('get-notes', { notebookId }),
  getNote: (id: string) => ipcRenderer.invoke('get-note', { id }),
  updateNote: (id: string, updates: any) => ipcRenderer.invoke('update-note', { id, updates }),
  deleteNote: (id: string) => ipcRenderer.invoke('delete-note', { id }),

  items: {
    getAll: (notebookId: string) => ipcRenderer.invoke('items:get', { notebookId }),
    updateOrder: (itemId: string, order: number) =>
      ipcRenderer.invoke('items:update-order', { itemId, order }),
    batchUpdateOrder: (updates: Record<string, number>) =>
      ipcRenderer.invoke('items:batch-update-order', { updates }),
    delete: (itemId: string, deleteResource = false) =>
      ipcRenderer.invoke('items:delete', { itemId, deleteResource })
  },

  createChatSession: (notebookId: string, title: string) =>
    ipcRenderer.invoke('create-chat-session', { notebookId, title }),
  getChatSessions: (notebookId: string) => ipcRenderer.invoke('get-chat-sessions', { notebookId }),
  getActiveSession: (notebookId: string) =>
    ipcRenderer.invoke('get-active-session', { notebookId }),
  updateSessionTitle: (sessionId: string, title: string) =>
    ipcRenderer.invoke('update-session-title', { sessionId, title }),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', { sessionId }),

  getMessages: (sessionId: string) => invokeWithTimeout('get-messages', 10000, { sessionId }),
  sendMessage: (sessionId: string, content: string, mode: 'chat' | 'ask' = 'chat') => {
    return invokeWithTimeout(mode === 'ask' ? 'ask-message' : 'send-message', 60000, {
      sessionId,
      content,
      mode
    })
  },
  abortMessage: (messageId: string) => invokeWithTimeout('abort-message', 5000, { messageId }),

  podcast: {
    generateScript: (notebookId: string) => invokeWithTimeout('podcast:generate-script', 120000, { notebookId }),
    update: (id: string, updates: { title?: string }) => invokeWithTimeout('podcast:update', 10000, { id, title: updates.title || '' }),
    cancel: (notebookId: string) => invokeWithTimeout('podcast:cancel', 5000, { notebookId }),
    onProgress: (callback: (data: { notebookId: string; stage: string; progress: number }) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('podcast:progress', listener)
      return () => ipcRenderer.removeListener('podcast:progress', listener)
    },
    synthesizeAudio: () => invokeWithTimeout('podcast:synthesize-audio', 5000, {})
  },

  onMessageChunk: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-chunk', listener)
    return () => ipcRenderer.removeListener('message-chunk', listener)
  },

  onMessageError: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-error', listener)
    return () => ipcRenderer.removeListener('message-error', listener)
  },

  onSessionAutoSwitched: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session-auto-switched', listener)
    return () => ipcRenderer.removeListener('session-auto-switched', listener)
  },

  // Provider config
  saveProviderConfig: (config: any) => invokeWithTimeout('save-provider-config', 5000, config),
  getProviderConfig: (providerName: string) =>
    ipcRenderer.invoke('get-provider-config', { providerName }),
  getAllProviderConfigs: () => ipcRenderer.invoke('get-all-provider-configs'),
  deleteProviderConfig: (providerName: string) =>
    ipcRenderer.invoke('delete-provider-config', { providerName }),
  validateProviderConfig: (providerName: string, config: any) =>
    invokeWithTimeout('validate-provider-config', 15000, { providerName, config }),
  fetchModels: (providerName: string, apiKey: string) =>
    invokeWithTimeout('fetch-models', 15000, { providerName, apiKey }),
  getProviderModels: (providerName: string) =>
    ipcRenderer.invoke('get-provider-models', { providerName }),

  onProviderConfigChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('provider-config-changed', listener)
    return () => ipcRenderer.removeListener('provider-config-changed', listener)
  },

  // Check if API key encryption is available
  checkEncryption: (): Promise<{ encrypted: boolean }> => ipcRenderer.invoke('check-encryption'),

  // Llama model management
  llama: {
    listModels: () => ipcRenderer.invoke('llama:list-models'),
    importModel: (type: 'chat' | 'embedding' | 'reranker') => ipcRenderer.invoke('llama:import-model', { type }),
    removeModel: (filename: string) => ipcRenderer.invoke('llama:remove-model', { filename }),
    getServerInfo: () => ipcRenderer.invoke('llama:get-server-info')
  },

  knowledge: {
    addDocument: (notebookId: string, options: any) =>
      ipcRenderer.invoke('knowledge:add-document', { notebookId, options }),
    addDocumentFromFile: (notebookId: string, filePath: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-file', { notebookId, filePath }),
    addDocumentsFromFolder: (notebookId: string, folderPath: string) =>
      ipcRenderer.invoke('knowledge:add-documents-from-folder', { notebookId, folderPath }),
    addNote: (notebookId: string, noteId: string) =>
      ipcRenderer.invoke('knowledge:add-note', { notebookId, noteId }),

    search: (notebookId: string, query: string, options?: any) =>
      ipcRenderer.invoke('knowledge:search', { notebookId, query, options }),

    getDocuments: (notebookId: string) =>
      ipcRenderer.invoke('knowledge:get-documents', { notebookId }),
    getDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document', { documentId }),
    getDocumentChunks: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document-chunks', { documentId }),
    getDocumentPage: (documentId: string, pageNumber: number, highlightText?: string) =>
      ipcRenderer.invoke('knowledge:get-document-page', { documentId, pageNumber, highlightText }),
    deleteDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:delete-document', { documentId }),
    reindexDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:reindex-document', { documentId }),

    getStats: (notebookId: string) => ipcRenderer.invoke('knowledge:get-stats', { notebookId }),

    selectFiles: () => ipcRenderer.invoke('knowledge:select-files'),
    selectFolder: () => ipcRenderer.invoke('knowledge:select-folder'),

    openSource: (documentId: string) => ipcRenderer.invoke('knowledge:open-source', { documentId }),

    onIndexProgress: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('knowledge:index-progress', listener)
      return () => ipcRenderer.removeListener('knowledge:index-progress', listener)
    }
  },

  templates: {
    selectTemplate: (kind: 'word' | 'excel') =>
      ipcRenderer.invoke('templates:select-template', { kind }),
    selectOutput: (kind: 'word' | 'excel') =>
      ipcRenderer.invoke('templates:select-output', { kind }),
    generateWord: (templatePath: string, outputPath: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('templates:generate-word', { templatePath, outputPath, data }),
    generateExcel: (templatePath: string, outputPath: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('templates:generate-excel', { templatePath, outputPath, data })
  },

  mindmap: {
    generate: (notebookId: string) => ipcRenderer.invoke('mindmap:generate', { notebookId }),
    getLatest: (notebookId: string) => ipcRenderer.invoke('mindmap:get-latest', { notebookId }),
    get: (mindMapId: string) => ipcRenderer.invoke('mindmap:get', { mindMapId }),
    getNodeChunks: (mindMapId: string, nodeId: string) =>
      ipcRenderer.invoke('mindmap:get-node-chunks', { mindMapId, nodeId }),
    update: (mindMapId: string, updates: any) =>
      ipcRenderer.invoke('mindmap:update', { mindMapId, updates }),
    delete: (mindMapId: string) => ipcRenderer.invoke('mindmap:delete', { mindMapId }),
    openWindow: (notebookId: string, mindMapId?: string) =>
      ipcRenderer.invoke('mindmap:open-window', { notebookId, mindMapId }),
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('mindmap:progress', listener)
      return () => ipcRenderer.removeListener('mindmap:progress', listener)
    }
  },

  quiz: {
    generate: (notebookId: string, options?: any) =>
      ipcRenderer.invoke('quiz:generate', { notebookId, options }),
    getLatest: (notebookId: string) => ipcRenderer.invoke('quiz:get-latest', { notebookId }),
    get: (quizId: string) => ipcRenderer.invoke('quiz:get', { quizId }),
    submitSession: (quizId: string, answers: Record<string, number>) =>
      ipcRenderer.invoke('quiz:submit-session', { quizId, answers }),
    getSession: (sessionId: string) => ipcRenderer.invoke('quiz:get-session', { sessionId }),
    update: (quizId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('quiz:update', { quizId, updates }),
    delete: (quizId: string) => ipcRenderer.invoke('quiz:delete', { quizId }),
    openWindow: (notebookId: string, quizId?: string) =>
      ipcRenderer.invoke('quiz:open-window', { notebookId, quizId }),
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('quiz:progress', listener)
      return () => ipcRenderer.removeListener('quiz:progress', listener)
    }
  },

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getState: () => ipcRenderer.invoke('update:get-state'),
    onStateChanged: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state)
      ipcRenderer.on('update:state-changed', listener)
      return () => ipcRenderer.removeListener('update:state-changed', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
