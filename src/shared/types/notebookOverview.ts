export interface NotebookOverview {
  id: string
  notebookId: string
  content: string
  sourceFingerprint: string
  status: 'fresh' | 'stale'
  model?: string | null
  createdAt: Date
  updatedAt: Date
}
