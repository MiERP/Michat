import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { AddressInfo } from 'net'
import { WebSocket, WebSocketServer } from 'ws'
import type { ProviderManager } from '../../providers/ProviderManager'
import type { LlamaService } from '../LlamaService'
import type { APIMessage } from '../../../shared/types/chat'
import type { ToolDefinition } from '../../../shared/types/tool'
import Logger from '../../../shared/utils/logger'
import { EXCEL_TOOLS } from './tools/excelTools'
import { WORD_TOOLS, type OfficeToolDefinition } from './tools/wordTools'
import { OfficeSkillService, type OfficeSkillName } from './skills/OfficeSkillService'

export const DEV_OFFICE_ADDIN_DIR = path.join(process.cwd(), 'src', 'office-addin')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const QUICK_ACTION_PROMPTS: Record<string, string> = {
  summarize:
    'Tóm tắt đoạn văn bản sau bằng tiếng Việt trong 2-4 gạch đầu dòng ngắn. Gộp ý trùng lặp, chỉ giữ ý chính, không chép lại từng định nghĩa hoặc từng câu nguyên văn:\n\n',
  rewrite: 'Rewrite the following text to improve clarity, flow, and professional tone:\n\n',
  translate_vi: 'Translate the following text to Vietnamese. Return only the translation:\n\n',
  translate_en: 'Translate the following text to English. Return only the translation:\n\n',
  translate_ja: 'Translate the following text to Japanese. Return only the translation:\n\n',
  polish: 'Polish the following text to fix grammar, spelling, and improve readability:\n\n',
  formula:
    'Create an Excel formula for the selected range. Return the formula and a short explanation:\n\n',
  fill_data:
    'Create tab-separated rows that can be written into Excel cells for the selected range/request:\n\n',
  analyze_table:
    'Analyze the selected Excel table/range. Summarize trends, issues, and useful next steps:\n\n',
  clean_data:
    'Suggest cleaned/standardized tabular output for the selected Excel data. Return tab-separated rows when useful:\n\n'
}

type OfficeHost = 'word' | 'excel'

interface OfficeSessionRecord {
  sessionId: string
  host: OfficeHost
  url: string
  documentTitle: string
  connectedAt: string
  lastSeenAt: string
  tools: OfficeToolDefinition[]
}

interface PublicOfficeSessionRecord {
  sessionId: string
  host: OfficeHost
  url: string
  documentTitle: string
  connectedAt: string
  lastSeenAt: string
  toolCount: number
  socketConnected: boolean
}

interface OfficeSocketMessage {
  type: string
  requestId?: string
  sessionId?: string
  host?: OfficeHost
  payload?: unknown
}

const OFFICE_TOOLS: OfficeToolDefinition[] = [...WORD_TOOLS, ...EXCEL_TOOLS]

class BadRequestError extends Error {}

export function normalizeOfficeToolArgs(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === '') return {}

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      throw new Error('Tool arguments must be a JSON object')
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Invalid tool call arguments JSON')
      throw error
    }
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>

  throw new Error('Tool call arguments must be an object')
}

export class OfficeBridgeService {
  private server: http.Server | null = null
  private wsServer: WebSocketServer | null = null
  private port: number = 0
  private host: string = 'localhost'
  private secure: boolean = false
  private providerManager: ProviderManager | null = null
  private llamaService: LlamaService | null = null
  private sessions = new Map<string, OfficeSessionRecord>()
  private sessionSockets = new Map<string, WebSocket>()
  private skillService = new OfficeSkillService()
  private pendingSocketReplies = new Map<
    string,
    { resolve: (message: OfficeSocketMessage) => void; timeout: NodeJS.Timeout }
  >()

  get address(): string {
    return `${this.secure ? 'https' : 'http'}://${this.host}:${this.port}`
  }

  get running(): boolean {
    return this.server !== null
  }

  get bridgePort(): number {
    return this.port
  }

  setDependencies(providerManager: ProviderManager, llamaService: LlamaService): void {
    this.providerManager = providerManager
    this.llamaService = llamaService
  }

  private getToolsForHost(host?: string | null): OfficeToolDefinition[] {
    if (host === 'word' || host === 'excel') {
      return OFFICE_TOOLS.filter((tool) => tool.host === host)
    }
    return OFFICE_TOOLS
  }

