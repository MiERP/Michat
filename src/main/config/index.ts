export { getStore } from './store'
export { SettingsManager } from './settingsManager'
export { ApiConfigManager } from '../ai/apiConfigManager'

export type { AppSettings, StoreSchema } from './types'
export { defaultSettings } from './defaults'

import { getStore } from './store'
import { SettingsManager } from './settingsManager'
import { ApiConfigManager } from '../ai/apiConfigManager'

export const settingsManager = new SettingsManager(getStore)
export const apiConfigManager = new ApiConfigManager(getStore)
