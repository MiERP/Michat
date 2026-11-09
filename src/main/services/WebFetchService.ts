/**
 * WebFetchService
 * 网页抓取服务，支持提取正文和转换为 Markdown
 */

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { Agent, fetch as undiciFetch } from 'undici'
import Logger from '../../shared/utils/logger'
import { assertSafePublicHttpUrl } from '../security/guards'

/** Hard cap for a fetched HTML document (decompressed bytes). */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>
type FetchLike = (
  input: string | URL,
  init?: Parameters<typeof undiciFetch>[1]
) => Promise<FetchResponse>

/**
 * Fetch result
 */
export interface FetchResult {
  content: string // extracted text
  title?: string
  description?: string
  url: string
  mimeType: string
  metadata?: Record<string, unknown>
}

/**
 * Fetch options
 */
export interface FetchOptions {
  timeout?: number
  extractMainContent?: boolean
  convertToMarkdown?: boolean
  userAgent?: string
}

interface ReadableStreamLike {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
    cancel(reason?: unknown): Promise<void>
    releaseLock(): void
  }
}

/**
 * Read a response body while enforcing a byte cap. The timeout stays active
 * until this promise settles, so a slow body cannot outlive the request.
 */
export async function readBodyWithLimit(
  response: { body: ReadableStreamLike | null },
  maxBytes: number = MAX_RESPONSE_BYTES
): Promise<string> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Response exceeds maximum size of ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function createPinnedDispatcher(addresses: string[]): Agent {
  const address = addresses[0]
  const family = address.includes(':') ? 6 : 4

  return new Agent({
    connect: {
      lookup: ((_hostname: string, _options: unknown, callback: Function) => {
        callback(null, address, family)
      }) as never
    }
  })
}

/**
 * 网页抓取服务
 */
export class WebFetchService {
  private static readonly MAX_REDIRECTS = 5
  private turndown: TurndownService
  private readonly fetchImpl: FetchLike
  private defaultOptions: Required<FetchOptions> = {
    timeout: 30000,
    extractMainContent: true,
    convertToMarkdown: true,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  constructor(fetchImpl: FetchLike = undiciFetch) {
    this.fetchImpl = fetchImpl
    // 配置 Turndown
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    })

    // 移除不需要的元素
    this.turndown.remove(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe'])
  }

  /**
   * 抓取网页内容
   */
  async fetchUrl(url: string, options?: FetchOptions): Promise<FetchResult> {
    const opts = { ...this.defaultOptions, ...options }

    try {
      let validated = await assertSafePublicHttpUrl(url, 'Knowledge URL')
      Logger.info('WebFetchService', `Fetching: ${validated.url.toString()}`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), opts.timeout)
      let dispatcher: Agent | undefined

      try {
        let response: FetchResponse | undefined

        for (
          let redirectCount = 0;
          redirectCount <= WebFetchService.MAX_REDIRECTS;
          redirectCount++
        ) {
          // Pin the connection to an address that was validated above. Creating
          // a fresh dispatcher per hop also prevents credential/connection reuse
          // across a redirect to another origin.
          dispatcher = createPinnedDispatcher(validated.addresses)
          response = await this.fetchImpl(validated.url, {
            headers: {
              'User-Agent': opts.userAgent,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'vi-VN,zh;q=0.9,en;q=0.8'
            },
            signal: controller.signal,
            redirect: 'manual',
            dispatcher
          } as Parameters<typeof undiciFetch>[1])

          if (![301, 302, 303, 307, 308].includes(response.status)) break
          const location = response.headers.get('location')
          if (!location) throw new Error('Web redirect is missing its Location header')
          if (redirectCount === WebFetchService.MAX_REDIRECTS) {
            throw new Error(`Too many redirects (maximum ${WebFetchService.MAX_REDIRECTS})`)
          }

          await response.body?.cancel()
          await dispatcher.close()
          dispatcher = undefined

          const redirectUrl = new URL(location, validated.url)
          validated = await assertSafePublicHttpUrl(
            redirectUrl.toString(),
            'Knowledge redirect URL'
          )
        }

        if (!response) throw new Error('Web request did not return a response')

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          throw new Error(`Unsupported content type: ${contentType}`)
        }

        const contentLength = Number(response.headers.get('content-length') || 0)
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          throw new Error(`Response exceeds maximum size of ${MAX_RESPONSE_BYTES} bytes`)
        }

        const html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES)
        return this.parseHtml(html, validated.url.toString(), opts)
      } finally {
        clearTimeout(timeoutId)
        await dispatcher?.close().catch(() => {})
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timeout after ${opts.timeout}ms`)
      }
      Logger.error('WebFetchService', 'Failed to fetch URL:', error)
      throw error
    }
  }

  /**
   * 解析 HTML 内容
   */
  parseHtml(html: string, url: string, options?: FetchOptions): FetchResult {
    const opts = { ...this.defaultOptions, ...options }
    const $ = cheerio.load(html)

    const title = $('title').text().trim() || $('h1').first().text().trim()
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content')

    let content: string
    if (opts.extractMainContent) {
      content = this.extractMainContent($)
    } else {
      content = $('body').html() || ''
    }

    if (opts.convertToMarkdown) {
      content = this.htmlToMarkdown(content)
    } else {
      content = cheerio.load(content).text()
    }

    content = this.cleanContent(content)

    return {
      content,
      title,
      description: description || undefined,
      url,
      mimeType: 'text/html',
      metadata: {
        originalLength: html.length
      }
    }
  }

  /**
   * 提取主要内容
   */
  private extractMainContent($: cheerio.CheerioAPI): string {
    $(
      'script, style, nav, footer, header, aside, iframe, noscript, ' +
        '.nav, .navigation, .menu, .sidebar, .footer, .header, .ad, .advertisement, ' +
        '.comments, .comment, .social, .share, .related, .recommend'
    ).remove()

    const mainSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article',
      '.post',
      '.content',
      '.entry-content',
      '.post-content',
      '.article-content',
      '#content',
      '#main-content'
    ]

    for (const selector of mainSelectors) {
      const element = $(selector).first()
      if (element.length && element.text().trim().length > 200) {
        return element.html() || ''
      }
    }

    return $('body').html() || ''
  }

  /**
   * HTML 转 Markdown
   */
  htmlToMarkdown(html: string): string {
    try {
      return this.turndown.turndown(html)
    } catch (error) {
      Logger.warn('WebFetchService', 'Failed to convert to Markdown, using plain text:', error)
      return cheerio.load(html).text()
    }
  }

  /**
   * 清理内容
   */
  private cleanContent(content: string): string {
    return (
      content
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim()
    )
  }

  /**
   * 验证 URL 是否有效
   */
  isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  }
}
