import Logger from '../../shared/utils/logger'
import type { LicenseStatus } from '../../shared/types/license'

// ============================================================
// HARDCODED LICENSE — Thay đổi giá trị tại đây khi cần cập nhật
// ============================================================
const HARDCODED_LICENSE_NAME = 'michat-PCT70-DEMO-260731-fullversion'
const HARDCODED_LICENSE_KEY = '260731' // Format YYMMDD → hết hạn 2026-07-31
// ============================================================

const EXPECTED_LICENSE_NAME_PREFIX = 'michat'

function parseExpiryDate(raw: string): Date | null {
  if (!/^\d{6}$/.test(raw)) return null

  const yy = Number(raw.slice(0, 2))
  const mm = Number(raw.slice(2, 4))
  const dd = Number(raw.slice(4, 6))
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null

  const year = 2000 + yy
  const date = new Date(year, mm - 1, dd, 23, 59, 59, 999)
  if (date.getFullYear() !== year || date.getMonth() !== mm - 1 || date.getDate() !== dd) {
    return null
  }
  return date
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isLicenseNameForThisApp(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return (
    normalized === EXPECTED_LICENSE_NAME_PREFIX ||
    normalized.startsWith(`${EXPECTED_LICENSE_NAME_PREFIX}-`)
  )
}

export class LicenseService {
  private static initialized = false
  private static cachedStatus: LicenseStatus | null = null

  static ensureLicenseOnStartup(): LicenseStatus {
    // Không cần đồng bộ file nữa — license được hardcode trong mã nguồn
    const status = this.computeStatus()
    this.cachedStatus = status
    this.initialized = true
    return status
  }

  static getStatus(): LicenseStatus {
    if (this.initialized && this.cachedStatus) {
      return this.cachedStatus
    }
    return this.ensureLicenseOnStartup()
  }

  private static computeStatus(): LicenseStatus {
    try {
      const name = HARDCODED_LICENSE_NAME
      const key = HARDCODED_LICENSE_KEY

      if (!name || !key) {
        return {
          valid: false,
          reason: 'invalid_format',
          message: 'License format is invalid'
        }
      }

      if (!isLicenseNameForThisApp(name)) {
        return {
          valid: false,
          reason: 'invalid_name',
          message: 'License name does not match this application',
          name
        }
      }

      const expiry = parseExpiryDate(key)
      if (!expiry) {
        return {
          valid: false,
          reason: 'invalid_key',
          message: 'License key format is invalid',
          name
        }
      }

      const now = new Date()
      if (now.getTime() > expiry.getTime()) {
        return {
          valid: false,
          reason: 'expired',
          message: `License expired on ${toIsoDate(expiry)}`,
          name,
          expiresAt: toIsoDate(expiry),
          daysRemaining: 0
        }
      }

      const msRemaining = Math.max(0, expiry.getTime() - now.getTime())
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000))
      return {
        valid: true,
        message: 'License is valid',
        name,
        expiresAt: toIsoDate(expiry),
        daysRemaining
      }
    } catch (error) {
      Logger.error('LicenseService', 'Failed to check license status:', error)
      return {
        valid: false,
        reason: 'invalid_format',
        message: 'Failed to parse license'
      }
    }
  }
}
