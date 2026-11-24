import { create } from 'zustand'

export type Language = 'vi-VN' | 'en-US'

interface I18nStore {
  language: Language
  isLoading: boolean
  changeLanguage: (language: Language) => Promise<void>
  initLanguage: () => Promise<void>
}

export const useI18nStore = create<I18nStore>((set) => {
  // Set up the listener (only once)
  if (typeof window !== 'undefined' && window.api) {
    window.api.settings.onSettingsChange((newSettings) => {
      const newLanguage = newSettings.language
      set({ language: newLanguage })
      console.log('[I18nStore] Language changed to:', newLanguage)
    })
  }

  return {
    language: 'en-US',
    isLoading: true,

    initLanguage: async () => {
      try {
        const language = await window.api.settings.get('language')
        set({ language: language || 'en-US', isLoading: false })
      } catch (error) {
        console.error('Failed to load language:', error)
        set({ isLoading: false })
      }
    },

    changeLanguage: async (language) => {
      try {
        // Update the UI first
        set({ language })
        // Then persist to electron-store
        await window.api.settings.set('language', language)
      } catch (error) {
        console.error('Failed to save language:', error)
      }
    }
  }
})
