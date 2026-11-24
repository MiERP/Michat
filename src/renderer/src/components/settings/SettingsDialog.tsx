import { Globe, Database, HelpCircle, MessageSquare, Keyboard } from 'lucide-react'
import { useState, useEffect, useMemo, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import GeneralSettings from './GeneralSettings'
import { useUIStore } from '../../store/uiStore'
import ProvidersSettings from './ProvidersSettings'
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
import type { AppSettings, PublicProviderConfig } from '../../../../shared/types'
import { REQUIRED_EMBEDDING_DIMENSIONS } from '../../../../shared/types/knowledge'

export default function SettingsDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const { isSettingsOpen, closeSettings } = useUIStore()
  const [activeSection, setActiveSection] = useState<string>('general')
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null)
  const [pendingSettings, setPendingSettings] = useState<AppSettings | null>(null)
  const [originalProviders, setOriginalProviders] = useState<PublicProviderConfig[]>([])
  const [pendingProviders, setPendingProviders] = useState<PublicProviderConfig[]>([])

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

      const providers = await window.api.getAllProviderConfigs()
      setOriginalProviders(providers)
      setPendingProviders(providers)
    }
    loadSettings()
  }, [])

  // Use useMemo to compute whether anything changed
  const hasChanges = useMemo(() => {
    if (originalSettings && pendingSettings && originalProviders && pendingProviders) {
      const settingsChanged = JSON.stringify(originalSettings) !== JSON.stringify(pendingSettings)
      const providersChanged =
        JSON.stringify(originalProviders) !== JSON.stringify(pendingProviders)
      return settingsChanged || providersChanged
    }
    return false
  }, [originalSettings, pendingSettings, originalProviders, pendingProviders])

  const menuItems = [
    {
      id: 'general',
      icon: Globe,
      label: t('generalSettings'),
      title: t('generalSettings'),
      description: t('generalSettingsDesc')
    },
    {
      id: 'provider',
      icon: Database,
      label: t('aiProviders'),
      title: t('aiProviders'),
      description: t('aiProvidersDesc')
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

  // Update pending provider configs
  const updatePendingProviders = (updatedProviders: PublicProviderConfig[]) => {
    setPendingProviders(updatedProviders)
  }

  // Refresh provider configs (sync state after add/delete)
  const refreshProviders = async () => {
    const providers = await window.api.getAllProviderConfigs()
    setOriginalProviders(providers)
    setPendingProviders(providers)
  }

  // Confirm and save
  const handleConfirm = async () => {
    // Save general settings
    if (pendingSettings) {
      await window.api.settings.update(pendingSettings)
      let resolvedSettings = pendingSettings

      // Model embedding phải khớp schema vector 1024 chiều; nếu không thì giữ model cũ.
      if (pendingSettings.defaultEmbeddingModel !== originalSettings?.defaultEmbeddingModel) {
        const probe = await window.api.knowledge.probeEmbeddingDimensions()
        if (
          probe.success &&
          probe.dimensions &&
          probe.dimensions !== REQUIRED_EMBEDDING_DIMENSIONS
        ) {
          const fallback = originalSettings?.defaultEmbeddingModel ?? ''
          resolvedSettings = { ...pendingSettings, defaultEmbeddingModel: fallback }
          await window.api.settings.update({ defaultEmbeddingModel: fallback })
          alert(
            t('embeddingDimensionMismatch', {
              dimensions: probe.dimensions,
              required: REQUIRED_EMBEDDING_DIMENSIONS
            })
          )
        }
      }

      setPendingSettings(resolvedSettings)
      setOriginalSettings(resolvedSettings)
    }

    // Save provider configs (adds/deletes are saved immediately; only edits are saved here)
    let anyUnencrypted = false
    for (const provider of pendingProviders) {
      const result = await window.api.saveProviderConfig(provider)
      if (!result.encrypted) {
        anyUnencrypted = true
      }
    }
    setOriginalProviders(pendingProviders)

    if (anyUnencrypted) {
      alert(
        'Warning: API keys are stored in plain text because system encryption is not available on this platform. This is a security risk.'
      )
    }
  }

  // Cancel changes
  const handleCancel = () => {
    if (originalSettings) {
      setPendingSettings(originalSettings)
    }
    if (originalProviders) {
      setPendingProviders(originalProviders)
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
                      providers={pendingProviders}
                    />
                  )}
                  {activeSection === 'provider' && (
                    <ProvidersSettings
                      providers={pendingProviders}
                      onProvidersChange={updatePendingProviders}
                      onRefresh={refreshProviders}
                    />
                  )}
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
