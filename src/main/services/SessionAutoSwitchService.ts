import * as queries from '../db/queries'
import { ProviderManager } from '../providers/ProviderManager'
import { KnowledgeService } from './KnowledgeService'
import Logger from '../../shared/utils/logger'

/**
 * Session Auto Switch Service
 * Manages session token counting and automatic switching logic
 */
export class SessionAutoSwitchService {
  // Ngưỡng mặc định (fallback khi không có ctx của model local).
  // Khi có ctx thực tế: dùng 80% ctx của model đang chạy (tránh tràn ctx llama-server).
  private static readonly DEFAULT_TOKEN_THRESHOLD = 8000
  private static readonly MAX_TOKEN_THRESHOLD = 100000

  private providerManager: ProviderManager
  private knowledgeService: KnowledgeService | null
  private tokenThreshold: number

  constructor(
    providerManager: ProviderManager,
    knowledgeService?: KnowledgeService | null,
    chatCtxSize?: number | null
  ) {
    this.providerManager = providerManager
    this.knowledgeService = knowledgeService ?? null
    this.tokenThreshold =
      chatCtxSize && chatCtxSize > 0
        ? Math.min(
            Math.max(Math.floor(chatCtxSize * 0.8), 2048),
            SessionAutoSwitchService.MAX_TOKEN_THRESHOLD
          )
        : SessionAutoSwitchService.DEFAULT_TOKEN_THRESHOLD
    Logger.info(
      'SessionAutoSwitch',
      `Token threshold set to ${this.tokenThreshold}${chatCtxSize ? ` (ctx=${chatCtxSize})` : ''}`
    )
  }

  /**
   * Record token usage and check if session switch is needed
   * @returns If session was switched, returns new session ID; otherwise returns null
   */
  async recordTokenUsageAndCheckSwitch(
    sessionId: string,
    tokensUsed: number
  ): Promise<string | null> {
    // Update token count
    const newTotal = queries.updateSessionTokens(sessionId, tokensUsed)

    Logger.debug('SessionAutoSwitch', `Session ${sessionId} current tokens: ${newTotal}`)

    // Check if switch is needed
    if (newTotal && newTotal >= this.tokenThreshold) {
      Logger.info(
        'SessionAutoSwitch',
        `Token count reached threshold (${newTotal}/${this.tokenThreshold}), starting session switch...`
      )
      return await this.switchSession(sessionId)
    }

    return null
  }

  /**
   * Switch session: generate summary, archive old session, create new session
   */
  private async switchSession(oldSessionId: string): Promise<string> {
    // 1. Get old session info
    const oldSession = queries.getSessionById(oldSessionId)
    if (!oldSession) {
      throw new Error(`Session ${oldSessionId} not found`)
    }

    // 2. Generate summary
    Logger.info('SessionAutoSwitch', 'Generating session summary...')
    const summary = await this.generateSummary(oldSessionId)

    // 3. Archive old session
    queries.updateSessionSummary(oldSessionId, summary, 'archived')
    Logger.info('SessionAutoSwitch', 'Old session archived')

    // 4. Store summary vào KB dạng memory (có embedding, search được)
    if (this.knowledgeService) {
      void this.knowledgeService
        .storeSessionMemory(oldSession.notebookId, oldSessionId, summary, oldSession.title)
        .catch((error) => {
          Logger.error('SessionAutoSwitch', 'Failed to store session memory:', error)
        })
    }

    // 5. Create new session, set parent session ID
    const newSession = queries.createSession(
      oldSession.notebookId,
      oldSession.title, // Keep same title
      oldSessionId // Set parent session ID to form chain
    )

    // 6. Add lightweight system message in new session (optional)
    // Users shouldn't notice session switch, so simplify prompt
    queries.createMessage(
      newSession.id,
      'system',
      `💡 Context optimized, conversation continues...`
    )

    Logger.info('SessionAutoSwitch', `Created new session: ${newSession.id}`)

    return newSession.id
  }

  /**
   * Generate session summary
   */
  private async generateSummary(sessionId: string): Promise<string> {
    const messages = queries.getMessagesBySession(sessionId)

    // Build summary prompt
    const conversationText = messages
      .filter((m) => m.role !== 'system') // Filter system messages
      .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
      .join('\n\n')

    const summaryPrompt = `Please concisely summarize the core content of the following conversation, preserving key information, important decisions, and technical details. The summary should be within 300 words.

Conversation content:
${conversationText}

Please provide summary:`

    // Call AI to generate summary
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      // If no provider configured, return a basic summary
      return `This conversation contains ${messages.length} messages.`
    }

    return new Promise<string>((resolve) => {
      let summaryContent = ''

      provider.sendMessageStream(
        [
          {
            role: 'user',
            content: summaryPrompt
          }
        ],
        // onChunk
        (chunk) => {
          summaryContent += chunk.content
        },
        // onError
        (error) => {
          Logger.error('SessionAutoSwitch', 'Failed to generate summary:', error)
          // Fallback: return simple summary
          resolve(`This conversation contains ${messages.length} messages.`)
        },
        // onComplete
        () => {
          resolve(summaryContent.trim())
        }
      )
    })
  }

  /**
   * Estimate token count for messages
   * Use improved algorithm to distinguish VietNam/English characters for better accuracy
   *
   * Reference:
   * - English/numbers/symbols: ~4 chars = 1 token
   * - VietNam/Japanese/Korean: ~1.5 chars = 1 token
   * - Code blocks: ~3.5 chars = 1 token
   */
  static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0

    let vietnamChars = 0
    let englishChars = 0
    let codeChars = 0

    // Detect if in code block
    const codeBlockRegex = /```[\s\S]*?```|`[^`]+`/g
    const codeBlocks = text.match(codeBlockRegex) || []

    // Count code block characters
    codeBlocks.forEach((block) => {
      codeChars += block.length
    })

    // Count other characters after removing code blocks
    const textWithoutCode = text.replace(codeBlockRegex, '')

    for (const char of textWithoutCode) {
      const code = char.charCodeAt(0)

      // VietNam character ranges (CJK Unified Ideographs)
      if (
        (code >= 0x4e00 && code <= 0x9fff) || // CJK Basic Ideographs
        (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
        (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
        (code >= 0x3040 && code <= 0x309f) || // Japanese Hiragana
        (code >= 0x30a0 && code <= 0x30ff) || // Japanese Katakana
        (code >= 0xac00 && code <= 0xd7af) // Korean Hangul
      ) {
        vietnamChars++
      } else {
        englishChars++
      }
    }

    // Calculate token count for each part
    const vietnamTokens = vietnamChars / 1.5 // VietNam: 1.5 chars ≈ 1 token
    const englishTokens = englishChars / 4 // English: 4 chars ≈ 1 token
    const codeTokens = codeChars / 3.5 // Code: 3.5 chars ≈ 1 token

    return Math.ceil(vietnamTokens + englishTokens + codeTokens)
  }
}
