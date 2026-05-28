import type Store from 'electron-store'
import type { StoreSchema } from './types'
import { defaultSettings, defaultShortcuts } from './defaults'

/**
 * 创建 electron-store 实例（使用动态导入）
 */
let store: Store<StoreSchema> | null = null

export async function getStore(): Promise<Store<StoreSchema>> {
  if (!store) {
    const { default: Store } = await import('electron-store')
    store = new Store<StoreSchema>({
      defaults: {
        settings: defaultSettings,
        providers: {
          llama: {
            providerName: 'llama',
            config: {
              baseUrl: 'http://127.0.0.1:8000/v1',
              embeddingBaseUrl: 'http://127.0.0.1:8001/v1',
              apiKey: ''
            },
            enabled: true,
            updatedAt: 0
          }
        },
        shortcuts: defaultShortcuts
      },
      name: 'michat-config',
      // 文件会保存在: ~/Library/Application Support/michat/michat-config.json (macOS)
      encryptionKey: undefined // 如果需要加密可以设置密钥
    })
  }
  return store
}
