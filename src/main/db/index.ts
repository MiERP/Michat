/* eslint-disable no-irregular-whitespace */
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as sqliteVec from 'sqlite-vec'
import * as schema from './schema'

let sqlite: Database.Database | null = null
let db: ReturnType<typeof drizzle> | null = null
let checkpointTimer: NodeJS.Timeout | null = null
let truncateTimer: NodeJS.Timeout | null = null
let isClosing = false // ÃƒÂ©Ã‹Å“Ã‚Â²ÃƒÂ¦Ã‚Â­Ã‚Â¢ÃƒÂ©Ã¢â‚¬Â¡Ã‚ÂÃƒÂ¥Ã‚Â¤Ã‚ÂÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â³ÃƒÂ©Ã¢â‚¬â€Ã‚Â­

/**
 * ÃƒÂ¥Ã‹â€ Ã‚ÂÃƒÂ¥Ã‚Â§Ã¢â‚¬Â¹ÃƒÂ¥Ã…â€™Ã¢â‚¬â€œÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¨Ã‚Â¿Ã…Â¾ÃƒÂ¦Ã…Â½Ã‚Â¥
 * ÃƒÂ¥Ã…â€œÃ‚Â¨ Electron ÃƒÂ¤Ã‚Â¸Ã‚Â»ÃƒÂ¨Ã‚Â¿Ã¢â‚¬ÂºÃƒÂ§Ã‚Â¨Ã¢â‚¬Â¹ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ app.whenReady() ÃƒÂ¤Ã‚Â¸Ã‚Â­ÃƒÂ¨Ã‚Â°Ã†â€™ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
 */
