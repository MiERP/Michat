import { isSmallTalkQuery } from './chitChat'

/**
 * A notebook with no indexed chunks cannot ground a factual answer. Small talk
 * is the only exception; everything else must be refused deterministically
 * instead of answered from the model's own parametric memory.
 */
export function shouldRefuseEmptyKnowledgeBase(query: string, indexedChunkCount: number): boolean {
  return indexedChunkCount === 0 && !isSmallTalkQuery(query)
}
