import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useI18nStore } from '../../store/i18nStore'
import type { Language } from '../../store/i18nStore'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import logo from '../../assets/logo.png'

const languages = [
  { code: 'vi-VN' as Language, labelKey: 'onboarding.languageVi' },
  { code: 'en-US' as Language, labelKey: 'onboarding.languageEn' }
]

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const { completeOnboarding } = useOnboardingStore()
  const { language, changeLanguage } = useI18nStore()
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [isCompleting, setIsCompleting] = useState(false)
  const [modelCount, setModelCount] = useState<number | null>(null)

  useEffect(() => {
    window.api.llama
      .listModels()
      .then((models) => setModelCount(models.length))
      .catch(() => setModelCount(0))
  }, [])

  const handleComplete = async () => {
    setIsCompleting(true)
    await changeLanguage(selectedLanguage)
    await completeOnboarding()
    navigate('/')
  }

  const selectedLangLabel = t(
    languages.find((entry) => entry.code === selectedLanguage)?.labelKey ?? 'onboarding.languageEn'
  )

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md px-6 text-center">
        <div className="mb-8">
          <img src={logo} alt="MiChat" className="w-24 h-24 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-foreground mb-2">MiChat</h1>
          <p className="text-sm text-muted-foreground">{t('onboarding.tagline')}</p>
        </div>

        <div className="mb-6">
          <Select
            value={selectedLanguage}
            onValueChange={(value) => setSelectedLanguage(value as Language)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('onboarding.selectLanguage')}>
                {selectedLangLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  {t(entry.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {modelCount === 0 && (
          <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-left">
            <p className="text-sm font-medium text-foreground">{t('onboarding.noModelsTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('onboarding.noModelsHint')}</p>
          </div>
        )}

        <Button size="lg" onClick={handleComplete} disabled={isCompleting} className="w-full">
          {isCompleting ? t('onboarding.starting') : t('onboarding.getStarted')}
        </Button>
      </div>
    </div>
  )
}
