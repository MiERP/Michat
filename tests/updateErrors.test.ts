import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { classifyUpdateError, sanitizeUpdateErrorMessage } from '../src/main/utils/updateErrors'

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'update', name), 'utf8')

const FORBIDDEN = ['_gh_sess', 'set-cookie', 'content-security-policy', 'headers:', 'releases.atom']

function expectNoTokens(value: string): void {
  for (const token of FORBIDDEN) {
    expect(value.toLowerCase()).not.toContain(token)
  }
}

describe('sanitizeUpdateErrorMessage', () => {
  it('strips a GitHub-style 404 header block and keeps a safe summary', () => {
    const raw = fixture('private-feed-error.txt')
    // The runtime input actually contains the dangerous tokens.
    expect(raw.toLowerCase()).toContain('_gh_sess')
    expect(raw.toLowerCase()).toContain('set-cookie')
    expect(raw.toLowerCase()).toContain('content-security-policy')
    expect(raw.toLowerCase()).toContain('releases.atom')

    const sanitized = sanitizeUpdateErrorMessage(raw)
    expect(sanitized.length).toBeLessThanOrEqual(240)
    expect(sanitized.length).toBeGreaterThan(0)
    expectNoTokens(sanitized)
  })

  it('drops a first-line header block and keeps the next safe line', () => {
    const raw = fixture('header-first-error.txt')
    expect(raw.toLowerCase()).toContain('headers:')
    const sanitized = sanitizeUpdateErrorMessage(raw)
    expect(sanitized).toContain('Cannot find latest.yml')
    expectNoTokens(sanitized)
  })

  it('returns an empty string when every line is header/cookie noise', () => {
    expect(sanitizeUpdateErrorMessage(fixture('headers-only-error.txt'))).toBe('')
  })

  it('handles null, undefined, objects, and empty strings', () => {
    expect(sanitizeUpdateErrorMessage(null)).toBe('')
    expect(sanitizeUpdateErrorMessage(undefined)).toBe('')
    expect(sanitizeUpdateErrorMessage('')).toBe('')
    expect(sanitizeUpdateErrorMessage({})).toBe('')
  })

  it('drops a pretty-printed multi-line header block and keeps the status line', () => {
    const raw = fixture('multiline-headers-error.txt')
    expect(raw).toContain('_gh_sess=SUPERSECRET')
    const sanitized = sanitizeUpdateErrorMessage(raw)
    expect(sanitized).toBe('404 Not Found')
    expectNoTokens(sanitized)
  })

  it('drops credential-bearing headers even without cookies', () => {
    expect(sanitizeUpdateErrorMessage('Authorization: Bearer ghp_SECRETTOKENVALUE')).toBe('')
    expect(
      sanitizeUpdateErrorMessage(
        'Headers: {\n  "authorization": "Bearer ghp_SECRETTOKENVALUE"\n}\nSafe line'
      )
    ).toBe('Safe line')
  })

  it('drops a cookie-free header line on its own', () => {
    const sanitized = sanitizeUpdateErrorMessage(
      'Content-Type: application/json\r\nCannot read update metadata'
    )
    expect(sanitized).toBe('Cannot read update metadata')
  })

  it('strips a cookie pair from a non-header line', () => {
    expect(sanitizeUpdateErrorMessage('fetch failed _gh_sess=abc123 retry')).toBe(
      'fetch failed retry'
    )
  })

  it('handles real CRLF line endings', () => {
    expect(sanitizeUpdateErrorMessage('Headers: {}\r\nSafe line\r\n')).toBe('Safe line')
  })

  it('drops a line that still contains header/cookie markers after scrubbing', () => {
    expect(
      sanitizeUpdateErrorMessage(
        'Error: 404 {"set-cookie": "_gh_sess=SUPERSECRET", "content-security-policy": "none"}'
      )
    ).toBe('')
    expect(sanitizeUpdateErrorMessage('Bearer ghp_SECRETTOKENVALUE')).toBe('[redacted]')
  })

  it('truncates long safe messages to 240 UTF-16 units', () => {
    const sanitized = sanitizeUpdateErrorMessage('x'.repeat(500))
    expect(sanitized).toHaveLength(240)
    expect(sanitized.endsWith('…')).toBe(true)
  })
})

describe('classifyUpdateError', () => {
  it('classifies 404/feed failures before network keywords', () => {
    expect(classifyUpdateError(fixture('private-feed-error.txt')).kind).toBe('feed-unavailable')
    expect(classifyUpdateError('404 timeout while reading releases.atom').kind).toBe(
      'feed-unavailable'
    )
    expect(classifyUpdateError({ code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }).kind).toBe(
      'feed-unavailable'
    )
    expect(classifyUpdateError('HttpError: Not Found').kind).toBe('feed-unavailable')
    expect(classifyUpdateError(new Error('Not Found')).kind).toBe('feed-unavailable')
    expect(classifyUpdateError({ code: 'HTTP_ERROR_404', message: '404 ' }).kind).toBe(
      'feed-unavailable'
    )
    expect(classifyUpdateError({ statusCode: 404, message: '404 ' }).kind).toBe('feed-unavailable')

    const httpError = Object.assign(new Error(fixture('http-error-404.txt')), {
      code: 'HTTP_ERROR_404'
    })
    expect(classifyUpdateError(httpError)).toMatchObject({
      kind: 'feed-unavailable',
      message: '404'
    })
    expect(classifyUpdateError(fixture('header-first-error.txt')).kind).toBe('feed-unavailable')
    expect(classifyUpdateError('connect ECONNREFUSED 127.0.0.1:49404').kind).toBe('network')
  })

  it('classifies DNS/socket failures as network', () => {
    for (const message of [
      'getaddrinfo ENOTFOUND api.github.com',
      'connect ECONNREFUSED 127.0.0.1:1',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'socket hang up',
      'net::ERR_CONNECTION_REFUSED',
      'net::ERR_NAME_NOT_RESOLVED'
    ]) {
      expect(classifyUpdateError(message).kind, message).toBe('network')
    }
  })

  it('classifies a 500 with a timeout header as unknown, not network', () => {
    const raw =
      '500 Internal Server Error\nHeaders: { "keep-alive": "timeout=5", "content-length": "0" }'
    const classified = classifyUpdateError(raw)
    expect(classified.kind).toBe('unknown')
    expect(classified.message).toBe('500 Internal Server Error')
  })

  it('classifies everything else as unknown, including empty input', () => {
    expect(classifyUpdateError('server exploded').kind).toBe('unknown')
    expect(classifyUpdateError(null).kind).toBe('unknown')
    expect(classifyUpdateError({ code: 'SOMETHING' }).kind).toBe('unknown')
  })
})
