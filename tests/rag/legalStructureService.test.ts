import { describe, expect, it } from 'vitest'
import type { LegalModalityTag } from '../../src/shared/types/legalReasoning'
import {
  buildLegalDocumentProfile,
  getLegalContextAt,
  parseLegalStructure
} from '../../src/main/services/LegalStructureService'

const LAW_TEXT = `LUẬT DỮ LIỆU

CHƯƠNG I
QUY ĐỊNH CHUNG

Điều 1. Phạm vi điều chỉnh
Luật này quy định về dữ liệu.

Mục 1
NGUYÊN TẮC XỬ LÝ DỮ LIỆU

Điều 2. Nguyên tắc xử lý dữ liệu
Việc xử lý dữ liệu phải hợp pháp.

CHƯƠNG II
QUYỀN VÀ NGHĨA VỤ

Điều 3. Quyền của chủ thể dữ liệu
Chủ thể dữ liệu có quyền theo luật này.`

const CLAUSE_AND_POINT_TEXT = `Điều 15. Thời hạn nộp hồ sơ
1. Doanh nghiệp phải nộp hồ sơ trong 10 ngày.
a) Hồ sơ nộp trực tuyến được tiếp nhận ngay.
b) Hồ sơ thiếu thành phần phải được bổ sung.`

describe('LegalStructureService', () => {
  it('accepts modality evidence on chunk context', () => {
    const modalities: LegalModalityTag[] = [
      {
        type: 'obligation',
        confidence: 0.55,
        evidenceText: 'ph\u1ea3i',
        startOffset: 10,
        endOffset: 14
      }
    ]
    const context: import('../../src/main/services/LegalStructureService').LegalChunkContext = {
      articleNumber: '1',
      modalities
    }

    expect(context.modalities).toEqual(modalities)
  })

  it('parses Vietnamese legal headings and creates an exact profile', () => {
    const structure = parseLegalStructure(LAW_TEXT)

    expect(structure).toMatchObject({ chapterCount: 2, sectionCount: 1, articleCount: 3 })
    expect(structure?.chapters.map((chapter) => chapter.number)).toEqual(['I', 'II'])
    expect(structure?.articles.map((article) => article.number)).toEqual(['1', '2', '3'])

    const profile = buildLegalDocumentProfile('Luật Dữ liệu', structure!)
    expect(profile).toContain('Số chương: 2')
    expect(profile).toContain('Số mục: 1')
    expect(profile).toContain('Số điều: 3')
    expect(profile).toContain('Chương II: QUYỀN VÀ NGHĨA VỤ')
  })

  it('labels text with nearest chapter, section, and article', () => {
    const structure = parseLegalStructure(LAW_TEXT)!
    const offset = LAW_TEXT.indexOf('Việc xử lý dữ liệu phải hợp pháp')

    expect(getLegalContextAt(structure, offset)).toEqual({
      chapterNumber: 'I',
      chapterTitle: 'QUY ĐỊNH CHUNG',
      sectionNumber: '1',
      sectionTitle: 'NGUYÊN TẮC XỬ LÝ DỮ LIỆU',
      articleNumber: '2',
      articleTitle: 'Nguyên tắc xử lý dữ liệu'
    })
  })

  it('labels legal content with nearest clause and point', () => {
    const structure = parseLegalStructure(CLAUSE_AND_POINT_TEXT)!
    const offset = CLAUSE_AND_POINT_TEXT.indexOf('Hồ sơ thiếu thành phần')

    expect(getLegalContextAt(structure, offset)).toMatchObject({
      articleNumber: '15',
      clauseNumber: '1',
      pointNumber: 'b'
    })
  })
})
