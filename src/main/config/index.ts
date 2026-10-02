
export { getStore } from './store'
export { SettingsManager } from './settingsManager'
export { ProviderConfigManager } from './ProviderConfigManager'

export { ProviderConfigManager as ProvidersManager } from './ProviderConfigManager'
export type { AppSettings, ProviderConfig, StoreSchema } from './types'
export { defaultSettings } from './defaults'

import { getStore } from './store'
import { SettingsManager } from './settingsManager'
import { ProviderConfigManager } from './ProviderConfigManager'

export const settingsManager = new SettingsManager(getStore)
export const providersManager = new ProviderConfigManager(getStore)
export const providerConfigManager = providersManager
