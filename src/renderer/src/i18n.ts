import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 导入所有语言资源
import zhCNCommon from './locales/vi-VN/common.json'
import zhCNChat from './locales/vi-VN/chat.json'
import zhCNSettings from './locales/vi-VN/settings.json'
import zhCNNotebook from './locales/vi-VN/notebook.json'
import zhCNUI from './locales/vi-VN/ui.json'
import zhCNQuiz from './locales/vi-VN/quiz.json'
import zhCNShortcuts from './locales/vi-VN/shortcuts.json'

import enUSCommon from './locales/en-US/common.json'
import enUSChat from './locales/en-US/chat.json'
import enUSSettings from './locales/en-US/settings.json'
import enUSNotebook from './locales/en-US/notebook.json'
import enUSUI from './locales/en-US/ui.json'
import enUSQuiz from './locales/en-US/quiz.json'
import enUSShortcuts from './locales/en-US/shortcuts.json'

const resources = {
  'vi-VN': {
    common: zhCNCommon,
    chat: zhCNChat,
    settings: zhCNSettings,
    notebook: zhCNNotebook,
    ui: zhCNUI,
    quiz: zhCNQuiz,
    shortcuts: zhCNShortcuts
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
  .use(initReactI18next) // 将 i18n 实例传递给 react-i18next
  .init({
    resources,
    lng: 'vi-VN', // 默认语言
    fallbackLng: 'vi-VN',
    interpolation: {
      escapeValue: false // React 已经默认转义了
    },
    react: {
      useSuspense: false
    }
  })

export default i18n
