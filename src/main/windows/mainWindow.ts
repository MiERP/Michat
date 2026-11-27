import { app, BrowserWindow, dialog, shell, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { getSecureWebPreferences } from '../security/appHardening'
import { buildContentSecurityPolicy } from '../security/csp'
import { isAllowedExternalOpenUrl } from '../security/guards'
import {
  buildRelaunchArgs,
  isCompatModeRequested,
  requestCompatMode,
  shouldAttemptCompatFallback,
  shouldReportRendererExit
} from '../compatMode'
import Logger from '../../shared/utils/logger'

let mainWindow: BrowserWindow | null = null
let cspApplied = false
let relaunchingForCompatMode = false

/**
 * Apply the Content-Security-Policy as a response header. The same policy is
 * injected into index.html by Vite for `file://` loads. Register the listener
 * once, even if a window is re-created on macOS.
 */
function applyCSP(): void {
  if (cspApplied) return
  cspApplied = true

  const headerPolicy = `${buildContentSecurityPolicy({ isDev: is.dev })}; frame-ancestors 'none'`

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [headerPolicy]
      }
    })
  })
}

export function createMainWindow(): BrowserWindow {
  // Apply CSP before creating any window
  applyCSP()

  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#282c34' : '#fafafa'
  // Playwright-driven verification renders the window offscreen and shows it
  // without activation, so automated checks never steal OS focus.
  const offscreenE2E = process.env.MICHAT_E2E_OFFSCREEN === '1'

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    ...(offscreenE2E ? { x: -32000, y: -32000 } : {}),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor: 'white' } }
      : {}),
    backgroundColor,
    webPreferences: getSecureWebPreferences(join(__dirname, '../preload/index.js'))
  })

  let windowShown = false
  mainWindow.on('ready-to-show', () => {
    windowShown = true
    if (offscreenE2E) {
      mainWindow?.showInactive()
    } else {
      mainWindow?.show()
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    Logger.error('MainWindow', 'Renderer process gone', details)
    if (windowShown || relaunchingForCompatMode) return

    const reason = details.reason
    if (!shouldReportRendererExit(reason)) return

    const alreadyCompat = isCompatModeRequested()
    const noSandboxSwitch =
      app.commandLine.hasSwitch('no-sandbox') ||
      process.argv.some((arg) => arg === '--no-sandbox' || arg.startsWith('--no-sandbox='))

    if (
      shouldAttemptCompatFallback({
        reason,
        windowShown,
        alreadyCompat,
        noSandboxSwitch
      })
    ) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'MiChat - Compatibility mode',
        message: 'The embedded renderer closed before the window could open.',
        detail:
          "Your security software may be blocking Electron's renderer sandbox (for example Kaspersky).\n\n" +
          'Run MiChat once in compatibility mode? This disables the renderer sandbox for this Windows user ' +
          'and writes a marker so the app can open. Add MiChat to your security software exclusions and run ' +
          '"MiChat.exe --reset-compat-mode" to return to the default sandbox.',
        buttons: ['Run in compatibility mode', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })

      if (choice !== 0) {
        mainWindow?.destroy()
        app.quit()
        return
      }

      if (!requestCompatMode()) {
        dialog.showErrorBox(
          'MiChat - Renderer error',
          `The embedded renderer exited before the window could open (${reason}), and MiChat could not save the compatibility flag.\n\n` +
            'Add MiChat to your security software exclusions and restart the app.'
        )
        mainWindow?.destroy()
        app.quit()
        return
      }

      relaunchingForCompatMode = true
      Logger.warn(
        'MainWindow',
        `Renderer exited before first paint (${reason}); relaunching in compatibility mode`
      )
      app.relaunch({ args: buildRelaunchArgs(process.argv) })
      app.quit()
      return
    }

    dialog.showErrorBox(
      'MiChat - Renderer error',
      `The embedded renderer exited before the window could open (${reason}).\n\n` +
        (alreadyCompat
          ? 'Compatibility mode is already active; check the security software exclusions and logs.'
          : 'The renderer could not start with the current sandbox settings. Add MiChat to your security software exclusions and restart the app.')
    )
    mainWindow?.destroy()
    app.quit()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalOpenUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL()
    if (!currentUrl || url === currentUrl) {
      return
    }

    event.preventDefault()
    if (isAllowedExternalOpenUrl(url)) {
      void shell.openExternal(url)
    }
  })

  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#282c34' : '#fafafa'
      mainWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
