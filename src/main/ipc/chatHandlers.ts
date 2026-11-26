import { ipcMain } from 'electron'
import * as queries from '../db/queries'
import { ApiClient } from '../ai/apiClient'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { validateAndCleanMessages } from '../utils/messageValidator'
import { settingsManager } from '../config'
import { markActive } from '../utils/activityTracker'
import type { ChatCitation, ChatMessageMetadata } from '../../shared/types/chat'
import type { AppSettings } from '../../shared/types'
import Logger from '../../shared/utils/logger'
import { buildScopeFilter } from '../utils/chatScope'
import {
  extractArticleRefs,
  extractArticleRefsFromContent,
  mergeSearchResults,
  prioritizeArticleMatches
} from '../utils/articleRefs'
import { extractDefinitionTerm, namesSpecificLaw } from '../services/rag/legalContext'
import {
  buildRAGContext,
  RAG_BASE_CONTEXT_TOKENS,
  sectionKeyOf
} from '../services/rag/promptContext'
import { estimateTokens } from '../../shared/utils/tokenEstimate'
import { sanitizeUntrustedPromptBlock } from '../services/rag/promptBoundary'
import { ChatSchemas, validate, validateWithEvent } from './validation'

// Active streaming requests map (messageId -> AbortController)
const activeStreams = new Map<string, AbortController>()

// BUG-05: Cleanup guard — remove stale streams older than 10 minutes.
// A full legal article can take 200-300s on an iGPU; 5 minutes used to abort
// long but healthy answers.
const STREAM_TIMEOUT_MS = 10 * 60 * 1000
const streamTimestamps = new Map<string, number>()

/** Dự phòng prompt overhead + câu trả lời khi tính ngân sách ngữ cảnh RAG. */
const RAG_TOKENS_RESERVED = 2_400

/**
 * Definition questions need several short definition chunks from the same
 * (possibly huge) section. Section de-duplication would keep only the first
 * one, so these queries use a wider candidate pool and keep distinct chunks.
 */
function isDefinitionQuery(query: string): boolean {
  return (
    /(định nghĩa|khái niệm|giải thích từ ngữ|được hiểu)/iu.test(query) ||
    extractDefinitionTerm(query) !== null
  )
}

function isEnumerationQuery(query: string): boolean {
  return /(gồm những|bao gồm|những loại|những nhóm|các loại|các nhóm|liệt kê|gồm các|danh sách)/iu.test(
    query
  )
}

function trackStream(messageId: string, controller: AbortController): void {
  activeStreams.set(messageId, controller)
  streamTimestamps.set(messageId, Date.now())
}

function touchStream(messageId: string): void {
  if (streamTimestamps.has(messageId)) {
    streamTimestamps.set(messageId, Date.now())
  }
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
    .map((item, index) => {
      const title = sanitizeUntrustedPromptBlock(item.title).replace(/"/g, "'")
      const summary = sanitizeUntrustedPromptBlock(item.summary)
      return `<memory index="${index + 1}" title="${title}">\n${summary}\n</memory>`
    })
    .join('\n\n')

  return `Long-term conversation memory from previous archived sessions:\n\n${blocks}\n\nUse this memory only as background context. If user intent conflicts with old memory, follow the newest user instruction.`
}

/** Bỏ dấu tiếng Việt để so khớp nhận cả "chào" lẫn "chao". */
function stripVietnameseDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
}

function isLikelyChitChat(query: string, shortQueryLength: number): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (q.length < shortQueryLength) return true

  const englishPatterns = [
    /^(hi|hello|hey)\b/,
    /^(good (morning|afternoon|evening))/,
    /^thank you\b/
  ]
  if (englishPatterns.some((re) => re.test(q))) return true

  const ascii = stripVietnameseDiacritics(q)
  const vietnamesePatterns = [/^(xin chao|chao)\b/, /^ban co the giup/, /^cam on\b/]

  return vietnamesePatterns.some((re) => re.test(ascii))
}

