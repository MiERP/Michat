import { ReactElement, useEffect, useState } from 'react'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet
} from '../ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Button } from '../ui/button'
import type { AppSettings } from '../../../../shared/types'

interface OfficeIntegrationSettingsProps {
  settings: AppSettings
  onSettingsChange: (updates: Partial<AppSettings>) => void
  refreshKey: number
}

export default function OfficeIntegrationSettings({
  settings,
  onSettingsChange,
  refreshKey
}: OfficeIntegrationSettingsProps): ReactElement {
  const [bridgeStatus, setBridgeStatus] = useState<{
    running: boolean
    port: number
    address: string
  } | null>(null)
  const [installPath, setInstallPath] = useState<string | null>(null)
  const [catalogPath, setCatalogPath] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installWarnings, setInstallWarnings] = useState<string[]>([])

  useEffect(() => {
    const poll = async () => {
      try {
        const status = await window.api.office.getStatus()
        setBridgeStatus(status)
      } catch {
        setBridgeStatus(null)
      }
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [refreshKey])

  const handleOpenFolder = async () => {
    await window.api.office.openManifestFolder()
  }

  const handleInstallManifests = async () => {
    setInstallError(null)
    setInstallWarnings([])
    const result = await window.api.office.installManifests()
    if (result.success && result.path) {
      setInstallPath(result.path)
      setCatalogPath(result.catalogPath ?? null)
      setInstallWarnings(result.warnings ?? [])
      return
    }
    setInstallError(result.error ?? 'Install failed')
  }

  return (
    <FieldSet>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Office Integration</FieldLabel>
            <FieldDescription>
              Enable the local HTTPS bridge that Word and Excel use to open MiChat.
            </FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.officeIntegrationEnabled ?? false)}
            onValueChange={(value) =>
              onSettingsChange({ officeIntegrationEnabled: value === 'true' })
            }
          >
            <SelectTrigger className="w-56">
              <SelectValue>
                {settings.officeIntegrationEnabled ? 'Enabled' : 'Disabled'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Bridge Status</FieldLabel>
            <FieldDescription>
              {bridgeStatus?.running
                ? `Running on ${bridgeStatus.address}`
                : 'Bridge is not running'}
            </FieldDescription>
          </FieldContent>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                bridgeStatus?.running ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm">{bridgeStatus?.running ? 'Online' : 'Offline'}</span>
          </div>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Manifests</FieldLabel>
            <FieldDescription>
              {installError
                ? `Install failed: ${installError}`
                : catalogPath
                  ? installWarnings.length > 0
                    ? `Registered trusted Office add-in catalog at ${catalogPath}; review: ${installWarnings.join('; ')}`
                    : `Registered trusted Office add-in catalog at ${catalogPath}. Keep MiChat running, then close and reopen Word/Excel. In Office, open Insert > Add-ins > My Add-ins.`
                  : installPath
                    ? `Copied Word and Excel manifests to ${installPath}`
                    : 'Install Word and Excel add-ins after installing the desktop app. Keep MiChat running, close Word/Excel, then reopen Office and open Insert > Add-ins > My Add-ins.'}
            </FieldDescription>
          </FieldContent>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenFolder}>
              Open Source
            </Button>
            <Button variant="outline" size="sm" onClick={handleInstallManifests}>
              Install to Office
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}
