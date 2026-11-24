import { Globe, Server, HelpCircle, MessageSquare, Keyboard } from 'lucide-react'
import { useState, useEffect, useMemo, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import GeneralSettings from './GeneralSettings'
import { useUIStore } from '../../store/uiStore'
import ApiSettings from './ApiSettings'
import PromptsSettings from './PromptsSettings'
import ShortcutSettings from './ShortcutSettings'
import AboutSettings from './AboutSettings'
import SettingsContentPanel from './SettingsContentPanel'
import { Dialog, DialogContent } from '../ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider
} from '../ui/sidebar'
import type { AppSettings } from '../../../../shared/types'

export default function SettingsDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const { isSettingsOpen, closeSettings } = useUIStore()
  const [activeSection, setActiveSection] = useState<string>('general')
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null)
  const [pendingSettings, setPendingSettings] = useState<AppSettings | null>(null)

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeSettings()
    }
  }

  // Load initial settings
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await window.api.settings.getAll()
      setOriginalSettings(settings)
      setPendingSettings(settings)
    }
    loadSettings()
  }, [])

  const hasChanges = useMemo(() => {
    if (originalSettings && pendingSettings) {
      return JSON.stringify(originalSettings) !== JSON.stringify(pendingSettings)
    }
    return false
  }, [originalSettings, pendingSettings])

  const menuItems = [
    {
      id: 'general',
      icon: Globe,
      label: t('generalSettings'),
      title: t('generalSettings'),
      description: t('generalSettingsDesc')
    },
    {
      id: 'api',
      icon: Server,
      label: t('apiSettings'),
      title: t('apiSettings'),
      description: t('apiSettingsDesc')
    },
    {
      id: 'prompts',
      icon: MessageSquare,
      label: t('promptSettings'),
      title: t('promptSettings'),
      description: t('quizPrompt')
    },
    {
      id: 'shortcuts',
      icon: Keyboard,
      label: t('shortcuts'),
      title: t('shortcuts'),
      description: t('shortcutsDesc')
    },
    {
      id: 'about',
      icon: HelpCircle,
      label: t('about'),
      title: t('about'),
      description: t('aboutDesc')
    }
  ]

  // Update pending settings
  const updatePendingSettings = (updates: Partial<AppSettings>) => {
    if (pendingSettings) {
      setPendingSettings({ ...pendingSettings, ...updates })
    }
  }

  // Confirm and save
  const handleConfirm = async () => {
    if (pendingSettings) {
      await window.api.settings.update(pendingSettings)
      setOriginalSettings(pendingSettings)
    }
  }

  // Cancel changes
  const handleCancel = () => {
    if (originalSettings) {
      setPendingSettings(originalSettings)
    }
  }

  return (
    <Dialog open={isSettingsOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-5xl h-[80vh] p-0 flex flex-col bg-sidebar"
        showCloseButton={false}
      >
        <SidebarProvider className="flex flex-1 min-h-0">
          <div className="flex flex-1 min-h-0 gap-3 p-3 w-full">
            {/* Use the Shadcn Sidebar */}
            <Sidebar className="w-40" collapsible="none">
              <SidebarContent>
                <SidebarMenu>
                  {menuItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          onClick={() => setActiveSection(item.id)}
                          isActive={isActive}
                          className={
                            isActive
                              ? 'bg-sidebar-primary! text-sidebar-primary-foreground!'
                              : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          }
                        >
                          <Icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarContent>
            </Sidebar>

            {/* Render the config for the active section */}
            {(() => {
              const currentItem = menuItems.find((item) => item.id === activeSection)
              if (!currentItem) return null

              return (
                <SettingsContentPanel
                  title={currentItem.title}
                  description={currentItem.description}
                  hasChanges={hasChanges}
                  onCancel={handleCancel}
                  onConfirm={handleConfirm}
                  onClose={() => closeSettings()}
                >
                  {pendingSettings && activeSection === 'general' && (
                    <GeneralSettings
                      settings={pendingSettings}
                      onSettingsChange={updatePendingSettings}
                    />
                  )}
                  {activeSection === 'api' && <ApiSettings />}
                  {pendingSettings && activeSection === 'prompts' && (
                    <PromptsSettings
                      settings={pendingSettings}
                      onSettingsChange={updatePendingSettings}
                    />
                  )}
                  {activeSection === 'shortcuts' && <ShortcutSettings />}
                  {activeSection === 'about' && <AboutSettings />}
                </SettingsContentPanel>
              )
            })()}
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