export function initDatabase() {
  // ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ¤Ã‚Â»Ã‚Â¶ÃƒÂ¥Ã‚Â­Ã‹Å“ÃƒÂ¦Ã¢â‚¬ÂÃ‚Â¾ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ÃƒÂ¦Ã‹â€ Ã‚Â·ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ§Ã¢â‚¬ÂºÃ‚Â®ÃƒÂ¥Ã‚Â½Ã¢â‚¬Â¢
  const dbPath = join(app.getPath('userData'), 'michat.db')

  console.log('[Database] Initializing database at:', dbPath)

  try {
    // ÃƒÂ¥Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¥Ã‚Â»Ã‚Âº SQLite ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¥Ã‚Â®Ã…Â¾ÃƒÂ¤Ã‚Â¾Ã¢â‚¬Â¹
    sqlite = new Database(dbPath)

    // ÃƒÂ¥Ã…Â Ã‚Â ÃƒÂ¨Ã‚Â½Ã‚Â½ sqlite-vec ÃƒÂ¦Ã¢â‚¬Â°Ã‚Â©ÃƒÂ¥Ã‚Â±Ã¢â‚¬Â¢
    if (app.isPackaged) {
      // ÃƒÂ¦Ã¢â‚¬Â°Ã¢â‚¬Å“ÃƒÂ¥Ã…â€™Ã¢â‚¬Â¦ÃƒÂ§Ã…Â½Ã‚Â¯ÃƒÂ¥Ã‚Â¢Ã†â€™ÃƒÂ¯Ã‚Â¼Ã…Â¡ÃƒÂ¦Ã¢â‚¬Â°Ã¢â‚¬Â¹ÃƒÂ¥Ã…Â Ã‚Â¨ÃƒÂ¦Ã…Â¾Ã¢â‚¬Å¾ÃƒÂ¥Ã‚Â»Ã‚ÂºÃƒÂ¥Ã‹â€ Ã‚Â° .asar.unpacked ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ÃƒÂ¨Ã‚Â·Ã‚Â¯ÃƒÂ¥Ã‚Â¾Ã¢â‚¬Å¾
      const platform = process.platform
      const arch = process.arch

      // ÃƒÂ¦Ã‹Å“Ã‚Â ÃƒÂ¥Ã‚Â°Ã¢â‚¬Å¾ÃƒÂ¥Ã‚Â¹Ã‚Â³ÃƒÂ¥Ã‚ÂÃ‚Â°ÃƒÂ¥Ã¢â‚¬â„¢Ã…â€™ÃƒÂ¦Ã…Â¾Ã‚Â¶ÃƒÂ¦Ã…Â¾Ã¢â‚¬Å¾ÃƒÂ¥Ã‚ÂÃ‚ÂÃƒÂ§Ã‚Â§Ã‚Â°
      const platformName = platform === 'win32' ? 'windows' : platform
      const packageName = `sqlite-vec-${platformName}-${arch}`
      const extension = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'

      // ÃƒÂ¦Ã…Â¾Ã¢â‚¬Å¾ÃƒÂ¥Ã‚Â»Ã‚ÂºÃƒÂ¥Ã‹â€ Ã‚Â°ÃƒÂ¨Ã‚Â§Ã‚Â£ÃƒÂ¥Ã…â€™Ã¢â‚¬Â¦ÃƒÂ§Ã¢â‚¬ÂºÃ‚Â®ÃƒÂ¥Ã‚Â½Ã¢â‚¬Â¢ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ÃƒÂ¨Ã‚Â·Ã‚Â¯ÃƒÂ¥Ã‚Â¾Ã¢â‚¬Å¾
      const vecPath = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        packageName,
        `vec0.${extension}`
      )

      console.log('[Database] Loading sqlite-vec from:', vecPath)
      sqlite.loadExtension(vecPath)
    } else {
      // ÃƒÂ¥Ã‚Â¼Ã¢â€šÂ¬ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ§Ã…Â½Ã‚Â¯ÃƒÂ¥Ã‚Â¢Ã†â€™ÃƒÂ¯Ã‚Â¼Ã…Â¡ÃƒÂ¤Ã‚Â½Ã‚Â¿ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ sqlite-vec ÃƒÂ©Ã‚Â»Ã‹Å“ÃƒÂ¨Ã‚Â®Ã‚Â¤ÃƒÂ¥Ã…Â Ã‚Â ÃƒÂ¨Ã‚Â½Ã‚Â½
      sqliteVec.load(sqlite)
    }
    console.log('[Database] sqlite-vec extension loaded')

    // ÃƒÂ©Ã‚ÂªÃ…â€™ÃƒÂ¨Ã‚Â¯Ã‚Â sqlite-vec ÃƒÂ§Ã¢â‚¬Â°Ã‹â€ ÃƒÂ¦Ã…â€œÃ‚Â¬
    const vecVersion = sqlite.prepare('SELECT vec_version() as version').get() as {
      version: string
    }
    console.log('[Database] sqlite-vec version:', vecVersion?.version)

    // ÃƒÂ¥Ã‚ÂÃ‚Â¯ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ WAL ÃƒÂ¦Ã‚Â¨Ã‚Â¡ÃƒÂ¥Ã‚Â¼Ã‚ÂÃƒÂ¤Ã‚Â»Ã‚Â¥ÃƒÂ¦Ã‚ÂÃ‚ÂÃƒÂ©Ã‚Â«Ã‹Å“ÃƒÂ¦Ã¢â€šÂ¬Ã‚Â§ÃƒÂ¨Ã†â€™Ã‚Â½
    sqlite.pragma('journal_mode = WAL')

    // ÃƒÂ¤Ã‚Â¼Ã‹Å“ÃƒÂ¥Ã…â€™Ã¢â‚¬â€œ WAL ÃƒÂ©Ã¢â‚¬Â¦Ã‚ÂÃƒÂ§Ã‚Â½Ã‚Â®
    sqlite.pragma('wal_autocheckpoint = 100') // ÃƒÂ¦Ã‚Â¯Ã‚Â 100 ÃƒÂ©Ã‚Â¡Ã‚ÂµÃƒÂ¨Ã¢â‚¬Â¡Ã‚ÂªÃƒÂ¥Ã…Â Ã‚Â¨ checkpointÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ©Ã¢â€žÂ¢Ã‚ÂÃƒÂ¤Ã‚Â½Ã…Â½ÃƒÂ©Ã‚Â»Ã‹Å“ÃƒÂ¨Ã‚Â®Ã‚Â¤ÃƒÂ¥Ã¢â€šÂ¬Ã‚Â¼ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
    sqlite.pragma('synchronous = NORMAL') // WAL ÃƒÂ¦Ã‚Â¨Ã‚Â¡ÃƒÂ¥Ã‚Â¼Ã‚ÂÃƒÂ¦Ã…Â½Ã‚Â¨ÃƒÂ¨Ã‚ÂÃ‚ÂÃƒÂ¨Ã‚Â®Ã‚Â¾ÃƒÂ§Ã‚Â½Ã‚Â®
    sqlite.pragma('busy_timeout = 5000') // 5 ÃƒÂ§Ã‚Â§Ã¢â‚¬â„¢ÃƒÂ¨Ã‚Â¶Ã¢â‚¬Â¦ÃƒÂ¦Ã¢â‚¬â€Ã‚Â¶ÃƒÂ¯Ã‚Â¼Ã…â€™ÃƒÂ©Ã‹Å“Ã‚Â²ÃƒÂ¦Ã‚Â­Ã‚Â¢ÃƒÂ¥Ã‚Â¹Ã‚Â¶ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ¥Ã¢â‚¬Â Ã‚Â²ÃƒÂ§Ã‚ÂªÃ‚Â

    // ÃƒÂ¨Ã‚Â®Ã‚Â°ÃƒÂ¥Ã‚Â½Ã¢â‚¬Â¢ÃƒÂ¥Ã‚Â½Ã¢â‚¬Å“ÃƒÂ¥Ã¢â‚¬Â°Ã‚ÂÃƒÂ©Ã¢â‚¬Â¦Ã‚ÂÃƒÂ§Ã‚Â½Ã‚Â®
    const journalMode = sqlite.pragma('journal_mode', { simple: true })
    const walCheckpoint = sqlite.pragma('wal_autocheckpoint', { simple: true })
    const syncMode = sqlite.pragma('synchronous', { simple: true })
    console.log('[Database] Configuration:', {
      journal_mode: journalMode,
      wal_autocheckpoint: walCheckpoint,
      synchronous: syncMode
    })

    // ÃƒÂ¥Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¥Ã‚Â»Ã‚Âº Drizzle ÃƒÂ¥Ã‚Â®Ã…Â¾ÃƒÂ¤Ã‚Â¾Ã¢â‚¬Â¹
    db = drizzle(sqlite, { schema })

    // ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¥Ã‚Â®Ã…â€™ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â´ÃƒÂ¦Ã¢â€šÂ¬Ã‚Â§ÃƒÂ¦Ã‚Â£Ã¢â€šÂ¬ÃƒÂ¦Ã…Â¸Ã‚Â¥
    const integrityCheck = sqlite.pragma('integrity_check', { simple: true })
    if (integrityCheck !== 'ok') {
      console.error('[Database] Integrity check failed:', integrityCheck)
    } else {
      console.log('[Database] Integrity check passed')
    }

    // ÃƒÂ¥Ã‚ÂÃ‚Â¯ÃƒÂ¥Ã…Â Ã‚Â¨ÃƒÂ¥Ã‚Â®Ã…Â¡ÃƒÂ¦Ã…â€œÃ…Â¸ checkpoint ÃƒÂ¦Ã…â€œÃ‚ÂºÃƒÂ¥Ã‹â€ Ã‚Â¶
    startPeriodicCheckpoint(dbPath)

    console.log('[Database] Database initialized successfully')
    return db
  } catch (error) {
    console.error('[Database] Failed to initialize database:', error)
    throw error
  }
}

