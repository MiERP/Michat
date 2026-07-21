import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { isAllowedExternalOpenUrl } from '../security/guards'

let mindMapWindow: BrowserWindow | null = null

/**
 * 创建思维导图窗口
 * @param notebookId - 笔记本 ID（用于生成新思维导图）
 * @param mindMapId - 思维导图 ID（用于查看特定版本，可选）
 */
export function createMindMapWindow(notebookId: string, mindMapId?: string): void {
  // 如果思维导图窗口已经存在，则聚焦并返回
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.focus()
    // 如果传入了新的路由参数，更新 URL
    const route = mindMapId ? `/mindmap/view/${mindMapId}` : `/mindmap/${notebookId}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mindMapWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
    } else {
      mindMapWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: route
      })
    }
    return
  }

  // 根据用户主题设置背景色
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#111820' : '#f0f3f0'

  // 创建思维导图窗口
  mindMapWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mindMapWindow.on('ready-to-show', () => {
    mindMapWindow?.show()
  })

  mindMapWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalOpenUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  mindMapWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mindMapWindow?.webContents.getURL()
    if (!currentUrl || url === currentUrl) {
      return
    }

    event.preventDefault()
    if (isAllowedExternalOpenUrl(url)) {
      void shell.openExternal(url)
    }
  })

  mindMapWindow.on('closed', () => {
    mindMapWindow = null
  })

  // 监听主题变化
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mindMapWindow && !mindMapWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#111820' : '#f0f3f0'
      mindMapWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  // 加载思维导图页面
  const route = mindMapId ? `/mindmap/view/${mindMapId}` : `/mindmap/${notebookId}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mindMapWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    mindMapWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route
    })
  }
}

/**
 * 获取思维导图窗口实例
 */
export function getMindMapWindow(): BrowserWindow | null {
  return mindMapWindow
}

/**
 * 销毁思维导图窗口
 */
export function destroyMindMapWindow(): void {
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.destroy()
    mindMapWindow = null
  }
}
