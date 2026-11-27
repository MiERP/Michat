import type { UpdateErrorKind } from '../../shared/types/update'

export interface ClassifiedUpdateError {
  kind: UpdateErrorKind
  /** Sanitized one-line summary, safe to show in the UI and logs. */
  message: string
}

const MAX_ERROR_LENGTH = 240

const FEED_PATTERNS = [
  '404 "',
  'http 404',
  '404 not found',
  'httperror: 404',
  'httperror: not found',
  'http error 404',
  'error: 404',
  'status 404',
  'statuscode 404',
  '404 releases',
  '404 latest',
  '404 channel',
  'http_error_404',
  'releases.atom',
  '/releases/latest',
  'err_updater_latest_version_not_found',
  'err_updater_channel_file_not_found',
  'err_updater_invalid_release_feed',
  'not found'
]

const NETWORK_PATTERNS = [
  'enotfound',
  'eai_again',
  'econnrefused',
  'etimedout',
  'esockettimedout',
  'econnreset',
  'enetunreach',
  'socket hang up',
  'getaddrinfo',
  'timeout',
  'err_connection_refused',
  'err_name_not_resolved',
  'err_internet_disconnected',
  'err_timed_out',
  'err_address_unreachable',
  'err_connection_reset',
  'err_network_changed'
]

const FORBIDDEN_HEADER =
  /^\s*(?:headers?|set-cookie|cookie|authorization|proxy-authorization|www-authenticate|location|etag|access-control-[a-z-]+|content-security-policy|content-type|content-length|content-encoding|connection|keep-alive|transfer-encoding|date|server|cache-control|vary|referrer-policy|strict-transport-security|x-[a-z0-9-]+)\s*:/i

const QUOTED_HEADER = /^\s*["'][a-z0-9-]+["']\s*:/i

const JSON_FRAGMENT = /^\s*[{}[\],]+\s*$/

const COOKIE_PAIR = /["']?(?:_gh_sess|[a-z0-9_-]+)=[^;"'\s,}]+/gi

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  if (error == null) return ''
  try {
    return String(error)
  } catch {
    return ''
  }
}

function rawErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const code = (error as { code?: unknown }).code
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return [typeof code === 'string' ? code : '', statusCode != null ? String(statusCode) : '']
    .filter(Boolean)
    .join(' ')
}

function includeAny(haystack: string, patterns: string[]): boolean {
  return patterns.some((pattern) => haystack.includes(pattern))
}

export function classifyUpdateError(error: unknown): ClassifiedUpdateError {
  const message = sanitizeUpdateErrorMessage(error)
  const haystack = `${rawErrorCode(error)} ${message}`.toLowerCase()

  const statusCode =
    error && typeof error === 'object' ? (error as { statusCode?: unknown }).statusCode : null
  const normalizedMessage = message.trim().toLowerCase()
  if (statusCode === 404 || normalizedMessage === '404' || normalizedMessage === 'not found') {
    return { kind: 'feed-unavailable', message }
  }

  // Feed failures win over network patterns: a 404 is a reachability problem,
  // not a DNS/socket problem, even when the HTTP client adds a timeout word.
  if (includeAny(haystack, FEED_PATTERNS)) {
    return { kind: 'feed-unavailable', message }
  }
  if (includeAny(haystack, NETWORK_PATTERNS)) {
    return { kind: 'network', message }
  }
  return { kind: 'unknown', message }
}

/**
 * Removes response headers, cookies, CSP text, and stray JSON blocks. The first
 * remaining safe line is kept so the UI can still show a useful diagnostic.
 */
export function sanitizeUpdateErrorMessage(error: unknown): string {
  const raw = rawErrorMessage(error)
  if (!raw.trim()) return ''

  const normalized = raw.replace(/\r\n?/g, '\n').replace(/\\r\\n|\\n|\\r/g, '\n')
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const safeLines = lines.filter((line) => {
    if (FORBIDDEN_HEADER.test(line)) return false
    if (QUOTED_HEADER.test(line)) return false
    if (JSON_FRAGMENT.test(line)) return false
    if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(line)) return false
    return true
  })

  let candidate = safeLines[0] ?? ''
  candidate = candidate
    .replace(/https?:\/\/[^\s)"']+/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(COOKIE_PAIR, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!candidate) return ''
  if (/headers?:|set-cookie|content-security-policy|_gh_sess/i.test(candidate)) return ''
  if (candidate.length > MAX_ERROR_LENGTH) {
    candidate = `${candidate.slice(0, MAX_ERROR_LENGTH - 1).trimEnd()}…`
  }
  return candidate
}