/**
 * ÃƒÂ¥Ã‚ÂÃ‚Â¯ÃƒÂ¥Ã…Â Ã‚Â¨ÃƒÂ¥Ã‚Â®Ã…Â¡ÃƒÂ¦Ã…â€œÃ…Â¸ checkpoint ÃƒÂ¦Ã…â€œÃ‚ÂºÃƒÂ¥Ã‹â€ Ã‚Â¶
 */
function startPeriodicCheckpoint(dbPath: string) {
  const walPath = `${dbPath}-wal`

  // ÃƒÂ¦Ã‚Â¯Ã‚Â 30 ÃƒÂ§Ã‚Â§Ã¢â‚¬â„¢ÃƒÂ¦Ã‚Â£Ã¢â€šÂ¬ÃƒÂ¦Ã…Â¸Ã‚Â¥ WAL ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ¤Ã‚Â»Ã‚Â¶ÃƒÂ¥Ã‚Â¤Ã‚Â§ÃƒÂ¥Ã‚Â°Ã‚ÂÃƒÂ¥Ã‚Â¹Ã‚Â¶ÃƒÂ¦Ã¢â‚¬Â°Ã‚Â§ÃƒÂ¨Ã‚Â¡Ã…â€™ PASSIVE checkpoint
  checkpointTimer = setInterval(async () => {
    try {
      if (!sqlite || isClosing) return

      const stats = await stat(walPath).catch(() => null)
      if (stats && stats.size > 1024 * 1024) {
        // 1MB
        console.log(
          `[Database] WAL file size: ${(stats.size / 1024 / 1024).toFixed(2)}MB, executing PASSIVE checkpoint...`
        )
        const result = sqlite.pragma('wal_checkpoint(PASSIVE)')
        console.log('[Database] PASSIVE checkpoint result:', result)
      }
    } catch (error) {
      console.error('[Database] Error during periodic checkpoint:', error)
    }
  }, 30000) // 30 ÃƒÂ§Ã‚Â§Ã¢â‚¬â„¢

  checkpointTimer.unref() // ÃƒÂ¤Ã‚Â¸Ã‚ÂÃƒÂ©Ã‹Å“Ã‚Â»ÃƒÂ¦Ã‚Â­Ã‚Â¢ÃƒÂ¨Ã‚Â¿Ã¢â‚¬ÂºÃƒÂ§Ã‚Â¨Ã¢â‚¬Â¹ÃƒÂ©Ã¢â€šÂ¬Ã¢â€šÂ¬ÃƒÂ¥Ã¢â‚¬Â¡Ã‚Âº

  // ÃƒÂ¦Ã‚Â¯Ã‚Â 5 ÃƒÂ¥Ã‹â€ Ã¢â‚¬Â ÃƒÂ©Ã¢â‚¬â„¢Ã…Â¸ÃƒÂ¦Ã¢â‚¬Â°Ã‚Â§ÃƒÂ¨Ã‚Â¡Ã…â€™ÃƒÂ¤Ã‚Â¸Ã¢â€šÂ¬ÃƒÂ¦Ã‚Â¬Ã‚Â¡ TRUNCATE checkpointÃƒÂ¯Ã‚Â¼Ã…â€™ÃƒÂ¦Ã‚Â¸Ã¢â‚¬Â¦ÃƒÂ§Ã‚ÂÃ¢â‚¬Â  WAL ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ¤Ã‚Â»Ã‚Â¶
  truncateTimer = setInterval(() => {
    try {
      if (!sqlite || isClosing) return

      console.log('[Database] Executing scheduled TRUNCATE checkpoint...')
      const result = sqlite.pragma('wal_checkpoint(TRUNCATE)')
      console.log('[Database] TRUNCATE checkpoint result:', result)
    } catch (error) {
      console.error('[Database] Error during truncate checkpoint:', error)
    }
  }, 300000) // 5 ÃƒÂ¥Ã‹â€ Ã¢â‚¬Â ÃƒÂ©Ã¢â‚¬â„¢Ã…Â¸

  truncateTimer.unref()
}

