import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { LlamaService } from './services/LlamaService'
import {
  initDatabase,
  runMigrations,
  initExtensions,
  closeDatabase,
  executeCheckpoint,
  getSqlite
} from './db'
import { ProviderManager } from './providers/ProviderManager'
import { SessionAutoSwitchService } from './services/SessionAutoSwitchService'
import { KnowledgeService } from './services/KnowledgeService'
import { UpdateService } from './services/UpdateService'
import { ShortcutManager } from './services/ShortcutManager'
import { LicenseService } from './services/LicenseService'
import { createMainWindow } from './windows'
import { registerAllHandlers } from './ipc'
import { getStore } from './config/store'
import Logger from '../shared/utils/logger'
import { isAllowedExternalOpenUrl } from './security/guards'
import { cancelAllNotebookOverviewGenerations } from './ipc/notebookOverviewHandlers'
import { LegalGraphRepository } from './services/legalGraph/LegalGraphRepository'
import { LegalGraphExtractionService } from './services/legalGraph/LegalGraphExtractionService'
import { LegalGraphWorker, prepareLegalGraphSource } from './services/legalGraph/LegalGraphWorker'
import { LegalReasoningService } from './services/legalGraph/LegalReasoningService'
import {
  LEGAL_GRAPH_EXTRACTOR_VERSION,
  LEGAL_GRAPH_ONTOLOGY_VERSION,
  LEGAL_GRAPH_PROMPT_VERSION
} from './services/legalGraph/legalGraphPrompt'
import type { LegalGraphProgress, LegalReasoningEvidence } from '../shared/types/legalReasoning'

let providerManager: ProviderManager | null = null
let sessionAutoSwitchService: SessionAutoSwitchService | null = null
let knowledgeService: KnowledgeService | null = null
let updateService: UpdateService | null = null
let shortcutManager: ShortcutManager | null = null
let isQuitting = false // Flag to indicate if app is quitting
let shutdownComplete = false

let llamaService: LlamaService | null = null
let legalGraphWorker: LegalGraphWorker | null = null
let legalReasoningService: LegalReasoningService | null = null

const legalGraphVersions = {
  model: '',
  extractorVersion: LEGAL_GRAPH_EXTRACTOR_VERSION,
  promptVersion: LEGAL_GRAPH_PROMPT_VERSION,
  ontologyVersion: LEGAL_GRAPH_ONTOLOGY_VERSION
}

interface LegalReasoningEvidenceRow {
  id: string
  document_id: string
  chunk_index: number
  content: string
  title: string
}

function broadcastLegalGraphProgress(progress: LegalGraphProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('knowledge:graph-progress', progress)
    }
  }
}

