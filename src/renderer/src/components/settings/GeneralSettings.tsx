import { ReactElement, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useI18nStore } from '../../store/i18nStore'
import type { AppSettings } from '../../../../shared/types'
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

interface GeneralSettingsProps {
  settings: AppSettings
  onSettingsChange: (updates: Partial<AppSettings>) => void
}

const languages = [
  { value: 'vi-VN', label: 'VietNam', native: 'Vietnamese' },
  { value: 'en-US', label: 'English', native: 'English' }
]

const ragTopKOptions = [1, 2, 3, 4, 5, 6, 7, 8]
const ragThresholdOptions = [0.4, 0.5, 0.55, 0.6, 0.62, 0.65, 0.7, 0.75]
const ragShortQueryOptions = [6, 8, 10, 12, 16, 20]
const ragDocTopKOptions = [3, 5, 8, 12, 20, 30]
const rerankTopNOptions = [4, 6, 8, 10, 12, 16, 20, 24]

export default function GeneralSettings({
  settings,
  onSettingsChange
}: GeneralSettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const { changeLanguage } = useI18nStore()

  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [settings.theme])

  return (
    <FieldSet>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{t('themeMode')}</FieldLabel>
            <FieldDescription>{t('selectTheme')}</FieldDescription>
          </FieldContent>
          <div className="inline-flex rounded-lg border bg-muted p-1">
            <Button
              onClick={() => onSettingsChange({ theme: 'light' })}
              variant={settings.theme === 'light' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-md"
            >
              <Sun className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t('light')}</span>
            </Button>
            <Button
              onClick={() => onSettingsChange({ theme: 'dark' })}
              variant={settings.theme === 'dark' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-md"
            >
              <Moon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t('dark')}</span>
            </Button>
          </div>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="language-select">{t('language')}</FieldLabel>
            <FieldDescription>{t('languageDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={settings.language}
            onValueChange={(value) => {
              const newLang = value as AppSettings['language']
              onSettingsChange({ language: newLang })
              changeLanguage(newLang)
            }}
          >
            <SelectTrigger id="language-select" className="w-56">
              <SelectValue placeholder={t('pleaseSelect')}>
                {languages.find((lang) => lang.value === settings.language)?.native}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((language) => (
                <SelectItem key={language.value} value={language.value}>
                  <span className="text-sm font-medium">{language.native}</span>
                  <span className="text-xs text-muted-foreground">{language.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rerank-enabled-select">{t('rerankEnabled')}</FieldLabel>
            <FieldDescription>{t('rerankEnabledDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.rerankEnabled ?? true)}
            onValueChange={(value) => onSettingsChange({ rerankEnabled: value === 'true' })}
          >
            <SelectTrigger id="rerank-enabled-select" className="w-56">
              <SelectValue>
                {settings.rerankEnabled !== false ? t('enabled') : t('disabled')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">{t('enabled')}</SelectItem>
              <SelectItem value="false">{t('disabled')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rerank-topn-select">{t('rerankTopN')}</FieldLabel>
            <FieldDescription>{t('rerankTopNDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.rerankTopN ?? 12)}
            onValueChange={(value) => onSettingsChange({ rerankTopN: Number(value) })}
          >
            <SelectTrigger id="rerank-topn-select" className="w-56">
              <SelectValue>{settings.rerankTopN ?? 12}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {rerankTopNOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rerank-fallback-select">{t('rerankHeuristicFallback')}</FieldLabel>
            <FieldDescription>{t('rerankHeuristicFallbackDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.rerankUseHeuristicFallback ?? true)}
            onValueChange={(value) =>
              onSettingsChange({ rerankUseHeuristicFallback: value === 'true' })
            }
          >
            <SelectTrigger id="rerank-fallback-select" className="w-56">
              <SelectValue>
                {settings.rerankUseHeuristicFallback !== false ? t('enabled') : t('disabled')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">{t('enabled')}</SelectItem>
              <SelectItem value="false">{t('disabled')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rag-topk-select">{t('ragTopK')}</FieldLabel>
            <FieldDescription>{t('ragTopKDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.ragTopK ?? 3)}
            onValueChange={(value) => onSettingsChange({ ragTopK: Number(value) })}
          >
            <SelectTrigger id="rag-topk-select" className="w-56">
              <SelectValue>{settings.ragTopK ?? 3}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ragTopKOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rag-threshold-select">{t('ragThreshold')}</FieldLabel>
            <FieldDescription>{t('ragThresholdDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.ragThreshold ?? 0.62)}
            onValueChange={(value) => onSettingsChange({ ragThreshold: Number(value) })}
          >
            <SelectTrigger id="rag-threshold-select" className="w-56">
              <SelectValue>{(settings.ragThreshold ?? 0.62).toFixed(2)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ragThresholdOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value.toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rag-short-query-select">{t('ragShortQueryLength')}</FieldLabel>
            <FieldDescription>{t('ragShortQueryLengthDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.ragSkipShortQueryLength ?? 12)}
            onValueChange={(value) => onSettingsChange({ ragSkipShortQueryLength: Number(value) })}
          >
            <SelectTrigger id="rag-short-query-select" className="w-56">
              <SelectValue>{settings.ragSkipShortQueryLength ?? 12}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ragShortQueryOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rag-chitchat-select">{t('ragChitChatHeuristic')}</FieldLabel>
            <FieldDescription>{t('ragChitChatHeuristicDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.ragEnableChitChatHeuristic ?? true)}
            onValueChange={(value) =>
              onSettingsChange({ ragEnableChitChatHeuristic: value === 'true' })
            }
          >
            <SelectTrigger id="rag-chitchat-select" className="w-56">
              <SelectValue>
                {settings.ragEnableChitChatHeuristic !== false ? t('enabled') : t('disabled')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">{t('enabled')}</SelectItem>
              <SelectItem value="false">{t('disabled')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rag-hierarchical-select">{t('ragHierarchical')}</FieldLabel>
            <FieldDescription>{t('ragHierarchicalDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.ragHierarchicalEnabled ?? true)}
            onValueChange={(value) =>
              onSettingsChange({ ragHierarchicalEnabled: value === 'true' })
            }
          >
            <SelectTrigger id="rag-hierarchical-select" className="w-56">
              <SelectValue>
                {settings.ragHierarchicalEnabled !== false ? t('enabled') : t('disabled')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">{t('enabled')}</SelectItem>
              <SelectItem value="false">{t('disabled')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="rag-doctopk-select">{t('ragDocTopK')}</FieldLabel>
            <FieldDescription>{t('ragDocTopKDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={String(settings.ragDocTopK ?? 8)}
            onValueChange={(value) => onSettingsChange({ ragDocTopK: Number(value) })}
          >
            <SelectTrigger id="rag-doctopk-select" className="w-56">
              <SelectValue>{settings.ragDocTopK ?? 8}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ragDocTopKOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}
