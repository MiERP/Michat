import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => userDataDir }
}))

import { closeDatabase, getDatabase, getSqlite, initDatabase } from '../src/main/db'

describe('database connection lifecycle', () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'michat-lifecycle-'))
  })

  afterEach(async () => {
    // Also release a leaked connection when the regression assertion fails.
    const connection = getSqlite()
    closeDatabase()
    if (connection?.open) connection.close()
    await rm(userDataDir, { recursive: true, force: true })
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
