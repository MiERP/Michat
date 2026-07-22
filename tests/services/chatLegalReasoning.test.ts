import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalReasoningResult } from '../../src/shared/types/legalReasoning'
import type { ChatMessageMetadata, StreamChunk } from '../../src/shared/types/chat'
import type { ProviderManager } from '../../src/main/providers/ProviderManager'
import type { SessionAutoSwitchService } from '../../src/main/services/SessionAutoSwitchService'
import type { KnowledgeService } from '../../src/main/services/KnowledgeService'
import type { LlamaService } from '../../src/main/services/LlamaService'
import type { LegalReasoningService } from '../../src/main/services/legalGraph/LegalReasoningService'
import type { LegalGraphWorker } from '../../src/main/services/legalGraph/LegalGraphWorker'

type IpcHandler = (...args: unknown[]) => unknown
interface SentPayload {
  messageId?: string
  type?: string
  content?: string
  metadata?: ChatMessageMetadata
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

  async function sendLegalMessage(
    content: string,
    outcome: 'complete' | 'error' | 'abort' = 'complete'
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
      search: vi.fn().mockResolvedValue([
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
      getDocuments: vi.fn().mockReturnValue([])
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
    if (outcome === 'complete') {
      streamCallbacks.onChunk?.({ content: modelText, done: false })
      streamCallbacks.onChunk?.({
        content: '',
        done: true,
        metadata: { model: 'test-model', usage: { totalTokens: 12 } }
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
      savedMetadata: savedCall?.[3]
    }
  }

  it('persists identical reasoning metadata sent in finish event', async () => {
    const result = await sendLegalMessage('Doanh nghi\u1ec7p b\u1ecb ph\u1ea1t th\u1ebf n\u00e0o?')

    expect(result.finishEvent?.metadata?.legalReasoning).toEqual(reasoningResult)
    expect(result.savedMetadata?.legalReasoning).toEqual(reasoningResult)
    expect(result.finishEvent?.metadata).toEqual(result.savedMetadata)
    expect(result.savedMetadata?.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ index: 2, chunkId: 'chunk-2' })])
    )
  })

  it('pauses worker during stream and resumes in finally', async () => {
    await sendLegalMessage('Ngh\u0129a v\u1ee5 l\u00e0 g\u00ec?')

    expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
  })

  it('resumes worker after provider error', async () => {
    await sendLegalMessage('Ngh\u0129a v\u1ee5 l\u00e0 g\u00ec?', 'error')

    expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
  })

  it('resumes worker after abort', async () => {
    await sendLegalMessage('Ngh\u0129a v\u1ee5 l\u00e0 g\u00ec?', 'abort')

    expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
  })

  it('removes citation markers outside allowed evidence', async () => {
    modelText = 'K\u1ebft lu\u1eadn [1] [99].'

    const result = await sendLegalMessage('Ngh\u0129a v\u1ee5 l\u00e0 g\u00ec?')

    expect(result.savedContent).toContain('[1]')
    expect(result.savedContent).not.toContain('[99]')
  })
})
