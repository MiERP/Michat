import { describe, expect, it } from 'vitest'
import {
  ApiSchemas,
  ChatSchemas,
  ClipboardSchemas,
  KnowledgeSchemas,
  SettingsSchemas
} from '../src/main/ipc/validation'

describe('ipc validation schemas', () => {
  it('rejects impossible metadata dates and accepts leap days', () => {
    for (const issuedAt of ['2025-02-29', '2025-02-31', '2025-13-01']) {
      expect(
        KnowledgeSchemas.updateDocumentMetadata.safeParse({
          documentId: 'doc-1',
          metadata: { issuedAt }
        }).success
      ).toBe(false)
    }
    expect(
      KnowledgeSchemas.updateDocumentMetadata.safeParse({
        documentId: 'doc-1',
        metadata: { issuedAt: '2024-02-29' }
      }).success
    ).toBe(true)
  })
  it('accepts known settings keys with correctly typed values', () => {
    expect(SettingsSchemas.set.parse({ key: 'language', value: 'vi-VN' }).key).toBe('language')
    expect(SettingsSchemas.update.parse({ updates: { ragTopK: 5 } }).updates.ragTopK).toBe(5)
    expect(() =>
      SettingsSchemas.update.parse({ updates: { allowRemoteProviders: false } })
    ).toThrow()
  })

  it('rejects unknown settings keys and invalid values', () => {
    expect(() => SettingsSchemas.set.parse({ key: 'unknown', value: true })).toThrow()
    expect(() => SettingsSchemas.set.parse({ key: 'ragThreshold', value: 2 })).toThrow()
    expect(() => SettingsSchemas.update.parse({ updates: { unexpected: true } })).toThrow()
  })

  it('validates API configuration shape and rejects unknown fields', () => {
    const parsed = ApiSchemas.saveConfig.parse({
      baseUrl: 'http://127.0.0.1:8000/v1',
      contextWindow: 8192
    })
    expect(parsed.baseUrl).toBe('http://127.0.0.1:8000/v1')

    // Model selection belongs to the external server, not MiChat.
    expect(() => ApiSchemas.saveConfig.parse({ chatModel: 'local-chat' })).toThrow()
    expect(() => ApiSchemas.saveConfig.parse({ unexpected: true })).toThrow()
    expect(() => ApiSchemas.saveConfig.parse({ contextWindow: 1024 })).toThrow()
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

  it('validates message deletion and like/dislike feedback', () => {
    expect(ChatSchemas.deleteMessage.parse({ messageId: 'msg-1' }).messageId).toBe('msg-1')
    expect(
      ChatSchemas.setMessageFeedback.parse({ messageId: 'msg-1', rating: 'like' }).rating
    ).toBe('like')
    expect(
      ChatSchemas.setMessageFeedback.parse({ messageId: 'msg-1', rating: null }).rating
    ).toBeNull()
    expect(() =>
      ChatSchemas.setMessageFeedback.parse({ messageId: 'msg-1', rating: 'maybe' })
    ).toThrow()
    expect(() => ChatSchemas.deleteMessage.parse({ messageId: 'x'.repeat(201) })).toThrow()
    expect(() =>
      ChatSchemas.setMessageFeedback.parse({ messageId: 'x'.repeat(201), rating: 'like' })
    ).toThrow()
  })

  it('caps clipboard payloads', () => {
    expect(ClipboardSchemas.writeText.parse({ text: 'copy me' }).text).toBe('copy me')
    expect(() => ClipboardSchemas.writeText.parse({ text: '' })).toThrow()
  })
})
