/** Renderer-safe configuration for the external local API. */
export interface PublicApiConfig {
  baseUrl: string
  chatModel: string
  embeddingModel: string
  embeddingBaseUrl?: string
  contextWindow: number
  hasApiKey: boolean
}

export interface SaveApiConfigInput {
  baseUrl?: string
  chatModel?: string
  embeddingModel?: string
  embeddingBaseUrl?: string
  contextWindow?: number
  apiKey?: string
  clearApiKey?: boolean
}

export interface ApiTestResult {
  ok: boolean
  message: string
  status?: number
  models?: string[]
}
