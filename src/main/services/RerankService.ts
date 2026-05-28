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
  topN?: number
  model?: string
  heuristicFallback?: boolean
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
    if (!options.enabled || candidates.length <= 1) {
      return {
        orderedIds: candidates.map((c) => c.id),
        scores: new Map(candidates.map((c) => [c.id, c.baseScore])),
        method: 'none'
      }
    }

    const topN = Math.min(Math.max(options.topN ?? candidates.length, 1), candidates.length)

    const providerOutcome = await this.tryProviderRerank(query, candidates, topN, options.model)
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
    model?: string
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
      const rerankResults = await provider.rerank(query, documents, {
        model: modelId || provider.getDefaultRerankModel?.(),
        topN
      })

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
    const scored = candidates.map((candidate) => {
      const lexical = this.lexicalScore(queryTokens, this.tokenize(candidate.text))
      // Blend semantic base score with lexical overlap.
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

  private lexicalScore(queryTokens: string[], docTokens: string[]): number {
    if (queryTokens.length === 0 || docTokens.length === 0) return 0

    const docSet = new Set(docTokens)
    let hits = 0
    for (const token of queryTokens) {
      if (docSet.has(token)) {
        hits += 1
      }
    }

    return hits / queryTokens.length
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
