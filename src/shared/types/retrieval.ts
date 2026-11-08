/**
 * A retrieval plan keeps user-imposed scope separate from hints inferred from
 * the question. Only the former may remove evidence from the result set.
 */
export type MetadataConstraintMode = 'hard' | 'preferred'

export interface MetadataConstraint {
  field: string
  values: string[]
  mode: MetadataConstraintMode
  source: 'user' | 'query-resolver'
  confidence: number
  reason: string
}

export interface RetrievalPlan {
  version: 1
  hardConstraints: MetadataConstraint[]
  preferredConstraints: MetadataConstraint[]
  /** Candidate documents identified by preferred metadata. They are a boost, never an exclusion. */
  preferredDocumentIds: string[]
}

export interface RetrievalTracePass {
  name: 'preferred' | 'broad'
  documentIds?: number
  returned: number
  elapsedMs: number
}

export interface RetrievalTrace {
  version: 1
  plan: RetrievalPlan
  passes: RetrievalTracePass[]
  fallbackUsed: boolean
  returned: number
}

export interface MetadataAwareSearchResult<T> {
  results: T[]
  trace: RetrievalTrace
}
