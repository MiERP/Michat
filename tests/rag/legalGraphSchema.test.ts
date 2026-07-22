import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

describe('legal graph migration', () => {
  beforeEach(async () => {
    userDataDir = join(tmpdir(), `michat-legal-graph-schema-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(userDataDir, { recursive: true })
  })

  afterEach(async () => {
    const dbModule = await import('../../src/main/db')
    dbModule.closeDatabase()
    await rm(userDataDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('creates graph tables and bidirectional relation indexes', async () => {
    const dbModule = await import('../../src/main/db')
    dbModule.initDatabase()
    dbModule.runMigrations()

    const objects = dbModule
      .getSqlite()!
      .prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'legal_%' OR name LIKE 'idx_legal_%'")
      .all() as Array<{ name: string; type: string }>

    expect(objects).toEqual(
      expect.arrayContaining([
        { name: 'legal_nodes', type: 'table' },
        { name: 'legal_relations', type: 'table' },
        { name: 'legal_extraction_jobs', type: 'table' },
        { name: 'idx_legal_relations_source_type', type: 'index' },
        { name: 'idx_legal_relations_target_type', type: 'index' }
      ])
    )
  })
})
