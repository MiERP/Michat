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

function createService(
  status: 'ready' | 'pending' | 'processing' | 'retry' | 'failed' | 'unavailable' = 'ready',
  relationCount = status === 'ready' ? 2 : 0
) {
  const repository = {
    getDocumentGraphStatus: vi.fn(() => ({
      status,
      attempts: 0,
      sourceUnitCount: 1,
      processedUnitCount: status === 'ready' ? 1 : 0,
      nodeCount: 3,
      relationCount
    })),
    getDocumentGraph: vi.fn(() => ({
      nodes: [
        { id: 'article-15', chunkId: 'chunk-1', articleNumber: '15' },
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

  it('seeds traversal by legal coordinates when retrieval chunk differs from graph chunk', () => {
    const { repository, service } = createService()

    service.reason('Điều 15 quy định chế tài nào?', [seed({ chunkId: 'retrieval-chunk' })])

    expect(repository.traverse).toHaveBeenCalledWith(
      expect.objectContaining({ seedNodeIds: ['article-15'] })
    )
  })

  it('returns pending limitation instead of fabricated path', () => {
    const { repository, service } = createService('pending')
    const result = service.reason('Ngh\u0129a v\u1ee5 l\u00e0 g\u00ec?', [seed()])

    expect(result).toMatchObject({ graphStatus: 'pending', paths: [] })
    expect(result.limitations).not.toHaveLength(0)
    expect(repository.traverse).not.toHaveBeenCalled()
  })

  it('uses existing verified graph while a version refresh is pending', () => {
    const { repository, service } = createService('retry', 2)
    const result = service.reason(
      'Doanh nghi\u1ec7p b\u1ecb x\u1eed l\u00fd th\u1ebf n\u00e0o n\u1ebfu kh\u00f4ng n\u1ed9p h\u1ed3 s\u01a1?',
      [seed()]
    )

    expect(result.graphStatus).toBe('ready')
    expect(result.paths).toHaveLength(1)
    expect(result.limitations).toContain(
      'Legal graph refresh is pending; existing verified graph remains in use.'
    )
    expect(repository.traverse).toHaveBeenCalledOnce()
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
    expect(result.comparison?.resolution.status).toBe('needs_user_facts')
  })

  it('hides comparison paths contained within one canonical legal work', () => {
    const lawAMetadata = buildLegalDocumentMetadata({
      documentNumber: '07/2022/QH15',
      documentType: 'Luật',
      status: 'unknown'
    })
    const lawBMetadata = buildLegalDocumentMetadata({
      documentNumber: '24/2018/QH14',
      documentType: 'Luật',
      status: 'unknown'
    })
    const repository = {
      getDocumentGraphStatus: vi.fn(() => ({
        status: 'ready',
        attempts: 0,
        sourceUnitCount: 1,
        processedUnitCount: 1,
        nodeCount: 2,
        relationCount: 1
      })),
      getDocumentGraph: vi.fn((documentId: string) => ({
        nodes:
          documentId === 'law-a'
            ? [
                { id: 'law-a-clause', documentId: 'law-a', chunkId: 'chunk-a', articleNumber: '26' },
                { id: 'law-a-article', documentId: 'law-a', chunkId: 'chunk-a', articleNumber: '16' }
              ]
            : [{ id: 'law-b-document', documentId: 'law-b', chunkId: 'chunk-b' }],
        relations: []
      })),
      traverse: vi.fn(() => [
        {
          score: 1,
          nodeIds: ['law-a-clause', 'law-a-article'],
          steps: [
            {
              relationId: 'law-a-reference',
              relationType: 'references',
              sourceNodeId: 'law-a-clause',
              sourceLabel: 'Khoản 2, Điều 26',
              targetNodeId: 'law-a-article',
              targetLabel: 'Điều 16',
              confidence: 1,
              evidenceChunkId: 'chunk-a',
              evidenceText: 'Điều 16',
              evidenceStartOffset: 0,
              evidenceEndOffset: 7,
              direction: 'outbound'
            }
          ]
        }
      ])
    }
    const service = new LegalReasoningService(repository as never, () => [], new LegalComparisonService())
    const result = service.reason(
      'Luật số 07/2022/QH15 và Luật số 24/2018/QH14 có quan hệ sửa đổi, thay thế hoặc viện dẫn trực tiếp nhau không?',
      [
        seed({
          documentId: 'law-a',
          documentTitle: 'Luật 07/2022/QH15',
          chunkId: 'chunk-a',
          citationId: 1,
          content: 'Khoản 2, Điều 26 viện dẫn Điều 16.',
          metadata: lawAMetadata,
          legalContext: { articleNumber: '26' }
        }),
        seed({
          documentId: 'law-b',
          documentTitle: 'Luật 24/2018/QH14',
          chunkId: 'chunk-b',
          citationId: 2,
          content: 'Điều 1. Phạm vi điều chỉnh.',
          metadata: lawBMetadata,
          legalContext: { articleNumber: '1' }
        })
      ]
    )

    expect(result.intent).toBe('comparison')
    expect(result.graphStatus).toBe('ready')
    expect(result.paths).toEqual([])
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