function loadLegalReasoningEvidence(
  notebookId: string,
  chunkIds: string[]
): LegalReasoningEvidence[] {
  const database = getSqlite()
  const uniqueChunkIds = [...new Set(chunkIds)]
  if (!database || uniqueChunkIds.length === 0) return []
  const placeholders = uniqueChunkIds.map(() => '?').join(', ')
  const rows = database
    .prepare(
      `SELECT c.id, c.document_id, c.chunk_index, c.content, d.title
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.notebook_id = ? AND c.id IN (${placeholders})`
    )
    .all(notebookId, ...uniqueChunkIds) as LegalReasoningEvidenceRow[]
  return rows.map((row) => ({
    notebookId,
    documentId: row.document_id,
    documentTitle: row.title,
    chunkId: row.id,
    chunkIndex: row.chunk_index,
    content: row.content,
    score: 0
  }))
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  try {
    const licenseStatus = LicenseService.ensureLicenseOnStartup()
    Logger.info(
      'Main',
      `License startup check: ${licenseStatus.valid ? 'valid' : 'invalid'}${licenseStatus.expiresAt ? `, expiresAt=${licenseStatus.expiresAt}` : ''}`
    )

    // Auto-start llama.cpp servers (best effort)
    llamaService = new LlamaService()
    await llamaService.ensureStarted()

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.michat.app')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize database
    Logger.info('Main', 'Initializing database...')
    initDatabase()
    runMigrations()
    initExtensions()
    Logger.info('Main', 'Database initialized')

    // Initialize Provider Manager
    Logger.info('Main', 'Initializing Provider Manager...')
    providerManager = new ProviderManager()
    await providerManager.initialize()
    Logger.info('Main', 'Provider Manager initialized')

    // Initialize Session Auto Switch Service
    Logger.info('Main', 'Initializing Session Auto Switch Service...')
    sessionAutoSwitchService = new SessionAutoSwitchService(providerManager)
    Logger.info('Main', 'Session Auto Switch Service initialized')

    // Initialize Knowledge Service
    Logger.info('Main', 'Initializing Knowledge Service...')
    const sqlite = getSqlite()
    if (!sqlite) throw new Error('SQLite is unavailable after database initialization')
    const legalGraphRepository = new LegalGraphRepository(sqlite, legalGraphVersions)
    knowledgeService = new KnowledgeService(providerManager, legalGraphRepository)
    const legalGraphExtractor = new LegalGraphExtractionService()
    legalGraphWorker = new LegalGraphWorker({
      repository: legalGraphRepository,
      extractor: legalGraphExtractor,
      providerManager,
      sourceLoader: (documentId) => {
        const document = knowledgeService?.getDocument(documentId)
        if (!document) return undefined
        return prepareLegalGraphSource(
          document,
          knowledgeService?.getDocumentChunks(documentId) || []
        )
      },
      onProgress: broadcastLegalGraphProgress
    })
    legalReasoningService = new LegalReasoningService(
      legalGraphRepository,
      loadLegalReasoningEvidence
    )
    Logger.info('Main', 'Knowledge Service initialized')

    // Initialize Update Service
    Logger.info('Main', 'Initializing Update Service...')
    updateService = new UpdateService()
    Logger.info('Main', 'Update Service initialized')

    // Initialize electron-store
    Logger.info('Main', 'Initializing electron-store...')
    const store = await getStore()
    Logger.info('Main', 'electron-store initialized')

    // Initialize Shortcut Manager
    Logger.info('Main', 'Initializing Shortcut Manager...')
    shortcutManager = new ShortcutManager(store)
    Logger.info('Main', 'Shortcut Manager initialized')

    // Register all IPC Handlers
    registerAllHandlers(
      providerManager,
      sessionAutoSwitchService,
      knowledgeService,
      updateService,
      shortcutManager,
      store,
      llamaService,
      legalReasoningService,
      legalGraphWorker
    )

    // IPC test (development only)
    if (process.env.NODE_ENV === 'development') {
      ipcMain.on('ping', () => console.log('pong'))
    }

    // Handle get platform request
    ipcMain.handle('get-platform', () => {
      return process.platform
    })

    // Handle get app version request
    ipcMain.handle('get-app-version', () => {
      return app.getVersion()
    })

    // Handle open external URL request
    ipcMain.handle('open-external-url', async (_event, url: string) => {
      try {
        if (!isAllowedExternalOpenUrl(url)) {
          throw new Error('Only public http/https URLs can be opened')
        }

        await shell.openExternal(url)
        return { success: true }
      } catch (error: any) {
        Logger.error('Main', 'Failed to open external URL:', error)
        return { success: false, error: error.message }
      }
    })

    // Create main window
    const mainWindow = createMainWindow()
    void legalGraphWorker.start()

    // Set main window for update service
    updateService.setMainWindow(mainWindow)

    // Set main window for shortcut manager and register shortcuts
    shortcutManager.setMainWindow(mainWindow)
    shortcutManager.registerShortcuts()
    Logger.info('Main', 'Shortcuts registered')

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        const mainWindow = createMainWindow()
        // Re-register shortcuts for the new window
        if (shortcutManager) {
          shortcutManager.setMainWindow(mainWindow)
          shortcutManager.registerShortcuts()
          Logger.info('Main', 'Shortcuts re-registered after window re-creation')
        }
      }
    })
  } catch (error) {
    Logger.error('Main', 'Fatal error during app initialization:', error)
    dialog.showErrorBox(
      'MiChat - Initialization Error',
      `A fatal error occurred during startup:\n\n${(error as Error).message}\n\nPlease check the logs and restart the application.`
    )
    app.quit()
  }
})

// Handle window all closed event
app.on('window-all-closed', () => {
  Logger.info('Main', 'All windows closed')

  if (process.platform === 'darwin') {
    // macOS specific: Execute checkpoint when window closes but app stays running
    Logger.debug('Main', 'macOS: Executing checkpoint on window close...')
    executeCheckpoint('PASSIVE')

    // Optional: Uncomment to also quit app when window closes on macOS
    // app.quit()
  } else {
    // Other platforms: Quit app when window closes
    app.quit()
  }
})

async function shutdownApplication(): Promise<void> {
  await legalGraphWorker?.stop(5_000)
  if (shortcutManager) {
    shortcutManager.unregisterShortcuts()
    Logger.info('Main', 'Shortcuts unregistered')
  }
  cancelAllNotebookOverviewGenerations()
  await llamaService?.stop()
  Logger.info('Main', 'Closing database connection...')
  executeCheckpoint('TRUNCATE')
  closeDatabase()
}

// First line of defense: before-quit event (user initiated quit)
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (isQuitting) return

  Logger.info('Main', 'before-quit event triggered')
  isQuitting = true
  void shutdownApplication()
    .catch((error) => Logger.error('Main', 'Graceful shutdown failed:', error))
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})

// Second line of defense: will-quit event (backup)
app.on('will-quit', () => {
  if (!shutdownComplete) {
    Logger.warn('Main', 'will-quit event triggered (backup)')
    legalGraphWorker?.requestStop()
    closeDatabase()
  }
})

// Third line of defense: Process signal handling (forced quit, system shutdown)
const handleShutdown = (signal: string) => {
  Logger.warn('Main', `Received ${signal}, shutting down gracefully...`)

  if (!isQuitting) {
    isQuitting = true
    legalGraphWorker?.requestStop()
    closeDatabase()
  }

  // Give database 2 seconds to finish closing
  setTimeout(() => {
    process.exit(0)
  }, 2000)
}

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGHUP', () => handleShutdown('SIGHUP'))

// Uncaught exception handling
process.on('uncaughtException', (error) => {
  Logger.error('Main', 'Uncaught exception:', error)
  legalGraphWorker?.requestStop()
  closeDatabase()
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  Logger.error('Main', 'Unhandled rejection:', reason)
})
