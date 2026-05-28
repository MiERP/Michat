/* eslint-disable no-irregular-whitespace */
import { ipcMain } from 'electron'
import * as queries from '../db/queries'
import { ProviderManager } from '../providers/ProviderManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { LlamaService } from '../services/LlamaService'
import { LicenseService } from '../services/LicenseService'
import { validateAndCleanMessages } from '../utils/messageValidator'
import { settingsManager } from '../config'
import type { ChatCitation, ChatMessageMetadata } from '../../shared/types/chat'
import type { AppSettings } from '../../shared/types'
import Logger from '../../shared/utils/logger'
import { ChatSchemas, validate, validateWithEvent } from './validation'

const CONTROL_CHARS_PATTERN = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g')

// Active streaming requests map (messageId -> AbortController)
const activeStreams = new Map<string, AbortController>()

// BUG-05: Cleanup guard ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â remove stale streams older than 5 minutes
const STREAM_TIMEOUT_MS = 5 * 60 * 1000
const streamTimestamps = new Map<string, number>()

const RAG_MAX_CHARS_PER_DOC = 1600
const RAG_MAX_TOTAL_CONTEXT_CHARS = 12000

function sanitizePromptText(raw: string): string {
  return raw
    .replace(CONTROL_CHARS_PATTERN, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function trackStream(messageId: string, controller: AbortController): void {
  activeStreams.set(messageId, controller)
  streamTimestamps.set(messageId, Date.now())
}

function cleanupStream(messageId: string): void {
  activeStreams.delete(messageId)
  streamTimestamps.delete(messageId)
}

function cleanupStaleStreams(): void {
  const now = Date.now()
  for (const [id, ts] of streamTimestamps) {
    if (now - ts > STREAM_TIMEOUT_MS) {
      const controller = activeStreams.get(id)
      if (controller) {
        Logger.warn('ChatHandlers', `Force-aborting stale stream: ${id}`)
        controller.abort()
      }
      cleanupStream(id)
    }
  }
}

// Run stale cleanup every 2 minutes
setInterval(cleanupStaleStreams, 2 * 60 * 1000).unref()

/**
 * ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº RAG ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€¦ ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ prompt
 */
function buildRAGContext(
  searchResults: Array<{
    chunkId: string
    documentTitle: string
    content: string
    score: number
  }>
): { context: string; includedChunkIds: Set<string> } {
  if (searchResults.length === 0) return { context: '', includedChunkIds: new Set() }

  const includedChunkIds = new Set<string>()
  const contextParts: string[] = []
  let totalContentChars = 0

  for (const result of searchResults) {
    if (totalContentChars >= RAG_MAX_TOTAL_CONTEXT_CHARS) break

    const sanitized = sanitizePromptText(result.content)
    if (!sanitized) continue

    const remaining = RAG_MAX_TOTAL_CONTEXT_CHARS - totalContentChars
    const targetChars = Math.min(RAG_MAX_CHARS_PER_DOC, remaining)
    if (targetChars <= 0) break

    const clipped = clipText(sanitized, targetChars)
    if (!clipped) continue

    includedChunkIds.add(result.chunkId)
    totalContentChars += clipped.length

    contextParts.push(
      `<doc id="${contextParts.length + 1}" chunk="${result.chunkId}" title="${result.documentTitle}" score="${result.score.toFixed(3)}">\n${clipped}\n</doc>`
    )
  }

  if (contextParts.length === 0) return { context: '', includedChunkIds }

  return {
    context: `Knowledge base context for the current user question:
Below are relevant retrieved documents:

<documents>
${contextParts.join('\n\n')}
</documents>

Instructions:
1. Please answer the user's question based ONLY on the documents above.
2. If the provided knowledge is insufficient or irrelevant, clearly state that you don't know based on the context.
3. When a statement uses document evidence, append citation index in square brackets, e.g. [1].
4. Do NOT attach all document indices by default; only cite the specific document(s) actually used.
5. If one statement uses multiple documents, cite only the necessary ones, e.g. [1][3].
6. Do NOT add a separate provenance sentence like "This information was found in file..."; keep citations inline with the statement itself.`,
    includedChunkIds
  }
}

function buildLongTermMemoryContext(
  summaries: Array<{ title: string; summary: string }>,
  maxItems = 3
): string {
  if (summaries.length === 0) return ''

  const selected = summaries.slice(0, maxItems)
  const blocks = selected
    .map(
      (item, index) =>
        `<memory index="${index + 1}" title="${item.title.replace(/"/g, "'")}">\n${item.summary}\n</memory>`
    )
    .join('\n\n')

  return `Long-term conversation memory from previous archived sessions:\n\n${blocks}\n\nUse this memory only as background context. If user intent conflicts with old memory, follow the newest user instruction.`
}

function isLikelyChitChat(query: string, shortQueryLength: number): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (q.length < shortQueryLength) return true

  const patterns = [
    /^(hi|hello|hey)\b/,
    /^(xin chao|chao|chÃƒÆ’Ã†â€™Ãƒâ€š o)\b/,
    /^(good (morning|afternoon|evening))/,
    /^(ban|bÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â¡n) (co|cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³) (the|thÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚Â»Ãƒâ€ Ã¢â‚¬â„¢) (giup|giÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºp)/,
    /^(cam on|cÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â£m ÃƒÆ’Ã¢â‚¬Â Ãƒâ€šÃ‚Â¡n|thank you)\b/
  ]

  return patterns.some((re) => re.test(q))
}

function normalizeCitationSnippet(raw: string, maxLength = 240): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength).trim()}...`
}

function buildCitations(
  searchResults: Array<{
    chunkId: string
    documentId: string
    documentTitle: string
    chunkIndex: number
    score: number
    content: string
    matchedContent?: string
    sourceUri?: string
    pageNumber?: number
  }>
): ChatCitation[] {
  return searchResults.map((result, idx) => ({
    index: idx + 1,
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    chunkId: result.chunkId,
    chunkIndex: result.chunkIndex,
    score: result.score,
    snippet: normalizeCitationSnippet(result.matchedContent || result.content),
    sourceUri: result.sourceUri,
    pageNumber: result.pageNumber
  }))
}

/**
 * Register chat-related IPC Handlers
 */
export function registerChatHandlers(
  providerManager: ProviderManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService,
  llamaService: LlamaService
) {
  // ==================== Chat Session ====================
  ipcMain.handle(
    'create-chat-session',
    validate(ChatSchemas.createSession, async (args) => {
      return queries.createSession(args.notebookId, args.title)
    })
  )

  ipcMain.handle(
    'get-chat-sessions',
    validate(ChatSchemas.getChatSessions, async (args) => {
      return queries.getSessionsByNotebook(args.notebookId)
    })
  )

  ipcMain.handle(
    'get-active-session',
    validate(ChatSchemas.getActiveSession, async (args) => {
      return queries.getActiveSessionByNotebook(args.notebookId)
    })
  )

  ipcMain.handle(
    'update-session-title',
    validate(ChatSchemas.updateSessionTitle, async (args) => {
      queries.updateSessionTitle(args.sessionId, args.title)
      return { success: true }
    })
  )

  ipcMain.handle(
    'delete-session',
    validate(ChatSchemas.deleteSession, async (args) => {
      queries.deleteSession(args.sessionId)
      return { success: true }
    })
  )

  // ==================== Chat Message ====================
  ipcMain.handle(
    'get-messages',
    validate(ChatSchemas.getMessages, async (args) => {
      return queries.getMessagesBySession(args.sessionId)
    })
  )

  // S-03: Use validateWithEvent so send-message has consistent validation
  // while still accessing event.sender for streaming
  ipcMain.handle(
    'send-message',
    validateWithEvent(ChatSchemas.sendMessage, async (event, args) => {
      const { sessionId, content } = args

      // 1. ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â­Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯
      queries.createMessage(sessionId, 'user', content)

      // 2. ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº assistant ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€š ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â¬Ãƒâ€šÃ‚Â¦
      const assistantMessage = queries.createMessage(sessionId, 'assistant', '')

      // License guard: block chat when license is missing/invalid/expired
      const licenseStatus = LicenseService.getStatus()
      if (!licenseStatus.valid) {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          error: `License invalid: ${licenseStatus.message}`
        })
        return assistantMessage.id
      }

      // 3. ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â½ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â²ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€¦ ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡
      const history = queries.getMessagesBySession(sessionId)
      let messages = history.map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }))

      // 3.1 ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¿ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â¤ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â©Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒâ€š ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€š Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°
      messages = validateAndCleanMessages(messages)

      // ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚ÂªÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¦ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¿Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯
      if (messages.length === 0) {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          error: 'No valid conversation history'
        })
        return assistantMessage.id
      }

      const settings = await settingsManager.getAllSettings().catch(() => null)
      const activeLanguage = settings?.language || 'vi-VN'
      const personaPrompt =
        settings?.prompts?.chat?.[activeLanguage] || settings?.prompts?.chat?.['vi-VN']
      if (personaPrompt?.trim()) {
        messages.unshift({
          role: 'system',
          content: personaPrompt.trim()
        })
      }

      const session = queries.getSessionById(sessionId)
      const summaries: Array<{ title: string; summary: string }> = []
      let cursorSessionId = session?.parentSessionId
      let depth = 0

      while (cursorSessionId && depth < 5) {
        const parentSession = queries.getSessionById(cursorSessionId)
        if (!parentSession) break
        if (parentSession.summary?.trim()) {
          summaries.push({
            title: parentSession.title || `Session ${depth + 1}`,
            summary: parentSession.summary.trim()
          })
        }
        cursorSessionId = parentSession.parentSessionId || undefined
        depth++
      }

      const memoryContext = buildLongTermMemoryContext(summaries)
      if (memoryContext) {
        messages.unshift({
          role: 'system',
          content: memoryContext
        })
      }

      let citationMetadata: ChatCitation[] = []

      // 3.2 RAG ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¢Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â£ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¹Ãƒâ€šÃ‚Â¶ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€¦ ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡
      // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚ÂªÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â®ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â»Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¤ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂµÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒâ€šÃ‚Â¶ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ RAG
      try {
        const effectiveSettings = (settings || {}) as Partial<AppSettings>
        const hasEmbeddingModel =
          effectiveSettings.defaultEmbeddingModel &&
          effectiveSettings.defaultEmbeddingModel.includes(':')
        const ragTopK = Math.min(Math.max(effectiveSettings.ragTopK ?? 3, 1), 8)
        const ragThreshold = Math.min(Math.max(effectiveSettings.ragThreshold ?? 0.62, 0), 1)
        const shortQueryLength = Math.min(
          Math.max(effectiveSettings.ragSkipShortQueryLength ?? 12, 4),
          32
        )
        const useChitChatHeuristic = effectiveSettings.ragEnableChitChatHeuristic ?? true
        const rerankEnabled = effectiveSettings.rerankEnabled ?? true
        const rerankTopN = Math.min(Math.max(effectiveSettings.rerankTopN ?? 12, ragTopK), 100)
        const rerankModel = effectiveSettings.defaultRerankModel?.trim() || undefined
        const rerankUseHeuristicFallback = effectiveSettings.rerankUseHeuristicFallback ?? true

        if (
          hasEmbeddingModel &&
          !(useChitChatHeuristic && isLikelyChitChat(content, shortQueryLength))
        ) {
          const session = queries.getSessionById(sessionId)
          if (session?.notebookId) {
            const ragStartedAt = Date.now()
            const searchResults = await knowledgeService.search(session.notebookId, content, {
              topK: ragTopK,
              threshold: ragThreshold,
              rerank: {
                enabled: rerankEnabled,
                topN: rerankTopN,
                model: rerankModel,
                heuristicFallback: rerankUseHeuristicFallback
              }
            })

            if (searchResults.length > 0) {
              const ragContextResult = buildRAGContext(searchResults)
              const ragContext = ragContextResult.context
              citationMetadata = buildCitations(
                searchResults.filter((item) => ragContextResult.includedChunkIds.has(item.chunkId))
              )
              Logger.debug(
                'ChatHandlers',
                `RAG: Found ${searchResults.length} relevant chunks for query, kept ${citationMetadata.length} chunks after prompt budget trim (topK=${ragTopK}, threshold=${ragThreshold}, rerankEnabled=${rerankEnabled}, rerankTopN=${rerankTopN}, latency=${Date.now() - ragStartedAt}ms)`
              )

              // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â°ÃƒÂ¢Ã¢â€šÂ¬  RAG ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€¦ ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Âº system message ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â°ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¡Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¤Ãƒâ€šÃ‚Â´
              if (ragContext) {
                messages.unshift({
                  role: 'system',
                  content: ragContext
                })
              }
            }
          }
        } else {
          Logger.debug(
            'ChatHandlers',
            hasEmbeddingModel
              ? 'RAG skipped: query identified as chit-chat/short text'
              : 'RAG disabled: No embedding model configured'
          )
        }
      } catch (error) {
        // RAG ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¤Ãƒâ€šÃ‚Â±ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂºÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â©Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â­Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚ÂªÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â°ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â½ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â­Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Ãƒâ€¦
        Logger.warn('ChatHandlers', 'RAG search failed:', error)
      }

      // 4. ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â°Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ AI Provider ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â
      const provider = await providerManager.getActiveChatProvider()
      if (!provider) {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          error: 'AI Provider not configured, please configure in settings'
        })
        return assistantMessage.id
      }

      const providerName = String((provider as any)?.name || '').toLowerCase()
      const isLlamaChat = providerName === 'llama' || providerName === 'llama-embed'
      if (isLlamaChat) {
        const chatReady = await llamaService.ensureChatStarted()
        if (!chatReady) {
          event.sender.send('message-error', {
            messageId: assistantMessage.id,
            error:
              'Local llama chat server is unavailable. Please check llama binary/model configuration and try again.'
          })
          return assistantMessage.id
        }
      }

      let fullTextContent = ''
      let fullReasoningContent = ''
      let usageMetadata: any = null

      // ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â°Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ Provider ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â,ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ AbortControllerÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒâ€¦Ã‚Â½ AI SDK fullStreamÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°
      const abortController = await provider.sendMessageStream(
        messages,
        // onChunk - ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¤ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬  AI SDK fullStream ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â§Ãƒâ€šÃ‚Â part ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â±Ãƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
        (chunk) => {
          const { metadata, content, done } = chunk

          // 1. ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
          if (metadata?.reasoningStart) {
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-start',
              reasoningId: metadata.reasoningId
            })
          }
          // 2. ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¢Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹
          else if (metadata?.isReasoning) {
            fullReasoningContent += content

            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-delta',
              content: content,
              reasoningId: metadata.reasoningId
            })
          }
          // 3. ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€¦Ã‚Â¸
          else if (metadata?.reasoningEnd) {
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-end',
              reasoningId: metadata.reasoningId
            })
          }
          // 4. ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢Ãƒâ€šÃ‚Â®ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¹Ã¢â‚¬Â text-deltaÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°
          else if (content) {
            fullTextContent += content

            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'text-delta',
              content: content
            })
          }

          // 5. ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¼Ãƒâ€š ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â
          if (done) {
            // ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¿Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â­Ãƒâ€¹Ã…â€œ usage metadata
            if (metadata?.usage) {
              usageMetadata = metadata
            }

            // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â¶
            const finishMetadata: ChatMessageMetadata = {
              ...(metadata || {}),
              citations: citationMetadata
            }
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'finish',
              metadata: finishMetadata
            })
          }
        },
        // onError
        (error) => {
          event.sender.send('message-error', {
            messageId: assistantMessage.id,
            error: error.message
          })
          cleanupStream(assistantMessage.id)
        },
        // onComplete
        async () => {
          try {
            const finalMetadata: ChatMessageMetadata = {
              ...(usageMetadata || {}),
              citations: citationMetadata
            }

            // Update DB with final content (including reasoning)
            queries.updateMessageContent(
              assistantMessage.id,
              fullTextContent,
              fullReasoningContent,
              finalMetadata
            )

            let tokensUsed = 0
            if (usageMetadata?.usage?.totalTokens) {
              tokensUsed = usageMetadata.usage.totalTokens
            } else {
              const userTokens = SessionAutoSwitchService.estimateTokens(content)
              const assistantTokens = SessionAutoSwitchService.estimateTokens(fullTextContent)
              tokensUsed = userTokens + assistantTokens
            }

            Logger.debug('ChatHandlers', `Tokens used in this conversation: ${tokensUsed}`)

            const newSessionId = await sessionAutoSwitchService.recordTokenUsageAndCheckSwitch(
              sessionId,
              tokensUsed
            )

            if (newSessionId) {
              event.sender.send('session-auto-switched', {
                oldSessionId: sessionId,
                newSessionId
              })
            }

            event.sender.send('message-complete', { messageId: assistantMessage.id })
          } catch (error) {
            Logger.error('ChatHandlers', 'Error in completion callback:', error)
            event.sender.send('message-error', {
              messageId: assistantMessage.id,
              error: 'Error occurred while processing message'
            })
          } finally {
            cleanupStream(assistantMessage.id)
          }
        }
      )

      // BUG-05 Fix: Track stream with timestamp for stale cleanup
      trackStream(assistantMessage.id, abortController)

      return assistantMessage.id
    })
  )

  // ==================== Abort Message ====================
  ipcMain.handle(
    'abort-message',
    validate(ChatSchemas.abortMessage, async (args) => {
      const controller = activeStreams.get(args.messageId)

      if (controller) {
        Logger.info('ChatHandlers', `Aborting message: ${args.messageId}`)
        controller.abort()
        cleanupStream(args.messageId)
        return { success: true }
      } else {
        Logger.warn('ChatHandlers', `No active stream found for message: ${args.messageId}`)
        return { success: false, reason: 'No active stream found' }
      }
    })
  )
}
