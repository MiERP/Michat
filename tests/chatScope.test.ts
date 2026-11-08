import { describe, expect, it } from 'vitest'
import { buildScopeFilter } from '../src/main/utils/chatScope'

describe('buildScopeFilter', () => {
  it('returns undefined for an empty scope', () => {
    expect(buildScopeFilter(undefined)).toBeUndefined()
    expect(buildScopeFilter({})).toBeUndefined()
    expect(buildScopeFilter({ documentIds: ['   '] })).toBeUndefined()
  })

  it('keeps document, section and page scopes', () => {
    const filter = buildScopeFilter({
      documentIds: ['doc-1'],
      sectionPath: ['Điều 1'],
      pageRange: { from: 2, to: 9 }
    })

    expect(filter).toEqual({
      documentIds: ['doc-1'],
      sectionPath: ['Điều 1'],
      pageRange: { from: 2, to: 9 }
    })
  })

  it('ignores an inverted page range', () => {
    expect(buildScopeFilter({ pageRange: { from: 5, to: 2 } })).toBeUndefined()
  })
})
