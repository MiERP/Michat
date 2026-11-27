import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  writeText: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  },
  clipboard: {
    writeText: state.writeText
  }
}))

import { registerClipboardHandlers } from '../src/main/ipc/clipboardHandlers'

describe('clipboard IPC handler', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.writeText.mockReset()
    registerClipboardHandlers()
  })

  function handler(): (event: unknown, args: unknown) => Promise<unknown> {
    const registered = state.handlers.get('clipboard:write-text')
    if (!registered) throw new Error('clipboard handler not registered')
    return registered as (event: unknown, args: unknown) => Promise<unknown>
  }

  it('writes the renderer text through Electron clipboard', async () => {
    await expect(handler()({}, { text: 'Nội dung cần sao chép' })).resolves.toEqual({
      success: true
    })
    expect(state.writeText).toHaveBeenCalledWith('Nội dung cần sao chép')
  })

  it('rejects empty and oversized payloads before writing', async () => {
    await expect(handler()({}, { text: '' })).rejects.toThrow('Validation failed')
    await expect(handler()({}, { text: 'x'.repeat(1_000_001) })).rejects.toThrow(
      'Validation failed'
    )
    expect(state.writeText).not.toHaveBeenCalled()
  })
})
