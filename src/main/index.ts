import { app, BrowserWindow, ipcMain, shell, dialog, session } from 'electron'
import { isAbsolute } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { LlamaService } from './services/LlamaService'
import {
  initDatabase,
  runMigrations,
  initExtensions,
  closeDatabase,
  executeCheckpoint,
  getDatabase
} from './db'
import { notebooks } from './db/schema'
import { getAllNotebooks } from './db/queries'
import { wasVectorIndexRebuilt } from './db'
import { ProviderManager } from './providers/ProviderManager'
import { SessionAutoSwitchService } from './services/SessionAutoSwitchService'
import { KnowledgeService } from './services/KnowledgeService'
import { KnowledgeLinkService } from './services/KnowledgeLinkService'
import { DocumentEnrichmentService } from './services/DocumentEnrichmentService'
import { NotebookSummaryService } from './services/NotebookSummaryService'
import { BackgroundJobService } from './services/BackgroundJobService'
import { UpdateService } from './services/UpdateService'
import { ShortcutManager } from './services/ShortcutManager'
import { createMainWindow } from './windows'
import { registerAllHandlers } from './ipc'
import { getStore, settingsManager } from './config'
import Logger from '../shared/utils/logger'
import { isAllowedExternalOpenUrl } from './security/guards'
import {
  enforceSingleInstance,
  installPermissionHandlers,
  installWebContentsGuards
} from './security/appHardening'

let providerManager: ProviderManager | null = null
let sessionAutoSwitchService: SessionAutoSwitchService | null = null
let knowledgeService: KnowledgeService | null = null
let backgroundJobService: BackgroundJobService | null = null
let updateService: UpdateService | null = null
let shortcutManager: ShortcutManager | null = null
let isQuitting = false // Flag to indicate if app is quitting

let llamaService: LlamaService | null = null

enforceSingleInstance(app)

/**
 * Packaged smoke hook for the isolated document parser (plan Task 15).
 * `scripts/smoke-packaged.ps1` starts the packaged binary with this flag,
 * checks that a real utility process parsed the file, then the app exits.
 */
const PARSER_SMOKE_PREFIX = '--smoke-parser='

async function runParserSmoke(filePath: string): Promise<void> {
  const { ParserWorkerClient } = await import('./services/import/ParserWorkerClient')
  const client = new ParserWorkerClient()
  let line: string
  let exitCode = 0

  try {
    if (!isAbsolute(filePath)) throw new Error('Smoke file path must be absolute')
    const result = await client.parseFile(filePath)
    const pid = client.workerPid
    if (!pid || pid === process.pid) {
      throw new Error('Document parser did not run in a separate utility process')
    }
    line = `MICHAT_PARSER_SMOKE_OK chars=${result.content.length} mime=${result.mimeType} pid=${pid}`
  } catch (error) {
    exitCode = 1
    line = `MICHAT_PARSER_SMOKE_FAIL ${(error as Error).message}`
  } finally {
    client.dispose()
  }

  await new Promise<void>((resolve) => process.stdout.write(`${line}\n`, () => resolve()))
  app.exit(exitCode)
}

/**
 * Hằng ngày enqueue decay-links cho mọi notebook
 * (giảm confidence liên kết cũ, loại link quá yếu)
 */
