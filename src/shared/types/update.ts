/**
 * Update status enum
 */
export enum UpdateStatus {
  IDLE = 'idle',
  CHECKING = 'checking',
  AVAILABLE = 'available',
  NOT_AVAILABLE = 'not-available',
  DOWNLOADING = 'downloading',
  DOWNLOADED = 'downloaded',
  ERROR = 'error'
}

/** Categorized update failure used to render a localized message. */
export type UpdateErrorKind = 'feed-unavailable' | 'network' | 'unknown'

/**
 * Update progress
 */
export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

/** A downloadable file listed in electron-updater's update metadata. */
export interface UpdateFileInfo {
  url: string
  sha512?: string
  size?: number
  blockMapSize?: number
  isAdminRightsRequired?: boolean
}

/** A release note entry used when electron-updater returns a changelog list. */
export interface ReleaseNoteInfo {
  version: string
  note: string | null
}

/**
 * Update metadata compatible with electron-updater's UpdateInfo.
 * Only the fields this app reads are declared; electron-updater objects with
 * additional fields remain assignable.
 */
export interface UpdateInfo {
  version: string
  files?: UpdateFileInfo[]
  releaseName?: string | null
  releaseNotes?: string | Array<ReleaseNoteInfo> | null
  releaseDate?: string
  stagingPercentage?: number
  minimumSystemVersion?: string
}

/**
 * Update state
 */
export interface UpdateState {
  status: UpdateStatus
  info?: UpdateInfo
  progress?: UpdateProgress
  /** Categorized failure used by the localized About card. */
  errorKind?: UpdateErrorKind
}

/**
 * Update check result. `error` is a fixed code, never raw updater text.
 */
export interface UpdateCheckResult {
  success: boolean
  state?: UpdateState
  error?: 'update-failed'
}

/**
 * Update operation result. `error` is a fixed code, never raw updater text.
 */
export interface UpdateOperationResult {
  success: boolean
  error?: 'update-failed'
}