/**
 * ÃƒÂ¦Ã¢â‚¬Â°Ã‚Â§ÃƒÂ¨Ã‚Â¡Ã…â€™ÃƒÂ¤Ã‚Â¸Ã‚Â»ÃƒÂ¥Ã…Â Ã‚Â¨ checkpointÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ¤Ã‚Â¾Ã¢â‚¬ÂºÃƒÂ¥Ã‚Â¤Ã¢â‚¬â€œÃƒÂ©Ã†â€™Ã‚Â¨ÃƒÂ¨Ã‚Â°Ã†â€™ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
 */
export function executeCheckpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE') {
  if (!sqlite) return

  try {
    console.log(`[Database] Executing ${mode} checkpoint...`)
    const result = sqlite.pragma(`wal_checkpoint(${mode})`)
    console.log(`[Database] ${mode} checkpoint result:`, result)
  } catch (error) {
    console.error(`[Database] Error executing ${mode} checkpoint:`, error)
  }
}

/**
 * ÃƒÂ¨Ã‚Â¿Ã‚ÂÃƒÂ¨Ã‚Â¡Ã…â€™ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¨Ã‚Â¿Ã‚ÂÃƒÂ§Ã‚Â§Ã‚Â»
 * ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ¥Ã‹â€ Ã‚ÂÃƒÂ¥Ã‚Â§Ã¢â‚¬Â¹ÃƒÂ¥Ã…â€™Ã¢â‚¬â€œÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¥Ã‚ÂÃ…Â½ÃƒÂ§Ã‚Â«Ã¢â‚¬Â¹ÃƒÂ¥Ã‚ÂÃ‚Â³ÃƒÂ¨Ã‚Â°Ã†â€™ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
 */