function normalizeCitationSnippet(raw: string, maxLength = 2000): string {
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
    sectionPath?: string[]
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
    pageNumber: result.pageNumber,
    sectionPath: result.sectionPath
  }))
}

/**
 * Register chat-related IPC Handlers
 */
export function registerChatHandlers(
  apiClient: ApiClient,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService
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
      const { sessionId, content, scope } = args
      const session = queries.getSessionById(sessionId)
      if (!session?.notebookId) {
        return { messageId: '', error: 'Session not found' }
      }

      // Fail before writing rows so the renderer never receives an error for a
      // placeholder it has not seen yet.
      const provider = await apiClient.getChatProvider()
      if (!provider) {
        return {
          messageId: '',
          error:
            'Chat API is not configured. Set the API base URL in Settings > API and load a chat model in the external server.'
        }
      }

      queries.createMessage(sessionId, 'user', content)
      const assistantMessage = queries.createMessage(sessionId, 'assistant', '')
      event.sender.send('message-created', {
        messageId: assistantMessage.id,
        sessionId,
        notebookId: session.notebookId
      })

      // 3. Load conversation history.
      const history = queries.getMessagesBySession(sessionId)
      let messages = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }))

      // 3.1 Validate and clean the message history.
      messages = validateAndCleanMessages(messages)

      // Reject an empty history after cleanup.
      if (messages.length === 0) {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          notebookId: session.notebookId,
          error: 'No valid conversation history'
        })
        return { messageId: assistantMessage.id }
      }

      const settings = await settingsManager.getAllSettings().catch(() => null)
      const activeLanguage = settings?.language || 'vi-VN'
      const personaPrompt =
        settings?.prompts?.chat?.[activeLanguage] || settings?.prompts?.chat?.['vi-VN']
      const systemParts: string[] = []
      if (personaPrompt?.trim()) {
        systemParts.push(personaPrompt.trim())
      }

      const summaries: Array<{ title: string; summary: string }> = []
      let cursorSessionId = session.parentSessionId
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
        systemParts.push(memoryContext)
      }

      let citationMetadata: ChatCitation[] = []
      let ragContext = ''

      // 3.2 RAG retrieval (scope-aware hierarchical search).
      // Skip RAG only for chit-chat or very short queries.
      try {
        const effectiveSettings = (settings || {}) as Partial<AppSettings>
        const hasEmbeddingModel = Boolean(await apiClient.getEmbeddingProvider())
        const ragTopK = Math.min(Math.max(effectiveSettings.ragTopK ?? 5, 1), 16)
        const ragThreshold = Math.min(Math.max(effectiveSettings.ragThreshold ?? 0.5, 0), 1)
        const shortQueryLength = Math.min(
          Math.max(effectiveSettings.ragSkipShortQueryLength ?? 12, 4),
          32
        )
        const useChitChatHeuristic = effectiveSettings.ragEnableChitChatHeuristic ?? true
        const rerankEnabled = effectiveSettings.rerankEnabled ?? false
        const rerankTopN = Math.min(Math.max(effectiveSettings.rerankTopN ?? 12, ragTopK), 100)
        const rerankUseHeuristicFallback = effectiveSettings.rerankUseHeuristicFallback ?? true
        const hierarchicalEnabled = effectiveSettings.ragHierarchicalEnabled ?? true
        const hierarchicalDocTopK = Math.min(Math.max(effectiveSettings.ragDocTopK ?? 8, 1), 50)
        const metadataAwareEnabled = effectiveSettings.ragMetadataAwareEnabled ?? true
        const retrievalDebugEnabled = effectiveSettings.ragRetrievalDebugEnabled ?? false

        if (
          hasEmbeddingModel &&
          !(useChitChatHeuristic && isLikelyChitChat(content, shortQueryLength))
        ) {
          if (session.notebookId) {
            const ragStartedAt = Date.now()
            const explicitScope = buildScopeFilter(scope)
            const articleRefs = extractArticleRefs(content)
            const definitionQuery = isDefinitionQuery(content)
            const needsWidePool = articleRefs.length > 0 || definitionQuery
            const requestedTopK = needsWidePool ? 16 : ragTopK
            // Definitions are often a single short clause buried under many
            // generic chunks. Widen the rerank pool for this query type so
            // the defining clause survives the final top-K cut.
            const effectiveRerankEnabled = rerankEnabled || definitionQuery
            const effectiveRerankTopN = definitionQuery ? Math.max(rerankTopN, 50) : rerankTopN

            const retrievalOptions = {
              topK: requestedTopK,
              threshold: ragThreshold,
              hierarchical: {
                enabled: hierarchicalEnabled,
                docTopK: hierarchicalDocTopK
              },
              rerank: {
                enabled: effectiveRerankEnabled,
                topN: effectiveRerankTopN,
                heuristicFallback: rerankUseHeuristicFallback
              }
            }

            const runSearch = async (hierarchical: boolean) => {
              const options = {
                ...retrievalOptions,
                hierarchical: { ...retrievalOptions.hierarchical, enabled: hierarchical }
              }
              if (metadataAwareEnabled) {
                return knowledgeService.searchMetadataAware(session.notebookId, content, {
                  ...options,
                  metadataFilter: explicitScope,
                  metadataAware: { enabled: true, debug: retrievalDebugEnabled }
                })
              }
              return {
                results: await knowledgeService.search(session.notebookId, content, {
                  ...options,
                  metadataFilter: explicitScope
                })
              }
            }

            const [metadataOutcome, flatOutcome] = await Promise.all([
              runSearch(hierarchicalEnabled),
              // The flat pass is only needed when explicit articles/definitions
              // can be hidden by section scoping; otherwise it doubles latency.
              needsWidePool && hierarchicalEnabled
                ? runSearch(false).catch((error) => {
                    Logger.warn('ChatHandlers', 'Flat RAG search failed:', error)
                    return null
                  })
                : Promise.resolve(null)
            ])
            const inExplicitScope = (item: {
              documentId: string
              sectionPath?: string[]
              pageNumber?: number
            }): boolean => {
              if (!explicitScope) return true
              if (
                explicitScope.documentIds?.length &&
                !explicitScope.documentIds.includes(item.documentId)
              ) {
                return false
              }
              if (explicitScope.sectionPath?.length) {
                const path = (item.sectionPath ?? []).join(' > ').toLowerCase()
                if (!explicitScope.sectionPath.every((part) => path.includes(part.toLowerCase()))) {
                  return false
                }
              }
              if (explicitScope.pageRange) {
                if (typeof item.pageNumber !== 'number') return false
                if (
                  item.pageNumber < explicitScope.pageRange.from ||
                  item.pageNumber > explicitScope.pageRange.to
                ) {
                  return false
                }
              }
              return true
            }
            const baseResults = mergeSearchResults(
              metadataOutcome.results,
              flatOutcome?.results ?? []
            )
            // Prefer the document that actually matched the question. If the
            // question names a law that is not in the notebook, the retrieval
            // service returns no structural block instead of falling back to
            // the first article with the same number from another law.
            const namesLaw = namesSpecificLaw(content)
            const seedDocumentIds = explicitScope?.documentIds?.length
              ? explicitScope.documentIds
              : !namesLaw && baseResults[0]
                ? [baseResults[0].documentId]
                : undefined

            // Full-article blocks come from source offsets, so long lists keep
            // every clause and overlapping chunk text is removed exactly once.
            const definitionEvidence = definitionQuery
              ? knowledgeService
                  .searchDefinitionEvidence(session.notebookId, content, 2, seedDocumentIds)
                  .filter(inExplicitScope)
              : []
            const articleContext =
              articleRefs.length > 0
                ? knowledgeService
                    .getArticleContext(session.notebookId, articleRefs, {
                      query: content,
                      documentIds: seedDocumentIds,
                      maxArticles: Math.min(Math.max(articleRefs.length, 1), 8),
                      maxChars: 12_000
                    })
                    .filter(inExplicitScope)
                : []
            const structuralBlocks = [...definitionEvidence, ...articleContext]
            const structuralSections = new Set(structuralBlocks.map(sectionKeyOf))

            // A section heading can be cut at the chapter boundary, leaving a
            // chunk whose sectionPath is only "Chương II" (Điều 10 of the
            // Cybersecurity Law). When the question asks for a list, read the
            // article heading from the chunk itself and expand that article.
            if (isEnumerationQuery(content)) {
              for (const candidate of baseResults.slice(0, 8)) {
                if (structuralBlocks.length >= 3) break
                const seedText = candidate.matchedContent ?? candidate.content
                for (const ref of extractArticleRefsFromContent(seedText, 1)) {
                  // Only trust a heading at the beginning of the matched
                  // passage, not a reference to the next article at its tail.
                  const headingIndex = seedText.search(new RegExp(`Điều\\s+${ref}`, 'iu'))
                  if (headingIndex < 0 || headingIndex > 120) continue
                  const blocks = knowledgeService
                    .getArticleContext(session.notebookId, [ref], {
                      query: content,
                      documentIds: [candidate.documentId],
                      maxArticles: 1,
                      maxChars: 12_000
                    })
                    .filter(inExplicitScope)
                  for (const block of blocks) {
                    const key = sectionKeyOf(block)
                    if (structuralSections.has(key)) continue
                    structuralSections.add(key)
                    structuralBlocks.push(block)
                  }
                }
              }
            }

            const directEvidencePool = knowledgeService
              .searchDirectEvidence(session.notebookId, content, 4, seedDocumentIds)
              .filter(inExplicitScope)
            // The top-ranked semantic document does not always contain the
            // date/time-limit clause; when the seeded scan finds nothing,
            // fall back to a notebook-wide scan (the filter is cheap).
            const directEvidence =
              directEvidencePool.length === 0 && seedDocumentIds?.length
                ? knowledgeService
                    .searchDirectEvidence(session.notebookId, content, 4)
                    .filter(inExplicitScope)
                : directEvidencePool
            const isCoveredByStructuralBlock = (result: {
              documentId: string
              content: string
            }): boolean =>
              structuralBlocks.some(
                (block) =>
                  block.documentId === result.documentId &&
                  block.content.length > result.content.length &&
                  block.content.includes(
                    result.content.slice(0, Math.min(240, result.content.length))
                  )
              )
            const semanticResults = mergeSearchResults(directEvidence, baseResults).filter(
              (result) =>
                !structuralSections.has(sectionKeyOf(result)) && !isCoveredByStructuralBlock(result)
            )
            // Direct evidence (effective dates, time limits) must survive even
            // when a complete article block is present or the article block is
            // clipped. Keep it as its own document; never drop the exact clause.
            const requiredEvidence = directEvidence
            const requiredIds = new Set(requiredEvidence.map((result) => result.chunkId))
            const supplementalPool = semanticResults.filter(
              (result) => !requiredIds.has(result.chunkId)
            )
            const supplementalLimit =
              structuralBlocks.length > 0 ? (definitionQuery ? 0 : 1) : Math.max(ragTopK, 5)
            const searchResults = [
              // Exact date/time-limit evidence goes first so the prompt
              // budget can never drop it behind large article blocks.
              ...requiredEvidence,
              ...structuralBlocks,
              ...prioritizeArticleMatches(articleRefs, supplementalPool).slice(0, supplementalLimit)
            ]
            if (retrievalDebugEnabled && 'trace' in metadataOutcome) {
              Logger.info(
                'ChatHandlers',
                `Retrieval trace: ${JSON.stringify(metadataOutcome.trace)}`
              )
            }

            if (searchResults.length > 0) {
              // Whole-article and definition blocks are much larger than the
              // chunk-sized documents the base budget assumed. Widen the
              // budget per structural block, but never past what the
              // configured context window can hold after reserving room for
              // the fixed prompt overhead and the answer itself.
              const ragTokenBudget =
                structuralBlocks.length > 0
                  ? Math.min(
                      RAG_BASE_CONTEXT_TOKENS + 1200 * Math.min(structuralBlocks.length, 4),
                      Math.max(
                        (await apiClient.getContextWindow()) - RAG_TOKENS_RESERVED,
                        RAG_BASE_CONTEXT_TOKENS
                      )
                    )
                  : undefined
              const ragContextResult = buildRAGContext(searchResults, {
                // Article-scoped retrievals deliberately return adjacent
                // clauses from the same large article (for example a time-limit
                // list split across chunks), so keep both.
                dedupeSections: !definitionQuery && articleRefs.length === 0,
                tokenBudget: ragTokenBudget
              })
              ragContext = ragContextResult.context
              citationMetadata = buildCitations(
                searchResults.filter((item) => ragContextResult.includedChunkIds.has(item.chunkId))
              )
              Logger.debug(
                'ChatHandlers',
                `RAG: Found ${searchResults.length} relevant chunks for query, kept ${citationMetadata.length} chunks after prompt budget trim (topK=${requestedTopK}, threshold=${ragThreshold}, rerankEnabled=${rerankEnabled}, rerankTopN=${rerankTopN}, hierarchical=${hierarchicalEnabled}, scoped=${!!explicitScope}, contextTokens=${estimateTokens(ragContext)}, latency=${Date.now() - ragStartedAt}ms)`
              )
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
        // RAG is best-effort: log and continue without context.
        Logger.warn('ChatHandlers', 'RAG search failed:', error)
      }

      if (ragContext) systemParts.push(ragContext)

      // Qwen/llama.cpp chat templates accept only one system message at the
      // beginning. Merge persona, long-term memory and RAG context into a
      // single leading system message instead of unshifting them separately.
      if (systemParts.length > 0) {
        const existingSystem = messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
        const conversation = messages.filter((message) => message.role !== 'system')
        messages = [
          {
            role: 'system' as const,
            content: [...existingSystem, ...systemParts].filter(Boolean).join('\n\n---\n\n')
          },
          ...conversation
        ]
      }

      let fullTextContent = ''
      let fullReasoningContent = ''
      let usageMetadata: ChatMessageMetadata | null = null

      // Call the provider's streaming generation and get an AbortController (based on AI SDK fullStream)
      // Đánh dấu hoạt động để background queue tạm dừng khi user đang chat
      markActive()
      const abortController = await provider.sendMessageStream(
        messages,
        (chunk) => {
          const { metadata, content, done } = chunk
          touchStream(assistantMessage.id)

          // 1. Reasoning block started.
          if (metadata?.reasoningStart) {
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-start',
              reasoningId: metadata.reasoningId
            })
          }
          // 2. Reasoning delta.
          else if (metadata?.isReasoning) {
            fullReasoningContent += content

            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-delta',
              content: content,
              reasoningId: metadata.reasoningId
            })
          }
          // 3. Reasoning block ended.
          else if (metadata?.reasoningEnd) {
            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'reasoning-end',
              reasoningId: metadata.reasoningId
            })
          }
          // 4. Assistant text delta.
          else if (content) {
            fullTextContent += content

            event.sender.send('message-chunk', {
              messageId: assistantMessage.id,
              type: 'text-delta',
              content: content
            })
          }

          // 5. Stream metadata and finish marker.
          if (done) {
            // Save usage metadata
            if (metadata?.usage) {
              usageMetadata = metadata
            }

            // Send the completion event
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
            notebookId: session.notebookId,
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
          } catch (error) {
            Logger.error('ChatHandlers', 'Error in completion callback:', error)
            event.sender.send('message-error', {
              messageId: assistantMessage.id,
              notebookId: session.notebookId,
              error: 'Error occurred while processing message'
            })
          } finally {
            cleanupStream(assistantMessage.id)
          }
        },
        { maxTokens: 2048, temperature: 0.2 }
      )

      // BUG-05 Fix: Track stream with timestamp for stale cleanup
      trackStream(assistantMessage.id, abortController)

      return { messageId: assistantMessage.id }
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
