import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { CheckCircle2, Loader2, PlugZap, Save, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PublicApiConfig } from '../../../../shared/types/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet
} from '../ui/field'

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'error'
  message?: string
  models?: string[]
}

export default function ApiSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [config, setConfig] = useState<PublicApiConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [contextWindow, setContextWindow] = useState('8192')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  const applyConfig = useCallback((value: PublicApiConfig) => {
    setConfig(value)
    setBaseUrl(value.baseUrl)
    setChatModel(value.chatModel)
    setEmbeddingModel(value.embeddingModel)
    setContextWindow(String(value.contextWindow))
    setApiKey('')
    setClearApiKey(false)
  }, [])

  useEffect(() => {
    void window.api.api.getConfig().then(applyConfig)
    void window.api.api.checkEncryption().then((result) => {
      setEncryptionAvailable(result.encrypted)
    })
  }, [applyConfig])

  const handleTest = async (): Promise<void> => {
    setTestState({ status: 'testing' })
    try {
      const result = await window.api.api.testConnection({
        baseUrl,
        apiKey: apiKey || undefined,
        clearApiKey
      })
      setTestState({
        status: result.ok ? 'ok' : 'error',
        message: result.message,
        models: result.models
      })
    } catch (error) {
      setTestState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    setSaved(false)
    try {
      const next = await window.api.api.saveConfig({
        baseUrl,
        chatModel,
        embeddingModel,
        contextWindow: Number(contextWindow) || 8192,
        apiKey: apiKey || undefined,
        clearApiKey
      })
      applyConfig(next)
      setSaved(true)
      setTestState({ status: 'idle' })
    } catch (error) {
      setTestState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <FieldSet>
      <FieldGroup>
        <Field>
          <FieldContent>
            <FieldLabel htmlFor="api-base-url">{t('apiBaseUrl')}</FieldLabel>
            <FieldDescription>{t('apiBaseUrlDesc')}</FieldDescription>
          </FieldContent>
          <Input
            id="api-base-url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value)
              setSaved(false)
            }}
            placeholder="http://127.0.0.1:1234/v1"
            spellCheck={false}
          />
        </Field>

        <Field>
          <FieldContent>
            <FieldLabel htmlFor="api-key">{t('apiKey')}</FieldLabel>
            <FieldDescription>
              {config?.hasApiKey && !clearApiKey ? t('apiKeyStored') : t('apiKeyDesc')}
            </FieldDescription>
          </FieldContent>
          <Input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              setClearApiKey(false)
              setSaved(false)
            }}
            placeholder={config?.hasApiKey ? '••••••••' : t('apiKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
          {config?.hasApiKey && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => {
                  setClearApiKey(event.target.checked)
                  setApiKey('')
                  setSaved(false)
                }}
              />
              {t('clearApiKey')}
            </label>
          )}
        </Field>

        <Field>
          <FieldContent>
            <FieldLabel htmlFor="api-chat-model">{t('apiChatModel')}</FieldLabel>
            <FieldDescription>{t('apiChatModelDesc')}</FieldDescription>
          </FieldContent>
          <Input
            id="api-chat-model"
            value={chatModel}
            onChange={(event) => {
              setChatModel(event.target.value)
              setSaved(false)
            }}
            placeholder={t('apiModelPlaceholder')}
            spellCheck={false}
          />
        </Field>

        <Field>
          <FieldContent>
            <FieldLabel htmlFor="api-embedding-model">{t('apiEmbeddingModel')}</FieldLabel>
            <FieldDescription>{t('apiEmbeddingModelDesc')}</FieldDescription>
          </FieldContent>
          <Input
            id="api-embedding-model"
            value={embeddingModel}
            onChange={(event) => {
              setEmbeddingModel(event.target.value)
              setSaved(false)
            }}
            placeholder={t('apiModelPlaceholder')}
            spellCheck={false}
          />
        </Field>

        <Field>
          <FieldContent>
            <FieldLabel htmlFor="api-context-window">{t('apiContextWindow')}</FieldLabel>
            <FieldDescription>{t('apiContextWindowDesc')}</FieldDescription>
          </FieldContent>
          <Input
            id="api-context-window"
            type="number"
            min={2048}
            max={1000000}
            value={contextWindow}
            onChange={(event) => {
              setContextWindow(event.target.value)
              setSaved(false)
            }}
          />
        </Field>

        {!encryptionAvailable && (
          <p className="text-xs text-destructive">{t('apiEncryptionUnavailable')}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleTest()}>
            {testState.status === 'testing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlugZap className="w-3.5 h-3.5" />
            )}
            {t('testConnection')}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={isSaving}>
            <Save className="w-3.5 h-3.5" />
            {isSaving ? t('saving') : t('saveApiConfig')}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="w-3.5 h-3.5" /> {t('apiSaved')}
            </span>
          )}
        </div>

        {testState.status !== 'idle' && testState.status !== 'testing' && (
          <div
            className={`rounded-md border p-3 text-sm ${
              testState.status === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-foreground'
                : 'border-destructive/40 bg-destructive/10 text-foreground'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {testState.status === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive" />
              )}
              {testState.status === 'ok' ? t('connectionSuccessful') : t('connectionFailed')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{testState.message}</p>
            {testState.models && testState.models.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium">{t('availableModels')}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {testState.models.join(', ')}
                </p>
              </div>
            )}
          </div>
        )}
      </FieldGroup>
    </FieldSet>
  )
}
