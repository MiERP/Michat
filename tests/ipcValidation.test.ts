import { describe, expect, it } from 'vitest'
import { KnowledgeSchemas, ProviderSchemas, SettingsSchemas } from '../src/main/ipc/validation'

describe('ipc validation schemas', () => {
  it('accepts known settings keys with correctly typed values', () => {
    expect(SettingsSchemas.set.parse({ key: 'language', value: 'vi-VN' }).key).toBe('language')
    expect(
      SettingsSchemas.update.parse({ updates: { allowRemoteProviders: false, ragTopK: 5 } }).updates
        .ragTopK
    ).toBe(5)
  })

  it('rejects unknown settings keys and invalid values', () => {
    expect(() => SettingsSchemas.set.parse({ key: 'unknown', value: true })).toThrow()
    expect(() => SettingsSchemas.set.parse({ key: 'ragThreshold', value: 2 })).toThrow()
    expect(() => SettingsSchemas.update.parse({ updates: { unexpected: true } })).toThrow()
  })

  it('validates provider endpoint shape without allowing invalid URLs', () => {
    expect(
      ProviderSchemas.saveProviderConfig.parse({
        providerName: 'llama',
        enabled: true,
        config: { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '' }
      }).providerName
    ).toBe('llama')

    expect(() =>
      ProviderSchemas.saveProviderConfig.parse({
        providerName: 'remote',
        enabled: true,
        config: { baseUrl: 'not-a-url' }
      })
    ).toThrow()
  })

  it('validates legal graph status and retry document IDs', () => {
    expect(KnowledgeSchemas.getLegalGraphStatus.parse({ documentId: 'doc-1' })).toEqual({
      documentId: 'doc-1'
    })
    expect(KnowledgeSchemas.retryLegalGraph.parse({ documentId: 'doc-1' })).toEqual({
      documentId: 'doc-1'
    })
    expect(() => KnowledgeSchemas.getLegalGraphStatus.parse({ documentId: '' })).toThrow()
    expect(() => KnowledgeSchemas.retryLegalGraph.parse({ documentId: '../doc' })).toThrow()
  })
})
