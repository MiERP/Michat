import { ChevronRight, Download, KeyRound, RefreshCw } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logoImg from '../../assets/logo.png'
import type { LicenseStatus } from '../../../../shared/types/license'
import { UpdateStatus, type UpdateState } from '../../../../shared/types/update'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

export default function AboutSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [appVersion, setAppVersion] = useState<string>('')
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: UpdateStatus.IDLE })
  const [updateBusy, setUpdateBusy] = useState(false)

  const formatDate = (isoDate?: string): string => {
    if (!isoDate) return '-'
    const parsed = new Date(`${isoDate}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return isoDate
    return parsed.toLocaleDateString()
  }

  useEffect(() => {
    window.api.getAppVersion().then((version) => {
      setAppVersion(version)
    })

    window.api.license
      .getStatus()
      .then((status) => setLicenseStatus(status))
      .catch(() => {
        setLicenseStatus({
          valid: false,
          reason: 'invalid_format',
          message: 'Failed to read license status'
        })
      })
  }, [])

  useEffect(() => {
    window.api.update
      .getState()
      .then((result) => {
        if (result.state) setUpdateState(result.state)
      })
      .catch(() => {})
    return window.api.update.onStateChanged((state) => setUpdateState(state))
  }, [])

  const handleCheckUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      const result = await window.api.update.check()
      if (result.state) setUpdateState(result.state)
      if (!result.success && result.error) alert(result.error)
    } finally {
      setUpdateBusy(false)
    }
  }

  const handleDownloadUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      const result = await window.api.update.download()
      if (!result.success && result.error) alert(result.error)
    } finally {
      setUpdateBusy(false)
    }
  }

  const handleInstallUpdate = async (): Promise<void> => {
    if (!confirm('Install the downloaded update now? MiChat will restart.')) return
    const result = await window.api.update.install()
    if (!result.success && result.error) alert(result.error)
  }

  const handleOpenWebsite = async () => {
    await window.api.openExternalUrl('https://github.com/HAVS/MiChat')
  }

  const handleFeedback = async () => {
    await window.api.openExternalUrl('https://github.com/HAVS/MiChat/issues')
  }

  const handleOpenLicense = async () => {
    await window.api.openExternalUrl('https://github.com/HAVS/MiChat/blob/main/LICENSE')
  }

  return (
    <div className="space-y-6">
      <div className="text-center py-8 flex flex-col items-center gap-4">
        <img src={logoImg} alt="MiChat" className="w-16 h-16 rounded-xl" />
        <div className="flex flex-col gap-2">
          <h2 className="text-h1 text-foreground">MiChat</h2>
          <p className="text-sm text-muted-foreground">
            {t('version')} {appVersion}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Updates</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Status: {updateState.status}
          {updateState.info?.version ? ` · v${updateState.info.version}` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCheckUpdate}
            disabled={updateBusy || updateState.status === UpdateStatus.CHECKING}
          >
            Check for updates
          </Button>
          {updateState.status === UpdateStatus.AVAILABLE && (
            <Button size="sm" onClick={handleDownloadUpdate} disabled={updateBusy}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Download
            </Button>
          )}
          {updateState.status === UpdateStatus.DOWNLOADED && (
            <Button size="sm" onClick={handleInstallUpdate}>
              Install and restart
            </Button>
          )}
        </div>
        {updateState.status === UpdateStatus.DOWNLOADING && (
          <p className="text-xs text-muted-foreground">
            Downloading… {Math.round(updateState.progress?.percent ?? 0)}%
          </p>
        )}
        {updateState.status === UpdateStatus.ERROR && updateState.error && (
          <p className="text-xs text-destructive">{updateState.error}</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('legalNotices')}</h3>
        <p className="text-xs text-muted-foreground">{t('copyrightNotice')}</p>
        <p className="text-xs text-muted-foreground">{t('licenseNotice')}</p>
        <p className="text-xs text-muted-foreground">{t('warrantyNotice')}</p>
        <button
          onClick={handleOpenLicense}
          className="text-sm text-primary underline underline-offset-4 cursor-pointer"
        >
          {t('viewLicense')}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t('licenseInfo')}</span>
          </div>
          <Badge variant={licenseStatus?.valid ? 'default' : 'destructive'}>
            {licenseStatus?.valid ? t('licenseValid') : t('licenseExpired')}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">{t('licenseInfoDesc')}</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <span className="text-muted-foreground">{t('licenseName')}</span>
          <span className="text-foreground font-medium break-all">
            {licenseStatus?.name || '-'}
          </span>

          <span className="text-muted-foreground">{t('licenseExpiry')}</span>
          <span className="text-foreground font-medium">
            {formatDate(licenseStatus?.expiresAt)}
          </span>

          <span className="text-muted-foreground">{t('licenseDaysRemaining')}</span>
          <span className="text-foreground font-medium">
            {licenseStatus?.valid ? (licenseStatus?.daysRemaining ?? '-') : 0}
          </span>
        </div>

        {licenseStatus && !licenseStatus.valid && (
          <p className="text-xs text-destructive">{licenseStatus.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleOpenWebsite}
          className="flex justify-between p-3 bg-card rounded-lg hover:bg-accent transition-colors cursor-pointer"
        >
          <span className="text-sm text-muted-foreground">{t('officialWebsite')}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={handleFeedback}
          className="flex justify-between p-3 bg-card rounded-lg hover:bg-accent transition-colors cursor-pointer"
        >
          <span className="text-sm text-muted-foreground">{t('feedback')}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}
