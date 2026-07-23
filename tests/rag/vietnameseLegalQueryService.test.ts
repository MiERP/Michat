import { describe, expect, it } from 'vitest'
import { expandVietnameseLegalQuery } from '../../src/main/services/VietnameseLegalQueryService'

describe('expandVietnameseLegalQuery', () => {
  it('adds bounded legal synonyms without changing the original query', () => {
    expect(expandVietnameseLegalQuery('Mức phạt khi vi phạm là gì?')).toEqual(
      expect.arrayContaining(['Mức phạt khi vi phạm là gì?', 'xử phạt', 'chế tài'])
    )
  })
})
