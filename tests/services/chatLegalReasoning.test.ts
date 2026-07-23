import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalReasoningResult } from '../../src/shared/types/legalReasoning'
import type { APIMessage, ChatMessageMetadata, StreamChunk } from '../../src/shared/types/chat'
import type { ProviderManager } from '../../src/main/providers/ProviderManager'
import type { SessionAutoSwitchService } from '../../src/main/services/SessionAutoSwitchService'
import type { KnowledgeService } from '../../src/main/services/KnowledgeService'
import type { LlamaService } from '../../src/main/services/LlamaService'
import type { LegalReasoningService } from '../../src/main/services/legalGraph/LegalReasoningService'
import type { LegalGraphWorker } from '../../src/main/services/legalGraph/LegalGraphWorker'
import { estimateChatTokens } from '../../src/main/services/ChatPromptBudget'

type IpcHandler = (...args: unknown[]) => unknown
interface SentPayload {
  messageId?: string
  type?: string
  content?: string
  metadata?: ChatMessageMetadata
  phase?: string
  elapsedMs?: number
}

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  createMessage: vi.fn(),
  getMessagesBySession: vi.fn(),
  getSessionById: vi.fn(),
  updateMessageContent: vi.fn(),
  getAllSettings: vi.fn(),
  getLicenseStatus: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../src/main/db/queries', () => ({
  createMessage: mocks.createMessage,
  getMessagesBySession: mocks.getMessagesBySession,
  getSessionById: mocks.getSessionById,
  updateMessageContent: mocks.updateMessageContent,
  createSession: vi.fn(),
  getSessionsByNotebook: vi.fn(),
  getActiveSessionByNotebook: vi.fn(),
  updateSessionTitle: vi.fn(),
  deleteSession: vi.fn()
}))

vi.mock('../../src/main/config', () => ({
  settingsManager: { getAllSettings: mocks.getAllSettings }
}))

vi.mock('../../src/main/services/LicenseService', () => ({
  LicenseService: { getStatus: mocks.getLicenseStatus }
}))

import { registerChatHandlers } from '../../src/main/ipc/chatHandlers'

const reasoningResult: LegalReasoningResult = {
  intent: 'sanction',
  graphStatus: 'ready',
  paths: [
    {
      score: 0.82,
      minimumConfidence: 0.9,
      steps: [
        {
          relationId: 'relation-1',
          relationType: 'sanction_for',
          sourceNodeId: 'action-1',
          sourceLabel: 'Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1',
          targetNodeId: 'sanction-1',
          targetLabel: 'Ph\u1ea1t ti\u1ec1n',
          confidence: 0.9,
          citationIds: [2]
        }
      ]
    }
  ],
  limitations: [],
  evidence: [
    {
      citationId: 2,
      notebookId: 'notebook-1',
      documentId: 'document-1',
      documentTitle: 'Lu\u1eadt th\u1eed nghi\u1ec7m',
      chunkId: 'chunk-2',
      chunkIndex: 2,
      content: '\u0110i\u1ec1u 2. Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb ph\u1ea1t ti\u1ec1n.',
      score: 0.88
    }
  ],
  context: 'Chu\u1ed7i ch\u1ee9ng c\u1ee9 \u0111\u00e3 x\u00e1c minh: [1] sanction_for [2].'
}

