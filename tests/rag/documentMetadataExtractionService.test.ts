import { describe, expect, it } from 'vitest'
import {
  extractDocumentMetadata,
  isOriginalLegalDocument,
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

const ANALYSIS_REPORT = `BÁO CÁO PHÂN TÍCH CHUYÊN SÂU: Nghị quyết số 08-NQ/TW về Đẩy mạnh
phát triển Công nghiệp Quốc phòng đến năm 2030 và những năm tiếp theo
Lời Mở đầu: Tầm vóc Chiến lược của Nghị quyết 08-NQ/TW
Nghị quyết số 08-NQ/TW, được Bộ Chính trị khóa XIII ban hành ngày 26 tháng 01
năm 2022 về "Đẩy mạnh phát triển công nghiệp quốc phòng đến năm 2030 và những
năm tiếp theo", là một văn kiện có ý nghĩa chiến lược đặc biệt quan trọng.`

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

  it('does not display legal metadata for a report about a resolution', () => {
    const result = extractDocumentMetadata({
      title: 'Nghị quyết 08-NQ_TW_ Công nghiệp quốc phòng.pdf',
      content: ANALYSIS_REPORT
    })

    expect(isOriginalLegalDocument(ANALYSIS_REPORT)).toBe(false)
    expect(result.metadata).toEqual({})
  })

  it('does not borrow a date from a report with conflicting resolution references', () => {
    const result = extractDocumentMetadata({
      title: 'Phân tích Nghị quyết 15_NQ-CP.pdf',
      content:
        'BÁO CÁO PHÂN TÍCH CHUYÊN SÂU: CHƯƠNG TRÌNH HÀNH ĐỘNG CỦA CHÍNH PHỦ\n' +
        'Yêu cầu nghiên cứu ban đầu đề cập đến Nghị quyết số 15/NQ-CP ngày 07/02/2023. ' +
        'Văn bản khớp nội dung là Nghị quyết số 14/NQ-CP ngày 08/02/2023.'
    })

    expect(result.metadata).toEqual({})
  })

  it('does not mistake an official header quoted inside an analysis report for the report header', () => {
    const report =
      'BÁO CÁO PHÂN TÍCH NGHỊ QUYẾT 08\n' +
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nSố: 08-NQ/TW\nNGHỊ QUYẾT\n' +
      'Nội dung trích dẫn từ văn bản gốc.'

    expect(isOriginalLegalDocument(report)).toBe(false)
    expect(extractDocumentMetadata({ title: 'analysis.pdf', content: report }).metadata).toEqual({})
  })

  it('accepts common original-document number formats', () => {
    const resolution = 'CHÍNH PHỦ\nSố: 15/NQ-CP\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nNGHỊ QUYẾT'
    const decision = 'THỦ TƯỚNG CHÍNH PHỦ\nSố: 123/QĐ-TTg\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nQUYẾT ĐỊNH'
    const partyResolution = 'BỘ CHÍNH TRỊ\nSố: 08-NQ/TW\nĐẢNG CỘNG SẢN VIỆT NAM\nNGHỊ QUYẾT'

    expect(isOriginalLegalDocument(resolution)).toBe(true)
    expect(isOriginalLegalDocument(decision)).toBe(true)
    expect(isOriginalLegalDocument(partyResolution)).toBe(true)
    expect(extractDocumentMetadata({ title: 'resolution.pdf', content: resolution }).metadata.documentNumber).toBe('15/NQ-CP')
    expect(extractDocumentMetadata({ title: 'decision.pdf', content: decision }).metadata.documentNumber).toBe('123/QĐ-TTg')
    expect(extractDocumentMetadata({ title: 'party.pdf', content: partyResolution }).metadata).toMatchObject({ documentNumber: '08-NQ/TW', issuer: 'Bộ Chính trị' })
  })

  it('rejects a study that quotes an official masthead', () => {
    const study = 'NGHIÊN CỨU VỀ NGHỊ QUYẾT 08\nTrích nguyên văn:\nĐẢNG CỘNG SẢN VIỆT NAM\nSố: 08-NQ/TW\nNGHỊ QUYẾT'
    expect(isOriginalLegalDocument(study)).toBe(false)
  })
})
