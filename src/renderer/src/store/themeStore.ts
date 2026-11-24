import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  isLoading: boolean
  setTheme: (theme: Theme) => Promise<void>
  toggleTheme: () => Promise<void>
  initTheme: () => Promise<void>
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  // Set up the listener (only once)
  if (typeof window !== 'undefined' && window.api) {
    window.api.settings.onSettingsChange((newSettings) => {
      const newTheme = newSettings.theme
      set({ theme: newTheme })
      // Update the class on the HTML element
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      console.log('[ThemeStore] Theme changed to:', newTheme)
    })
  }

  return {
    theme: 'dark',
    isLoading: true,

    initTheme: async () => {
      try {
        const theme = await window.api.settings.get('theme')
        set({ theme, isLoading: false })
        // Update the class on the HTML element
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      } catch (error) {
        console.error('Failed to load theme:', error)
        set({ isLoading: false })
      }
    },

    setTheme: async (theme) => {
      try {
        // Update the UI first
        set({ theme })
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
        // Then persist to electron-store
        await window.api.settings.set('theme', theme)
      } catch (error) {
        console.error('Failed to save theme:', error)
      }
    },

    toggleTheme: async () => {
      const currentTheme = get().theme
      const newTheme = currentTheme === 'light' ? 'dark' : 'light'
      await get().setTheme(newTheme)
    }
  }
})
