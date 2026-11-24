/**
 * Knowledge Store
 * Knowledge base state management
 */

import { create } from 'zustand'
import type {
  KnowledgeDocument,
  KnowledgeSearchResult,
  IndexProgress,
  KnowledgeStats,
  AddDocumentOptions,
  SearchOptions
} from '../../../shared/types/knowledge'
import { useCitationStore } from './citationStore'

interface KnowledgeStore {
  // State
  documents: KnowledgeDocument[]
  searchResults: KnowledgeSearchResult[]
  stats: KnowledgeStats | null
  isLoading: boolean
  isSearching: boolean
  isIndexing: boolean
  indexProgress: IndexProgress | null
  error: string | null
  /** Tài liệu đang được người dùng xem (chọn ở cột trái) — hiển thị tóm tắt trong khung chat. */
  inspectedDocumentId: string | null

  // Actions
  setDocuments: (docs: KnowledgeDocument[]) => void
  setSearchResults: (results: KnowledgeSearchResult[]) => void
  setStats: (stats: KnowledgeStats | null) => void
  setIsLoading: (value: boolean) => void
  setIsSearching: (value: boolean) => void
  setIsIndexing: (value: boolean) => void
  setIndexProgress: (progress: IndexProgress | null) => void
  setError: (error: string | null) => void
  setInspectedDocumentId: (documentId: string | null) => void
  clearSearchResults: () => void

  // Async operations
  loadDocuments: (notebookId: string) => Promise<void>
  loadStats: (notebookId: string) => Promise<void>
  addDocument: (
    notebookId: string,
    options: AddDocumentOptions
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  addDocumentFromFile: (
    notebookId: string,
    filePath: string
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  addDocumentFromUrl: (
    notebookId: string,
    url: string
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  addDocumentsFromFolder: (
    notebookId: string,
    folderPath: string
  ) => Promise<{
    success: boolean
    result?: {
      totalFiles: number
      indexedFiles: number
      failedFiles: Array<{ filePath: string; error: string }>
    }
    error?: string
  }>
  addNoteToKnowledge: (
    notebookId: string,
    noteId: string
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  search: (notebookId: string, query: string, options?: SearchOptions) => Promise<void>
  deleteDocument: (
    notebookId: string,
    documentId: string
  ) => Promise<{ success: boolean; error?: string }>
  selectFiles: () => Promise<string[]>
  selectFolder: () => Promise<string | null>
}

export const useKnowledgeStore = create<KnowledgeStore>()((set, get) => ({
  // Initial state
  documents: [],
  searchResults: [],
  stats: null,
  isLoading: false,
  isSearching: false,
  isIndexing: false,
  indexProgress: null,
  error: null,
  inspectedDocumentId: null,

  // Setters
  setDocuments: (documents) => set({ documents }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setStats: (stats) => set({ stats }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
  setIndexProgress: (indexProgress) => set({ indexProgress }),
  setError: (error) => set({ error }),
  setInspectedDocumentId: (inspectedDocumentId) => set({ inspectedDocumentId }),
  clearSearchResults: () => set({ searchResults: [] }),

  // Load the document list
  loadDocuments: async (notebookId) => {
    set({ isLoading: true, error: null })
    try {
      const docs = await window.api.knowledge.getDocuments(notebookId)
      set({ documents: docs, isLoading: false })
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
    }
  },

  // Load statistics
  loadStats: async (notebookId) => {
    try {
      const stats = await window.api.knowledge.getStats(notebookId)
      set({ stats })
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  },

  // Add a document
  addDocument: async (notebookId, options) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocument(notebookId, options)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // Add a document from a file
  addDocumentFromFile: async (notebookId, filePath) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentFromFile(notebookId, filePath)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  addDocumentFromUrl: async (notebookId, url) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentFromUrl(notebookId, url)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // Add documents from a folder in bulk
  addDocumentsFromFolder: async (notebookId, folderPath) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentsFromFolder(notebookId, folderPath)
      await get().loadDocuments(notebookId)
      await get().loadStats(notebookId)
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // Add a note to the knowledge base
  addNoteToKnowledge: async (notebookId, noteId) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addNote(notebookId, noteId)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // Search
  search: async (notebookId, query, options) => {
    if (!query.trim()) {
      set({ searchResults: [] })
      return
    }

    set({ isSearching: true, error: null })
    try {
      const result = await window.api.knowledge.search(notebookId, query, options)
      if (result.success) {
        set({ searchResults: result.results, isSearching: false })
      } else {
        set({ searchResults: [], isSearching: false, error: result.error })
      }
    } catch (error) {
      set({ searchResults: [], isSearching: false, error: (error as Error).message })
    }
  },

  // Delete a document
  deleteDocument: async (notebookId, documentId) => {
    try {
      const result = await window.api.knowledge.deleteDocument(documentId)
      if (result.success) {
        const selectedCitation = useCitationStore.getState().selected
        if (selectedCitation?.citation.documentId === documentId) {
          useCitationStore.getState().clearCitation()
        }

        set((state) => ({
          documents: state.documents.filter((d) => d.id !== documentId)
        }))
        await get().loadStats(notebookId)
      }
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  },

  // Select files
  selectFiles: async () => {
    try {
      return await window.api.knowledge.selectFiles()
    } catch (error) {
      console.error('Failed to select files:', error)
      return []
    }
  },

  // Select a folder
  selectFolder: async () => {
    try {
      return await window.api.knowledge.selectFolder()
    } catch (error) {
      console.error('Failed to select folder:', error)
      return null
    }
  }
}))

/**
 * Set up knowledge base listeners
 */
export function setupKnowledgeListeners(): () => void {
  const cleanupProgress = window.api.knowledge.onIndexProgress((data: IndexProgress) => {
    useKnowledgeStore.getState().setIndexProgress(data)
  })

  return () => {
    cleanupProgress()
  }
}
