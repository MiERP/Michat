import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { ipcMain, shell } from 'electron'
import { OfficeBridgeService } from '../services/office/OfficeBridgeService'
import { settingsManager } from '../config'
import Logger from '../../shared/utils/logger'
import { copyOfficeManifests, OFFICE_MANIFESTS } from './officeManifestInstaller'

function clearOfficeAddinCache(addinIds: string[]): void {
  if (process.platform !== 'win32') return

  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return

  const wefRoot = path.join(localAppData, 'Microsoft', 'Office', '16.0', 'Wef')
  if (!fs.existsSync(wefRoot)) return

  const removePath = (targetPath: string): void => {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
  }

  try {
    removePath(path.join(wefRoot, 'AppCommands'))
    removePath(path.join(wefRoot, 'AddinInfo'))

    for (const addinId of addinIds) {
      const stack = [wefRoot]
      while (stack.length > 0) {
        const dir = stack.pop()
        if (!dir) continue

        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const entryPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            stack.push(entryPath)
            continue
          }
          if (entry.name.includes(addinId)) {
            fs.rmSync(entryPath, { force: true })
          }
        }
      }
    }

    const rootValues = [
      'Word_AggregatedCache',
      'Word_RibbonCache',
      'Word_en-US_RibbonCustomizationExpire',
      'WordOMEXRefreshPending',
      'Excel_AggregatedCache',
      'Excel_RibbonCache',
      'Excel_en-US_RibbonCustomizationExpire',
      'ExcelOMEXRefreshPending'
    ]

    for (const value of rootValues) {
      try {
        execFileSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Office\\16.0\\WEF', '/v', value, '/f'], {
          stdio: 'ignore'
        })
      } catch {
        // Cache value may not exist.
      }
    }

    for (const cacheKey of ['Word', 'Excel']) {
      try {
        execFileSync('reg', ['delete', `HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Cache\\${cacheKey}`, '/f'], {
          stdio: 'ignore'
        })
      } catch {
        // Cache key may not exist.
      }
    }
  } catch (error) {
    Logger.warn('OfficeHandlers', 'Failed to clear Office add-in cache:', error as any)
  }
}

function isOfficeHostRunning(): boolean {
  if (process.platform !== 'win32') return false

  try {
    execFileSync('tasklist', ['/FI', 'IMAGENAME eq WINWORD.EXE', '/FI', 'IMAGENAME eq EXCEL.EXE'], {
      stdio: 'pipe'
    })
    const wordRunning = execFileSync('tasklist', ['/FI', 'IMAGENAME eq WINWORD.EXE'], {
      encoding: 'utf8'
    }).includes('WINWORD.EXE')
    const excelRunning = execFileSync('tasklist', ['/FI', 'IMAGENAME eq EXCEL.EXE'], {
      encoding: 'utf8'
    }).includes('EXCEL.EXE')
    return wordRunning || excelRunning
  } catch {
    return false
  }
}
function unregisterOfficeAddin(addinId: string): void {
  if (process.platform !== 'win32') return

  try {
    execFileSync(
      'reg',
      ['delete', 'HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer', '/v', addinId, '/f'],
      { stdio: 'ignore' }
    )
    execFileSync(
      'reg',
      ['delete', `HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer\\${addinId}`, '/f'],
      { stdio: 'ignore' }
    )
  } catch {
    return
  }
}

function registerOfficeManifest(manifestPath: string, addinId: string): void {
  unregisterOfficeAddin(addinId)

  if (process.platform === 'win32') {
    execFileSync(
      'reg',
      [
        'add',
        'HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer',
        '/v',
        addinId,
        '/t',
        'REG_SZ',
        '/d',
        manifestPath,
        '/f'
      ],
      { stdio: 'pipe' }
    )
    return
  }

  execFileSync('npx', ['office-addin-dev-settings', 'register', manifestPath], {
    cwd: process.cwd(),
    stdio: 'pipe'
  })
}

function toOfficeCatalogUncPath(installRoot: string): string {
  const resolvedPath = path.resolve(installRoot)
  const driveMatch = resolvedPath.match(/^([A-Za-z]):\\(.*)$/)

  if (!driveMatch) return resolvedPath

  return `\\\\localhost\\${driveMatch[1].toUpperCase()}$\\${driveMatch[2]}`
}

