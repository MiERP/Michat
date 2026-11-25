import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/main/config/defaults'

describe('defaultSettings retrieval tuning', () => {
  it('ships the accuracy-first RAG defaults documented in the changelog', () => {
    expect(defaultSettings.ragTopK).toBe(5)
    expect(defaultSettings.ragThreshold).toBe(0.5)
    expect(defaultSettings.rerankEnabled).toBe(false)
  })
})
