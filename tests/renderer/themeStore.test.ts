import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/main/config/defaults'
import { useThemeStore } from '../../src/renderer/src/store/themeStore'

describe('default theme', () => {
  it('ships light as both the built-in and the renderer initial theme', () => {
    expect(defaultSettings.theme).toBe('light')
    expect(useThemeStore.getState().theme).toBe('light')
  })
})