  private getOfficeToolDefinitions(host: OfficeHost): ToolDefinition[] {
    const textParameter = {
      type: 'string' as const,
      description: 'Text to write to the Word document'
    }

    if (host === 'word') {
      return [
        {
          name: 'word_get_selection_text',
          description: 'Read the current Word selection.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'word_get_document_text',
          description: 'Read the full Word document text.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'word_get_document_context',
          description:
            'Read structured Word context including content, metadata, paragraphs, and outline.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'word_replace_selection',
          description:
            'Replace the current Word selection with provided text after user confirmation.',
          parameters: { type: 'object', properties: { text: textParameter }, required: ['text'] }
        },
        {
          name: 'word_insert_at_cursor',
          description:
            'Insert text at the current Word cursor or after the current selection after user confirmation.',
          parameters: { type: 'object', properties: { text: textParameter }, required: ['text'] }
        },
        {
          name: 'word_append_to_document',
          description: 'Append text to the Word document after user confirmation.',
          parameters: { type: 'object', properties: { text: textParameter }, required: ['text'] }
        }
      ]
    }

    return [
      {
        name: 'excel_get_selected_range',
        description: 'Read the selected Excel range with address and values.',
        parameters: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'excel_write_selected_range',
        description: 'Write values to the selected Excel range after user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              description: 'Non-empty rectangular 2D array of values to write.',
              items: {
                type: 'array',
                description: 'Row values.',
                items: { type: 'string', description: 'Cell value.' }
              }
            }
          },
          required: ['values']
        }
      }
    ]
  }

  private createSessionId(host: OfficeHost): string {
    return `${host}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private toPublicSession(session: OfficeSessionRecord): PublicOfficeSessionRecord {
    return {
      sessionId: session.sessionId,
      host: session.host,
      url: session.url,
      documentTitle: session.documentTitle,
      connectedAt: session.connectedAt,
      lastSeenAt: session.lastSeenAt,
      toolCount: session.tools.length,
      socketConnected: this.sessionSockets.get(session.sessionId)?.readyState === WebSocket.OPEN
    }
  }

  private createRequestId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private sendSocketMessage(socket: WebSocket, message: OfficeSocketMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  private sendSocketError(socket: WebSocket, requestId: string | undefined, error: string): void {
    this.sendSocketMessage(socket, { type: 'error', requestId, payload: { error } })
  }

  private handleSocketMessage(socket: WebSocket, data: WebSocket.RawData): void {
    let message: OfficeSocketMessage
    try {
      message = JSON.parse(data.toString())
    } catch {
      this.sendSocketError(socket, undefined, 'Invalid JSON')
      return
    }

    if (message.type === 'hello') {
      const session = message.sessionId ? this.sessions.get(message.sessionId) : null
      if (!session || session.host !== message.host) {
        this.sendSocketError(socket, message.requestId, 'Unknown Office session')
        socket.close()
        return
      }

      const previousSocket = this.sessionSockets.get(session.sessionId)
      if (previousSocket && previousSocket !== socket) previousSocket.close()

      session.lastSeenAt = new Date().toISOString()
      this.sessionSockets.set(session.sessionId, socket)
      this.sendSocketMessage(socket, {
        type: 'hello_ack',
        requestId: message.requestId,
        sessionId: session.sessionId,
        host: session.host
      })
      return
    }

    if (
      message.type === 'pong' ||
      message.type === 'echo_result' ||
      message.type === 'office_tool_result' ||
      message.type === 'office_tool_error'
    ) {
      const pending = message.requestId ? this.pendingSocketReplies.get(message.requestId) : null
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingSocketReplies.delete(message.requestId!)
        pending.resolve(message)
      }
      return
    }

    if (message.type === 'ping') {
      this.sendSocketMessage(socket, {
        type: 'pong',
        requestId: message.requestId,
        sessionId: message.sessionId
      })
      return
    }

    this.sendSocketError(socket, message.requestId, `Unsupported message type: ${message.type}`)
  }

  private attachWebSocketServer(): void {
    if (!this.server) return

    this.wsServer = new WebSocketServer({ noServer: true })
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', this.address || 'http://localhost')
      if (url.pathname !== '/office/ws') {
        socket.destroy()
        return
      }

      this.wsServer?.handleUpgrade(req, socket, head, (ws) => {
        this.wsServer?.emit('connection', ws, req)
      })
    })

    this.wsServer.on('connection', (socket) => {
      socket.on('message', (data) => this.handleSocketMessage(socket, data))
      socket.on('close', () => {
        for (const [sessionId, sessionSocket] of this.sessionSockets.entries()) {
          if (sessionSocket === socket) this.sessionSockets.delete(sessionId)
        }
      })
    })
  }

  private sendSessionPing(sessionId: string): Promise<OfficeSocketMessage> {
    const socket = this.sessionSockets.get(sessionId)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Office session WebSocket is not connected'))
    }

    const requestId = this.createRequestId('ping')
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSocketReplies.delete(requestId)
        reject(new Error('Timed out waiting for Office session pong'))
      }, 10000)

      this.pendingSocketReplies.set(requestId, { resolve, timeout })
      this.sendSocketMessage(socket, { type: 'ping', requestId, sessionId })
    })
  }

  async routeToolCall(
    sessionId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const socket = this.sessionSockets.get(sessionId)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Office session WebSocket is not connected')
    }

    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Unknown Office session')
    }

    const allowedTool = this.getOfficeToolDefinitions(session.host).some(
      (tool) => tool.name === name
    )
    if (!allowedTool) {
      throw new Error(`Office tool "${name}" is not available for ${session.host}`)
    }

    const requestId = this.createRequestId('tool')

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSocketReplies.delete(requestId)
        reject(new Error('Timed out waiting for tool call result'))
      }, 30000)

      this.pendingSocketReplies.set(requestId, {
        resolve: (message) => {
          clearTimeout(timeout)
          if (message.type === 'office_tool_error') {
            const payload = message.payload as { error?: string }
            reject(new Error(payload?.error || 'Tool execution error'))
          } else {
            const payload = message.payload as { result?: unknown } | unknown
            const result =
              payload && typeof payload === 'object' && 'result' in payload
                ? (payload as { result?: unknown }).result
                : payload
            resolve(JSON.stringify(result ?? {}))
          }
        },
        timeout
      })

      this.sendSocketMessage(socket, {
        type: 'office_tool_call',
        requestId,
        sessionId,
        host: session?.host,
        payload: { name, args }
      })
    })
  }

  getAddinDir(): string {
    const resourcesPath = process.resourcesPath
    if (resourcesPath) {
      const packagedDir = path.join(resourcesPath, 'office-addin')
      if (fs.existsSync(packagedDir)) return packagedDir
    }
    return DEV_OFFICE_ADDIN_DIR
  }

  private async getActiveProvider() {
    if (!this.providerManager) return null
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      Logger.warn('OfficeBridge', 'No active chat provider configured')
      return null
    }
    const providerName = String((provider as any)?.name || '').toLowerCase()
    const isLlamaChat = providerName === 'llama' || providerName === 'llama-embed'
    if (isLlamaChat && this.llamaService) {
      const chatReady = await this.llamaService.ensureChatStarted()
      if (!chatReady) {
        Logger.warn('OfficeBridge', 'Llama chat server is unavailable')
        return null
      }
    }
    return provider
  }

  private writeSSE(res: http.ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  private buildOfficeBudgetPrompt(action?: string): string {
    if (action === 'summarize') {
      return 'Output budget: Vietnamese, 2-4 short bullets, no preface, no verbatim restatement.'
    }
    if (action === 'rewrite' || action?.startsWith('translate_') || action === 'polish') {
      return 'Output budget: return only the transformed text, no preface, no explanation.'
    }
    return 'Output budget: answer in at most 120 words or 5 bullets unless the user explicitly asks for more.'
  }

  private buildOfficeSkillPrompt(args: {
    host?: OfficeHost
    userText?: string
    documentTitle?: string
    documentContext?: unknown
    requestedSkills?: unknown
  }): { prompt: string; skillNames: OfficeSkillName[] } {
    return this.skillService.buildSystemPrompt(args)
  }

  private appendOfficeSkillPrompt(
    messages: APIMessage[],
    skillPrompt: string,
    skillNames: OfficeSkillName[]
  ): void {
    if (!skillPrompt || skillNames.length === 0) return
    messages.unshift({ role: 'system', content: skillPrompt })
  }

  private extractLatestUserText(messages: APIMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === 'user') return String(message.content || '')
    }
    return ''
  }

  private formatDocumentContext(documentContext: unknown): string {
    if (!documentContext) return ''
    if (typeof documentContext === 'string') return documentContext.slice(0, 32000)

    if (typeof documentContext !== 'object') return String(documentContext).slice(0, 32000)

    const context = documentContext as Record<string, unknown>
    const metadata =
      context.metadata && typeof context.metadata === 'object'
        ? (context.metadata as Record<string, unknown>)
        : {}
    const selectedText =
      typeof context.selectedText === 'string' ? context.selectedText.slice(0, 12000) : ''

    if (selectedText || context.mode === 'selection') {
      return JSON.stringify({
        mode: 'selection',
        source: 'selection',
        selectedText,
        instruction:
          'The user selected text in Word. Treat selectedText as the only target text for this request.',
        metadata: { selectedCharCount: selectedText.length }
      }).slice(0, 16000)
    }

    const outline = Array.isArray(context.outline) ? context.outline.slice(0, 40) : []
    const paragraphs = Array.isArray(context.paragraphs) ? context.paragraphs.slice(0, 40) : []
    const content = typeof context.content === 'string' ? context.content.slice(0, 6000) : ''

    return JSON.stringify({
      mode: context.mode,
      source: context.source,
      content,
      instruction:
        'No Word selection was provided. Use document content only as background context.',
      metadata,
      outline,
      paragraphs,
      truncated: typeof context.content === 'string' && context.content.length > content.length
    }).slice(0, 16000)
  }

  private async handleStreamChat(
    res: http.ServerResponse,
    messages: APIMessage[],
    activeSkills: OfficeSkillName[] = []
  ): Promise<void> {
    const provider = await this.getActiveProvider()
    if (!provider) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'AI provider not available. Configure a chat model in MiChat settings.'
        })
      )
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    this.writeSSE(res, 'skills', { skills: activeSkills })

    const abortController = await provider.sendMessageStream(
      messages,
      (chunk) => {
        if (chunk.content) {
          this.writeSSE(res, 'chunk', { content: chunk.content })
        }
        if (chunk.done) {
          this.writeSSE(res, 'done', {
            content: chunk.content,
            metadata: chunk.metadata
          })
        }
      },
      (error) => {
        Logger.error('OfficeBridge', 'Stream error:', error)
        this.writeSSE(res, 'error', { message: error.message })
        res.end()
      },
      () => {
        res.end()
      }
    )

    res.on('close', () => {
      abortController.abort()
    })
  }

  private async handleStreamChatWithTools(
    res: http.ServerResponse,
    messages: APIMessage[],
    sessionId: string,
    host: OfficeHost,
    activeSkills: OfficeSkillName[] = []
  ): Promise<void> {
    const provider = await this.getActiveProvider()
    if (!provider) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'AI provider not available.' }))
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    this.writeSSE(res, 'skills', { skills: activeSkills })

    const toolDefs = this.getOfficeToolDefinitions(host)
    let currentMessages = [...messages]
    let accumulatedContent = ''
    const maxToolRounds = 5
    let abortController: AbortController | null = null

    const cleanup = () => abortController?.abort()
    res.on('close', cleanup)

    try {
      for (let round = 0; round < maxToolRounds; round++) {
        let toolCall: { id: string; name: string; args: Record<string, unknown> } | null = null
        let streamError: Error | null = null

        const streamFinished = new Promise<void>((resolve) => {
          provider
            .sendMessageStream(
              currentMessages,
              (chunk) => {
                if (chunk.content) {
                  accumulatedContent += chunk.content
                  this.writeSSE(res, 'chunk', { content: chunk.content })
                }
                if (chunk.metadata?.toolCallStart && !toolCall) {
                  toolCall = {
                    id: chunk.metadata.toolCallId || '',
                    name: chunk.metadata.toolCallName || '',
                    args: {}
                  }
                }
                if (chunk.metadata?.toolCallArgs !== undefined && toolCall) {
                  toolCall.args = normalizeOfficeToolArgs(chunk.metadata.toolCallArgs)
                }
              },
              (error) => {
                streamError = error
                Logger.error('OfficeBridge', 'Stream error:', error)
                this.writeSSE(res, 'error', { message: error.message })
                resolve()
              },
              resolve,
              toolDefs
            )
            .then((controller) => {
              abortController = controller
            })
            .catch((error) => {
              streamError = error instanceof Error ? error : new Error(String(error))
              resolve()
            })
        })

        await streamFinished

        if (streamError) return

        if (!toolCall) {
          this.writeSSE(res, 'done', { content: accumulatedContent, metadata: {} })
          return
        }
        const completedToolCall = toolCall as {
          id: string
          name: string
          args: Record<string, unknown>
        }

        let result: string
        try {
          result = await this.routeToolCall(
            sessionId,
            completedToolCall.name,
            completedToolCall.args
          )
        } catch (err) {
          this.writeSSE(res, 'error', {
            message: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
          })
          return
        }
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: '' },
          { role: 'user', content: `Tool "${completedToolCall.name}" returned: ${result}` }
        ]
      }
    } finally {
      res.removeListener('close', cleanup)
      res.end()
    }
  }

  private async handleQuickAction(
    res: http.ServerResponse,
    action: string,
    text: string,
    systemPrompt = 'You are a helpful writing assistant. Follow the instruction precisely.',
    host?: OfficeHost,
    requestedSkills?: unknown
  ): Promise<void> {
    const prompt = QUICK_ACTION_PROMPTS[action]
    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `Unknown action: ${action}` }))
      return
    }

    const { prompt: skillPrompt, skillNames } = this.buildOfficeSkillPrompt({
      host,
      userText: `${action} ${text}`,
      requestedSkills
    })

    const messages: APIMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'system',
        content: this.buildOfficeBudgetPrompt(action)
      },
      { role: 'user', content: prompt + text }
    ]
    this.appendOfficeSkillPrompt(messages, skillPrompt, skillNames)

    await this.handleStreamChat(res, messages, skillNames)
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${this.host}`)
      const pathname = url.pathname

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (pathname === '/office/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'michat-office-bridge', version: '0.1.0' }))
        return
      }

      if (pathname === '/office/config') {
        const provider = this.providerManager
          ? await this.providerManager.getActiveChatProvider()
          : null
        const providerName = provider ? String((provider as any)?.name || 'unknown') : 'none'
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            bridgeVersion: '0.1.0',
            activeProvider: providerName,
            bridgePort: this.port
          })
        )
        return
      }

      if (pathname === '/office/tools') {
        const tools = this.getToolsForHost(url.searchParams.get('host'))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ tools }))
        return
      }

      if (pathname === '/office/skills') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ skills: this.skillService.getDescriptors() }))
        return
      }

      if (pathname === '/office/sessions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            sessions: Array.from(this.sessions.values()).map((session) =>
              this.toPublicSession(session)
            )
          })
        )
        return
      }

      const socketPingMatch = pathname.match(/^\/office\/session\/([^/]+)\/ws\/ping$/)
      if (socketPingMatch && req.method === 'POST') {
        const sessionId = decodeURIComponent(socketPingMatch[1])
        if (!this.sessions.has(sessionId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unknown Office session' }))
          return
        }

        try {
          const pong = await this.sendSessionPing(sessionId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ...pong }))
        } catch (error) {
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Ping failed' }))
        }
        return
      }

      if (pathname === '/office/session/hello' && req.method === 'POST') {
        const body = await this.parseBody(req)
        const host = body.host === 'excel' ? 'excel' : body.host === 'word' ? 'word' : null

        if (!host) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unsupported Office host' }))
          return
        }

        const now = new Date().toISOString()
        const sessionId =
          typeof body.sessionId === 'string' && body.sessionId
            ? body.sessionId
            : this.createSessionId(host)
        const session: OfficeSessionRecord = {
          sessionId,
          host,
          url: typeof body.url === 'string' ? body.url : '',
          documentTitle: typeof body.documentTitle === 'string' ? body.documentTitle : '',
          connectedAt: this.sessions.get(sessionId)?.connectedAt || now,
          lastSeenAt: now,
          tools: this.getToolsForHost(host)
        }
        this.sessions.set(sessionId, session)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ...this.toPublicSession(session), tools: session.tools }))
        return
      }

      if (pathname === '/office/api/chat' && req.method === 'POST') {
        const body = await this.parseBody(req)
        const messages: APIMessage[] = body.messages || []
        const documentContext = body.documentContext || ''
        const systemPrompt: string = body.systemPrompt || ''
        const sessionId: string = body.sessionId || ''
        const requestedSkills = body.skills
        const requestHost =
          body.host === 'excel' ? 'excel' : body.host === 'word' ? 'word' : undefined

        if (messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No messages provided' }))
          return
        }

        const session = sessionId ? this.sessions.get(sessionId) : undefined
        const { prompt: skillPrompt, skillNames } = this.buildOfficeSkillPrompt({
          host: session?.host || requestHost,
          userText: this.extractLatestUserText(messages),
          documentTitle: session?.documentTitle,
          documentContext,
          requestedSkills
        })

        const formattedDocumentContext = this.formatDocumentContext(documentContext)
        if (formattedDocumentContext) {
          messages.unshift({
            role: 'system',
            content: `The user has provided the following structured Office document context:\n\n${formattedDocumentContext}`
          })
        }

        if (systemPrompt) {
          messages.unshift({
            role: 'system',
            content: systemPrompt.slice(0, 4000)
          })
        }

        messages.unshift({
          role: 'system',
          content: this.buildOfficeBudgetPrompt()
        })
        this.appendOfficeSkillPrompt(messages, skillPrompt, skillNames)

        const socketConnected =
          session && this.sessionSockets.get(sessionId)?.readyState === WebSocket.OPEN

        if (session && socketConnected) {
          await this.handleStreamChatWithTools(res, messages, sessionId, session.host, skillNames)
        } else {
          await this.handleStreamChat(res, messages, skillNames)
        }
        return
      }

      if (pathname.startsWith('/office/action/') && req.method === 'POST') {
        const action = pathname.replace('/office/action/', '')
        const body = await this.parseBody(req)
        const text: string = body.text || ''
        const systemPrompt: string = body.systemPrompt || ''
        const host = body.host === 'excel' ? 'excel' : body.host === 'word' ? 'word' : undefined

        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No text provided for action' }))
          return
        }

        await this.handleQuickAction(
          res,
          action,
          text,
          systemPrompt || undefined,
          host,
          body.skills
        )
        return
      }

      if (pathname.startsWith('/office/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'not implemented' }))
        return
      }

      if (pathname === '/') {
        res.writeHead(302, { Location: '/shared/taskpane.html' })
        res.end()
        return
      }

      let filePath = path.join(this.getAddinDir(), pathname)
      filePath = path.resolve(filePath)

      const addinDir = path.resolve(this.getAddinDir())
      if (!filePath.startsWith(addinDir)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      if (!fs.existsSync(filePath)) {
        if (path.extname(filePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
          return
        }
        filePath = path.join(this.getAddinDir(), 'shared/taskpane.html')
      }

      const ext = path.extname(filePath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const content = fs.readFileSync(filePath)

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      })
      res.end(content)
    } catch (error) {
      if (error instanceof BadRequestError) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
        return
      }
      Logger.error('OfficeBridge', 'Request handler error:', error as any)
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  }

  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new BadRequestError('Invalid JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  async start(preferredPort = 18327, options: { secure?: boolean } = {}): Promise<void> {
    if (this.server) return

    const certDir = path.join(process.env.USERPROFILE || '', '.office-addin-dev-certs')
    const certPath = path.join(certDir, 'localhost.crt')
    const keyPath = path.join(certDir, 'localhost.key')

    const shouldUseHttps = options.secure === true

    if (shouldUseHttps && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      this.secure = true
      this.server = https.createServer(
        {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath)
        },
        (req, res) => this.handleRequest(req, res)
      )
    } else {
      this.secure = false
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
    }

    this.attachWebSocketServer()

    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server was closed before start'))
        return
      }
      this.server.once('error', (err: NodeJS.ErrnoException) => {
        this.server = null
        this.port = 0
        reject(err)
      })
      this.server.listen(preferredPort, this.host, () => {
        const addr = this.server!.address() as AddressInfo
        this.port = addr.port
        Logger.info('OfficeBridge', `Bridge listening on ${this.address}`)
        resolve()
      })
    })
  }

  stop(): void {
    if (!this.server) return
    Logger.info('OfficeBridge', 'Stopping bridge...')
    for (const pending of this.pendingSocketReplies.values()) clearTimeout(pending.timeout)
    this.pendingSocketReplies.clear()
    for (const socket of this.sessionSockets.values()) socket.close()
    this.sessionSockets.clear()
    this.wsServer?.close()
    this.wsServer = null
    this.server.close()
    this.server = null
    this.port = 0
    this.sessions.clear()
  }
}
