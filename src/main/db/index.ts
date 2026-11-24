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
let isClosing = false // guard against double close
let vectorIndexRebuilt = false

/**
 * Kiểm tra bảng vec_embeddings hiện có cột document_id chưa.
 * vec0 là virtual table nên không ALTER được: probe bằng SELECT là cách
 * đáng tin nhất (PRAGMA table_info có thể không phản ánh đúng cột của module).
 */
function vectorTableHasDocumentColumn(connection: Database.Database): boolean {
  try {
    connection.prepare('SELECT document_id FROM vec_embeddings LIMIT 1').get()
    return true
  } catch {
    return false
  }
}

/**
 * True khi lần chạy này đã phải tạo lại bảng vector (mất vector cũ).
 * Caller (main) dùng cờ này để xếp hàng job 'rebuild-vectors'.
 */
export function wasVectorIndexRebuilt(): boolean {
  return vectorIndexRebuilt
}

/**
 * Initializes the database connection.
 * Call inside app.whenReady() in the Electron main process.
 */
export function initDatabase() {
  if (db && sqlite?.open) return db
  isClosing = false
  vectorIndexRebuilt = false
  // Database file lives in the user data directory
  const dbPath = join(app.getPath('userData'), 'michat.db')

  console.log('[Database] Initializing database at:', dbPath)

  try {
    // Create the SQLite database instance
    sqlite = new Database(dbPath)

    // Load the sqlite-vec extension
    if (app.isPackaged) {
      // Packaged build: manually resolve the .asar.unpacked path
      const platform = process.platform
      const arch = process.arch

      // Map platform and architecture names
      const platformName = platform === 'win32' ? 'windows' : platform
      const packageName = `sqlite-vec-${platformName}-${arch}`
      const extension = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'

      // Build the path inside the unpacked directory
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
      // Development: let sqlite-vec load with its defaults
      sqliteVec.load(sqlite)
    }
    console.log('[Database] sqlite-vec extension loaded')

    // Verify the sqlite-vec version
    const vecVersion = sqlite.prepare('SELECT vec_version() as version').get() as {
      version: string
    }
    console.log('[Database] sqlite-vec version:', vecVersion?.version)

    // Enable WAL mode for better performance
    sqlite.pragma('journal_mode = WAL')

    // Explicitly enforce the schema's ON DELETE CASCADE relationships.
    sqlite.pragma('foreign_keys = ON')

    // Overwrite deleted rows instead of leaving old content in free pages.
    sqlite.pragma('secure_delete = ON')

    // Tune the WAL configuration
    sqlite.pragma('wal_autocheckpoint = 100') // auto-checkpoint every 100 pages (lowered from the default)
    sqlite.pragma('synchronous = NORMAL') // recommended setting for WAL mode
    sqlite.pragma('busy_timeout = 5000') // 5-second timeout to avoid lock contention

    // Log the current configuration
    const journalMode = sqlite.pragma('journal_mode', { simple: true })
    const walCheckpoint = sqlite.pragma('wal_autocheckpoint', { simple: true })
    const syncMode = sqlite.pragma('synchronous', { simple: true })
    console.log('[Database] Configuration:', {
      journal_mode: journalMode,
      wal_autocheckpoint: walCheckpoint,
      synchronous: syncMode
    })

    // Create the Drizzle instance
    db = drizzle(sqlite, { schema })

    // Database integrity check
    const integrityCheck = sqlite.pragma('integrity_check', { simple: true })
    if (integrityCheck !== 'ok') {
      console.error('[Database] Integrity check failed:', integrityCheck)
    } else {
      console.log('[Database] Integrity check passed')
    }

    // Start the periodic checkpoint mechanism
    startPeriodicCheckpoint(dbPath)

    console.log('[Database] Database initialized successfully')
    return db
  } catch (error) {
    console.error('[Database] Failed to initialize database:', error)
    throw error
  }
}

/**
 * Starts the periodic checkpoint mechanism
 */
