import { describe, expect, it } from 'vitest'
import { parseLegalStructure } from '../../src/main/services/LegalStructureService'
import {
  extractLegalMetadataFromDocument,
  mergeLegalMetadataInspector
} from '../../src/main/services/LegalMetadataExtractionService'

const DOCUMENT = `QUỐC HỘI
Số: 12/2026/QH15

CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Hà Nội, ngày 15 tháng 6 năm 2026

LUẬT THỬ NGHIỆM

Điều 1. Phạm vi điều chỉnh
Luật này quy định việc quản lý dữ liệu thử nghiệm trên lãnh thổ Việt Nam.

Điều 2. Đối tượng áp dụng
Cơ quan, tổ chức và cá nhân có liên quan.

Điều 30. Hiệu lực thi hành
Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2027 và thay thế Luật số 03/2020/QH14.`

const DATA_LAW_HEADER = `QUỐC HỘI
--------
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------
Luật số: 60/2024/QH15 Hà Nội, ngày 30 tháng 11 năm 2024
LUẬT
DỮ LIỆU
Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;
Quốc hội ban hành Luật Dữ liệu.
Chương I
QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
Luật này quy định về dữ liệu số.
Điều 2. Đối tượng áp dụng
Cơ quan, tổ chức, cá nhân có liên quan.
Điều 3. Giải thích từ ngữ
Quyết định xử lý dữ liệu là quyết định của cơ quan có thẩm quyền.`

const AMENDING_LAW = `QUỐC HỘI
--------
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------
Luật số: 07/2022/QH15 Hà Nội, ngày 16 tháng 6 năm 2022
LUẬT
SỬA ĐỔI, BỔ SUNG MỘT SỐ ĐIỀU CỦA LUẬT SỞ HỮU TRÍ TUỆ
Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;
Quốc hội ban hành Luật sửa đổi, bổ sung một số điều của Luật Sở hữu trí tuệ số 50/2005/QH11.
Điều 1. Sửa đổi, bổ sung một số điều của Luật Sở hữu trí tuệ
Nội dung sửa đổi.`

const TWO_LEVEL_ISSUER = `BỘ TÀI CHÍNH
TỔNG CỤC THUẾ
--------
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------
Quyết định số: 123/QĐ-TCT Hà Nội, ngày 10 tháng 3 năm 2026
QUYẾT ĐỊNH
BAN HÀNH QUY TRÌNH QUẢN LÝ DỮ LIỆU THUẾ
Căn cứ Luật Quản lý thuế;
Theo đề nghị của Vụ trưởng Vụ Công nghệ thông tin;
Tổng cục trưởng Tổng cục Thuế quyết định:
Điều 1. Ban hành kèm theo Quyết định này quy trình quản lý dữ liệu thuế.`

describe('LegalMetadataExtractionService', () => {
  it('extracts the six first-page legal header fields', () => {
    const result = extractLegalMetadataFromDocument({
      title: '07_2022_QH15.pdf',
      content: AMENDING_LAW,
      structure: parseLegalStructure(AMENDING_LAW)!
    })

    expect(result.legalDocument).toMatchObject({
      issuer: 'Quốc hội',
      documentNumber: '07/2022/QH15',
      documentType: 'Luật',
      issuedAt: '2022-06-16',
      documentTitle: 'SỬA ĐỔI, BỔ SUNG MỘT SỐ ĐIỀU CỦA LUẬT SỞ HỮU TRÍ TUỆ',
      legalBases: expect.stringContaining('Căn cứ Hiến pháp')
    })
    expect(result.legalDocument.legalBases).toContain('Quốc hội ban hành Luật sửa đổi')
    expect(result.inspector.fields.documentTitle?.evidence?.text).toBe(
      'SỬA ĐỔI, BỔ SUNG MỘT SỐ ĐIỀU CỦA LUẬT SỞ HỮU TRÍ TUỆ'
    )
  })

  it('keeps a two-level issuing authority in child/parent order', () => {
    const result = extractLegalMetadataFromDocument({
      title: '123_QD_TCT.pdf',
      content: TWO_LEVEL_ISSUER,
      structure: parseLegalStructure(TWO_LEVEL_ISSUER)!
    })

    expect(result.legalDocument).toMatchObject({
      issuer: 'Tổng cục Thuế / Bộ Tài chính',
      documentNumber: '123/QĐ-TCT',
      documentType: 'Quyết định',
      issuedAt: '2026-03-10',
      documentTitle: 'BAN HÀNH QUY TRÌNH QUẢN LÝ DỮ LIỆU THUẾ',
      legalBases: expect.stringContaining('Theo đề nghị của Vụ trưởng')
    })
  })

  it('prioritizes the legal heading and accepts a prefixed document number', () => {
    const result = extractLegalMetadataFromDocument({
      title: '60_2024_QH15_luật dữ liệu.pdf',
      content: DATA_LAW_HEADER,
      structure: parseLegalStructure(DATA_LAW_HEADER)!
    })

    expect(result.legalDocument).toMatchObject({
      documentNumber: '60/2024/QH15',
      documentType: 'Luật',
      issuer: 'Quốc hội',
      issuedAt: '2024-11-30',
      documentTitle: 'DỮ LIỆU',
      legalBases: expect.stringContaining('Quốc hội ban hành Luật Dữ liệu')
    })
    expect(result.inspector.fields.documentNumber?.evidence?.text).toContain(
      'Luật số: 60/2024/QH15'
    )
    expect(result.inspector.fields.documentType?.evidence?.text).toBe('LUẬT')
  })

  it('extracts intrinsic metadata with source evidence and leaves current status unknown', () => {
    const result = extractLegalMetadataFromDocument({
      title: 'Luật thử nghiệm',
      content: DOCUMENT,
      structure: parseLegalStructure(DOCUMENT)!
    })

    expect(result.legalDocument).toMatchObject({
      documentNumber: '12/2026/QH15',
      documentType: 'Luật',
      issuer: 'Quốc hội',
      issuedAt: '2026-06-15',
      effectiveFrom: '2027-01-01',
      status: 'unknown',
      scope: expect.stringContaining('quản lý dữ liệu thử nghiệm')
    })
    expect(result.inspector.fields.documentNumber).toMatchObject({
      value: '12/2026/QH15',
      status: 'extracted',
      confidence: 0.99,
      evidence: expect.objectContaining({ text: expect.stringContaining('Số: 12/2026/QH15') })
    })
    expect(result.inspector.fields.effectiveFrom?.evidence?.articleNumber).toBe('30')
    expect(result.inspector.declaredRelations).toEqual([
      expect.objectContaining({ type: 'replaces', targetDocumentNumber: '03/2020/QH14' })
    ])
  })

  it('preserves user-corrected fields when a document is reindexed', () => {
    const extracted = extractLegalMetadataFromDocument({
      title: 'Luật thử nghiệm',
      content: DOCUMENT,
      structure: parseLegalStructure(DOCUMENT)!
    }).inspector
    const merged = mergeLegalMetadataInspector(extracted, {
      ...extracted,
      fields: {
        ...extracted.fields,
        documentNumber: {
          value: '12A/2026/QH15',
          status: 'user_corrected',
          confidence: 1
        }
      }
    })

    expect(merged.fields.documentNumber).toEqual({
      value: '12A/2026/QH15',
      status: 'user_corrected',
      confidence: 1
    })
  })
})
