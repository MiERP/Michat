import { BrowserWindow, shell, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { getSecureWebPreferences } from '../security/appHardening'
import { buildContentSecurityPolicy } from '../security/csp'
import { isAllowedExternalOpenUrl } from '../security/guards'

let mainWindow: BrowserWindow | null = null
let cspApplied = false

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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor: 'white' } }
      : {}),
    backgroundColor,
    webPreferences: getSecureWebPreferences(join(__dirname, '../preload/index.js'))
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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
