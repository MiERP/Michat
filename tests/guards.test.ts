import { describe, it, expect } from 'vitest'
import {
  normalizeFsPath,
  isPathInsideDirectory,
  assertLoopbackHttpUrl,
  assertSafePublicHttpUrl,
  isAllowedExternalOpenUrl
} from '../src/main/security/guards'

describe('guards', () => {
  describe('assertLoopbackHttpUrl', () => {
    it('accepts localhost', () => {
      const result = assertLoopbackHttpUrl('http://localhost:11434/v1', 'test')
      expect(result.hostname).toBe('localhost')
    })

    it('accepts 127.0.0.1', () => {
      const result = assertLoopbackHttpUrl('http://127.0.0.1:8000', 'test')
      expect(result.hostname).toBe('127.0.0.1')
    })

    it('rejects external URLs', () => {
      expect(() => assertLoopbackHttpUrl('http://example.com', 'test')).toThrow()
    })

    it('rejects ftp', () => {
      expect(() => assertLoopbackHttpUrl('ftp://localhost', 'test')).toThrow()
    })
  })

  describe('isAllowedExternalOpenUrl', () => {
    it('allows public URLs', () => {
      expect(isAllowedExternalOpenUrl('http://example.com')).toBe(true)
    })

    it('blocks localhost', () => {
      expect(isAllowedExternalOpenUrl('http://localhost')).toBe(false)
    })

    it('blocks private IPs', () => {
      expect(isAllowedExternalOpenUrl('http://192.168.1.1')).toBe(false)
    })

    it('blocks invalid URLs', () => {
      expect(isAllowedExternalOpenUrl('not-a-url')).toBe(false)
    })
  })

  describe('normalizeFsPath', () => {
    it('resolves relative paths', () => {
      const result = normalizeFsPath('./foo')
      expect(result).toContain('foo')
    })
  })

  describe('isPathInsideDirectory', () => {
    it('returns true for paths inside directory', () => {
      expect(isPathInsideDirectory('/base/child', '/base')).toBe(true)
    })

    it('returns false for paths outside directory', () => {
      expect(isPathInsideDirectory('/base/../../etc', '/base')).toBe(false)
    })
  })

  describe('assertSafePublicHttpUrl', () => {
    it('rejects IPv4-mapped IPv6 loopback addresses', async () => {
      await expect(
        assertSafePublicHttpUrl('http://[::ffff:127.0.0.1]:8000/v1/models', 'test')
      ).rejects.toThrow(/private network address/i)
    })

    it('rejects the unspecified IPv6 address', async () => {
      await expect(assertSafePublicHttpUrl('http://[::]:8000', 'test')).rejects.toThrow(
        /private network address/i
      )
    })

    it('rejects multicast and reserved IPv4 ranges', async () => {
      await expect(assertSafePublicHttpUrl('http://224.0.0.1', 'test')).rejects.toThrow(
        /private network address/i
      )
      await expect(assertSafePublicHttpUrl('http://240.0.0.1', 'test')).rejects.toThrow(
        /private network address/i
      )
    })

    it('rejects plain loopback and link-local addresses', async () => {
      await expect(assertSafePublicHttpUrl('http://127.0.0.1', 'test')).rejects.toThrow(
        /private network address/i
      )
      await expect(assertSafePublicHttpUrl('http://169.254.1.1', 'test')).rejects.toThrow(
        /private network address/i
      )
    })
  })
})
