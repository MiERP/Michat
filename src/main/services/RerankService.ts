/**
 * RerankService
 * Optional reranking stage for retrieval candidates.
 * Tries provider-based rerank first, then falls back to a lightweight lexical heuristic.
 */

import { ProviderManager } from '../providers/ProviderManager'
import Logger from '../../shared/utils/logger'

export interface RerankCandidate {
  id: string
  text: string
  baseScore: number
}

export interface RerankOptions {
  enabled?: boolean
  localOnly?: boolean
  topN?: number
  model?: string
  heuristicFallback?: boolean
  timeoutMs?: number
}

export interface RerankOutcome {
  orderedIds: string[]
  scores: Map<string, number>
  method: 'provider' | 'heuristic' | 'none'
}

export class RerankService {
  constructor(private providerManager: ProviderManager) {}

  async rerank(
    query: string,
    candidates: RerankCandidate[],
    options: RerankOptions = {}
  ): Promise<RerankOutcome> {
    if (!options.enabled || candidates.length === 0) {
      return {
        orderedIds: candidates.map((c) => c.id),
        scores: new Map(candidates.map((c) => [c.id, c.baseScore])),
        method: 'none'
      }
    }

    const topN = Math.min(Math.max(options.topN ?? candidates.length, 1), candidates.length)

    const providerOutcome = options.localOnly
      ? null
      : await this.tryProviderRerank(
          query,
          candidates,
          topN,
          options.model,
          options.timeoutMs ?? 650
        )
    if (providerOutcome) {
      return providerOutcome
    }

    if (options.heuristicFallback === false) {
      return {
        orderedIds: candidates.map((c) => c.id),
        scores: new Map(candidates.map((c) => [c.id, c.baseScore])),
        method: 'none'
      }
    }

    return this.heuristicRerank(query, candidates, topN)
  }

  private async tryProviderRerank(
    query: string,
    candidates: RerankCandidate[],
    topN: number,
    model?: string,
    timeoutMs = 650
  ): Promise<RerankOutcome | null> {
    try {
      const provider = await this.providerManager.getActiveRerankProvider(model)
      if (!provider || typeof provider.rerank !== 'function') {
        return null
      }

      const documents = candidates.map((candidate) => ({
        id: candidate.id,
        text: candidate.text
      }))

      const modelId = this.extractModelId(model)
      const rerankResults = await Promise.race([
        provider.rerank(query, documents, {
          model: modelId || provider.getDefaultRerankModel?.(),
          topN
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Rerank deadline exceeded: ${timeoutMs}ms`)), timeoutMs)
        )
      ])

      if (!rerankResults || rerankResults.length === 0) {
        return null
      }

      const scoreMap = new Map<string, number>()
      for (const result of rerankResults) {
        scoreMap.set(result.documentId, result.score)
      }

      const rerankedIds = rerankResults
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((r) => r.documentId)

      const remaining = candidates
        .map((c) => c.id)
        .filter((id) => !scoreMap.has(id))
        .sort(
          (a, b) =>
            (this.getBaseScore(candidates, b) || 0) - (this.getBaseScore(candidates, a) || 0)
        )

      const orderedIds = [...rerankedIds, ...remaining]

      return {
        orderedIds,
        scores: scoreMap,
        method: 'provider'
      }
    } catch (error) {
      Logger.warn('RerankService', 'Provider rerank failed, falling back to heuristic:', error)
      return null
    }
  }

  private heuristicRerank(
    query: string,
    candidates: RerankCandidate[],
    topN: number
  ): RerankOutcome {
    const queryTokens = this.tokenize(query)
    const tokenizedDocuments = candidates.map((candidate) => this.tokenize(candidate.text))
    const documentFrequency = new Map<string, number>()
    for (const tokens of tokenizedDocuments) {
      for (const token of new Set(tokens)) {
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)
      }
    }
    const averageLength =
      tokenizedDocuments.reduce((sum, tokens) => sum + tokens.length, 0) /
      Math.max(tokenizedDocuments.length, 1)
    const scored = candidates.map((candidate) => {
      const index = candidates.indexOf(candidate)
      const lexical = this.bm25Score(
        queryTokens,
        tokenizedDocuments[index],
        documentFrequency,
        candidates.length,
        averageLength
      )
      const score = candidate.baseScore * 0.65 + lexical * 0.35
      return { id: candidate.id, score }
    })

    scored.sort((a, b) => b.score - a.score)

    const topIds = scored.slice(0, topN).map((item) => item.id)
    const remainingIds = candidates
      .map((c) => c.id)
      .filter((id) => !topIds.includes(id))
      .sort(
        (a, b) => (this.getBaseScore(candidates, b) || 0) - (this.getBaseScore(candidates, a) || 0)
      )

    return {
      orderedIds: [...topIds, ...remainingIds],
      scores: new Map(scored.map((item) => [item.id, item.score])),
      method: 'heuristic'
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  }

  private bm25Score(
    queryTokens: string[],
    documentTokens: string[],
    documentFrequency: Map<string, number>,
    documentCount: number,
    averageLength: number
  ): number {
    if (!queryTokens.length || !documentTokens.length) return 0
    const frequencies = new Map<string, number>()
    documentTokens.forEach((token) => frequencies.set(token, (frequencies.get(token) || 0) + 1))
    let score = 0
    for (const token of new Set(queryTokens)) {
      const frequency = frequencies.get(token) || 0
      if (!frequency) continue
      const idf = Math.log(1 + (documentCount - (documentFrequency.get(token) || 0) + 0.5) / ((documentFrequency.get(token) || 0) + 0.5))
      const denominator = frequency + 1.2 * (0.25 + 0.75 * (documentTokens.length / Math.max(averageLength, 1)))
      score += idf * ((frequency * 2.2) / denominator)
    }
    return score / (score + 1)
  }

  private getBaseScore(candidates: RerankCandidate[], id: string): number | undefined {
    return candidates.find((candidate) => candidate.id === id)?.baseScore
  }

  private extractModelId(model?: string): string | undefined {
    if (!model) return undefined
    if (!model.includes(':')) return model
    const [, ...parts] = model.split(':')
    return parts.join(':') || undefined
  }
}
