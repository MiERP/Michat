import { create } from 'zustand'
import type { ChatCitation } from '../../../shared/types/chat'

interface CitationContext {
  messageId: string
  citation: ChatCitation
  documentContent?: string
  highlightText?: string
  pageNumber?: number
  sourceUri?: string
}

interface CitationStore {
  selected: CitationContext | null
  isLoading: boolean
  setCitation: (messageId: string, citation: ChatCitation) => Promise<void>
  clearCitation: () => void
}

export const useCitationStore = create<CitationStore>((set) => ({
  selected: null,
  isLoading: false,

  setCitation: async (messageId: string, citation: ChatCitation) => {
    set({ isLoading: true })

    try {
      const document = await window.api.knowledge.getDocument(citation.documentId)
      if (!document) {
        set({ selected: null, isLoading: false })
        return
      }

      if (citation.pageNumber) {
        const page = await window.api.knowledge.getDocumentPage(
          citation.documentId,
          citation.pageNumber,
          citation.snippet
        )

        if (page) {
          set({
            selected: {
              messageId,
              citation,
              documentContent: page.content,
              highlightText: page.highlightText || citation.snippet,
              pageNumber: page.pageNumber,
              sourceUri: page.sourceUri
            },
            isLoading: false
          })
          return
        }
      }

      const chunks = (await window.api.knowledge.getDocumentChunks(citation.documentId)).sort(
        (a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0)
      )
      const currentIndex = chunks.findIndex((c) => c.id === citation.chunkId)

      let content = citation.snippet
      if (currentIndex >= 0) {
        const parts: string[] = []
        if (chunks[currentIndex - 1]?.content) parts.push(chunks[currentIndex - 1].content)
        if (chunks[currentIndex]?.content) parts.push(chunks[currentIndex].content)
        if (chunks[currentIndex + 1]?.content) parts.push(chunks[currentIndex + 1].content)
        if (parts.length > 0) {
          content = parts.join('\n...\n')
        }
      }

      set({
        selected: {
          messageId,
          citation,
          documentContent: content,
          highlightText: citation.snippet,
          pageNumber: citation.pageNumber,
          sourceUri: citation.sourceUri
        },
        isLoading: false
      })
    } catch {
      set({
        selected: {
          messageId,
          citation,
          documentContent: citation.snippet,
          highlightText: citation.snippet,
          pageNumber: citation.pageNumber,
          sourceUri: citation.sourceUri
        },
        isLoading: false
      })
    }
  },

  clearCitation: () => set({ selected: null, isLoading: false })
}))
