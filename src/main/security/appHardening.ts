import type { App, Session, WebPreferences } from 'electron'

/**
 * Single place that defines the renderer security flags. Never rely on
 * Electron defaults for these; an accidental regression should fail a test.
 */
export function getSecureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false
  }
}

/** Deny camera, microphone, geolocation, notifications and device access. */
export function installPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
}

/**
 * Guard every future webContents: no webviews and no popups. Windows that need
 * to open public links install their own setWindowOpenHandler afterwards.
 */
export function installWebContentsGuards(app: App): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

/** Only one app instance may own the SQLite database and llama servers. */
export function enforceSingleInstance(app: App): boolean {
  const acquired = app.requestSingleInstanceLock()
  if (!acquired) {
    app.exit(0)
  }
  return acquired
}
