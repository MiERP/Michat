import { BrowserWindow, shell, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { isAllowedExternalOpenUrl } from '../security/guards'

let mainWindow: BrowserWindow | null = null

/**
 * S-04 Fix: Apply Content-Security-Policy to prevent XSS attacks.
 * Called once when the main window is created.
 */
function applyCSP(): void {
  // In dev mode, Vite's React plugin injects an inline script (Fast Refresh preamble).
  // 'unsafe-inline' is required for it to work. Production stays strict.
  const devScriptSrc = is.dev ? " 'unsafe-inline'" : ''
  const devConnectSrc = is.dev ? ' ws://localhost:* http://localhost:*' : ''

  const csp = [
    "default-src 'self'",
    // Allow inline styles (required for Tailwind CSS v4 runtime)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // Allow Google Fonts
    "font-src 'self' https://fonts.gstatic.com",
    // Allow images from self and data URIs
    "img-src 'self' data: blob:",
    // Allow media (e.g. audio/video attachments)
    "media-src 'self' blob:",
    // Dev: allow 'unsafe-inline' for Vite HMR preamble. Prod: strict 'self' only.
    `script-src 'self'${devScriptSrc}`,
    // Allow connections to self + external AI API endpoints + dev HMR
    `connect-src 'self' https://*.openai.com https://*.anthropic.com https://*.googleapis.com https://openrouter.ai https://api.groq.com http://localhost:* wss://localhost:*${devConnectSrc}`,
    // Block all workers except self
    "worker-src 'self' blob:",
    // Block <object> / <embed>
    "object-src 'none'",
    // Block framing
    "frame-ancestors 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
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
