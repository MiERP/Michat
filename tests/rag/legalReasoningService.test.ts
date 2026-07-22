import { describe, expect, it, vi } from 'vitest'
import {
  LegalComparisonService,
  buildLegalDocumentMetadata
} from '../../src/main/services/LegalComparisonService'
import {
  LegalReasoningService,
  classifyLegalReasoningIntent,
  type LegalReasoningEvidence,
  type LegalReasoningSeed
} from '../../src/main/services/legalGraph/LegalReasoningService'

const metadata = buildLegalDocumentMetadata({ status: 'unknown' })

function seed(overrides: Partial<LegalReasoningSeed> = {}): LegalReasoningSeed {
  return {
    notebookId: 'notebook-1',
    citationId: 1,
    documentId: 'document-1',
    documentTitle: 'Deadline law',
    chunkId: 'chunk-1',
    chunkIndex: 0,
    score: 0.95,
    content: 'Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1.',
    legalContext: { articleNumber: '15' },
    metadata,
    ...overrides
  }
}

function createService(status: 'ready' | 'pending' | 'failed' | 'unavailable' = 'ready') {
  const repository = {
    getDocumentGraphStatus: vi.fn(() => ({
      status,
      attempts: 0,
      sourceUnitCount: 1,
      processedUnitCount: status === 'ready' ? 1 : 0,
      nodeCount: 3,
      relationCount: 2
    })),
    getDocumentGraph: vi.fn(() => ({
      nodes: [
        { id: 'article-15', chunkId: 'chunk-1' },
        { id: 'action-file', chunkId: 'chunk-1' },
        { id: 'sanction-late', chunkId: 'chunk-2' }
      ],
      relations: []
    })),
    traverse: vi.fn(() => [
      {
        score: 0.81,
        nodeIds: ['article-15', 'action-file', 'sanction-late'],
        steps: [
          {
            relationId: 'relation-1',
            relationType: 'requires',
            sourceNodeId: 'article-15',
            sourceLabel: 'Article 15',
            targetNodeId: 'action-file',
            targetLabel: 'File dossier',
            confidence: 0.9,
            evidenceChunkId: 'chunk-1',
            evidenceText: 'ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1',
            evidenceStartOffset: 17,
            evidenceEndOffset: 31,
            direction: 'outbound'
          },
          {
            relationId: 'relation-2',
            relationType: 'sanction_for',
            sourceNodeId: 'action-file',
            sourceLabel: 'File dossier',
            targetNodeId: 'sanction-late',
            targetLabel: 'Late filing sanction',
            confidence: 0.88,
            evidenceChunkId: 'chunk-2',
            evidenceText: 'ph\u1ea1t ti\u1ec1n',
            evidenceStartOffset: 100,
            evidenceEndOffset: 109,
            direction: 'outbound'
          }
        ]
      }
    ])
  }
  const evidence = new Map<string, LegalReasoningEvidence>([
    [
      'chunk-1',
      {
        notebookId: 'notebook-1',
        documentId: 'document-1',
        documentTitle: 'Deadline law',
        chunkId: 'chunk-1',
        chunkIndex: 0,
        content: 'Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1.',
        score: 0.95
      }
    ],
    [
      'chunk-2',
      {
        notebookId: 'notebook-1',
        documentId: 'document-1',
        documentTitle: 'Deadline law',
        chunkId: 'chunk-2',
        chunkIndex: 1,
        content: 'Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb ph\u1ea1t ti\u1ec1n.',
        score: 0.8
      }
    ]
  ])
  const service = new LegalReasoningService(
    repository as never,
    (_notebookId, chunkIds) => chunkIds.flatMap((chunkId) => evidence.get(chunkId) ?? []),
    new LegalComparisonService()
  )
  return { repository, service }
}

describe('LegalReasoningService', () => {
  it('classifies Vietnamese legal intents deterministically', () => {
    expect(classifyLegalReasoningIntent('B\u1ecb x\u1eed ph\u1ea1t th\u1ebf n\u00e0o?')).toBe(
      'sanction'
    )
    expect(classifyLegalReasoningIntent('Ch\u1ee7 th\u1ec3 c\u00f3 quy\u1ec1n g\u00ec?')).toBe(
      'permission'
    )
    expect(
      classifyLegalReasoningIntent(
        'Tr\u01b0\u1eddng h\u1ee3p n\u00e0o kh\u00f4ng \u0111\u01b0\u1ee3c l\u00e0m?'
      )
    ).toBe('prohibition')
    expect(classifyLegalReasoningIntent('Kh\u00e1i ni\u1ec7m n\u00e0y l\u00e0 g\u00ec?')).toBe(
      'definition'
    )
  })

  it('builds obligation to sanction path from seed evidence', () => {
    const { service } = createService()
    const result = service.reason(
      'Doanh nghi\u1ec7p b\u1ecb x\u1eed l\u00fd th\u1ebf n\u00e0o n\u1ebfu kh\u00f4ng n\u1ed9p h\u1ed3 s\u01a1?',
      [seed()]
    )

    expect(result.intent).toBe('sanction')
    expect(result.paths[0].steps.map((step) => step.relationType)).toEqual([
      'requires',
      'sanction_for'
    ])
    expect(result.paths[0].steps.map((step) => step.citationIds)).toEqual([[1], [2]])
    expect(result.context).toContain('[1] Article 15 --requires--> File dossier')
    expect(result.context).toContain('[2] File dossier --sanction_for--> Late filing sanction')
  })

  it('returns pending limitation instead of fabricated path', () => {
    const { repository, service } = createService('pending')
    const result = service.reason('Ngh\u0129a v\u1ee5 l\u00e0 g\u00ec?', [seed()])

    expect(result).toMatchObject({ graphStatus: 'pending', paths: [] })
    expect(result.limitations).not.toHaveLength(0)
    expect(repository.traverse).not.toHaveBeenCalled()
  })

  it('keeps comparison compatibility and refuses unverified priority', () => {
    const { service } = createService('unavailable')
    const comparisonSeeds: LegalReasoningSeed[] = [
      seed({ documentId: 'law-a', chunkId: 'chunk-a', citationId: 1 }),
      seed({ documentId: 'law-b', chunkId: 'chunk-b', citationId: 2 })
    ]
    const result = service.reason(
      'V\u0103n b\u1ea3n n\u00e0o \u01b0u ti\u00ean \u00e1p d\u1ee5ng?',
      comparisonSeeds
    )

    expect(result.intent).toBe('applicability')
    expect(result.comparison?.resolution.status).toBe('needs_metadata')
  })

  it('rejects paths whose evidence chunk cannot be validated', () => {
    const { repository } = createService()
    const broken = new LegalReasoningService(
      repository as never,
      () => [],
      new LegalComparisonService()
    )

    expect(broken.reason('B\u1ecb ph\u1ea1t th\u1ebf n\u00e0o?', [seed()]).paths).toEqual([])
  })
})
