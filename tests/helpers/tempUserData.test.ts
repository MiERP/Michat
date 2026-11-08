import { describe, expect, it, vi } from 'vitest'
import { stat } from 'fs/promises'
import { createTempUserData, closeAndRemove } from './tempUserData'

describe('tempUserData helper', () => {
  it('creates an isolated directory and removes it after closing the database', async () => {
    const dir = await createTempUserData('michat-helper')
    const closeDatabase = vi.fn()

    await closeAndRemove(dir, closeDatabase)

    expect(closeDatabase).toHaveBeenCalledTimes(1)
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries EBUSY errors with backoff before succeeding', async () => {
    const rm = vi.fn(async () => {
      if (rm.mock.calls.length < 3) {
        const error = new Error('resource busy') as NodeJS.ErrnoException
        error.code = 'EBUSY'
        throw error
      }
    })
    const closeDatabase = vi.fn()

    await closeAndRemove('C:/tmp/michat-retry', closeDatabase, {
      rm,
      retries: 3,
      delayMs: 0
    })

    expect(closeDatabase).toHaveBeenCalledTimes(1)
    expect(rm).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-transient errors', async () => {
    const rm = vi.fn(async () => {
      const error = new Error('bad path') as NodeJS.ErrnoException
      error.code = 'EINVAL'
      throw error
    })

    await expect(closeAndRemove('C:/tmp/michat-invalid', () => {}, { rm })).rejects.toThrow(
      'bad path'
    )
    expect(rm).toHaveBeenCalledTimes(1)
  })
})
