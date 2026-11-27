import { Home, Plus, X, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotebookStore } from '../../store/notebookStore'
import { useUIStore } from '../../store/uiStore'
import { ReactElement, useState } from 'react'
import { Button } from '../ui/button'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { isMac, isLinux, isWindows } from '../../lib/platform'

interface TopNavigationBarProps {
  onCreateClick: () => void
  isHomePage?: boolean
}

export default function TopNavigationBar({
  onCreateClick,
  isHomePage = false
}: TopNavigationBarProps): ReactElement {
  const { t } = useTranslation('ui')
  const navigate = useNavigate()
  const { openSettings } = useUIStore()
  const { currentNotebook, openedNotebooks, removeOpenedNotebook, setCurrentNotebook } =
    useNotebookStore()

  // Determine the active tab
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (isHomePage) return 'home'
    return currentNotebook?.id ?? 'home'
  })

  // Update activeTab when isHomePage or currentNotebook changes
  if (isHomePage && activeTab !== 'home') {
    setActiveTab('home')
  } else if (!isHomePage && currentNotebook && activeTab !== currentNotebook.id) {
    setActiveTab(currentNotebook.id)
  }

  const handleTabChange = (value: string): void => {
    setActiveTab(value)
    if (value === 'home') {
      navigate('/')
    } else {
      setCurrentNotebook(value)
      navigate(`/notebook/${value}`)
    }
  }

  const handleCloseOpenedNotebook = (id: string, e: React.MouseEvent): void => {
    e.stopPropagation()

    // If the current notebook is being closed, navigate away
    if (currentNotebook?.id === id && !isHomePage) {
      // Find the current notebook's index in the list
      const currentIndex = openedNotebooks.findIndex((nb) => nb.id === id)
      const otherNotebooks = openedNotebooks.filter((nb) => nb.id !== id)

      if (otherNotebooks.length > 0) {
        // If it is not the first, go to the previous one; otherwise go to the next
        const targetNotebook =
          currentIndex > 0 ? openedNotebooks[currentIndex - 1] : openedNotebooks[1]
        setCurrentNotebook(targetNotebook.id)
        navigate(`/notebook/${targetNotebook.id}`)
      } else {
        // No other notebooks: go to the home page
        navigate('/')
      }
    }
    removeOpenedNotebook(id)
  }

  const handleSettingsClick = (): void => {
    openSettings()
  }

  return (
    <div
      className="brand-topbar h-12 shrink-0 flex items-center justify-between px-2 gap-0.5"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS left spacer (reserved for window controls) */}
      {isMac() && <div className="w-20"></div>}

      {/* Linux left settings button area */}
      {isLinux() && (
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSettingsClick}
            data-testid="open-settings"
            variant="ghost"
            size="icon"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="w-7 h-7 text-white/80 hover:bg-white/10 hover:text-white"
            title={t('settings')}
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Navigation tabs */}
      <div className="flex items-center gap-2 flex-1">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1">
          <TabsList
            className="bg-transparent border-0 gap-2 h-auto p-0 justify-start"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* Home tab */}
            <TabsTrigger
              value="home"
              className="brand-navigation-tab h-7 gap-2 px-3 rounded-md border transition-all"
            >
              <Home className="w-4 h-4" />
              <span>{t('home')}</span>
            </TabsTrigger>

            {/* Open notebook tabs */}
            {openedNotebooks.map((notebook) => (
              <TabsTrigger
                key={notebook.id}
                value={notebook.id}
                className="brand-navigation-tab h-7 gap-1 pr-2 pl-3 rounded-md border transition-all max-w-[200px]"
              >
                <span className="truncate">{notebook.title}</span>
                <button
                  onClick={(e) => handleCloseOpenedNotebook(notebook.id, e)}
                  type="button"
                  className="ml-1 inline-flex items-center justify-center h-4 w-4 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
                  title={t('closeTab')}
                >
                  <X className="w-3 h-3" />
                </button>
              </TabsTrigger>
            ))}

            {/* New notebook button */}
            <Button
              onClick={onCreateClick}
              data-testid="create-notebook"
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-white/80 hover:bg-white/10 hover:text-white"
              title={t('create', { ns: 'common' })}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </TabsList>
        </Tabs>
      </div>

      {/* Settings button for non-Linux platforms (kept on the right on Windows and macOS) */}
      {!isLinux() && (
        <Button
          onClick={handleSettingsClick}
          data-testid="open-settings"
          variant="ghost"
          size="icon"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="w-7 h-7 text-white/80 hover:bg-white/10 hover:text-white"
          title={t('settings')}
        >
          <Settings className="w-4 h-4" />
        </Button>
      )}

      {/* Windows right spacer (reserved for window controls) */}
      {isWindows() && <div className="w-32"></div>}
    </div>
  )
}