export function runMigrations() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  // __dirname ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ§Ã‚Â¼Ã¢â‚¬â€œÃƒÂ¨Ã‚Â¯Ã¢â‚¬ËœÃƒÂ¥Ã‚ÂÃ…Â½ÃƒÂ¦Ã…â€™Ã¢â‚¬Â¡ÃƒÂ¥Ã‚ÂÃ¢â‚¬Ëœ out/mainÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ¦Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¦Ã…â€œÃ¢â‚¬Â°ÃƒÂ¤Ã‚Â»Ã‚Â£ÃƒÂ§Ã‚Â Ã‚ÂÃƒÂ¦Ã¢â‚¬Â°Ã¢â‚¬Å“ÃƒÂ¥Ã…â€™Ã¢â‚¬Â¦ÃƒÂ¥Ã‹â€ Ã‚Â° out/main/index.jsÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
  // ÃƒÂ¨Ã¢â€šÂ¬Ã…â€™ migrations ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ¤Ã‚Â»Ã‚Â¶ÃƒÂ¨Ã‚Â¢Ã‚Â«ÃƒÂ¥Ã‚Â¤Ã‚ÂÃƒÂ¥Ã‹â€ Ã‚Â¶ÃƒÂ¥Ã‹â€ Ã‚Â° out/main/db/migrations
  const builtMigrationsFolder = join(__dirname, 'db', 'migrations')
  const sourceMigrationsFolder = join(__dirname, 'migrations')
  const migrationsFolder = existsSync(builtMigrationsFolder) ? builtMigrationsFolder : sourceMigrationsFolder
  console.log('[Database] Running migrations from:', migrationsFolder)

  try {
    migrate(db, { migrationsFolder })
    console.log('[Database] Migrations completed successfully')
  } catch (error) {
    console.error('[Database] Migration failed:', error)
    throw error
  }
}

/**
 * ÃƒÂ¥Ã‹â€ Ã‚ÂÃƒÂ¥Ã‚Â§Ã¢â‚¬Â¹ÃƒÂ¥Ã…â€™Ã¢â‚¬â€œÃƒÂ¦Ã¢â‚¬Â°Ã‚Â©ÃƒÂ¥Ã‚Â±Ã¢â‚¬Â¢ÃƒÂ¨Ã‚Â¡Ã‚Â¨ÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ©Ã¢â‚¬Â¡Ã‚ÂÃƒÂ¦Ã‚Â£Ã¢â€šÂ¬ÃƒÂ§Ã‚Â´Ã‚Â¢ + ÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â¨ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ¦Ã‚Â£Ã¢â€šÂ¬ÃƒÂ§Ã‚Â´Ã‚Â¢ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
 * ÃƒÂ¥Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¥Ã‚Â»Ã‚Âº sqlite-vec ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ vec0 ÃƒÂ¨Ã¢â€žÂ¢Ã…Â¡ÃƒÂ¦Ã¢â‚¬Â¹Ã…Â¸ÃƒÂ¨Ã‚Â¡Ã‚Â¨ÃƒÂ¥Ã¢â‚¬â„¢Ã…â€™ FTS5 ÃƒÂ¨Ã¢â€žÂ¢Ã…Â¡ÃƒÂ¦Ã¢â‚¬Â¹Ã…Â¸ÃƒÂ¨Ã‚Â¡Ã‚Â¨
 * ÃƒÂ¥Ã…â€œÃ‚Â¨ runMigrations ÃƒÂ¥Ã‚ÂÃ…Â½ÃƒÂ¨Ã‚Â°Ã†â€™ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
 */
