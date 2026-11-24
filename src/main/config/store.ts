import type Store from 'electron-store'
import type { StoreSchema } from './types'
import { defaultSettings, defaultShortcuts } from './defaults'

/**
 * Creates the electron-store instance (using a dynamic import)
 */
let store: Store<StoreSchema> | null = null

export async function getStore(): Promise<Store<StoreSchema>> {
  if (!store) {
    const { default: Store } = await import('electron-store')
    store = new Store<StoreSchema>({
      defaults: {
        settings: defaultSettings,
        shortcuts: defaultShortcuts
      },
      name: 'michat-config',
      // The file is stored at: ~/Library/Application Support/michat/michat-config.json (macOS)
      encryptionKey: undefined // set a key here if encryption is needed
    })
  }
  return store
}
