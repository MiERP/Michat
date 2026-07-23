import type { ChatCitation } from './chat'

export interface NotebookOverview {
  id: string
  notebookId: string
  content: string
  citations: ChatCitation[]
  sourceFingerprint: string
  status: 'fresh' | 'stale'
  model?: string | null
  createdAt: Date
  updatedAt: Date
}
