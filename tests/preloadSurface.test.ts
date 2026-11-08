import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electron.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electron.invoke,
    send: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  }
}))

async function loadPreload(): Promise<void> {
  await import('../src/preload/index')
}

describe('preload surface', () => {
  beforeEach(() => {
    vi.resetModules()
    electron.exposeInMainWorld.mockClear()
    electron.invoke.mockClear()
    Object.defineProperty(process, 'contextIsolated', {
      value: true,
      configurable: true
    })
  })

  it('exposes only the curated api object', async () => {
    await loadPreload()

    expect(electron.exposeInMainWorld).toHaveBeenCalledTimes(1)
    const [name, api] = electron.exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>]

    expect(name).toBe('api')
    expect(api.ipcRenderer).toBeUndefined()
    expect(api.electron).toBeUndefined()
    expect(typeof (api.shortcuts as Record<string, unknown>).getAll).toBe('function')
  })

  it('routes shortcut calls through the curated shortcuts API', async () => {
    await loadPreload()
    const [, api] = electron.exposeInMainWorld.mock.calls[0] as [
      string,
      { shortcuts: { update: (action: string, accelerator: string) => Promise<void> } }
    ]

    await api.shortcuts.update('newChat', 'Ctrl+N')

    expect(electron.invoke).toHaveBeenCalledWith('shortcuts:update', 'newChat', 'Ctrl+N')
  })

  it('fails closed when context isolation is disabled', async () => {
    Object.defineProperty(process, 'contextIsolated', {
      value: false,
      configurable: true
    })

    await expect(loadPreload()).rejects.toThrow('context isolation')
  })
})