function registerTrustedOfficeCatalog(installRoot: string): string {
  const catalogPath = process.platform === 'win32' ? toOfficeCatalogUncPath(installRoot) : installRoot

  if (process.platform !== 'win32') return catalogPath

  const catalogId = '{f1f0b4df-8a66-4f26-a97d-7ed335d4cbf4}'
  const catalogRoot = String.raw`HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs`
  const catalogKey = `${catalogRoot}\\${catalogId}`

  execFileSync('reg', ['add', catalogKey, '/v', 'Id', '/t', 'REG_SZ', '/d', catalogId, '/f'], {
    stdio: 'pipe'
  })
  execFileSync('reg', ['add', catalogKey, '/v', 'Url', '/t', 'REG_SZ', '/d', catalogPath, '/f'], {
    stdio: 'pipe'
  })
  execFileSync('reg', ['add', catalogKey, '/v', 'Flags', '/t', 'REG_DWORD', '/d', '1', '/f'], {
    stdio: 'pipe'
  })

  return catalogPath
}

export function registerOfficeHandlers(bridgeService: OfficeBridgeService): void {
  ipcMain.handle('office:get-status', async () => {
    return {
      running: bridgeService.running,
      port: bridgeService.bridgePort,
      address: bridgeService.address
    }
  })

  ipcMain.handle('office:get-settings', async () => {
    const all = await settingsManager.getAllSettings()
    return {
      enabled: (all as any).officeIntegrationEnabled === true
    }
  })

  ipcMain.handle('office:set-enabled', async (_event, enabled: boolean) => {
    await settingsManager.updateSettings({ officeIntegrationEnabled: enabled } as any)
    if (enabled && !bridgeService.running) {
      await bridgeService.start(18327, { secure: true })
    }
    if (!enabled && bridgeService.running) {
      bridgeService.stop()
    }
    return {
      success: true,
      running: bridgeService.running,
      port: bridgeService.bridgePort,
      address: bridgeService.address
    }
  })

  ipcMain.handle('office:open-manifest-folder', async () => {
    const dir = bridgeService.getAddinDir()
    try {
      await shell.openPath(dir)
      return { success: true }
    } catch (error) {
      Logger.error('OfficeHandlers', 'Failed to open manifest folder:', error as any)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('office:install-manifests', async () => {
    const sourceDir = bridgeService.getAddinDir()
    const installRoot = path.join(process.env.LOCALAPPDATA || sourceDir, 'MiChat', 'OfficeAddins')

    try {
      if (!bridgeService.running) {
        await bridgeService.start(18327, { secure: true })
      }

      if (!bridgeService.address.startsWith('https://')) {
        return {
          success: false,
          error:
            'Office add-ins require the local bridge to run over trusted HTTPS. Install or trust the localhost Office certificate, then retry Install to Office.'
        }
      }

      const installedManifests = copyOfficeManifests(sourceDir, installRoot)
      const trustedCatalogPath = registerTrustedOfficeCatalog(installRoot)
      const registrationWarnings: string[] = []
      const addinIds = OFFICE_MANIFESTS.map((item) => item.addinId)
      const officeHostRunning = isOfficeHostRunning()

      if (officeHostRunning) {
        registrationWarnings.push('Word/Excel is running. Close and reopen Office before reinstalling to avoid clearing the ribbon cache while it is in use.')
      } else {
        clearOfficeAddinCache(addinIds)
      }

      for (const manifest of installedManifests) {
        const addinId = OFFICE_MANIFESTS.find((item) => item.host === manifest.host)?.addinId
        if (!addinId) continue

        try {
          registerOfficeManifest(manifest.installedPath, addinId)
        } catch (error) {
          Logger.warn(
            'OfficeHandlers',
            `Failed to register ${manifest.host} Office manifest:`,
            error as any
          )
          registrationWarnings.push(`${manifest.host}: ${(error as Error).message}`)
        }
      }

      return {
        success: true,
        path: installRoot,
        catalogPath: trustedCatalogPath,
        manifests: installedManifests,
        warnings: registrationWarnings
      }
    } catch (error) {
      Logger.error('OfficeHandlers', 'Failed to install Office manifests:', error as any)
      return { success: false, error: (error as Error).message }
    }
  })

  Logger.info('OfficeHandlers', 'Office integration handlers registered')
}
