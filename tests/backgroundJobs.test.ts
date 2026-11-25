import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTempUserData, closeAndRemove } from './helpers/tempUserData'
import type { Database } from '../../src/main/db'
import type { BackgroundJobService } from '../../src/main/services/BackgroundJobService'

type DbModule = typeof import('../../src/main/db')
type SchemaModule = typeof import('../../src/main/db/schema')

type LinkServiceStub = {
  generateLinksForDocument: (documentId: string) => Promise<number>
  decayLinks: () => number
}

type BackgroundJobsContext = {
  dbModule: DbModule
  schema: SchemaModule
  db: Database
  notebookId: string
  createService: (linkService?: LinkServiceStub | null) => BackgroundJobService
}

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir
  }
}))

describe('BackgroundJobService durability', () => {
  let context: BackgroundJobsContext | undefined

  beforeEach(async () => {
    userDataDir = await createTempUserData('michat-jobs')

    const dbModule = await import('../../src/main/db')
    const schema = await import('../../src/main/db/schema')
    const { BackgroundJobService } = await import('../../src/main/services/BackgroundJobService')

    dbModule.initDatabase()
    dbModule.runMigrations()
    dbModule.initExtensions()

    const db = dbModule.getDatabase()
    const notebookId = `notebook_${Math.random().toString(16).slice(2)}`
    db.insert(schema.notebooks)
      .values({ id: notebookId, title: 'Jobs Test', createdAt: new Date(), updatedAt: new Date() })
      .run()

    const createService = (linkService: LinkServiceStub | null = null): BackgroundJobService =>
      new BackgroundJobService(
        {} as never,
        (linkService ?? { generateLinksForDocument: async () => 0, decayLinks: () => 0 }) as never,
        undefined,
        0, // idle gate off
        0 // heavy cooldown off
      )

    context = { dbModule, schema, db, notebookId, createService }
  })

  afterEach(async () => {
    if (userDataDir) {
      await closeAndRemove(userDataDir, () => context?.dbModule.closeDatabase())
    }
    vi.resetModules()
  })

  it('deduplicates identical pending jobs', () => {
    const { createService, notebookId } = context!
    const service = createService()

    const first = service.enqueueDecayLinks(notebookId)
    const second = service.enqueueDecayLinks(notebookId)

    expect(second).toBe(first)
    expect(service.getPendingCount()).toBe(1)
  })

  it('recovers jobs stuck in running state from a previous crash', async () => {
    const { db, schema, createService, notebookId } = context!
    db.insert(schema.backgroundJobs)
      .values({
        id: 'job_stale',
        jobType: 'decay-links',
        notebookId,
        status: 'running',
        attempts: 1,
        maxAttempts: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date()
      })
      .run()

    const service = createService()
    service.start()
    service.stop()

    const { eq } = await import('drizzle-orm')
    const row = db
      .select()
      .from(schema.backgroundJobs)
      .where(eq(schema.backgroundJobs.id, 'job_stale'))
      .get()

    expect(row.status).toBe('pending')
    expect(row.startedAt).toBeNull()
    expect(row.lastError).toBe('recovered after restart')
  })

  it('applies retry backoff on failure and skips until retryAt elapses', async () => {
    const { db, schema, createService, notebookId } = context!
    const service = createService({
      generateLinksForDocument: async () => {
        throw new Error('boom')
      },
      decayLinks: () => 0
    })

    const jobId = service.enqueue({
      jobType: 'generate-links',
      documentId: 'doc_x',
      notebookId,
      maxAttempts: 2
    })
    await service.tick()

    const { eq } = await import('drizzle-orm')
    let row = db
      .select()
      .from(schema.backgroundJobs)
      .where(eq(schema.backgroundJobs.id, jobId))
      .get()
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.retryAt.getTime()).toBeGreaterThan(Date.now())

    // Tick ngay sau đó phải bỏ qua vì chưa tới retryAt (backoff)
    await service.tick()
    row = db.select().from(schema.backgroundJobs).where(eq(schema.backgroundJobs.id, jobId)).get()
    expect(row.attempts).toBe(1)
  })

  it('prunes completed jobs older than the retention window', () => {
    const { db, schema, createService, notebookId } = context!
    db.insert(schema.backgroundJobs)
      .values({
        id: 'job_old_done',
        jobType: 'decay-links',
        notebookId,
        status: 'done',
        attempts: 1,
        maxAttempts: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000)
      })
      .run()
    db.insert(schema.backgroundJobs)
      .values({
        id: 'job_recent_done',
        jobType: 'decay-links',
        notebookId,
        status: 'done',
        attempts: 1,
        maxAttempts: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date()
      })
      .run()

    const service = createService()
    service.start()
    service.stop()

    const rows = db.select().from(schema.backgroundJobs).all()
    expect(rows.some((row) => row.id === 'job_old_done')).toBe(false)
    expect(rows.some((row) => row.id === 'job_recent_done')).toBe(true)
  })

  it('pause stops new jobs until resumed', async () => {
    const { createService, notebookId } = context!
    const service = createService()

    service.enqueueDecayLinks(notebookId)
    service.pause()
    await service.tick()
    expect(service.getPendingCount()).toBe(1)

    service.resume()
    await service.tick()
    expect(service.getPendingCount()).toBe(0)
  })

  it('waitForActiveJob resolves only after the active job settles', async () => {
    const { createService, notebookId } = context!
    let resolveRun: (() => void) | null = null
    const service = createService({
      generateLinksForDocument: () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve
        }),
      decayLinks: () => 0
    })

    service.enqueue({
      jobType: 'generate-links',
      documentId: 'doc_wait',
      notebookId,
      maxAttempts: 2
    })

    const tickPromise = service.tick()
    await new Promise((resolve) => setTimeout(resolve, 20)) // job đã vào running

    let settled = false
    const waitPromise = service.waitForActiveJob().then(() => {
      settled = true
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled).toBe(false)

    resolveRun!()
    await Promise.all([tickPromise, waitPromise])
    expect(settled).toBe(true)
  })

  it('waitForActiveJob reports a timeout while the job is still running', async () => {
    const { createService, notebookId } = context!
    let resolveRun: (() => void) | null = null
    const service = createService({
      generateLinksForDocument: () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve
        }),
      decayLinks: () => 0
    })

    service.enqueue({
      jobType: 'generate-links',
      documentId: 'doc_timeout',
      notebookId,
      maxAttempts: 2
    })

    const tickPromise = service.tick()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(await service.waitForActiveJob(10)).toBe(false)

    resolveRun!()
    await tickPromise
    expect(await service.waitForActiveJob()).toBe(true)
  })

  it('shutdown waits for the active job to settle', async () => {
    const { createService, notebookId } = context!
    let resolveRun: (() => void) | null = null
    const service = createService({
      generateLinksForDocument: () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve
        }),
      decayLinks: () => 0
    })

    service.enqueue({
      jobType: 'generate-links',
      documentId: 'doc_y',
      notebookId,
      maxAttempts: 2
    })

    const tickPromise = service.tick()
    await new Promise((resolve) => setTimeout(resolve, 20)) // job đã vào running
    const shutdownPromise = service.shutdown()

    let shutdownDone = false
    void shutdownPromise.then(() => {
      shutdownDone = true
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(shutdownDone).toBe(false)

    resolveRun!()
    await Promise.all([shutdownPromise, tickPromise])
    expect(shutdownDone).toBe(true)
  })
})
