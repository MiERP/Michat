import { ipcMain } from 'electron'
import { LicenseService } from '../services/LicenseService'

export function registerLicenseHandlers(): void {
  ipcMain.handle('license:get-status', () => {
    return LicenseService.getStatus()
  })
}
