import { describe, expect, it } from 'vitest'
import {
  LegalComparisonService,
  buildLegalDocumentMetadata,
  isLegalComparisonQuery,
  validateComparisonCitations,
  type LegalComparisonEvidence
} from '../../src/main/services/LegalComparisonService'

const lawA = buildLegalDocumentMetadata({
  documentNumber: '01/2024/QH15',
  documentType: 'law',
  issuer: 'Quốc hội',
  effectiveFrom: '2024-01-01',
  status: 'effective',
  verifiedAt: '2026-07-21'
})

const lawB = buildLegalDocumentMetadata({
  documentNumber: '02/2025/QH15',
  documentType: 'law',
  issuer: 'Quốc hội',
  effectiveFrom: '2025-01-01',
  status: 'effective',
  verifiedAt: '2026-07-21',
  replacesDocumentIds: ['law-a']
})

const evidence: LegalComparisonEvidence[] = [
  {
    citationId: 1,
    documentId: 'law-a',
    documentTitle: 'Luật A',
    chunkId: 'chunk-a',
    chunkIndex: 2,
    score: 0.91,
    content: 'Điều 15. Doanh nghiệp phải nộp hồ sơ trong 10 ngày.',
    legalContext: { articleNumber: '15', articleTitle: 'Thời hạn nộp hồ sơ' },
    metadata: lawA
  },
  {
    citationId: 2,
    documentId: 'law-b',
    documentTitle: 'Luật B',
    chunkId: 'chunk-b',
    chunkIndex: 3,
    score: 0.89,
    content: 'Điều 15. Doanh nghiệp phải nộp hồ sơ trong 15 ngày.',
    legalContext: { articleNumber: '15', articleTitle: 'Thời hạn nộp hồ sơ' },
    metadata: lawB
  }
]

describe('LegalComparisonService', () => {
  it('detects Vietnamese comparison and applicability questions', () => {
    expect(isLegalComparisonQuery('So sánh quy định của hai luật này')).toBe(true)
    expect(isLegalComparisonQuery('Văn bản nào được áp dụng khi có khác nhau?')).toBe(true)
    expect(isLegalComparisonQuery('Điều 15 quy định gì?')).toBe(false)
  })

  it('builds evidence rows per document and resolves verified replacement by time', () => {
    const result = new LegalComparisonService().compare('Văn bản nào áp dụng?', evidence)

    expect(result.mode).toBe('compare')
    expect(result.evidenceByDocument).toHaveLength(2)
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'temporal_change', citationIds: [1, 2] })
      ])
    )
    expect(result.resolution).toMatchObject({
      status: 'resolved',
      preferredDocumentId: 'law-b',
      citationIds: [1, 2]
    })
  })

  it('refuses priority when document status or effective date is unverified', () => {
    const result = new LegalComparisonService().compare('Văn bản nào áp dụng?', [
      evidence[0],
      {
        ...evidence[1],
        metadata: buildLegalDocumentMetadata({
          documentNumber: '02/2025/QH15',
          documentType: 'law',
          issuer: 'Quốc hội',
          status: 'unknown'
        })
      }
    ])

    expect(result.resolution).toMatchObject({
      status: 'needs_metadata',
      requiredMetadata: expect.arrayContaining(['effectiveFrom', 'status'])
    })
  })

  it('rejects model citations outside retrieved evidence', () => {
    expect(validateComparisonCitations('Kết luận [1] và [3].', [1, 2])).toEqual({
      valid: false,
      invalidCitationIds: [3]
    })
    expect(validateComparisonCitations('Kết luận [1] và [2].', [1, 2])).toEqual({
      valid: true,
      invalidCitationIds: []
    })
  })
})
