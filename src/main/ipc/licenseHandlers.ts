import { LicenseService } from '../services/LicenseService'
import { registerNoArgHandler } from './handlerRegistry'

export function registerLicenseHandlers(): void {
  registerNoArgHandler('license:get-status', async () => {
    return LicenseService.getStatus()
  })
}