export function initExtensions() {
  if (!sqlite) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  console.log('[Database] Initializing extension tables (Vector + FTS)...')

  try {
    // 1. ÃƒÂ¥Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¥Ã‚Â»Ã‚ÂºÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ©Ã¢â‚¬Â¡Ã‚ÂÃƒÂ§Ã‚Â´Ã‚Â¢ÃƒÂ¥Ã‚Â¼Ã¢â‚¬Â¢ÃƒÂ¨Ã¢â€žÂ¢Ã…Â¡ÃƒÂ¦Ã¢â‚¬Â¹Ã…Â¸ÃƒÂ¨Ã‚Â¡Ã‚Â¨ÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ¥Ã‚Â¦Ã¢â‚¬Å¡ÃƒÂ¦Ã…Â¾Ã…â€œÃƒÂ¤Ã‚Â¸Ã‚ÂÃƒÂ¥Ã‚Â­Ã‹Å“ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
    // ÃƒÂ¤Ã‚Â½Ã‚Â¿ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ cosine ÃƒÂ¨Ã‚Â·Ã‚ÂÃƒÂ§Ã‚Â¦Ã‚Â»ÃƒÂ¥Ã‚ÂºÃ‚Â¦ÃƒÂ©Ã¢â‚¬Â¡Ã‚ÂÃƒÂ¯Ã‚Â¼Ã…â€™1024 ÃƒÂ§Ã‚Â»Ã‚Â´ÃƒÂ¥Ã‚ÂºÃ‚Â¦ÃƒÂ¯Ã‚Â¼Ã‹â€ BAAI/bge-m3 ÃƒÂ©Ã‚Â»Ã‹Å“ÃƒÂ¨Ã‚Â®Ã‚Â¤ÃƒÂ§Ã‚Â»Ã‚Â´ÃƒÂ¥Ã‚ÂºÃ‚Â¦ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        embedding_id TEXT PRIMARY KEY,
        chunk_id TEXT,
        notebook_id TEXT,
        embedding FLOAT[1024] distance_metric=cosine
      );
    `)

    // 2. ÃƒÂ¥Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¥Ã‚Â»Ã‚Âº FTS5 ÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â¨ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ§Ã‚Â´Ã‚Â¢ÃƒÂ¥Ã‚Â¼Ã¢â‚¬Â¢ÃƒÂ¨Ã¢â€žÂ¢Ã…Â¡ÃƒÂ¦Ã¢â‚¬Â¹Ã…Â¸ÃƒÂ¨Ã‚Â¡Ã‚Â¨ÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ¥Ã‚Â¦Ã¢â‚¬Å¡ÃƒÂ¦Ã…Â¾Ã…â€œÃƒÂ¤Ã‚Â¸Ã‚ÂÃƒÂ¥Ã‚Â­Ã‹Å“ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
    // tokenize="unicode61" ÃƒÂ¦Ã¢â‚¬ÂÃ‚Â¯ÃƒÂ¦Ã…â€™Ã‚ÂÃƒÂ¥Ã…Â¸Ã‚ÂºÃƒÂ§Ã‚Â¡Ã¢â€šÂ¬ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ÃƒÂ¥Ã‚Â¤Ã…Â¡ÃƒÂ¨Ã‚Â¯Ã‚Â­ÃƒÂ¨Ã‚Â¨Ã¢â€šÂ¬ÃƒÂ¥Ã‹â€ Ã¢â‚¬Â ÃƒÂ¨Ã‚Â¯Ã‚Â
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
        chunk_id UNINDEXED,
        notebook_id UNINDEXED,
        content,
        tokenize="unicode61"
      );
    `)

    console.log('[Database] Extension tables initialized successfully')
  } catch (error) {
    console.error('[Database] Failed to initialize vector store:', error)
    throw error
  }
}

/**
 * ÃƒÂ¨Ã…Â½Ã‚Â·ÃƒÂ¥Ã‚ÂÃ¢â‚¬â€œÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¥Ã‚Â®Ã…Â¾ÃƒÂ¤Ã‚Â¾Ã¢â‚¬Â¹
 * ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ©Ã…â€œÃ¢â€šÂ¬ÃƒÂ¨Ã‚Â¦Ã‚ÂÃƒÂ¦Ã¢â‚¬Â°Ã‚Â§ÃƒÂ¨Ã‚Â¡Ã…â€™ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¦Ã¢â‚¬Å“Ã‚ÂÃƒÂ¤Ã‚Â½Ã…â€œÃƒÂ¦Ã¢â‚¬â€Ã‚Â¶ÃƒÂ¨Ã‚Â°Ã†â€™ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
 */
export function getDatabase() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * ÃƒÂ¤Ã‚Â¼Ã‹Å“ÃƒÂ©Ã¢â‚¬ÂºÃ¢â‚¬Â¦ÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â³ÃƒÂ©Ã¢â‚¬â€Ã‚Â­ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¨Ã‚Â¿Ã…Â¾ÃƒÂ¦Ã…Â½Ã‚Â¥
 * ÃƒÂ¥Ã…â€œÃ‚Â¨ Electron app.on('before-quit') ÃƒÂ¤Ã‚Â¸Ã‚Â­ÃƒÂ¨Ã‚Â°Ã†â€™ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
 */
