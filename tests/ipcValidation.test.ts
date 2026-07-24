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
  it('validates document metadata updates', () => {
    expect(
      KnowledgeSchemas.updateDocumentMetadata.parse({
        documentId: 'doc-1',
        metadata: {
          documentNumber: '99/2025/NĐ-CP',
          documentType: 'Nghị định',
          issuedAt: '2025-05-06'
        }
      }).metadata.documentNumber
    ).toBe('99/2025/NĐ-CP')

    expect(() =>
      KnowledgeSchemas.updateDocumentMetadata.parse({
        documentId: 'doc-1',
        metadata: { issuedAt: '06/05/2025' }
      })
    ).toThrow()
  })
})
