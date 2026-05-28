export type LicenseInvalidReason =
  | 'missing_file'
  | 'invalid_format'
  | 'invalid_name'
  | 'invalid_key'
  | 'expired'

export interface LicenseStatus {
  valid: boolean
  reason?: LicenseInvalidReason
  message: string
  name?: string
  expiresAt?: string
  daysRemaining?: number
  licenseFile?: string
}
