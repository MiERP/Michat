import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import NotebookLayout from './components/notebook/NotebookLayout'
import NotebookListPage from './components/pages/NotebookListPage'
import OnboardingPage from './components/pages/OnboardingPage'
import SettingsDialog from './components/settings/SettingsDialog'

const QuizPage = lazy(() => import('./components/pages/QuizPage'))
import { setupChatListeners } from './store/chatStore'
import { useThemeStore } from './store/themeStore'
import { useNotebookStore } from './store/notebookStore'
import { useI18nStore } from './store/i18nStore'
import { useOnboardingStore } from './store/onboardingStore'
import { useShortcutExecutor } from './hooks/useShortcutExecutor'
import { initPlatform } from './lib/platform'
import i18n from './i18n'

function App(): React.JSX.Element {
  const initTheme = useThemeStore((state) => state.initTheme)
  const loadNotebooks = useNotebookStore((state) => state.loadNotebooks)
  const { language, initLanguage } = useI18nStore()
  const {
    hasCompletedOnboarding,
    isLoading: onboardingLoading,
    initOnboarding
  } = useOnboardingStore()

  // Activate the shortcut executor
  useShortcutExecutor()

  // Initialize platform detection (preload platform info into the cache)
  useEffect(() => {
    initPlatform().catch((error) => {
      console.error('[App] Failed to initialize platform detection:', error)
    })
  }, [])

  // Initialize chat listeners
  useEffect(() => {
    const cleanup = setupChatListeners()
    return cleanup
  }, [])

  // Initialize the theme
  useEffect(() => {
    initTheme()
  }, [initTheme])

  // Initialize the language
  useEffect(() => {
    initLanguage()
  }, [initLanguage])

  // Watch for language changes
  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language)
    }
  }, [language])

  // Initialize notebook data (load from the database)
  useEffect(() => {
    console.log('[App] Loading notebooks on startup...')
    loadNotebooks().catch((error) => {
      console.error('[App] Failed to load notebooks:', error)
    })
  }, [loadNotebooks])

  // Initialize onboarding state
  useEffect(() => {
    initOnboarding()
  }, [initOnboarding])

  // Show a loading state while onboarding state is loading
  if (onboardingLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <I18nextProvider i18n={i18n}>
      <HashRouter>
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
          <Routes>
            {/* Onboarding route */}
            {!hasCompletedOnboarding && <Route path="/onboarding" element={<OnboardingPage />} />}
            {/* Main app route */}
            <Route
              path="/"
              element={
                hasCompletedOnboarding ? (
                  <NotebookListPage />
                ) : (
                  <Navigate to="/onboarding" replace />
                )
              }
            />
            <Route path="/notebook/:id" element={<NotebookLayout />} />
            <Route path="/quiz/:notebookId" element={<QuizPage />} />
            <Route path="/quiz/view/:quizId" element={<QuizPage />} />
          </Routes>
        </Suspense>
        <SettingsDialog />
      </HashRouter>
    </I18nextProvider>
  )
}

export default App
