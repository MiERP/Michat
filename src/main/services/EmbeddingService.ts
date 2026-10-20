/**
 * EmbeddingService
 * Đóng gói logic tạo vector embedding, hỗ trợ xử lý theo lô và thử lại khi lỗi
 */

import { createHash } from 'crypto'
import { ProviderManager } from '../providers/ProviderManager'
import type { EmbeddingResult, EmbeddingConfig } from '../providers/types'
import Logger from '../../shared/utils/logger'

/**
 * Cấu hình dịch vụ Embedding
 */
export interface EmbeddingServiceConfig {
  batchSize?: number // Kích thước mỗi lô, mặc định 20
  maxRetries?: number // Số lần thử lại tối đa, mặc định 3
  retryDelay?: number // Độ trễ giữa các lần thử (ms), mặc định 1000
  rateLimit?: number // Khoảng chờ giữa các request (ms), mặc định 100
  cacheEnabled?: boolean // Bật/tắt cache embedding (mặc định true)
  cacheMaxEntries?: number // Số entry tối đa của LRU cache, mặc định 4096
}

/**
 * Dịch vụ Embedding
 * Đóng gói logic tạo vector embedding, hỗ trợ xử lý theo lô, retry và kiểm soát tốc độ
 */
export class EmbeddingService {
  private providerManager: ProviderManager
  private config: Required<EmbeddingServiceConfig>
  private cache = new Map<string, EmbeddingResult>()
  private cacheHits = 0
  private cacheMisses = 0

  constructor(providerManager: ProviderManager, config?: EmbeddingServiceConfig) {
    this.providerManager = providerManager
    this.config = {
      batchSize: config?.batchSize ?? 20,
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
      rateLimit: config?.rateLimit ?? 100,
      cacheEnabled: config?.cacheEnabled ?? true,
      cacheMaxEntries: config?.cacheMaxEntries ?? 4096
    }
  }

  /**
   * Xóa toàn bộ cache embedding (gọi khi đổi model hoặc muốn ép tính lại)
   */
  clearCache(): void {
    const size = this.cache.size
    this.cache.clear()
    Logger.info('EmbeddingService', `Embedding cache cleared (${size} entries)`)
  }

  getCacheStats(): { entries: number; hits: number; misses: number } {
    return { entries: this.cache.size, hits: this.cacheHits, misses: this.cacheMisses }
  }

