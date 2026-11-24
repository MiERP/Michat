import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { getSecureWebPreferences } from '../security/appHardening'
import { isAllowedExternalOpenUrl } from '../security/guards'

let quizWindow: BrowserWindow | null = null

/**
 * Creates the quiz window
 * @param notebookId - notebook ID (used to generate a new quiz)
 * @param quizId - quiz ID (used to view a specific version, optional)
 */
export function createQuizWindow(notebookId: string, quizId?: string): void {
  // If the quiz window already exists, focus it and return
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.focus()
    // If new route parameters were passed in, update the URL
    const route = quizId ? `/quiz/view/${quizId}` : `/quiz/${notebookId}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      quizWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
    } else {
      quizWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: route
      })
    }
    return
  }

  // Set the background color according to the user's theme
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // Create the quiz window
  quizWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Position macOS traffic lights (window controls)
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor: 'white' } }
      : {}),
    backgroundColor,
    webPreferences: getSecureWebPreferences(join(__dirname, '../preload/index.js'))
  })

  quizWindow.on('ready-to-show', () => {
    quizWindow?.show()
  })

  quizWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalOpenUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  quizWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = quizWindow?.webContents.getURL()
    if (!currentUrl || url === currentUrl) {
      return
    }

    event.preventDefault()
    if (isAllowedExternalOpenUrl(url)) {
      void shell.openExternal(url)
    }
  })

  quizWindow.on('closed', () => {
    quizWindow = null
  })

  // Listen for theme changes
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (quizWindow && !quizWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      quizWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  // Load the quiz page
  const route = quizId ? `/quiz/view/${quizId}` : `/quiz/${notebookId}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    quizWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    quizWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route
    })
  }
}

/**
 * Returns the quiz window instance
 */
export function getQuizWindow(): BrowserWindow | null {
  return quizWindow
}

/**
 * Destroys the quiz window
 */
export function destroyQuizWindow(): void {
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.destroy()
    quizWindow = null
  }
}
