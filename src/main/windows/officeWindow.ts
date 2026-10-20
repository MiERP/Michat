import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { isAllowedExternalOpenUrl } from '../security/guards'

let officeWindow: BrowserWindow | null = null
let settingsListenerAttached = false

/**
 * Office workbench window: turns notebook knowledge into Word / Excel /
 * PowerPoint documents through the bundled officecli engine.
 */
export function createOfficeWindow(notebookId: string, route = 'workbench'): void {
  const target = `/office/${route}/${notebookId}`

  if (officeWindow && !officeWindow.isDestroyed()) {
    officeWindow.focus()
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      officeWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${target}`)
    } else {
      officeWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: target })
    }
    return
  }

  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  officeWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
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

  officeWindow.on('ready-to-show', () => {
    officeWindow?.show()
  })

  officeWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalOpenUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  officeWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = officeWindow?.webContents.getURL()
    if (!currentUrl || url === currentUrl) return
    event.preventDefault()
    if (isAllowedExternalOpenUrl(url)) {
      void shell.openExternal(url)
    }
  })

  officeWindow.on('closed', () => {
    officeWindow = null
  })

  if (!settingsListenerAttached) {
    settingsListenerAttached = true
    settingsManager.onSettingsChangeSync((newSettings) => {
      if (officeWindow && !officeWindow.isDestroyed()) {
        officeWindow.setBackgroundColor(newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa')
      }
    })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    officeWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${target}`)
  } else {
    officeWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: target })
  }
}

export function getOfficeWindow(): BrowserWindow | null {
  return officeWindow
}

export function destroyOfficeWindow(): void {
  if (officeWindow && !officeWindow.isDestroyed()) {
    officeWindow.destroy()
    officeWindow = null
  }
}