describe('chat legal reasoning integration', () => {
  let sentEvents: Array<{ channel: string; payload: SentPayload }>
  let streamCallbacks: {
    onChunk?: (chunk: StreamChunk) => void
    onError?: (error: Error) => void
    onComplete?: () => void | Promise<void>
  }
  let modelText: string
  let worker: { setChatActive: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    sentEvents = []
    streamCallbacks = {}
    modelText = 'K\u1ebft lu\u1eadn [1].'
    worker = { setChatActive: vi.fn() }

    mocks.createMessage.mockImplementation((_sessionId: string, role: string) => ({
      id: role === 'assistant' ? 'assistant-1' : 'user-1'
    }))
    mocks.getMessagesBySession.mockReturnValue([
      { role: 'user', content: 'Doanh nghi\u1ec7p b\u1ecb ph\u1ea1t th\u1ebf n\u00e0o?' }
    ])
    mocks.getSessionById.mockReturnValue({
      id: 'session-1',
      notebookId: 'notebook-1',
      parentSessionId: null
    })
    mocks.getAllSettings.mockResolvedValue({
      language: 'vi-VN',
      defaultEmbeddingModel: 'local:embedding',
      ragEnableChitChatHeuristic: false,
      ragTopK: 3,
      ragThreshold: 0.5,
      rerankEnabled: false,
      rerankTopN: 3,
      rerankUseHeuristicFallback: true,
      prompts: { chat: {} }
    })
    mocks.getLicenseStatus.mockReturnValue({ valid: true, message: 'ok' })
  })

  function crossWorkResults() {
    return [
      {
        chunkId: 'chunk-1',
        documentId: 'document-1',
        documentTitle: 'Lu\u1eadt th\u1eed nghi\u1ec7m',
        documentType: 'text',
        content: '\u0110i\u1ec1u 1. Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1.',
        matchedContent: 'Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1.',
        score: 0.95,
        chunkIndex: 1,
        metadata: { legalContext: { articleNumber: '1' } },
        documentMetadata: { legalDocument: true, canonicalGraphDocumentId: 'document-1' }
      },
      {
        chunkId: 'chunk-2',
        documentId: 'document-2',
        documentTitle: 'Ngh\u1ecb \u0111\u1ecbnh th\u1eed nghi\u1ec7m',
        documentType: 'text',
        content: '\u0110i\u1ec1u 2. Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb ph\u1ea1t ti\u1ec1n.',
        matchedContent: 'Ch\u1eadm n\u1ed9p h\u1ed3 s\u01a1 b\u1ecb ph\u1ea1t ti\u1ec1n.',
        score: 0.88,
        chunkIndex: 2,
        metadata: { legalContext: { articleNumber: '2' } },
        documentMetadata: { legalDocument: true, canonicalGraphDocumentId: 'document-2' }
      }
    ]
  }

  async function sendLegalMessage(
    content: string,
    outcome: 'complete' | 'error' | 'abort' = 'complete',
    searchResultsOverride?: unknown[],
    usage = { totalTokens: 12 },
    documentsOverride: unknown[] = []
  ) {
    const provider = {
      name: 'test',
      getDefaultChatModel: () => 'test-model',
      sendMessageStream: vi.fn(
        async (
          _messages: unknown[],
          onChunk: (chunk: StreamChunk) => void,
          onError: (error: Error) => void,
          onComplete: () => void | Promise<void>
        ) => {
          streamCallbacks = { onChunk, onError, onComplete }
          return new AbortController()
        }
      )
    }
    const providerManager = {
      getActiveChatProvider: vi.fn().mockResolvedValue(provider)
    }
    const knowledgeService = {
      search: vi.fn().mockResolvedValue(searchResultsOverride ?? [
        {
          chunkId: 'chunk-1',
          documentId: 'document-1',
          documentTitle: 'Lu\u1eadt th\u1eed nghi\u1ec7m',
          documentType: 'text',
          content: '\u0110i\u1ec1u 1. Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1.',
          matchedContent: 'Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1.',
          score: 0.95,
          chunkIndex: 1,
          metadata: { legalContext: { articleNumber: '1', clauseNumber: '1' } },
          documentMetadata: { legalDocument: true }
        }
      ]),
      getDocuments: vi.fn().mockReturnValue(documentsOverride)
    }
    const reasoningService = { reason: vi.fn().mockReturnValue(reasoningResult) }
    const sessionAutoSwitchService = {
      recordTokenUsageAndCheckSwitch: vi.fn().mockResolvedValue(null)
    }
    const llamaService = { ensureChatStarted: vi.fn().mockResolvedValue(true) }

    registerChatHandlers(
      providerManager as unknown as ProviderManager,
      sessionAutoSwitchService as unknown as SessionAutoSwitchService,
      knowledgeService as unknown as KnowledgeService,
      llamaService as unknown as LlamaService,
      reasoningService as unknown as LegalReasoningService,
      worker as unknown as LegalGraphWorker
    )

    const handler = mocks.handlers.get('send-message')
    expect(handler).toBeTypeOf('function')
    const event = {
      sender: {
        send: (channel: string, payload: SentPayload) => sentEvents.push({ channel, payload })
      }
    }

    const messageId = await handler!(event, { sessionId: 'session-1', content })
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (outcome === 'complete') {
      streamCallbacks.onChunk?.({ content: modelText, done: false })
      streamCallbacks.onChunk?.({
        content: '',
        done: true,
        metadata: { model: 'test-model', usage }
      })
      await streamCallbacks.onComplete?.()
    } else if (outcome === 'error') {
      streamCallbacks.onError?.(new Error('provider failed'))
    } else {
      const abortHandler = mocks.handlers.get('abort-message')
      expect(abortHandler).toBeTypeOf('function')
      await abortHandler!({}, { messageId })
    }

    const finishEvent = sentEvents.find(
      (item) => item.channel === 'message-chunk' && item.payload.type === 'finish'
    )?.payload
    const savedCall = mocks.updateMessageContent.mock.calls.at(-1)
    return {
      finishEvent,
      savedContent: savedCall?.[1] as string | undefined,
      savedMetadata: savedCall?.[3],
      providerMessages: provider.sendMessageStream.mock.calls[0]?.[0] as APIMessage[],
      providerOptions: provider.sendMessageStream.mock.calls[0]?.[4] as
        | { maxOutputTokens?: number }
        | undefined,
      provider,
      knowledgeService,
      legalReasoningService: reasoningService
    }
  }

  it('returns no-evidence refusal without starting the model', async () => {
    const result = await sendLegalMessage('Điều 15 quy định gì?', 'complete', [])

    expect(result.provider.sendMessageStream).not.toHaveBeenCalled()
    expect(result.finishEvent?.content).toContain('Chưa tìm thấy căn cứ')
    expect(result.finishEvent?.metadata?.citations).toEqual([])
  })

  it('returns direct article evidence without starting the model', async () => {
    const result = await sendLegalMessage('Điều 1 quy định gì?')

    expect(result.provider.sendMessageStream).not.toHaveBeenCalled()
    expect(result.finishEvent?.content).toContain('Điều 1')
    expect(result.finishEvent?.content).toContain('[1]')
    expect(result.finishEvent?.metadata?.citations).toHaveLength(1)
  })

  it('caps compact synthesis prompt and output for one document', async () => {
    mocks.getMessagesBySession.mockReturnValue([
      ...Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `old-${index} ${'x'.repeat(800)}`
      })),
      { role: 'user', content: 'Tóm tắt văn bản này' }
    ])

    const result = await sendLegalMessage('Tóm tắt văn bản này')

    expect(result.providerOptions).toEqual({ maxOutputTokens: 64 })
    expect(estimateChatTokens(result.providerMessages) + 64 + 256).toBeLessThanOrEqual(1024)
  })

  it('emits evidence and generation phases before answer completion', async () => {
    await sendLegalMessage('Tóm tắt văn bản này')
    const phases = sentEvents
      .filter((event) => event.channel === 'message-chunk' && event.payload.type === 'phase')
      .map((event) => event.payload.phase)

    expect(phases).toEqual([
      'routing',
      'retrieving',
      'evidence-ready',
      'generating',
      'validating',
      'complete'
    ])
  })

  it('bypasses all RAG work for assistant self-introduction', async () => {
    mocks.getAllSettings.mockResolvedValue({
      language: 'vi-VN',
      defaultEmbeddingModel: 'local:embedding',
      ragEnableChitChatHeuristic: true,
      ragTopK: 3,
      ragThreshold: 0.5,
      rerankEnabled: false,
      rerankTopN: 3,
      rerankUseHeuristicFallback: true,
      prompts: { chat: {} }
    })

    const { finishEvent, knowledgeService, legalReasoningService } = await sendLegalMessage(
      'hãy tự giới thiệu về bản thân bạn'
    )

    expect(knowledgeService.search).not.toHaveBeenCalled()
    expect(legalReasoningService.reason).not.toHaveBeenCalled()
    expect(finishEvent?.metadata?.citations).toEqual([])
    expect(finishEvent?.metadata?.legalReasoning).toBeUndefined()
  })

  it('keeps retrieval for a greeting-prefixed document request', async () => {
    const { knowledgeService } = await sendLegalMessage(
      'xin chào, hãy tóm tắt nội dung tài liệu này'
    )

    expect(knowledgeService.search).toHaveBeenCalledOnce()
  })

  it('keeps social prompts small and excludes archived-session memory', async () => {
    const oldTurns = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `OLD-TURN-${index} ${'x'.repeat(380)}`
    }))
    mocks.getMessagesBySession.mockReturnValue([
      ...oldTurns,
      { role: 'user', content: 'xin chào' }
    ])
    mocks.getSessionById.mockImplementation((sessionId: string) =>
      sessionId === 'session-1'
        ? { id: 'session-1', notebookId: 'notebook-1', parentSessionId: 'parent-1' }
        : {
            id: 'parent-1',
            title: 'Phiên cũ',
            summary: 'OLD-PARENT-MEMORY',
            parentSessionId: null
          }
    )
    mocks.getAllSettings.mockResolvedValue({
      language: 'vi-VN',
      defaultEmbeddingModel: 'local:embedding',
      prompts: { chat: { 'vi-VN': 'PERSONA-PROMPT' } }
    })

    const { providerMessages } = await sendLegalMessage('xin chào')
    const conversationMessages = providerMessages.filter((message) => message.role !== 'system')

    expect(conversationMessages.length).toBeLessThanOrEqual(6)
    expect(conversationMessages.at(-1)?.content).toBe('xin chào')
    expect(conversationMessages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(1600)
    expect(providerMessages[0]).toEqual({ role: 'system', content: 'PERSONA-PROMPT' })
    expect(providerMessages.map((message) => message.content).join('\n')).not.toContain(
      'OLD-PARENT-MEMORY'
    )
  })

  it('keeps retrieval but suppresses graph reasoning for a single legal work', async () => {
    const { knowledgeService, legalReasoningService } = await sendLegalMessage(
      'Doanh nghiệp vi phạm thời hạn nộp hồ sơ bị xử phạt thế nào?'
    )

    expect(knowledgeService.search).toHaveBeenCalledOnce()
    expect(legalReasoningService.reason).not.toHaveBeenCalled()
  })

  it('activates graph reasoning for mixed relational intent across two canonical works', async () => {
    const { knowledgeService, legalReasoningService } = await sendLegalMessage(
      'Xin ch\u00e0o, doanh nghi\u1ec7p vi ph\u1ea1m th\u1eddi h\u1ea1n b\u1ecb x\u1eed ph\u1ea1t th\u1ebf n\u00e0o?',
      'complete',
      crossWorkResults()
    )

    expect(knowledgeService.search).toHaveBeenCalledOnce()
    expect(legalReasoningService.reason).toHaveBeenCalledOnce()
  })

  it('activates graph reasoning when query names two legal works and asks their relation', async () => {
    const documents = [
      {
        id: 'document-1',
        title: '07_2022_QH15.docx',
        status: 'indexed',
        metadata: { legalStructure: true, legalDocument: { documentNumber: '07/2022/QH15' } }
      },
      {
        id: 'document-2',
        title: '24_2018_QH14.pdf',
        status: 'indexed',
        metadata: { legalStructure: true, legalDocument: { documentNumber: '24/2018/QH14' } }
      }
    ]
    const { legalReasoningService } = await sendLegalMessage(
      'Luật số 07/2022/QH15 và Luật số 24/2018/QH14 có quan hệ sửa đổi, thay thế hoặc viện dẫn trực tiếp nhau không?',
      'complete',
      crossWorkResults(),
      { totalTokens: 12 },
      documents
    )

    expect(legalReasoningService.reason).toHaveBeenCalledOnce()
  })

  it('suppresses graph reasoning for duplicate files of one canonical work', async () => {
    const duplicateResults = crossWorkResults().map((result, index) => ({
      ...result,
      documentId: index === 0 ? 'law-docx' : 'law-pdf',
      documentMetadata: { legalDocument: true, canonicalGraphDocumentId: 'canonical-law-07' }
    }))

    const { legalReasoningService } = await sendLegalMessage(
      'So s\u00e1nh ch\u1ebf t\u00e0i gi\u1eefa hai t\u1ec7p',
      'complete',
      duplicateResults
    )

    expect(legalReasoningService.reason).not.toHaveBeenCalled()
  })

  it('omits citations and legal reasoning when retrieval retains no evidence', async () => {
    const { finishEvent, legalReasoningService } = await sendLegalMessage(
      'Doanh nghiệp vi phạm thời hạn nộp hồ sơ bị xử phạt thế nào?',
      'complete',
      []
    )

    expect(legalReasoningService.reason).not.toHaveBeenCalled()
    expect(finishEvent?.metadata?.citations).toEqual([])
    expect(finishEvent?.metadata?.legalReasoning).toBeUndefined()
  })

  it('persists identical reasoning metadata sent in finish event', async () => {
    modelText = 'K\u1ebft lu\u1eadn [1] [2].'
    const result = await sendLegalMessage(
      'Doanh nghi\u1ec7p b\u1ecb ph\u1ea1t th\u1ebf n\u00e0o?',
      'complete',
      crossWorkResults()
    )

    expect(result.finishEvent?.metadata?.legalReasoning).toEqual(reasoningResult)
    expect(result.savedMetadata?.legalReasoning).toEqual(reasoningResult)
    expect(result.finishEvent?.metadata).toEqual(result.savedMetadata)
    expect(result.savedMetadata?.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ index: 2, chunkId: 'chunk-2' })])
    )
  })

  it('pauses worker during stream and resumes in finally', async () => {
    await sendLegalMessage('Tóm tắt văn bản này')

    expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
  })

  it('resumes worker after provider error', async () => {
    await sendLegalMessage('Tóm tắt văn bản này', 'error')

    expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
  })

  it('resumes worker after abort', async () => {
    await sendLegalMessage('Tóm tắt văn bản này', 'abort')

    expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
  })

  it('removes citation markers outside allowed evidence', async () => {
    modelText = 'K\u1ebft lu\u1eadn [1] [99].'

    const result = await sendLegalMessage('Tóm tắt văn bản này')

    expect(result.savedContent).toContain('[1]')
    expect(result.savedContent).not.toContain('[99]')
  })

  it('strips raw source tags and persists only citations used by final answer', async () => {
    modelText =
      '<comparison-evidence><doc id=chunk-1>K\u1ebft lu\u1eadn [1] [99].</doc></comparison-evidence>\n\nNgu\u1ed3n tr\u00edch d\u1eabn:\n* <doc id=chunk-1>'

    const result = await sendLegalMessage('Tóm tắt văn bản này')

    expect(result.savedContent).toBe('K\u1ebft lu\u1eadn [1].')
    expect(result.finishEvent?.content).toBe(result.savedContent)
    expect(result.savedMetadata?.citations).toEqual([
      expect.objectContaining({ index: 1, chunkId: 'chunk-1' })
    ])
  })

  it('adds application-owned citation when final answer uses no citation marker', async () => {
    modelText = 'Kết luận có căn cứ từ tài liệu.'

    const result = await sendLegalMessage('Tóm tắt văn bản này')

    expect(result.savedContent).toContain('[1]')
    expect(result.savedMetadata?.citations).toHaveLength(1)
  })

  it('persists estimated token usage when provider reports zeros', async () => {
    const result = await sendLegalMessage(
      'Tóm tắt văn bản này',
      'complete',
      undefined,
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    )

    expect(result.savedMetadata?.usage).toMatchObject({ estimated: true })
    expect(result.savedMetadata?.usage?.promptTokens).toBeGreaterThan(0)
    expect(result.savedMetadata?.usage?.completionTokens).toBeGreaterThan(0)
    expect(result.savedMetadata?.usage?.totalTokens).toBeGreaterThan(0)
  })
})
