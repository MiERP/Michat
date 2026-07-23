import { describe, expect, it } from 'vitest'
import { filterRelevantEvidence } from '../../src/main/services/EvidenceRelevanceGate'

const result = (content: string, documentTitle = 'Tài liệu') => ({ content, documentTitle })

describe('filterRelevantEvidence', () => {
  it('rejects lexical false positives for out-of-scope Singapore tax', () => {
    expect(
      filterRelevantEvidence(
        'Mức thuế thu nhập doanh nghiệp tại Singapore năm 2025 là bao nhiêu?',
        [result('Điều 112A. Phản đối đơn đăng ký sở hữu công nghiệp.', 'Luật 07/2022/QH15')]
      )
    ).toEqual([])
  })

  it('keeps exact article evidence', () => {
    expect(
      filterRelevantEvidence('Điều 25A quy định ngoại lệ nào?', [
        result('Điều 25A. Các trường hợp ngoại lệ không xâm phạm quyền tác giả.')
      ])
    ).toHaveLength(1)
  })

  it('keeps document-number evidence from title', () => {
    expect(
      filterRelevantEvidence('Tóm tắt chính sách lao động trong Nghị định 103/2025/NĐ-CP', [
        result('Chính sách đối với người lao động.', '103_2025_ND-CP.pdf')
      ])
    ).toHaveLength(1)
  })

  it('does not reject exact document evidence because of answer instructions', () => {
    expect(
      filterRelevantEvidence(
        'Tóm tắt các chính sách chính của Nghị định 103/2025/NĐ-CP. Chỉ dùng evidence trong tài liệu và trích dẫn nguồn.',
        [result('Chính sách đối với người lao động.', '103_2025_ND-CP_658022.pdf')]
      )
    ).toHaveLength(1)
  })
})
