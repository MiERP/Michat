import type Store from 'electron-store'
import type { AppSettings, StoreSchema } from './types'
import { defaultSettings } from './defaults'

/**
 * Deep-merges the settings object
 * Ensures existing stored data picks up newly added default fields
 */
function mergeSettings(stored: Partial<AppSettings>): AppSettings {
  return {
    theme: stored.theme ?? defaultSettings.theme,
    language: stored.language ?? defaultSettings.language,
    autoLaunch: stored.autoLaunch ?? defaultSettings.autoLaunch,
    hasCompletedOnboarding: stored.hasCompletedOnboarding ?? defaultSettings.hasCompletedOnboarding,
    rerankEnabled: stored.rerankEnabled ?? defaultSettings.rerankEnabled,
    rerankTopN: stored.rerankTopN ?? defaultSettings.rerankTopN,
    rerankUseHeuristicFallback:
      stored.rerankUseHeuristicFallback ?? defaultSettings.rerankUseHeuristicFallback,
    ragTopK: stored.ragTopK ?? defaultSettings.ragTopK,
    ragThreshold: stored.ragThreshold ?? defaultSettings.ragThreshold,
    ragSkipShortQueryLength:
      stored.ragSkipShortQueryLength ?? defaultSettings.ragSkipShortQueryLength,
    ragEnableChitChatHeuristic:
      stored.ragEnableChitChatHeuristic ?? defaultSettings.ragEnableChitChatHeuristic,
    ragHierarchicalEnabled: stored.ragHierarchicalEnabled ?? defaultSettings.ragHierarchicalEnabled,
    ragDocTopK: stored.ragDocTopK ?? defaultSettings.ragDocTopK,
    ragMetadataAwareEnabled:
      stored.ragMetadataAwareEnabled ?? defaultSettings.ragMetadataAwareEnabled,
    ragRetrievalDebugEnabled:
      stored.ragRetrievalDebugEnabled ?? defaultSettings.ragRetrievalDebugEnabled,
    prompts: {
      quiz: {
        'vi-VN': stored.prompts?.quiz?.['vi-VN'] ?? defaultSettings.prompts!.quiz!['vi-VN'],
        'en-US': stored.prompts?.quiz?.['en-US'] ?? defaultSettings.prompts!.quiz!['en-US']
      },
      chat: {
        'vi-VN': stored.prompts?.chat?.['vi-VN'] ?? defaultSettings.prompts!.chat!['vi-VN'],
        'en-US': stored.prompts?.chat?.['en-US'] ?? defaultSettings.prompts!.chat!['en-US']
      }
    }
  }
}

/**
 * Settings manager
 */
export class SettingsManager {
  private getStore: () => Promise<Store<StoreSchema>>
  private storeCache: Store<StoreSchema> | null = null

  constructor(getStore: () => Promise<Store<StoreSchema>>) {
    this.getStore = getStore
    // Prime the store cache immediately
    getStore().then((store) => {
      this.storeCache = store
    })
  }

  /**
   * Reads a single setting synchronously (only available once the store is initialized, otherwise returns the default)
   */
  getSettingSync<K extends keyof AppSettings>(key: K): AppSettings[K] {
    if (!this.storeCache) {
      return defaultSettings[key]
    }
    const storedSettings: Partial<AppSettings> = this.storeCache.get('settings') ?? defaultSettings
    const mergedSettings = mergeSettings(storedSettings)
    return mergedSettings[key]
  }

  /**
   * Returns all settings
   */
  async getAllSettings(): Promise<AppSettings> {
    const store = await this.getStore()
    const storedSettings: Partial<AppSettings> = store.get('settings') ?? defaultSettings
    return mergeSettings(storedSettings)
  }

  /**
   * Returns a single setting
   */
  async getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    const settings = await this.getAllSettings()
    return settings[key]
  }

  /**
   * Updates settings
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    const store = await this.getStore()
    const current = await this.getAllSettings()
    const newSettings = { ...current, ...updates }
    store.set('settings', newSettings)
  }

  /**
   * Sets a single value
   */
  async setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    await this.updateSettings({ [key]: value } as Partial<AppSettings>)
  }

  /**
   * Resets to the default settings
   */
  async resetSettings(): Promise<void> {
    const store = await this.getStore()
    store.set('settings', defaultSettings)
  }

  /**
   * Listens for settings changes (synchronous variant; only takes effect once the store is initialized)
   */
  onSettingsChangeSync(
    callback: (newSettings: AppSettings, oldSettings: AppSettings) => void
  ): void {
    if (this.storeCache) {
      this.storeCache.onDidChange('settings', (newValue, oldValue) => {
        if (newValue && oldValue) {
          callback(newValue, oldValue)
        }
      })
    } else {
      // Store not initialized yet; register the listener once it is
      this.getStore().then((store) => {
        store.onDidChange('settings', (newValue, oldValue) => {
          if (newValue && oldValue) {
            callback(newValue, oldValue)
          }
        })
      })
    }
  }

  /**
   * Listens for settings changes
   */
  async onSettingsChange(
    callback: (newSettings: AppSettings, oldSettings: AppSettings) => void
  ): Promise<() => void> {
    const store = await this.getStore()
    return store.onDidChange('settings', (newValue, oldValue) => {
      if (newValue && oldValue) {
        callback(newValue, oldValue)
      }
    })
  }
}
