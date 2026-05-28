import { useState, useEffect, useCallback, ReactElement } from 'react'
import { HardDrive, Download, Trash2, Cpu, Database, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'

interface GgufModel {
  filename: string
  type: 'chat' | 'embedding' | 'unknown'
  sizeMB: number
  addedAt: string | null
}

interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

interface ProvidersSettingsProps {
  providers: ProviderConfig[]
  onProvidersChange: (updatedProviders: ProviderConfig[]) => void
  onRefresh: () => Promise<void>
}

export default function ProvidersSettings({ onRefresh }: ProvidersSettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const [models, setModels] = useState<GgufModel[]>([])
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)

  useEffect(() => {
    const checkEncryption = async () => {
      try {
        const result = await window.api.checkEncryption()
        setEncryptionAvailable(result.encrypted)
      } catch {
        setEncryptionAvailable(true)
      }
    }
    checkEncryption()
  }, [])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [defaultChatModel, setDefaultChatModel] = useState<string>('')
  const [defaultEmbeddingModel, setDefaultEmbeddingModel] = useState<string>('')

  const loadDefaults = useCallback(async () => {
    try {
      const settings = await window.api.settings.getAll()
      setDefaultChatModel(settings.defaultChatModel || '')
      setDefaultEmbeddingModel(settings.defaultEmbeddingModel || '')
    } catch (error) {
      console.error('Failed to load default model settings:', error)
    }
  }, [])

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.llama.listModels()
      setModels(result || [])
    } catch (error) {
      console.error('Failed to load models:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadModels()
    loadDefaults()
  }, [loadModels, loadDefaults])

  const handleImport = async (type: 'chat' | 'embedding') => {
    setImporting(true)
    try {
      const result = await window.api.llama.importModel(type)
      if (result.success) {
        await loadModels()
        await onRefresh()
        await loadDefaults()
      } else if (result.reason && result.reason !== 'cancelled') {
        alert(`Import failed: ${result.reason}`)
      }
    } catch (error) {
      alert(`Import failed: ${(error as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  const handleUseAsDefault = async (model: GgufModel) => {
    try {
      if (model.type === 'chat') {
        await window.api.settings.update({ defaultChatModel: `llama:${model.filename}` })
      } else if (model.type === 'embedding') {
        await window.api.settings.update({ defaultEmbeddingModel: `llama:${model.filename}` })
      } else {
        return
      }
      await onRefresh()
      await loadDefaults()
    } catch (error) {
      alert(`Set default model failed: ${(error as Error).message}`)
    }
  }

  const handleRemove = async (filename: string) => {
    const confirmed = confirm(`Remove model "${filename}"? This will delete the file permanently.`)
    if (!confirmed) return

    try {
      const result = await window.api.llama.removeModel(filename)
      if (result.success) {
        await loadModels()
        await onRefresh()
        await loadDefaults()
      } else {
        alert(`Remove failed: ${result.reason}`)
      }
    } catch (error) {
      alert(`Remove failed: ${(error as Error).message}`)
    }
  }

  const chatModels = models.filter((m) => m.type === 'chat')
  const embedModels = models.filter((m) => m.type === 'embedding')
  const unknownModels = models.filter((m) => m.type === 'unknown')

  const formatSize = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
    return `${mb} MB`
  }

  const isModelDefault = (model: GgufModel): boolean => {
    if (model.type === 'chat') return defaultChatModel === `llama:${model.filename}`
    if (model.type === 'embedding') return defaultEmbeddingModel === `llama:${model.filename}`
    return false
  }

  const ModelRow = ({ model }: { model: GgufModel }) => (
    <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-background/50 hover:bg-background/80 transition-colors gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {model.type === 'chat' ? (
          <Cpu className="w-4 h-4 text-blue-500 shrink-0" />
        ) : model.type === 'embedding' ? (
          <Database className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : (
          <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{model.filename}</div>
          <div className="text-xs text-muted-foreground">
            {formatSize(model.sizeMB)}
            {model.addedAt && ` · ${new Date(model.addedAt).toLocaleDateString()}`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {model.type !== 'unknown' && (
          <Button
            variant={isModelDefault(model) ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => handleUseAsDefault(model)}
            disabled={isModelDefault(model)}
            className="h-8"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            {isModelDefault(model) ? 'Mặc định' : 'Dùng làm mặc định'}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => handleRemove(model.filename)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 pr-4">
        {!encryptionAvailable && (
          <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
            <strong>Security Warning:</strong> API keys are stored in plain text because system encryption is not available on this platform.
          </div>
        )}
        <div className="flex gap-3">
          <Button
            onClick={() => handleImport('chat')}
            disabled={importing}
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {importing
              ? t('importing') || 'Importing...'
              : t('importChatModel') || 'Import Chat Model'}
          </Button>
          <Button
            onClick={() => handleImport('embedding')}
            disabled={importing}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {importing
              ? t('importing') || 'Importing...'
              : t('importEmbedModel') || 'Import Embedding Model'}
          </Button>
        </div>

        {chatModels.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-500" />
              {t('chatModels') || 'Chat Models'} ({chatModels.length})
            </h3>
            <div className="space-y-1">
              {chatModels.map((m) => (
                <ModelRow key={m.filename} model={m} />
              ))}
            </div>
          </div>
        )}

        {embedModels.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-500" />
              {t('embeddingModels') || 'Embedding Models'} ({embedModels.length})
            </h3>
            <div className="space-y-1">
              {embedModels.map((m) => (
                <ModelRow key={m.filename} model={m} />
              ))}
            </div>
          </div>
        )}

        {unknownModels.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted-foreground" />
              {t('unclassifiedModels') || 'Unclassified'} ({unknownModels.length})
            </h3>
            <div className="space-y-1">
              {unknownModels.map((m) => (
                <ModelRow key={m.filename} model={m} />
              ))}
            </div>
          </div>
        )}

        {!loading && models.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <HardDrive className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">{t('noModels') || 'No models installed'}</p>
            <p className="text-xs mt-1">
              {t('noModelsDesc') || 'Import .gguf model files to get started'}
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
