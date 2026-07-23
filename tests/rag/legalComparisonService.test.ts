import { describe, expect, it } from 'vitest'
import {
  LegalComparisonService,
  buildCanonicalVariantAnswer,
  buildLegalComparisonContext,
  buildLegalDocumentMetadata,
  getCanonicalLegalWorkKey,
  isLegalApplicabilityQuery,
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
    expect(
      isLegalComparisonQuery(
        'Luật số 07/2022/QH15 và Luật số 24/2018/QH14 có quan hệ sửa đổi, thay thế hoặc viện dẫn trực tiếp nhau không?'
      )
    ).toBe(true)
    expect(isLegalComparisonQuery('Điều 15 quy định gì?')).toBe(false)
    expect(
      isLegalApplicabilityQuery('V\u0103n b\u1ea3n n\u00e0o \u01b0u ti\u00ean \u00e1p d\u1ee5ng?')
    ).toBe(true)
  })

  it('builds evidence rows per document and resolves verified replacement by time', () => {
    const result = new LegalComparisonService().compare(
      'Văn bản nào áp dụng ngày 01/06/2026?',
      evidence
    )

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

  it('refuses to claim current validity when the user provides no as-of date', () => {
    const result = new LegalComparisonService().compare('Văn bản nào đang có hiệu lực?', evidence)

    expect(result.resolution).toMatchObject({
      status: 'needs_user_facts',
      reason: expect.stringContaining('ngày cần đối chiếu')
    })
  })

  it('refuses priority when document status or effective date is unverified', () => {
    const result = new LegalComparisonService().compare('Văn bản nào áp dụng ngày 01/06/2026?', [
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

  it('does not require effectivity metadata when only checking whether a relation exists', () => {
    const result = new LegalComparisonService().compare(
      'Hai luật có quan hệ sửa đổi, thay thế hoặc viện dẫn trực tiếp nhau không?',
      [
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
      ]
    )

    expect(result.resolution.status).toBe('insufficient_evidence')
    expect(result.resolution.reason).toContain('viện dẫn trực tiếp')
    expect(result.rows).toEqual([])
    expect(result.limitations).not.toContain('Metadata hiệu lực chưa đầy đủ hoặc chưa xác minh.')
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

  it('builds compact context that preserves evidence from both documents', () => {
    const result = new LegalComparisonService().compare('So sánh phạm vi điều chỉnh', [
      { ...evidence[0], content: `Phạm vi luật A. ${'A'.repeat(1200)}` },
      { ...evidence[1], content: `Phạm vi luật B. ${'B'.repeat(1200)}` }
    ])
    const context = buildLegalComparisonContext(result, {
      compact: true,
      maxEvidenceCharsPerItem: 280,
      maxEvidenceItems: 4
    })

    expect(context).toContain('Luật A')
    expect(context).toContain('Luật B')
    expect(context.length).toBeLessThan(2000)
  })

  it('derives one canonical legal work key for DOCX and PDF variants', () => {
    const metadata = buildLegalDocumentMetadata({
      documentNumber: '07/2022/QH15',
      documentType: 'Luật',
      issuer: 'Quốc hội'
    })

    expect(getCanonicalLegalWorkKey(metadata)).toBe('luật:07/2022/QH15')
  })

  it('does not create a conflict between two physical copies of one legal work', () => {
    const sameLaw = buildLegalDocumentMetadata({
      documentNumber: '07/2022/QH15',
      documentType: 'Luật',
      issuer: 'Quốc hội',
      status: 'unknown'
    })
    const result = new LegalComparisonService().compare('So sánh hai tài liệu', [
      {
        ...evidence[0],
        documentId: 'law-docx',
        documentTitle: '07_2022_QH15.docx',
        content: 'Điều 15. Chủ thể có quyền yêu cầu xử lý dữ liệu.',
        metadata: sameLaw
      },
      {
        ...evidence[1],
        documentId: 'law-pdf',
        documentTitle: '07_2022_QH15.pdf',
        content: 'Điều 15. Chủ thể có quyền yêu cầu xử lý dữ liệu trong thời hạn 10 ngày.',
        metadata: sameLaw
      }
    ])

    expect(result.evidenceByDocument).toHaveLength(1)
    expect(result.rows).toEqual([])
    expect(result.limitations).not.toContain('Metadata hiệu lực chưa đầy đủ hoặc chưa xác minh.')
    expect(result.resolution).toMatchObject({
      status: 'resolved',
      reason: expect.stringContaining('cùng một văn bản pháp luật')
    })
    expect(buildCanonicalVariantAnswer(result)).toBe(
      'Hai file là các bản sao/biến thể nguồn của cùng một văn bản pháp luật: Luật số 07/2022/QH15; không phải hai văn bản pháp luật khác nhau và không tạo xung đột pháp lý giữa các bản sao [1], [2].'
    )
  })
})
