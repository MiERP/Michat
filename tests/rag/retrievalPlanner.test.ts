import { describe, expect, it } from 'vitest'
import {
  createRetrievalPlan,
  mergePreferredAndBroadResults
} from '../../src/main/services/RetrievalPlanner'

describe('createRetrievalPlan', () => {
  const documents = [
    {
      id: 'decree',
      metadata: {
        documentMetadata: {
          documentNumber: '15/2024/NĐ-CP',
          documentType: 'Nghị định',
          issuer: 'Chính phủ'
        }
      }
    },
    {
      id: 'circular',
      metadata: {
        documentMetadata: {
          documentNumber: '01/2024/TT-BTP',
          documentType: 'Thông tư',
          issuer: 'Bộ Tư pháp',
          issuedAt: '2024-02-01',
          documentTitle: 'Hướng dẫn dữ liệu ACME'
        },
        enrichment: {
          entities: ['ACME'],
          keywords: ['quản trị dữ liệu']
        },
        tags: ['ưu tiên']
      }
    }
  ]

  it('makes a unique document number an inferred hard constraint', () => {
    const plan = createRetrievalPlan('Tóm tắt Nghị định 15/2024/NĐ-CP', documents)

    expect(plan.hardConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'documentNumber',
          values: ['15/2024/NĐ-CP'],
          source: 'query-resolver'
        })
      ])
    )
    expect(plan.preferredDocumentIds).toEqual(['decree'])
  })

  it('resolves a unique document number even when the question omits its year', () => {
    const plan = createRetrievalPlan('Tóm tắt Nghị định 15/NĐ-CP', documents)

    expect(plan.hardConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'documentNumber',
          values: ['15/2024/NĐ-CP'],
          source: 'query-resolver'
        })
      ])
    )
    expect(plan.preferredDocumentIds).toEqual(['decree'])
  })

  it('uses document type and issuer as preferred hints so they cannot hide other evidence', () => {
    const plan = createRetrievalPlan('Quy định của Bộ Tư pháp', documents)

    expect(plan.hardConstraints).toEqual([])
    expect(plan.preferredConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'issuer', values: ['Bộ Tư pháp'], mode: 'preferred' })
      ])
    )
    expect(plan.preferredDocumentIds).toEqual(['circular'])
  })

  it('keeps an explicit user document scope hard while retaining inferred hints', () => {
    const plan = createRetrievalPlan('Thông tư của Bộ Tư pháp', documents, {
      documentIds: ['decree']
    })

    expect(plan.hardConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'documentIds', values: ['decree'], source: 'user' })
      ])
    )
    expect(plan.preferredDocumentIds).toEqual([])
  })

  it('resolves entity, date, keyword and tag signals from indexed metadata', () => {
    const plan = createRetrievalPlan(
      'Tài liệu ACME ngày 01/02/2024 về quản trị dữ liệu, nhãn ưu tiên',
      documents
    )

    expect(plan.preferredConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entity', values: ['ACME'] }),
        expect.objectContaining({ field: 'issuedAt', values: ['2024-02-01'] }),
        expect.objectContaining({ field: 'keyword', values: ['quản trị dữ liệu'] }),
        expect.objectContaining({ field: 'tag', values: ['ưu tiên'] })
      ])
    )
    expect(plan.preferredDocumentIds).toEqual(['circular'])
  })
})

describe('mergePreferredAndBroadResults', () => {
  it('keeps every broad result eligible when the preferred pass is already full', () => {
    const preferred = [
      { chunkId: 'preferred-1', score: 0.03 },
      { chunkId: 'preferred-2', score: 0.02 }
    ]
    const broad = [
      { chunkId: 'semantic-evidence', score: 0.04 },
      { chunkId: 'preferred-1', score: 0.03 }
    ]

    const merged = mergePreferredAndBroadResults(preferred, broad, 2)

    expect(merged.map((result) => result.chunkId)).toContain('semantic-evidence')
  })
})
