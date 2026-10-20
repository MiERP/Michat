/**
 * RerankService
 * Optional heuristic reranking stage for retrieval candidates.
 *
 * Provider-based reranking is intentionally not supported: the app ships only
 * local chat/embedding models and no rerank model, so candidates are reordered
 * with a lightweight lexical heuristic blended into the retrieval score.
 */

export interface RerankCandidate {
  id: string
  text: string
  baseScore: number
}

export interface RerankOptions {
  enabled?: boolean
  topN?: number
  heuristicFallback?: boolean
}

export interface RerankOutcome {
  orderedIds: string[]
  scores: Map<string, number>
  method: 'heuristic' | 'none'
}

export class RerankService {
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

    if (options.heuristicFallback === false) {
      return {
        orderedIds: candidates.map((c) => c.id),
        scores: new Map(candidates.map((c) => [c.id, c.baseScore])),
        method: 'none'
      }
    }

    return this.heuristicRerank(query, candidates, topN)
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
}