function startPeriodicCheckpoint(dbPath: string) {
  const walPath = `${dbPath}-wal`

  // Every 30 seconds, check the WAL file size and run a PASSIVE checkpoint
  checkpointTimer = setInterval(async () => {
    try {
      if (!sqlite || isClosing) return

      const stats = await stat(walPath).catch(() => null)
      if (!sqlite || isClosing) return
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
  }, 30000) // 30 seconds

  checkpointTimer.unref() // do not keep the process alive

  // Every 5 minutes, run a TRUNCATE checkpoint to shrink the WAL file
  truncateTimer = setInterval(() => {
    try {
      if (!sqlite || isClosing) return

      console.log('[Database] Executing scheduled TRUNCATE checkpoint...')
      const result = sqlite.pragma('wal_checkpoint(TRUNCATE)')
      console.log('[Database] TRUNCATE checkpoint result:', result)
    } catch (error) {
      console.error('[Database] Error during truncate checkpoint:', error)
    }
  }, 300000) // 5 minutes

  truncateTimer.unref()
}

/**
 * Runs an explicit checkpoint (for external callers)
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
 * Rebuild the database file after destructive deletes so old pages do not
 * retain document/chat content. VACUUM cannot run inside a transaction.
 */
export function vacuumDatabase(): void {
  if (!sqlite || isClosing) return
  try {
    sqlite.exec('VACUUM')
    console.log('[Database] VACUUM completed')
  } catch (error) {
    console.warn('[Database] VACUUM failed:', error)
  }
}

/**
 * Runs database migrations.
 * Call immediately after initializing the database.
 */
export function runMigrations() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  // After compilation __dirname points to out/main (all code is bundled into out/main/index.js)
  // while the migrations files are copied to out/main/db/migrations
  const builtMigrationsFolder = join(__dirname, 'db', 'migrations')
  const sourceMigrationsFolder = join(__dirname, 'migrations')
  const migrationsFolder = existsSync(builtMigrationsFolder)
    ? builtMigrationsFolder
    : sourceMigrationsFolder
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
 * Initializes the extension tables (vector search + full-text search).
 * Creates the sqlite-vec vec0 virtual table and the FTS5 virtual table.
 * Call after runMigrations.
 */
export function initExtensions() {
  if (!sqlite) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  console.log('[Database] Initializing extension tables (Vector + FTS)...')

  try {
    // 1. Create the vector index virtual table (if it does not exist)
    // Uses cosine distance with 1024 dimensions (the BAAI/bge-m3 default)
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        embedding_id TEXT PRIMARY KEY,
        chunk_id TEXT,
        document_id TEXT,
        notebook_id TEXT,
        embedding FLOAT[1024] distance_metric=cosine
      );
    `)

    // Bảng cũ (thiếu document_id) phải được tạo lại vì vec0 không ALTER được.
    // Vector cũ mất → job 'rebuild-vectors' sẽ embed lại từ chunks.content.
    if (!vectorTableHasDocumentColumn(sqlite)) {
      console.warn(
        '[Database] vec_embeddings is legacy (no document_id) — recreating table; chunk vectors will be re-embedded in background'
      )
      sqlite.exec('DROP TABLE IF EXISTS vec_embeddings;')
      sqlite.exec(`
        CREATE VIRTUAL TABLE vec_embeddings USING vec0(
          embedding_id TEXT PRIMARY KEY,
          chunk_id TEXT,
          document_id TEXT,
          notebook_id TEXT,
          embedding FLOAT[1024] distance_metric=cosine
        );
      `)
      vectorIndexRebuilt = true
    }

    // 1b. Vector cấp TÀI LIỆU (document-level index) cho Hierarchical Retrieval:
    // một vector cho mỗi document (summary/enrichment hoặc phần đầu nội dung).
    // Dùng để chọn tài liệu trước, rồi mới tìm chunk bên trong.
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
        embedding_id TEXT PRIMARY KEY,
        document_id TEXT,
        notebook_id TEXT,
        embedding FLOAT[1024] distance_metric=cosine
      );
    `)

    // 1c. Vector cấp MỤC (section-level index): một vector cho mỗi heading của
    // tài liệu có cấu trúc — tầng giữa của document → section → chunk retrieval.
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_sections USING vec0(
        embedding_id TEXT PRIMARY KEY,
        section_id TEXT,
        document_id TEXT,
        notebook_id TEXT,
        embedding FLOAT[1024] distance_metric=cosine
      );
    `)

    // 2. Create the FTS5 full-text index virtual table (if it does not exist)
    // tokenize="unicode61" provides basic multilingual tokenization
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
 * Returns the database instance.
 * Call when a database operation is needed.
 */
export function getDatabase() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * Closes the database connection gracefully.
 * Call inside Electron's app.on('before-quit').
 */
export function closeDatabase() {
  if (isClosing || !sqlite) {
    console.log('[Database] Database already closed or closing')
    return
  }

  isClosing = true
  console.log('[Database] Starting graceful database closure...')

  try {
    // Clear the timers
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = null
    }
    if (truncateTimer) {
      clearInterval(truncateTimer)
      truncateTimer = null
    }

    // Run a final checkpoint to force all WAL data into the main database
    console.log('[Database] Executing final RESTART checkpoint before closing...')
    const checkpointResult = sqlite.pragma('wal_checkpoint(RESTART)')
    console.log('[Database] Final checkpoint result:', checkpointResult)

    // Close the database connection
    sqlite.close()
    console.log('[Database] Database connection closed successfully')

    sqlite = null
    db = null
  } catch (error) {
    console.error('[Database] Error during database closure:', error)
    // Clear references even when an error occurred
    sqlite = null
    db = null
  }
}

/**
 * Returns the raw SQLite instance (for pragma calls and similar operations)
 */
export function getSqlite() {
  return sqlite
}

// Export the type for other modules
export type Database = NonNullable<typeof db>