  private normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ')
  }

  private buildCacheKey(providerName: string, model: string, dims: string, text: string): string {
    const hash = createHash('md5').update(this.normalizeText(text)).digest('hex')
    return `${providerName}|${model}|${dims}|${hash}`
  }

  private cacheGet(key: string): EmbeddingResult | undefined {
    if (!this.config.cacheEnabled) return undefined
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // LRU: đẩy entry vừa truy cập xuống cuối
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.cacheHits++
    return entry
  }

  private cacheSet(key: string, result: EmbeddingResult): void {
    if (!this.config.cacheEnabled) return
    if (this.cache.size >= this.config.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) this.cache.delete(oldestKey)
    }
    this.cache.set(key, result)
  }

  private copyResult(result: EmbeddingResult): EmbeddingResult {
    return { ...result, embedding: new Float32Array(result.embedding) }
  }

  /**
   * Tạo embedding cho một đoạn văn bản
   */
  async embed(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult> {
    const provider = await this.providerManager.getActiveEmbeddingProvider()

    if (!provider) {
      throw new Error('No embedding provider available')
    }

    const model = provider.getDefaultEmbeddingModel()
    const dims = String(config?.dimensions ?? '*')
    const cacheKey = this.buildCacheKey(provider.name, model, dims, text)
    const cached = this.cacheGet(cacheKey)
    if (cached) {
      Logger.debug('EmbeddingService', `Cache hit for query text (${text.length} chars)`)
      return this.copyResult(cached)
    }
    this.cacheMisses++

    const result = await this.withRetry(() => provider.createEmbedding(text, config))
    this.cacheSet(cacheKey, result)
    return this.copyResult(result)
  }

  /**
   * Tạo embedding theo lô
   * Tự động chia lô khi có nhiều văn bản
   */
  async embedBatch(
    texts: string[],
    config?: EmbeddingConfig,
    onProgress?: (completed: number, total: number) => void
  ): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return []
    }

    const provider = await this.providerManager.getActiveEmbeddingProvider()

    if (!provider) {
      throw new Error('No embedding provider available')
    }

    // 1. Kiểm tra cache cho từng text
    const model = provider.getDefaultEmbeddingModel()
    const dims = String(config?.dimensions ?? '*')
    const results: (EmbeddingResult | undefined)[] = new Array(texts.length).fill(undefined)
    const missIndexes: number[] = []

    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.buildCacheKey(provider.name, model, dims, texts[i])
      const cached = this.cacheGet(cacheKey)
      if (cached) {
        results[i] = cached
      } else {
        this.cacheMisses++
        missIndexes.push(i)
      }
    }

    const totalMisses = missIndexes.length
    if (totalMisses === 0) {
      Logger.debug('EmbeddingService', `Batch cache: ${texts.length}/${texts.length} hits`)
      onProgress?.(texts.length, texts.length)
      return results.map((r) => this.copyResult(r!))
    }

    Logger.info(
      'EmbeddingService',
      `Batch cache: ${texts.length - totalMisses}/${texts.length} hits, embedding ${totalMisses} missing`
    )

    // 2. Chỉ embed những text chưa có trong cache
    const missTexts = missIndexes.map((i) => texts[i])
    const cachedCount = texts.length - totalMisses
    const missProgress = onProgress
      ? (completed: number) => {
          onProgress(cachedCount + completed, texts.length)
        }
      : undefined
    const missResults = await this.embedBatchUncached(provider, missTexts, config, missProgress)

    for (let i = 0; i < missIndexes.length; i++) {
      const originalIndex = missIndexes[i]
      results[originalIndex] = missResults[i]
      this.cacheSet(
        this.buildCacheKey(provider.name, model, dims, texts[originalIndex]),
        missResults[i]
      )
    }

    return results.map((r) => this.copyResult(r!))
  }

  /**
   * Embed lô text chưa có trong cache (giữ nguyên hành vi batch/retry cũ)
   */
  private async embedBatchUncached(
    provider: NonNullable<Awaited<ReturnType<ProviderManager['getActiveEmbeddingProvider']>>>,
    texts: string[],
    config?: EmbeddingConfig,
    onProgress?: (completed: number, total: number) => void
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = []
    const batches = this.chunk(texts, this.config.batchSize)

    Logger.info('EmbeddingService', `Processing ${texts.length} texts in ${batches.length} batches`)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      try {
        const batchResults = await this.embedBatchWithAdaptiveSplit(provider, batch, config)
        results.push(...batchResults)

        if (onProgress) {
          onProgress(results.length, texts.length)
        }

        Logger.debug('EmbeddingService', `Batch ${i + 1}/${batches.length} completed`)

        // Tránh bị giới hạn tần suất request
        if (i < batches.length - 1) {
          await this.sleep(this.config.rateLimit)
        }
      } catch (error) {
        Logger.error('EmbeddingService', `Batch ${i + 1} failed:`, error)
        throw error
      }
    }

    return results
  }

  /**
   * Lấy mô hình Embedding mặc định của provider hiện tại
   */
  async getDefaultModel(): Promise<string | undefined> {
    const provider = await this.providerManager.getActiveEmbeddingProvider()
    return provider?.getDefaultEmbeddingModel()
  }

  /**
   * Kiểm tra provider hiện tại có hỗ trợ Embedding hay không
   */
  async isAvailable(): Promise<boolean> {
    const provider = await this.providerManager.getActiveEmbeddingProvider()
    return provider !== null
  }

  /**
   * Cập nhật cấu hình
   */
  updateConfig(config: Partial<EmbeddingServiceConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Chia mảng thành các lô nhỏ
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * Tách thích ứng cho embedding server cục bộ.
   * Nếu lỗi do một input vượt giới hạn token, sẽ đệ quy tách nhỏ và tạo embedding,
   * sau đó gộp vector bằng trung bình đơn giản.
   */
  private async embedBatchWithAdaptiveSplit(
    provider: NonNullable<Awaited<ReturnType<ProviderManager['getActiveEmbeddingProvider']>>>,
    texts: string[],
    config?: EmbeddingConfig
  ): Promise<EmbeddingResult[]> {
    try {
      return await this.withRetry(() => provider.createEmbeddings(texts, config))
    } catch (error) {
      if (!this.isInputTooLargeError(error)) {
        throw error
      }

      Logger.warn(
        'EmbeddingService',
        'Embedding batch contains oversized input. Falling back to per-text adaptive embedding.'
      )

      const fallbackResults: EmbeddingResult[] = []
      for (const text of texts) {
        fallbackResults.push(await this.embedSingleWithAdaptiveSplit(provider, text, config))
      }
      return fallbackResults
    }
  }

  private async embedSingleWithAdaptiveSplit(
    provider: NonNullable<Awaited<ReturnType<ProviderManager['getActiveEmbeddingProvider']>>>,
    text: string,
    config?: EmbeddingConfig,
    depth = 0
  ): Promise<EmbeddingResult> {
    const maxDepth = 6

    try {
      return await this.withRetry(() => provider.createEmbedding(text, config))
    } catch (error) {
      if (!this.isInputTooLargeError(error) || text.length < 40 || depth >= maxDepth) {
        throw error
      }

      const splitPos = Math.floor(text.length / 2)
      const left = text.slice(0, splitPos).trim()
      const right = text.slice(splitPos).trim()

      if (!left || !right) {
        throw error
      }

      const [leftEmbedding, rightEmbedding] = await Promise.all([
        this.embedSingleWithAdaptiveSplit(provider, left, config, depth + 1),
        this.embedSingleWithAdaptiveSplit(provider, right, config, depth + 1)
      ])

      const pooled = new Float32Array(leftEmbedding.embedding.length)
      for (let i = 0; i < pooled.length; i++) {
        pooled[i] = (leftEmbedding.embedding[i] + rightEmbedding.embedding[i]) / 2
      }

      return {
        embedding: pooled,
        model: leftEmbedding.model,
        dimensions: pooled.length,
        tokensUsed: (leftEmbedding.tokensUsed || 0) + (rightEmbedding.tokensUsed || 0)
      }
    }
  }

  private isInputTooLargeError(error: unknown): boolean {
    const messages = this.extractErrorMessages(error)
    return messages.some(
      (message) =>
        /input\s*\(\d+\s*tokens\)\s*is too large to process/i.test(message) ||
        /increase the physical batch size/i.test(message)
    )
  }

  private extractErrorMessages(error: unknown, visited = new WeakSet<object>()): string[] {
    if (error === null || error === undefined) return []

    if (typeof error === 'string') return [error]
    if (typeof error === 'number' || typeof error === 'boolean') return [String(error)]

    if (error instanceof Error) {
      const messages: string[] = [error.message]
      const maybeObject = error as unknown as Record<string, unknown>
      messages.push(...this.extractErrorMessages(maybeObject.cause, visited))
      messages.push(...this.extractErrorMessages(maybeObject.errors, visited))
      messages.push(...this.extractErrorMessages(maybeObject.lastError, visited))
      return messages
    }

    if (typeof error === 'object') {
      const obj = error as Record<string, unknown>
      if (visited.has(obj)) return []
      visited.add(obj)

      const messages: string[] = []
      if (typeof obj.message === 'string') messages.push(obj.message)
      if (typeof obj.responseBody === 'string') messages.push(obj.responseBody)
      if (typeof obj.stack === 'string') messages.push(obj.stack)

      messages.push(...this.extractErrorMessages(obj.cause, visited))
      messages.push(...this.extractErrorMessages(obj.errors, visited))
      messages.push(...this.extractErrorMessages(obj.lastError, visited))

      if (Array.isArray(obj.data)) {
        for (const item of obj.data) {
          messages.push(...this.extractErrorMessages(item, visited))
        }
      } else if (obj.data && typeof obj.data === 'object') {
        messages.push(...this.extractErrorMessages(obj.data, visited))
      }

      return messages
    }

    return [String(error)]
  }

  /**
   * Thực thi có retry
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        Logger.warn('EmbeddingService', `Attempt ${attempt} failed:`, error)

        // Deterministic input-size errors will not recover with retries.
        if (this.isInputTooLargeError(error)) {
          throw lastError
        }

        if (attempt < this.config.maxRetries) {
          // Backoff theo cấp số nhân
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * Tạm dừng
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
