/** Renderer-safe configuration for the external local API. */
export interface PublicApiConfig {
  baseUrl: string
  embeddingBaseUrl?: string
  contextWindow: number
  hasApiKey: boolean
}

export interface SaveApiConfigInput {
  baseUrl?: string
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
