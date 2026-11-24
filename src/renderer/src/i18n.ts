import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Import all language resources
import viVNCommon from './locales/vi-VN/common.json'
import viVNChat from './locales/vi-VN/chat.json'
import viVNSettings from './locales/vi-VN/settings.json'
import viVNNotebook from './locales/vi-VN/notebook.json'
import viVNUI from './locales/vi-VN/ui.json'
import viVNQuiz from './locales/vi-VN/quiz.json'
import viVNShortcuts from './locales/vi-VN/shortcuts.json'

import enUSCommon from './locales/en-US/common.json'
import enUSChat from './locales/en-US/chat.json'
import enUSSettings from './locales/en-US/settings.json'
import enUSNotebook from './locales/en-US/notebook.json'
import enUSUI from './locales/en-US/ui.json'
import enUSQuiz from './locales/en-US/quiz.json'
import enUSShortcuts from './locales/en-US/shortcuts.json'

const resources = {
  'vi-VN': {
    common: viVNCommon,
    chat: viVNChat,
    settings: viVNSettings,
    notebook: viVNNotebook,
    ui: viVNUI,
    quiz: viVNQuiz,
    shortcuts: viVNShortcuts
  },
  'en-US': {
    common: enUSCommon,
    chat: enUSChat,
    settings: enUSSettings,
    notebook: enUSNotebook,
    ui: enUSUI,
    quiz: enUSQuiz,
    shortcuts: enUSShortcuts
  }
}

i18n
  .use(initReactI18next) // Pass the i18n instance to react-i18next
  .init({
    resources,
    lng: 'vi-VN', // Default language
    fallbackLng: 'vi-VN',
    interpolation: {
      escapeValue: false // React escapes by default
    },
    react: {
      useSuspense: false
    }
  })

export default i18n
