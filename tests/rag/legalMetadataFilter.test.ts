import { describe, expect, it } from 'vitest'
import { selectLegalMetadataFilter } from '../../src/main/services/rag/LegalMetadataFilter'
import type { QueryMetadataSignals } from '../../src/main/utils/queryMetadata'

function signals(overrides: Partial<QueryMetadataSignals> = {}): QueryMetadataSignals {
  return { documentTypes: [], issuers: [], ...overrides }
}

const corpus = [
  { documentNumber: '15/2024/NQ-CP', documentType: 'NGHI QUYET', issuer: 'CHINH PHU' },
  { documentNumber: '08/2023/NQ-TW', documentType: 'NGHI QUYET', issuer: 'QUOC HOI' },
  { documentNumber: '27/2021/TT-BGDDT', documentType: 'THONG TU', issuer: 'BO GIAO DUC' }
]

describe('selectLegalMetadataFilter', () => {
  it('matches a document number that includes the year', () => {
    expect(selectLegalMetadataFilter(corpus, signals({ documentNumber: '15/2024/NQ-CP' }))).toEqual(
      { documentNumber: '15/2024/NQ-CP' }
    )
  })

  it('matches a short document number against the stored year-qualified value', () => {
    expect(selectLegalMetadataFilter(corpus, signals({ documentNumber: '15/NQ-CP' }))).toEqual({
      documentNumber: '15/2024/NQ-CP'
    })
  })

  it('does not filter when the document number is ambiguous', () => {
    const duplicated = [...corpus, { documentNumber: '15-2024/NQ-CP' }]
    expect(
      selectLegalMetadataFilter(duplicated, signals({ documentNumber: '15/NQ-CP' }))
    ).toBeUndefined()
  })

  it('filters by a unique document type', () => {
    expect(selectLegalMetadataFilter(corpus, signals({ documentTypes: ['thong tu'] }))).toEqual({
      documentType: 'THONG TU'
    })
  })

  it('does not filter by document type when several stored variants match', () => {
    const mixed = [{ documentType: 'NGHI QUYET' }, { documentType: 'NGHI QUYET HUONG DAN' }]
    expect(
      selectLegalMetadataFilter(mixed, signals({ documentTypes: ['nghi quyet'] }))
    ).toBeUndefined()
  })

  it('filters by issuer and keeps only matching documents', () => {
    expect(selectLegalMetadataFilter(corpus, signals({ issuers: ['giao duc'] }))).toEqual({
      issuer: 'BO GIAO DUC'
    })
  })

  it('returns undefined for an empty corpus', () => {
    expect(selectLegalMetadataFilter([], signals({ documentNumber: '15/NQ-CP' }))).toBeUndefined()
  })
})