function scheduleDailyLinkDecay(queue: BackgroundJobService): void {
  const enqueueAll = (): void => {
    try {
      const db = getDatabase()
      const allNotebooks = db.select({ id: notebooks.id }).from(notebooks).all()
      for (const nb of allNotebooks) {
        queue.enqueueDecayLinks(nb.id)
      }
      if (allNotebooks.length > 0) {
        Logger.info('Main', `Scheduled daily decay-links for ${allNotebooks.length} notebooks`)
      }
    } catch (error) {
      Logger.error('Main', 'Failed to schedule decay-links:', error)
    }
  }

  // Chạy ngay khi khởi động + mỗi 24h
  enqueueAll()
  const timer = setInterval(enqueueAll, 24 * 60 * 60 * 1000)
  timer.unref()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  try {
    const parserSmokeArg = process.argv.find((arg) => arg.startsWith(PARSER_SMOKE_PREFIX))
    if (parserSmokeArg) {
      await runParserSmoke(parserSmokeArg.slice(PARSER_SMOKE_PREFIX.length))
      return
    }

    installPermissionHandlers(session.defaultSession)
    installWebContentsGuards(app)

    // Auto-start llama.cpp servers (best effort)
    llamaService = new LlamaService()

    // Seed local model defaults so chat and RAG work on first launch without
    // the user having to open Settings → General and save first.
    const currentSettings = await settingsManager.getAllSettings()
    const seeded: { defaultChatModel?: string; defaultEmbeddingModel?: string } = {}
    if (!currentSettings.defaultChatModel || !currentSettings.defaultEmbeddingModel) {
      const models = llamaService.listModels()
      if (!currentSettings.defaultChatModel) {
        const chatModel = models.find((model) => model.type === 'chat')
        if (chatModel) seeded.defaultChatModel = `llama:${chatModel.filename}`
      }
      if (!currentSettings.defaultEmbeddingModel) {
        const embeddingModel = models.find((model) => model.type === 'embedding')
        if (embeddingModel) seeded.defaultEmbeddingModel = `llama:${embeddingModel.filename}`
      }
      if (Object.keys(seeded).length > 0) {
        await settingsManager.updateSettings(seeded)
        Logger.info('Main', `Seeded default models: ${JSON.stringify(seeded)}`)
      }
    }

    // llama.cpp is started after the window is visible (see below); a cold
    // model load must not block first paint.

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

    // Initialize Knowledge Service
    Logger.info('Main', 'Initializing Knowledge Service...')
    knowledgeService = new KnowledgeService(providerManager, llamaService ?? undefined)
    Logger.info('Main', 'Knowledge Service initialized')

    // Initialize Session Auto Switch Service (cần knowledgeService để lưu memory)
    Logger.info('Main', 'Initializing Session Auto Switch Service...')
    sessionAutoSwitchService = new SessionAutoSwitchService(providerManager, knowledgeService, null)
    Logger.info('Main', 'Session Auto Switch Service initialized')

    // Initialize Background Job Service (queue cho auto-link/decay/reindex/enrich)
    Logger.info('Main', 'Initializing Background Job Service...')
    const linkService = new KnowledgeLinkService(providerManager)
    const enrichmentService = new DocumentEnrichmentService(providerManager, knowledgeService)
    const notebookSummaryService = new NotebookSummaryService(providerManager)
    backgroundJobService = new BackgroundJobService(
      knowledgeService,
      linkService,
      enrichmentService,
      30000,
      60000,
      (jobType, jobNotebookId) => {
        // Job nền hoàn thành (vd enrich-document) → báo UI refresh tài liệu,
        // để thẻ tóm tắt trong khung chat cập nhật ngay khi tóm tắt sẵn sàng.
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('knowledge:documents-changed', { notebookId: jobNotebookId })
          }
        }

        // Tóm tắt từng tài liệu vừa hoàn thành → xếp hàng tổng hợp lại tóm tắt
        // thống nhất của notebook (dedup ngăn xếp trùng).
        if (jobType === 'enrich-document' && jobNotebookId) {
          backgroundJobService?.enqueueSummarizeNotebook(jobNotebookId)
        }
      },
      notebookSummaryService
    )
    backgroundJobService.start()
    scheduleDailyLinkDecay(backgroundJobService)

    // Bảo trì dữ liệu cũ (chạy nền khi app rảnh):
    //  - bảng vector vừa phải tạo lại → embed lại toàn bộ chunk thiếu vector
    //  - quét tài liệu index trước khi có headingPath/doc vector → index lại
    const maintenanceNotebooks = getAllNotebooks()
    const vectorIndexRebuilt = wasVectorIndexRebuilt()
    for (const notebook of maintenanceNotebooks) {
      void knowledgeService
        .reconcileNotebookIndexes(notebook.id)
        .catch((error) =>
          Logger.warn('Main', `Knowledge index reconciliation failed for ${notebook.id}:`, error)
        )
      if (vectorIndexRebuilt) {
        backgroundJobService.enqueueRebuildVectors(notebook.id)
      }
      backgroundJobService.enqueueBackfill(notebook.id)
      // Tóm tắt notebook cũ/stale → tự tổng hợp lại khi app rảnh (skip nếu tươi).
      backgroundJobService.enqueueSummarizeNotebook(notebook.id)
    }
    // Một lần: tài liệu được index trước khi có metadata-aware retrieval chưa
    // có metadata trong chunk/FTS. Chạy nền sau khi cửa sổ đã hiện để không
    // chặn khởi động; các lần sau sẽ thấy đủ metadata và bỏ qua.
    setTimeout(() => {
      void knowledgeService
        ?.backfillLegalMetadataToIndex()
        .catch((error) => Logger.warn('Main', 'Legal metadata backfill failed:', error))
    }, 10000)

    // Tài liệu pháp lý bị parser cũ làm mất phần đầu (DOCX table) → reindex lại
    // để trích được số hiệu/loại/cơ quan. Chỉ chạy khi metadata còn trống.
    const legalMetadataReindexIds = knowledgeService.findDocumentsNeedingLegalMetadataReindex()
    for (const documentId of legalMetadataReindexIds) {
      backgroundJobService.enqueueReindex(documentId)
    }
    if (legalMetadataReindexIds.length > 0) {
      Logger.info(
        'Main',
        `Queued metadata reindex for ${legalMetadataReindexIds.length} legal document(s)`
      )
    }

    if (maintenanceNotebooks.length > 0) {
      Logger.info(
        'Main',
        `Maintenance queued for ${maintenanceNotebooks.length} notebook(s) (vectorRebuilt=${vectorIndexRebuilt})`
      )
    }
    Logger.info('Main', 'Background Job Service initialized')

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
      backgroundJobService,
      notebookSummaryService
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
      } catch (error) {
        Logger.error('Main', 'Failed to open external URL:', error)
        return { success: false, error: (error as Error).message }
      }
    })

    // Create main window before starting llama.cpp. The server/model load can
    // take tens of seconds; the UI must be visible and responsive meanwhile.
    const mainWindow = createMainWindow()

    void llamaService
      .ensureStarted()
      .then(async () => {
        const runtime = await llamaService!.getRuntimeInfo()
        sessionAutoSwitchService?.setChatCtxSize(runtime.chatCtxSize)
        Logger.info('Main', 'llama.cpp servers are ready')
      })
      .catch((error) => Logger.warn('Main', 'llama.cpp background start failed:', error))

    // Start knowledge auto-sync (watcher + incremental reindex)
    knowledgeService.startAutoSync((payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('knowledge:auto-synced', payload)
      }

      // File đổi ngoài app → nội dung mới làm tóm tắt cũ hết hạn (sourceHash
      // lệch) → tự xếp hàng làm giàu lại + sinh link nền khi app rảnh.
      if (!payload.error && payload.reason === 'file-changed' && backgroundJobService) {
        const changedDoc = knowledgeService?.getDocument(payload.documentId)
        if (changedDoc) {
          backgroundJobService.enqueueEnrich(payload.documentId, changedDoc.notebookId)
          backgroundJobService.enqueueGenerateLinks(payload.documentId, changedDoc.notebookId)
        }
      }
    })
    Logger.info('Main', 'Knowledge auto-sync started')

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

  if (llamaService) {
    llamaService.stop()
  }
})

