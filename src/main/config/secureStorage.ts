/**
 * Secure storage utilities
 * Uses the Electron safeStorage API to encrypt sensitive data
 */

import { safeStorage } from 'electron'
import Logger from '../../shared/utils/logger'

/**
 * Encrypts text data
 * @param plainText plain text
 * @returns Base64-encoded encrypted data, or null if encryption fails
 */
export function encryptString(plainText: string): string | null {
  try {
    // Check whether encryption is available
    if (!safeStorage.isEncryptionAvailable()) {
      Logger.warn('SecureStorage', 'Encryption not available on this platform')
      return null
    }

    const encrypted = safeStorage.encryptString(plainText)
    return encrypted.toString('base64')
  } catch (error) {
    Logger.error('SecureStorage', 'Failed to encrypt string:', error)
    return null
  }
}

/**
 * Decrypts text data
 * @param encryptedBase64 Base64-encoded encrypted data
 * @returns decrypted plain text, or null if decryption fails
 */
export function decryptString(encryptedBase64: string): string | null {
  try {
    if (!encryptedBase64) {
      return null
    }

    const buffer = Buffer.from(encryptedBase64, 'base64')
    const decrypted = safeStorage.decryptString(buffer)
    return decrypted
  } catch (error) {
    Logger.error('SecureStorage', 'Failed to decrypt string:', error)
    return null
  }
}

/**
 * Checks whether encryption is available
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Encrypts the sensitive fields of an object
 * @param obj object containing sensitive data
 * @param sensitiveFields array of field names to encrypt
 * @returns the encrypted object (the original object is mutated)
 */
export function encryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  sensitiveFields: string[]
): T {
  const result: Record<string, unknown> = { ...obj }

  for (const field of sensitiveFields) {
    const value = result[field]
    if (field in result && typeof value === 'string') {
      const encrypted = encryptString(value)
      if (encrypted) {
        result[field] = encrypted
        // Add a marker indicating the field is encrypted
        result[`__encrypted_${field}`] = true
      }
    }
  }

  return result as T
}

/**
 * Decrypts the sensitive fields of an object
 * @param obj object containing encrypted data
 * @param sensitiveFields array of field names to decrypt
 * @returns the decrypted object (the original object is mutated)
 */
export function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  sensitiveFields: string[]
): T {
  const result: Record<string, unknown> = { ...obj }

  for (const field of sensitiveFields) {
    // Check whether the encryption marker is present
    const encryptedMarker = `__encrypted_${field}`
    const value = result[field]
    if (result[encryptedMarker] && field in result && typeof value === 'string') {
      const decrypted = decryptString(value)
      if (decrypted) {
        result[field] = decrypted
      }
      // Remove the encryption marker
      delete result[encryptedMarker]
    }
  }

  return result as T
}

/**
 * List of sensitive fields in a provider configuration
 */
export const PROVIDER_SENSITIVE_FIELDS = ['apiKey', 'apiSecret', 'accessToken']

/**
 * Encrypts a provider configuration
 * @param config provider configuration object
 * @returns the encrypted configuration
 */
export function encryptProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  return encryptObjectFields(config, PROVIDER_SENSITIVE_FIELDS)
}

/**
 * Decrypts a provider configuration
 * @param config encrypted provider configuration object
 * @returns the decrypted configuration
 */
export function decryptProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  return decryptObjectFields(config, PROVIDER_SENSITIVE_FIELDS)
}
