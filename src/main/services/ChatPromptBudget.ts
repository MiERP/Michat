import type { APIMessage } from '../../shared/types/chat'

export interface FitChatPromptInput {
  system: string
  history: APIMessage[]
  query: string
  evidence?: string
  graph?: string
  contextWindow: number
  maxOutputTokens: number
  safetyTokens?: number
  maxHistoryMessages: number
}

export interface FitChatPromptResult {
  messages: APIMessage[]
  estimatedPromptTokens: number
  droppedHistoryMessages: number
}

function estimateTextTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 2))
}

export function estimateChatTokens(messages: APIMessage[]): number {
  return messages.reduce((total, message) => total + estimateTextTokens(message.content) + 4, 2)
}

function clipToTokens(content: string, maxTokens: number): string {
  const maxChars = Math.max(0, (maxTokens - 4) * 2)
  if (content.length <= maxChars) return content
  if (maxChars <= 3) return ''
  return `${content.slice(0, maxChars - 3).trimEnd()}...`
}

export function fitChatPrompt(input: FitChatPromptInput): FitChatPromptResult {
  const promptBudget = Math.max(
    64,
    input.contextWindow - input.maxOutputTokens - (input.safetyTokens ?? 256)
  )
  const system: APIMessage = { role: 'system', content: input.system }
  const query: APIMessage = { role: 'user', content: input.query }
  const mandatoryTokens = estimateChatTokens([system, query])
  let remaining = Math.max(0, promptBudget - mandatoryTokens)
  const dynamic: APIMessage[] = []

  if (input.evidence && remaining > 8) {
    const evidenceShare = input.graph ? Math.max(16, Math.floor(remaining * 0.72)) : remaining
    const content = clipToTokens(input.evidence, evidenceShare)
    if (content) {
      dynamic.push({ role: 'system', content })
      remaining -= estimateChatTokens([{ role: 'system', content }]) - 2
    }
  }

  if (input.graph && remaining > 8) {
    const content = clipToTokens(input.graph, remaining)
    if (content) {
      dynamic.push({ role: 'system', content })
      remaining -= estimateChatTokens([{ role: 'system', content }]) - 2
    }
  }

  const candidates = input.history.slice(-input.maxHistoryMessages)
  const selectedHistory: APIMessage[] = []
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]
    const tokens = estimateChatTokens([message]) - 2
    if (tokens > remaining) continue
    selectedHistory.unshift(message)
    remaining -= tokens
  }

  let messages = [system, ...selectedHistory, ...dynamic, query]
  while (estimateChatTokens(messages) > promptBudget && selectedHistory.length > 0) {
    selectedHistory.shift()
    messages = [system, ...selectedHistory, ...dynamic, query]
  }

  if (estimateChatTokens(messages) > promptBudget) {
    const overflow = estimateChatTokens(messages) - promptBudget
    const systemBudget = Math.max(8, estimateTextTokens(system.content) - overflow - 4)
    system.content = clipToTokens(system.content, systemBudget)
    messages = [system, ...selectedHistory, ...dynamic, query]
  }

  return {
    messages,
    estimatedPromptTokens: estimateChatTokens(messages),
    droppedHistoryMessages: input.history.length - selectedHistory.length
  }
}
