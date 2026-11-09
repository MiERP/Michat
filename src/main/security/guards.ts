import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isAbsolute, relative, resolve } from 'node:path'
import * as ipaddr from 'ipaddr.js'

/**
 * Ranges that must never be reachable by a user-supplied URL. `ipaddr.process`
 * normalizes IPv4-mapped IPv6 addresses before the range check.
 */
const BLOCKED_IP_RANGES = new Set([
  'unspecified',
  'broadcast',
  'multicast',
  'linkLocal',
  'loopback',
  'carrierGradeNat',
  'private',
  'reserved',
  'as112',
  'as112v6',
  'amt',
  'uniqueLocal',
  'documentation',
  'benchmarking',
  'ipv4Mapped'
])

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

function parseIp(hostname: string): ipaddr.IP | null {
  const normalized = normalizeHostname(hostname)
  if (!normalized || !ipaddr.isValid(normalized)) return null
  return ipaddr.process(normalized)
}

function isLoopbackIp(hostname: string): boolean {
  return parseIp(hostname)?.range() === 'loopback'
}

function isPrivateOrSpecialIp(hostname: string): boolean {
  const address = parseIp(hostname)
  return address !== null && BLOCKED_IP_RANGES.has(address.range())
}

function isPrivateOrSpecialHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (normalized.endsWith('.local')) return true

  return isIP(normalized) !== 0 && isPrivateOrSpecialIp(normalized)
}

function assertHttpUrl(url: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`)
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include embedded credentials`)
  }

  return parsed
}

export function normalizeFsPath(filePath: string): string {
  return resolve(filePath)
}

export function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const normalizedTarget = normalizeFsPath(targetPath)
  const normalizedDirectory = normalizeFsPath(directoryPath)
  const rel = relative(normalizedDirectory, normalizedTarget)

  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function assertLoopbackHttpUrl(url: string, label: string): URL {
  const parsed = assertHttpUrl(url, label)
  const hostname = normalizeHostname(parsed.hostname)

  if (hostname !== 'localhost' && !isLoopbackIp(hostname)) {
    throw new Error(`${label} must point to localhost or 127.0.0.1`)
  }

  return parsed
}

export function isAllowedExternalOpenUrl(url: string): boolean {
  try {
    const parsed = assertHttpUrl(url, 'URL')
    return !isPrivateOrSpecialHostname(parsed.hostname)
  } catch {
    return false
  }
}

export interface ValidatedPublicUrl {
  url: URL
  /** Resolved addresses; the caller can pin the connection to one of them. */
  addresses: string[]
}

export async function assertSafePublicHttpUrl(
  url: string,
  label: string
): Promise<ValidatedPublicUrl> {
  const parsed = assertHttpUrl(url, label)
  const hostname = normalizeHostname(parsed.hostname)

  if (isPrivateOrSpecialHostname(hostname)) {
    throw new Error(`${label} must not target localhost or a private network address`)
  }

  if (isIP(hostname) !== 0) {
    return { url: parsed, addresses: [hostname] }
  }

  const results = await lookup(hostname, { all: true, verbatim: true })
  if (results.length === 0) {
    throw new Error(`${label} host could not be resolved`)
  }

  const addresses = results.map((result) => result.address)
  for (const address of addresses) {
    if (isPrivateOrSpecialIp(address)) {
      throw new Error(`${label} must not resolve to localhost or a private network address`)
    }
  }

  return { url: parsed, addresses }
}
