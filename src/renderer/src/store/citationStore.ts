import { create } from 'zustand'
import type { ChatCitation } from '../../../shared/types/chat'

interface CitationContext {
  messageId: string
  citation: ChatCitation
  documentContent?: string
  prevContent?: string
  chunkContent?: string
  nextContent?: string
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

      const prevContent = currentIndex >= 0 ? chunks[currentIndex - 1]?.content : undefined
      const chunkContent = currentIndex >= 0 ? chunks[currentIndex]?.content : undefined
      const nextContent = currentIndex >= 0 ? chunks[currentIndex + 1]?.content : undefined

      const parts = [prevContent, chunkContent, nextContent].filter(
        (part): part is string => !!part
      )
      const documentContent = parts.join('\n...\n')

      set({
        selected: {
          messageId,
          citation,
          documentContent,
          prevContent,
          chunkContent,
          nextContent,
          highlightText: chunkContent || citation.snippet,
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
