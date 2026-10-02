import http from 'http'
import type { AddressInfo } from 'net'
import type { LlamaService } from '../LlamaService'
import Logger from '../../../shared/utils/logger'

const ALLOWED_PATHS = new Set(['/v1/models', '/v1/chat/completions'])

function setCorsHeaders(response: http.ServerResponse): void {
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Origin', 'https://localhost:3002')
}

export class OfficeProviderBridgeService {
  private server: http.Server | null = null
  private llamaService: LlamaService | null = null
  private port = 0

  get address(): string {
    return `http://127.0.0.1:${this.port}`
  }

  setLlamaService(llamaService: LlamaService): void {
    this.llamaService = llamaService
  }

  private sendJson(response: http.ServerResponse, status: number, body: unknown): void {
    setCorsHeaders(response)
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }

  private async proxy(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    requestUrl: URL
  ): Promise<void> {
    if (!ALLOWED_PATHS.has(requestUrl.pathname)) {
      this.sendJson(response, 404, { error: { message: 'Unsupported local model endpoint' } })
      return
    }

    if (request.method === 'OPTIONS') {
      setCorsHeaders(response)
      response.writeHead(204)
      response.end()
      return
    }

    if (
      (requestUrl.pathname === '/v1/models' && request.method !== 'GET') ||
      (requestUrl.pathname === '/v1/chat/completions' && request.method !== 'POST')
    ) {
      this.sendJson(response, 405, { error: { message: 'Method not allowed' } })
      return
    }

    if (!this.llamaService || !(await this.llamaService.ensureChatStarted())) {
      this.sendJson(response, 503, {
        error: { message: 'MiChat local model is unavailable. Import or select a chat model in MiChat.' }
      })
      return
    }

    const { chatPort } = this.llamaService.getRuntimeInfo()
    const target = http.request(
      {
        host: '127.0.0.1',
        port: chatPort,
        method: request.method,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        headers: { ...request.headers, host: `127.0.0.1:${chatPort}` }
      },
      (proxyResponse) => {
        setCorsHeaders(response)
        for (const [name, value] of Object.entries(proxyResponse.headers)) {
          if (value !== undefined && name.toLowerCase() !== 'access-control-allow-origin') {
            response.setHeader(name, value)
          }
        }
        response.writeHead(proxyResponse.statusCode ?? 502)
        proxyResponse.pipe(response)
      }
    )

    target.on('error', (error) => {
      Logger.error('OfficeProviderBridge', 'Local model proxy failed:', error)
      if (!response.headersSent) {
        this.sendJson(response, 502, { error: { message: 'MiChat local model request failed' } })
      } else {
        response.destroy(error)
      }
    })
    request.on('aborted', () => target.destroy())
    request.pipe(target)
  }

  private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1:18327')
    if (requestUrl.pathname === '/health') {
      this.sendJson(response, 200, { status: 'ok', provider: 'michat-local' })
      return
    }

    void this.proxy(request, response, requestUrl).catch((error) => {
      Logger.error('OfficeProviderBridge', 'Request failed:', error)
      if (!response.headersSent) {
        this.sendJson(response, 500, { error: { message: 'MiChat local model request failed' } })
      } else {
        response.destroy(error instanceof Error ? error : undefined)
      }
    })
  }

  async start(preferredPort = 18327): Promise<void> {
    if (this.server) return
    this.server = http.createServer((request, response) => this.handle(request, response))

    await new Promise<void>((resolve, reject) => {
      const server = this.server
      if (!server) return reject(new Error('Office provider bridge closed before start'))
      server.once('error', reject)
      server.listen(preferredPort, '127.0.0.1', () => {
        this.port = (server.address() as AddressInfo).port
        resolve()
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.port = 0
  }
}
