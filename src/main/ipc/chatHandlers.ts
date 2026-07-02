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
import type { APIMessage, ChatCitation, ChatMessageMetadata } from '../../shared/types/chat'
import type { AppSettings } from '../../shared/types'
import Logger from '../../shared/utils/logger'
import { ChatSchemas, validate, validateWithEvent } from './validation'
import { buildRAGContext } from './chatContext'

const activeStreams = new Map<string, AbortController>()
const STREAM_TIMEOUT_MS = 5 * 60 * 1000
const streamTimestamps = new Map<string, number>()

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
    /^(xin chao|chao|ch?o)\b/,
    /^(good (morning|afternoon|evening))/,
    /^(ban|b?n) (co|c?) (the|th?) (giup|gi?p)/,
    /^(cam on|c?m ?n|thank you)\b/
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
  const handleSendMessage = validateWithEvent(ChatSchemas.sendMessage, async (event, args) => {
      const { sessionId, content } = args
      const mode = args.mode || 'chat'

      queries.createMessage(sessionId, 'user', content)

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

      const settings = await settingsManager.getAllSettings().catch(() => null)
      const history = queries.getMessagesBySession(sessionId)
      let messages: APIMessage[] = history.map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }))


      messages = validateAndCleanMessages(messages)

      if (messages.length === 0) {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          error: 'No valid conversation history'
        })
        return assistantMessage.id
      }
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
        const rerankEnabled = Boolean(effectiveSettings.defaultRerankModel?.trim()) && (effectiveSettings.rerankEnabled ?? true)
        const rerankTopN = Math.min(Math.max(effectiveSettings.rerankTopN ?? 12, ragTopK), 100)
        const rerankModel = effectiveSettings.defaultRerankModel?.trim() || undefined
        const rerankUseHeuristicFallback = effectiveSettings.rerankUseHeuristicFallback ?? true

        if (
          hasEmbeddingModel &&
          (mode === 'ask' || !(useChitChatHeuristic && isLikelyChitChat(content, shortQueryLength)))
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
        Logger.warn('ChatHandlers', 'RAG search failed:', error)
      }

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

      const abortController = await provider.sendMessageStream(
        messages,
        (chunk) => {
          const { metadata, content, done } = chunk

          if (metadata?.reasoningStart) {
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-start',
              reasoningId: metadata.reasoningId
            })
          }
          else if (metadata?.isReasoning) {
            fullReasoningContent += content

            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-delta',
              content: content,
              reasoningId: metadata.reasoningId
            })
          }
          else if (metadata?.reasoningEnd) {
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-end',
              reasoningId: metadata.reasoningId
            })
          }
          else if (content) {
            fullTextContent += content

            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'text-delta',
              content: content
            })
          }

          if (done) {
            if (metadata?.usage) {
              usageMetadata = metadata
            }

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

  ipcMain.handle('send-message', handleSendMessage)
  ipcMain.handle('ask-message', async (event, args) =>
    handleSendMessage(event, { ...(args || {}), mode: 'ask' })
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


