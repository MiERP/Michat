import type { LegalComparisonResult } from '../../main/services/LegalComparisonService'

export const LEGAL_NODE_TYPES = [
  'document',
  'article',
  'clause',
  'point',
  'subject',
  'action',
  'concept',
  'sanction',
  'external_reference'
] as const

export const LEGAL_RELATION_TYPES = [
  'references',
  'defines',
  'applies_to',
  'requires',
  'permits',
  'prohibits',
  'exception_to',
  'condition_for',
  'sanction_for',
  'amends',
  'replaces',
  'repeals'
] as const

export const LEGAL_JOB_STATUSES = ['pending', 'processing', 'retry', 'ready', 'failed'] as const
export const LEGAL_MODALITIES = ['obligation', 'permission', 'prohibition'] as const

export type LegalNodeType = (typeof LEGAL_NODE_TYPES)[number]
export type LegalRelationType = (typeof LEGAL_RELATION_TYPES)[number]
export type LegalGraphJobStatus = (typeof LEGAL_JOB_STATUSES)[number]
export type LegalModality = (typeof LEGAL_MODALITIES)[number]

export interface LegalModalityTag {
  type: LegalModality
  confidence: number
  evidenceText: string
  startOffset: number
  endOffset: number
}

export interface LegalReasoningEvidence {
  citationId?: number
  notebookId: string
  documentId: string
  documentTitle: string
  chunkId: string
  chunkIndex: number
  content: string
  score: number
}

export interface LegalReasoningStep {
  relationId: string
  relationType: LegalRelationType
  sourceNodeId: string
  sourceLabel: string
  targetNodeId: string
  targetLabel: string
  confidence: number
  citationIds: number[]
}

export interface LegalReasoningPath {
  score: number
  minimumConfidence: number
  steps: LegalReasoningStep[]
}

export type LegalReasoningIntent =
  | 'lookup'
  | 'obligation'
  | 'permission'
  | 'prohibition'
  | 'sanction'
  | 'definition'
  | 'condition'
  | 'exception'
  | 'comparison'
  | 'applicability'
  | 'general'

export interface LegalReasoningResult {
  intent: LegalReasoningIntent
  graphStatus: 'ready' | 'pending' | 'failed' | 'unavailable'
  paths: LegalReasoningPath[]
  limitations: string[]
  evidence?: LegalReasoningEvidence[]
  context?: string
  comparison?: LegalComparisonResult
}

export interface LegalGraphDocumentStatus {
  status: LegalGraphJobStatus | 'unavailable'
  attempts: number
  sourceUnitCount: number
  processedUnitCount: number
  nodeCount: number
  relationCount: number
  model?: string
  extractorVersion?: string
  promptVersion?: string
  ontologyVersion?: string
  nextRunAt?: string
  lastError?: string
}

export interface LegalGraphProgress extends LegalGraphDocumentStatus {
  documentId: string
}