// First line of defense: before-quit event (user initiated quit)
app.on('before-quit', (event) => {
  if (isQuitting) return

  event.preventDefault()
  isQuitting = true
  Logger.info('Main', 'before-quit: graceful shutdown started')

  // Unregister shortcuts
  if (shortcutManager) {
    shortcutManager.unregisterShortcuts()
    Logger.info('Main', 'Shortcuts unregistered')
  }

  knowledgeService?.stopAutoSync()
  backgroundJobService?.stop()

  void (async () => {
    try {
      // Shutdown barrier: chờ llama.cpp và job nền dừng hẳn
      // TRƯỚC KHI đóng DB — tránh ghi dở dang hoặc truy vấn vào DB đã đóng.
      // Có trần tổng 10 giây để một thành phần treo không chặn app thoát.
      const tasks: Promise<unknown>[] = []
      if (llamaService) tasks.push(llamaService.stop())
      if (backgroundJobService) tasks.push(backgroundJobService.shutdown())
      const cap = new Promise<void>((resolve) => setTimeout(resolve, 10000))
      await Promise.race([Promise.allSettled(tasks), cap])
      Logger.info('Main', 'Shutdown tasks settled, closing database...')
    } catch (error) {
      Logger.error('Main', 'Error during graceful shutdown:', error)
    } finally {
      knowledgeService?.disposeFileParser()
      closeDatabase()
      app.quit()
    }
  })()
})

// Second line of defense: will-quit event (backup)
app.on('will-quit', () => {
  if (!isQuitting) {
    Logger.warn('Main', 'will-quit event triggered (backup)')
    closeDatabase()
  }
})

// Third line of defense: Process signal handling (forced quit, system shutdown)
const handleShutdown = (signal: string) => {
  Logger.warn('Main', `Received ${signal}, shutting down gracefully...`)

  if (!isQuitting) {
    isQuitting = true
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
  closeDatabase()
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  Logger.error('Main', 'Unhandled rejection:', reason)
})
