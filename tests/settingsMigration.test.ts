import { describe, expect, it } from 'vitest'
import { SettingsManager } from '../src/main/config/settingsManager'
import type { AppSettings } from '../src/main/config/types'
import type { StoreSchema } from '../src/main/config/types'

class MemoryStore {
  readonly values = new Map<keyof StoreSchema, unknown>()

  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] | undefined {
    return this.values.get(key) as StoreSchema[K] | undefined
  }

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    this.values.set(key, value)
  }
}

function managerFor(store: MemoryStore): SettingsManager {
  return new SettingsManager(async () => store as never)
}

describe('SettingsManager 2.2.0 RAG migration', () => {
  it('moves untouched 2.1.0 RAG defaults to the 2.2.0 values', async () => {
    const store = new MemoryStore()
    store.set('settings', {
      theme: 'light',
      ragTopK: 3,
      ragThreshold: 0.62,
      rerankEnabled: true
    } as AppSettings)

    const settings = await managerFor(store).getAllSettings()

    expect(settings.ragTopK).toBe(5)
    expect(settings.ragThreshold).toBe(0.5)
    expect(settings.rerankEnabled).toBe(false)
    expect(settings.theme).toBe('light')
    expect(store.get('settingsVersion')).toBe(2)
  })

  it('keeps explicitly customized RAG settings', async () => {
    const store = new MemoryStore()
    store.set('settings', {
      ragTopK: 8,
      ragThreshold: 0.7,
      rerankEnabled: true
    } as AppSettings)

    const settings = await managerFor(store).getAllSettings()

    expect(settings.ragTopK).toBe(8)
    expect(settings.ragThreshold).toBe(0.7)
    expect(settings.rerankEnabled).toBe(true)
    expect(store.get('settingsVersion')).toBe(2)
  })

  it('does not migrate again when the store is already version 2', async () => {
    const store = new MemoryStore()
    store.set('settingsVersion', 2)
    store.set('settings', {
      ragTopK: 3,
      ragThreshold: 0.62,
      rerankEnabled: true
    } as AppSettings)

    const settings = await managerFor(store).getAllSettings()

    expect(settings.ragTopK).toBe(3)
    expect(settings.ragThreshold).toBe(0.62)
    expect(settings.rerankEnabled).toBe(true)
  })
})
