import { describe, expect, it } from 'vitest'
import {
  extractDocumentMetadata,
  mergeDocumentMetadataInspector
} from '../../src/main/services/DocumentMetadataExtractionService'

const DOCUMENT = `CHÍNH PHỦ
Số: 99/2025/NĐ-CP

CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Hà Nội, ngày 06 tháng 05 năm 2025

NGHỊ ĐỊNH
QUY ĐỊNH CHI TIẾT MỘT SỐ ĐIỀU CỦA LUẬT CÔNG NGHIỆP QUỐC PHÒNG, AN NINH VÀ ĐỘNG VIÊN CÔNG NGHIỆP

Căn cứ Luật Tổ chức Chính phủ ngày 18 tháng 02 năm 2025;
Căn cứ Luật Công nghiệp quốc phòng, an ninh và động viên công nghiệp ngày 27 tháng 6 năm 2024;
Theo đề nghị của Bộ trưởng Bộ Quốc phòng;`

const FLATTENED_LAW =
  'QUỐC HỘI -------- CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Độc lập - Tự do - Hạnh phúc --------------- Luật số: 38/2024/QH15 Hà Nội, ngày 27 tháng 6 năm 2024 LUẬT CÔNG NGHIỆP QUỐC PHÒNG, AN NINH VÀ ĐỘNG VIÊN CÔNG NGHIỆP Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam; Quốc hội ban hành Luật Công nghiệp quốc phòng, an ninh và động viên công nghiệp. Chương I NHỮNG QUY ĐỊNH CHUNG'

describe('DocumentMetadataExtractionService', () => {
  it('extracts six document metadata fields', () => {
    const result = extractDocumentMetadata({
      title: '99_2025_ND-CP_655856.doc',
      content: DOCUMENT
    })

    expect(result.metadata).toMatchObject({
      documentNumber: '99/2025/NĐ-CP',
      documentType: 'Nghị định',
      issuer: 'Chính phủ',
      issuedAt: '2025-05-06',
      documentTitle:
        'QUY ĐỊNH CHI TIẾT MỘT SỐ ĐIỀU CỦA LUẬT CÔNG NGHIỆP QUỐC PHÒNG, AN NINH VÀ ĐỘNG VIÊN CÔNG NGHIỆP',
      legalBases:
        'Căn cứ Luật Tổ chức Chính phủ ngày 18 tháng 02 năm 2025;\nCăn cứ Luật Công nghiệp quốc phòng, an ninh và động viên công nghiệp ngày 27 tháng 6 năm 2024;'
    })
    expect(result.inspector.fields.documentNumber).toMatchObject({
      value: '99/2025/NĐ-CP',
      confidence: 0.99,
      status: 'extracted'
    })
  })

  it('preserves user-corrected fields during reindex', () => {
    const extracted = extractDocumentMetadata({
      title: 'document.doc',
      content: DOCUMENT
    }).inspector
    const merged = mergeDocumentMetadataInspector(extracted, {
      ...extracted,
      fields: {
        ...extracted.fields,
        issuer: { value: 'Văn phòng Chính phủ', confidence: 1, status: 'user_corrected' }
      }
    })

    expect(merged.fields.issuer).toEqual({
      value: 'Văn phòng Chính phủ',
      confidence: 1,
      status: 'user_corrected'
    })
  })

  it('extracts metadata from a flattened PDF header', () => {
    const result = extractDocumentMetadata({
      title: '38_2024_QH15_555033.pdf',
      content: FLATTENED_LAW
    })

    expect(result.metadata).toMatchObject({
      documentNumber: '38/2024/QH15',
      documentType: 'Luật',
      issuer: 'Quốc hội',
      issuedAt: '2024-06-27',
      documentTitle: 'CÔNG NGHIỆP QUỐC PHÒNG, AN NINH VÀ ĐỘNG VIÊN CÔNG NGHIỆP',
      legalBases: 'Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;'
    })
  })
})
