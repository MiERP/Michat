import { ChevronRight, Download, RefreshCw } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logoImg from '../../assets/logo.png'
import { UpdateStatus, type UpdateState } from '../../../../shared/types/update'
import { Button } from '../ui/button'

export default function AboutSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateState, setUpdateState] = useState<UpdateState>({ status: UpdateStatus.IDLE })
  const [updateBusy, setUpdateBusy] = useState(false)

  useEffect(() => {
    window.api.getAppVersion().then((version) => {
      setAppVersion(version)
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

  const preserveCategorizedError = (): void => {
    setUpdateState((current) =>
      current.status === UpdateStatus.ERROR
        ? current
        : { status: UpdateStatus.ERROR, errorKind: 'unknown' }
    )
  }

  const handleCheckUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      const result = await window.api.update.check()
      if (result.state) setUpdateState(result.state)
      else if (!result.success) {
        setUpdateState((current) =>
          current.status === UpdateStatus.ERROR
            ? current
            : { status: UpdateStatus.ERROR, errorKind: 'unknown' }
        )
      }
    } finally {
      setUpdateBusy(false)
    }
  }

  const handleDownloadUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      const result = await window.api.update.download()
      if (!result.success) {
        preserveCategorizedError()
      }
    } finally {
      setUpdateBusy(false)
    }
  }

  const handleInstallUpdate = async (): Promise<void> => {
    if (!confirm(t('confirmInstall'))) return
    const result = await window.api.update.install()
    if (!result.success) preserveCategorizedError()
  }

  const handleOpenWebsite = async (): Promise<void> => {
    await window.api.openExternalUrl('https://github.com/MiERP/Michat')
  }

  const handleFeedback = async (): Promise<void> => {
    await window.api.openExternalUrl('https://github.com/MiERP/Michat/issues')
  }

  const handleOpenLicense = async (): Promise<void> => {
    await window.api.openExternalUrl('https://github.com/MiERP/Michat/blob/main/LICENSE')
  }

  const latestVersion = updateState.info?.version
  const statusText = (() => {
    switch (updateState.status) {
      case UpdateStatus.CHECKING:
        return t('checking')
      case UpdateStatus.AVAILABLE:
        return latestVersion ? t('updateAvailable', { version: latestVersion }) : ''
      case UpdateStatus.NOT_AVAILABLE:
        return t('upToDate')
      case UpdateStatus.DOWNLOADING:
        return `${t('downloading')} ${Math.round(updateState.progress?.percent ?? 0)}%`
      case UpdateStatus.DOWNLOADED:
        return t('readyToInstall')
      case UpdateStatus.ERROR:
        switch (updateState.errorKind) {
          case 'feed-unavailable':
            return t('updateErrorFeedUnavailable')
          case 'network':
            return t('updateErrorNetwork')
          default:
            return t('updateErrorUnknown')
        }
      default:
        return ''
    }
  })()

  return (
    <div className="space-y-6">
      <div className="text-center py-8 flex flex-col items-center gap-4">
        <img src={logoImg} alt="MiChat" className="w-16 h-16 rounded-xl" />
        <h2 className="text-h1 text-foreground">MiChat</h2>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{t('updates')}</span>
        </div>
        {statusText && <p className="text-xs text-muted-foreground">{statusText}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCheckUpdate}
            disabled={updateBusy || updateState.status === UpdateStatus.CHECKING}
          >
            {updateState.status === UpdateStatus.CHECKING ? t('checking') : t('checkUpdates')}
          </Button>
          {updateState.status === UpdateStatus.AVAILABLE && (
            <Button size="sm" onClick={handleDownloadUpdate} disabled={updateBusy}>
              <Download className="w-3.5 h-3.5 mr-1" />
              {t('downloadUpdate')}
            </Button>
          )}
          {updateState.status === UpdateStatus.DOWNLOADED && (
            <Button size="sm" onClick={handleInstallUpdate}>
              {t('installUpdate')}
            </Button>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t('currentVersion')}{' '}
              <span className="font-medium text-foreground">v{appVersion || '—'}</span>
            </span>
            {latestVersion && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('latestVersion')}{' '}
                  <span className="font-medium text-foreground">v{latestVersion}</span>
                </span>
              </>
            )}
          </span>
        </div>
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
