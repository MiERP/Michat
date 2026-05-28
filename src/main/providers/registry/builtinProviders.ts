/**
 * Builtin Providers
 * Only local llama.cpp servers — no cloud providers.
 */

import type { ProviderDescriptor } from './ProviderDescriptor'
import { AISDKProvider } from '../base/AISDKProvider'

export const BUILTIN_PROVIDERS: ProviderDescriptor[] = [
  {
    name: 'llama',
    displayName: 'Llama Server',
    isBuiltin: true,
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultChatModel: 'local-chat',
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },
  {
    name: 'llama-embed',
    displayName: 'Llama Embedding',
    isBuiltin: true,
    defaultBaseUrl: 'http://127.0.0.1:8001/v1',
    defaultEmbeddingModel: 'local-embedding',
    capabilities: {
      chat: false,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  }
]

export function getBuiltinProvider(name: string): ProviderDescriptor | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.name === name)
}

export function isBuiltinProvider(name: string): boolean {
  return BUILTIN_PROVIDERS.some((p) => p.name === name)
}
