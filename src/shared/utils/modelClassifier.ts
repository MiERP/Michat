/**
 * Model Classifier
 * Classifies models by type using regex pattern matching.
 * No hardcoded builtin model cache — models come from llama server at runtime.
 */

import { Model, ModelType, CategorizedModels } from '../types'

const EMBEDDING_PATTERNS = [
  /embed/i,
  /bge/i,
  /bce-embedding/i,
  /e5-/i,
  /gte-/i,
  /m3e/i,
  /text-similarity/i,
  /sentence-transformers/i
]

const RERANKER_PATTERNS = [/rerank/i, /cross-encoder/i]

const CHAT_PATTERNS = [
  /gpt-/i,
  /deepseek/i,
  /qwen/i,
  /claude/i,
  /llama/i,
  /mistral/i,
  /gemini/i,
  /glm/i,
  /kimi/i,
  /minimax/i,
  /yi-/i,
  /chatglm/i,
  /baichuan/i,
  /internlm/i,
  /thinking/i,
  /instruct/i,
  /chat/i
]

const VISION_PATTERNS = [/-vl/i, /-vision/i, /vision/i, /4v/i, /captioner/i, /omni/i]

const IMAGE_GEN_PATTERNS = [
  /stable-diffusion/i,
  /sdxl/i,
  /flux/i,
  /dalle/i,
  /midjourney/i,
  /kolors/i
]

const AUDIO_PATTERNS = [/whisper/i, /tts/i, /speech/i, /audio/i, /cosyvoice/i, /fish-speech/i]

export function classifyModel(modelId: string): ModelType {
  const id = modelId.toLowerCase()

  if (RERANKER_PATTERNS.some((p) => p.test(id))) return ModelType.RERANKER
  if (EMBEDDING_PATTERNS.some((p) => p.test(id))) return ModelType.EMBEDDING
  if (IMAGE_GEN_PATTERNS.some((p) => p.test(id))) return ModelType.IMAGE
  if (AUDIO_PATTERNS.some((p) => p.test(id))) return ModelType.AUDIO
  if (CHAT_PATTERNS.some((p) => p.test(id)) || VISION_PATTERNS.some((p) => p.test(id))) {
    return ModelType.CHAT
  }

  return ModelType.UNKNOWN
}

export function enrichModelWithType(model: Model): Model {
  return { ...model, type: model.type || classifyModel(model.id) }
}

export function enrichModelsWithType(models: Model[]): Model[] {
  return models.map(enrichModelWithType)
}

export function categorizeModels(models: Model[]): CategorizedModels {
  const enriched = enrichModelsWithType(models)
  return {
    chat: enriched.filter((m) => m.type === ModelType.CHAT),
    embedding: enriched.filter((m) => m.type === ModelType.EMBEDDING),
    reranker: enriched.filter((m) => m.type === ModelType.RERANKER),
    other: enriched.filter(
      (m) =>
        m.type === ModelType.IMAGE ||
        m.type === ModelType.AUDIO ||
        m.type === ModelType.VIDEO ||
        m.type === ModelType.UNKNOWN
    )
  }
}

export function filterChatModels(models: Model[]): Model[] {
  return enrichModelsWithType(models).filter((m) => m.type === ModelType.CHAT)
}

export function filterEmbeddingModels(models: Model[]): Model[] {
  return enrichModelsWithType(models).filter((m) => m.type === ModelType.EMBEDDING)
}

export function mergeModels(builtinModels: Model[], remoteModels: Model[]): Model[] {
  const builtinMap = new Map(builtinModels.map((m) => [m.id, m]))
  const remoteMap = new Map(remoteModels.map((m) => [m.id, m]))
  const merged: Model[] = []

  for (const remote of remoteModels) {
    const builtin = builtinMap.get(remote.id)
    if (builtin) {
      merged.push({
        ...remote,
        type: builtin.type,
        max_context: builtin.max_context,
        description: builtin.description
      })
    } else {
      merged.push(enrichModelWithType(remote))
    }
  }

  for (const builtin of builtinModels) {
    if (!remoteMap.has(builtin.id)) merged.push(builtin)
  }

  return merged
}