export function closeDatabase() {
  if (isClosing || !sqlite) {
    console.log('[Database] Database already closed or closing')
    return
  }

  isClosing = true
  console.log('[Database] Starting graceful database closure...')

  try {
    // ÃƒÂ¦Ã‚Â¸Ã¢â‚¬Â¦ÃƒÂ©Ã¢â€žÂ¢Ã‚Â¤ÃƒÂ¥Ã‚Â®Ã…Â¡ÃƒÂ¦Ã¢â‚¬â€Ã‚Â¶ÃƒÂ¥Ã¢â€žÂ¢Ã‚Â¨
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = null
    }
    if (truncateTimer) {
      clearInterval(truncateTimer)
      truncateTimer = null
    }

    // ÃƒÂ¦Ã¢â‚¬Â°Ã‚Â§ÃƒÂ¨Ã‚Â¡Ã…â€™ÃƒÂ¦Ã…â€œÃ¢â€šÂ¬ÃƒÂ§Ã‚Â»Ã‹â€  checkpointÃƒÂ¯Ã‚Â¼Ã…â€™ÃƒÂ¥Ã‚Â¼Ã‚ÂºÃƒÂ¥Ã‹â€ Ã‚Â¶ÃƒÂ¥Ã‚ÂÃ‹â€ ÃƒÂ¥Ã‚Â¹Ã‚Â¶ÃƒÂ¦Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¦Ã…â€œÃ¢â‚¬Â° WAL ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‹â€ Ã‚Â°ÃƒÂ¤Ã‚Â¸Ã‚Â»ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“
    console.log('[Database] Executing final RESTART checkpoint before closing...')
    const checkpointResult = sqlite.pragma('wal_checkpoint(RESTART)')
    console.log('[Database] Final checkpoint result:', checkpointResult)

    // ÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â³ÃƒÂ©Ã¢â‚¬â€Ã‚Â­ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ¦Ã‚ÂÃ‚Â®ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“ÃƒÂ¨Ã‚Â¿Ã…Â¾ÃƒÂ¦Ã…Â½Ã‚Â¥
    sqlite.close()
    console.log('[Database] Database connection closed successfully')

    sqlite = null
    db = null
  } catch (error) {
    console.error('[Database] Error during database closure:', error)
    // ÃƒÂ¥Ã‚ÂÃ‚Â³ÃƒÂ¤Ã‚Â½Ã‚Â¿ÃƒÂ¥Ã¢â‚¬Â¡Ã‚ÂºÃƒÂ©Ã¢â‚¬ÂÃ¢â€žÂ¢ÃƒÂ¤Ã‚Â¹Ã…Â¸ÃƒÂ¨Ã‚Â¦Ã‚ÂÃƒÂ¦Ã‚Â¸Ã¢â‚¬Â¦ÃƒÂ§Ã‚ÂÃ¢â‚¬Â ÃƒÂ¥Ã‚Â¼Ã¢â‚¬Â¢ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
    sqlite = null
    db = null
  }
}

/**
 * ÃƒÂ¨Ã…Â½Ã‚Â·ÃƒÂ¥Ã‚ÂÃ¢â‚¬â€œÃƒÂ¥Ã…Â½Ã…Â¸ÃƒÂ¥Ã‚Â§Ã¢â‚¬Â¹ SQLite ÃƒÂ¥Ã‚Â®Ã…Â¾ÃƒÂ¤Ã‚Â¾Ã¢â‚¬Â¹ÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ÃƒÂ¤Ã‚ÂºÃ…Â½ pragma ÃƒÂ§Ã‚Â­Ã¢â‚¬Â°ÃƒÂ¦Ã¢â‚¬Å“Ã‚ÂÃƒÂ¤Ã‚Â½Ã…â€œÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
 */
export function getSqlite() {
  return sqlite
}

// ÃƒÂ¥Ã‚Â¯Ã‚Â¼ÃƒÂ¥Ã¢â‚¬Â¡Ã‚ÂºÃƒÂ§Ã‚Â±Ã‚Â»ÃƒÂ¥Ã…Â¾Ã¢â‚¬Â¹ÃƒÂ¤Ã‚Â¾Ã¢â‚¬ÂºÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â¶ÃƒÂ¤Ã‚Â»Ã¢â‚¬â€œÃƒÂ¦Ã‚Â¨Ã‚Â¡ÃƒÂ¥Ã‚ÂÃ¢â‚¬â€ÃƒÂ¤Ã‚Â½Ã‚Â¿ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨
export type Database = NonNullable<typeof db>
