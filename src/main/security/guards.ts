import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isAbsolute, relative, resolve } from 'node:path'

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

function parseIpv4(ip: string): number[] | null {
  const octets = ip.split('.').map((part) => Number(part))
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return null
  }
  return octets
}

function isLoopbackIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (normalized === '::1') return true

  const octets = parseIpv4(normalized)
  return octets !== null && octets[0] === 127
}

function isPrivateOrSpecialIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/i.test(normalized)) return true

  const octets = parseIpv4(normalized)
  if (octets === null) return false

  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true

  return false
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

export async function assertSafePublicHttpUrl(url: string, label: string): Promise<URL> {
  const parsed = assertHttpUrl(url, label)
  const hostname = normalizeHostname(parsed.hostname)

  if (isPrivateOrSpecialHostname(hostname)) {
    throw new Error(`${label} must not target localhost or a private network address`)
  }

  if (isIP(hostname) === 0) {
    const results = await lookup(hostname, { all: true, verbatim: true })
    if (results.length === 0) {
      throw new Error(`${label} host could not be resolved`)
    }

    for (const result of results) {
      if (isPrivateOrSpecialIp(result.address)) {
        throw new Error(`${label} must not resolve to localhost or a private network address`)
      }
    }
  }

  return parsed
}
