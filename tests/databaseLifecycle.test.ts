import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempUserData, closeAndRemove } from './helpers/tempUserData'

let userDataDir = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => userDataDir }
}))

import { closeDatabase, getDatabase, getSqlite, initDatabase } from '../src/main/db'

describe('database connection lifecycle', () => {
  beforeEach(async () => {
    userDataDir = await createTempUserData('michat-lifecycle')
  })

  afterEach(async () => {
    if (userDataDir) {
      await closeAndRemove(userDataDir, () => {
        const connection = getSqlite()
        closeDatabase()
        // Also release a leaked connection when the regression assertion fails.
        if (connection?.open) connection.close()
      })
    }
  })

  it('enforces foreign keys and secure deletion', () => {
    initDatabase()
    const sqlite = getSqlite()!

    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('secure_delete', { simple: true })).toBe(1)
  })

  it('closes a reopened database and invalidates its ORM handle', () => {
    initDatabase()
    closeDatabase()
    initDatabase()
    const reopened = getSqlite()!
    closeDatabase()
    expect(reopened.open).toBe(false)
    expect(getSqlite()).toBeNull()
    expect(() => getDatabase()).toThrow('not initialized')
  })
})
