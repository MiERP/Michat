import { describe, expect, it } from 'vitest'
import { detectQueryMetadata, normalizeMetadataValue } from '../src/main/utils/queryMetadata'

describe('detectQueryMetadata', () => {
  it('detects a document number together with its type', () => {
    const signals = detectQueryMetadata('Tóm tắt Nghị định 15/2024/NĐ-CP giúp tôi')
    expect(signals.documentNumber).toBe('15/2024/ND-CP')
    expect(signals.documentTypes).toEqual(['NGHI DINH'])
  })

  it('detects type and issuer phrases', () => {
    const signals = detectQueryMetadata('Thông tư của Bộ Tư pháp quy định gì?')
    expect(signals.documentTypes).toEqual(['THONG TU'])
    expect(signals.issuers).toEqual(['BO TU PHAP'])
  })

  it('supports the dash form and does not confuse dates with document numbers', () => {
    expect(detectQueryMetadata('Nghị quyết 08-NQ/TW').documentNumber).toBe('08-NQ/TW')
    expect(detectQueryMetadata('Ngày 15/03/2024 có gì?').documentNumber).toBeUndefined()
  })

  it('does not pick one number when the question compares two documents', () => {
    const signals = detectQueryMetadata(
      'So sánh Nghị định 15/2024/NĐ-CP với Thông tư 01/2024/TT-BTP'
    )
    expect(signals.documentNumber).toBeUndefined()
  })

  it('returns every mentioned type so ambiguous questions are not filtered', () => {
    const signals = detectQueryMetadata('So sánh Nghị định và Thông tư')
    expect(signals.documentTypes.sort()).toEqual(['NGHI DINH', 'THONG TU'])
  })

  it('returns no signals for a generic question', () => {
    expect(detectQueryMetadata('Quy định về đất đai là gì?')).toEqual({
      documentTypes: [],
      issuers: []
    })
  })
})

describe('normalizeMetadataValue', () => {
  it('folds Vietnamese diacritics and punctuation for matching', () => {
    expect(normalizeMetadataValue('15/2024/NĐ-CP')).toBe(normalizeMetadataValue('15/2024/ND-CP'))
    expect(normalizeMetadataValue('BỘ TƯ PHÁP')).toBe(normalizeMetadataValue('Bo Tu Phap'))
  })
})
