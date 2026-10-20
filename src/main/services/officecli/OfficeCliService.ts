import { mkdirSync, readFileSync, rmSync } from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import Logger from '../../../shared/utils/logger'
import {
  OfficeCliDeliveryError,
  OfficeCliIndeterminateError,
  OfficeCliResident,
  runCli
} from './residentClient'
import { probeBinaryVersion, resolveOfficeCliBinary } from './resolveBinary'

export interface OfficeCliStatus {
  available: boolean
  version: string | null
  binaryPath: string | null
  error?: string
}

/** Parsed officecli JSON envelope. */
export interface OfficeCliResult<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: { error?: string; code?: string; suggestion?: string }
  warnings?: unknown[]
}

export interface OfficeCliViewResult {
  view: string
  content: string
}

export interface OfficeCliOutline {
  fileName: string
  /** Word documents. */
  paragraphs?: number
  tables?: number
  images?: number
  headings?: { line: number; text: string; style: string; level: number }[]
  headers?: string[]
  footers?: string[]
  /** PowerPoint presentations. */
  totalSlides?: number
  slides?: {
    index: number
    title: string
    textBoxes: number
    pictures: number
    oleObjects: number
  }[]
}

export interface OfficeCliTextElement {
  path: string
  type?: string
  text?: string
}

export interface OfficeCliTextSlide {
  index: number
  path: string
  texts: string[]
}

export interface OfficeCliTextResult {
  /** Word documents. */
  totalElements?: number
  elements?: OfficeCliTextElement[]
  /** PowerPoint presentations. */
  totalSlides?: number
  slides?: OfficeCliTextSlide[]
}

export interface OfficeCliIssues {
  count: number
  issues: {
    id: string
    type: string
    severity: string
    path: string
    message: string
    suggestion?: string
  }[]
}

export class OfficeCliService {
  /** Root for generated documents and engine state; set by the app at startup. */
  private userDataDir: string | null = null

  private binary: string | null = null
  private version: string | null = null
  private initialised = false
  private initError: string | undefined

  private readonly residents = new Map<string, OfficeCliResident>()
  /** Serialises operations per document so two callers never race one resident. */
  private readonly queues = new Map<string, Promise<unknown>>()

  get status(): OfficeCliStatus {
    return {
      available: this.binary !== null,
      version: this.version,
      binaryPath: this.binary,
      error: this.initError
    }
  }

  get available(): boolean {
    return this.binary !== null
  }

  /**
   * Point the service at the app's user-data directory. Tests leave this unset
   * and fall back to a temp directory.
   */
  setUserDataDir(dir: string): void {
    this.userDataDir = dir
  }

  private baseDir(): string {
    return this.userDataDir ?? join(os.tmpdir(), 'michat-officecli')
  }

  /** Directory where MiChat writes generated documents. */
  get workspaceDir(): string {
    const dir = join(this.baseDir(), 'documents')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Environment for every officecli process. Disables the upstream self-updater
   * and self-installer (which would mutate PATH and write to ~/.officecli) and
   * redirects runtime state into the app's own user-data directory.
   */
  private childEnv(): Record<string, string> {
    const stateDir = join(this.baseDir(), 'officecli')
    mkdirSync(stateDir, { recursive: true })
    return {
      OFFICECLI_SKIP_UPDATE: '1',
      OFFICECLI_NO_AUTO_INSTALL: '1',
      OFFICECLI_STATE_DIR: stateDir
    }
  }

  async initialize(): Promise<OfficeCliStatus> {
    if (this.initialised) return this.status
    this.initialised = true

    const binary = resolveOfficeCliBinary()
    if (!binary) {
      this.initError = 'officecli binary not found for this platform'
      Logger.warn('OfficeCli', this.initError)
      return this.status
    }

    const version = await probeBinaryVersion(binary)
    if (!version) {
      this.initError = 'officecli binary failed the --version probe'
      Logger.warn('OfficeCli', `${this.initError}: ${binary}`)
      return this.status
    }

    this.binary = binary
    this.version = version
    Logger.info('OfficeCli', `Ready: v${version} (${binary})`)
    return this.status
  }

  private requireBinary(): string {
    if (!this.binary) throw new Error(this.initError || 'officecli is not available')
    return this.binary
  }

  /** Run `fn` serialised against other work on the same document path. */
  private enqueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = filePath.toLowerCase()
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    this.queues.set(
      key,
      next.catch(() => undefined)
    )
    return next
  }

  private async residentFor(filePath: string): Promise<OfficeCliResident> {
    const key = filePath.toLowerCase()
    let resident = this.residents.get(key)
    if (!resident) {
      resident = new OfficeCliResident(filePath, this.requireBinary(), {
        env: this.childEnv()
      })
      this.residents.set(key, resident)
    }
    await resident.start()
    return resident
  }

  /** Create a blank document (type inferred from the extension). */
  async create(filePath: string, args: string[] = []): Promise<OfficeCliResult> {
    const binary = this.requireBinary()
    const res = await runCli(binary, ['create', filePath, ...args], {
      env: this.childEnv(),
      timeoutMs: 120000
    })
    return this.toResult(res.Stdout, res.ExitCode, res.Stderr)
  }

  async open(filePath: string): Promise<void> {
    await this.enqueue(filePath, async () => {
      await this.residentFor(filePath)
    })
  }

  /** Flush and release the document's resident. Safe to call when not open. */
  async closeDocument(filePath: string): Promise<void> {
    const key = filePath.toLowerCase()
    const resident = this.residents.get(key)
    this.residents.delete(key)
    if (!resident) return
    await this.enqueue(filePath, async () => {
      await resident.close()
    }).catch((error) => {
      Logger.warn('OfficeCli', `close failed for ${filePath}:`, error)
    })
  }

  /** Called on app quit: releases every resident so no edits are stranded in RAM. */
  async closeAll(): Promise<void> {
    const paths = [...this.residents.keys()]
    await Promise.all(paths.map((p) => this.closeDocument(p)))
  }

  /**
   * Forward one resident command. `item` uses the batch-item shape:
   *   { command: 'set', path: '/Sheet1/A1', props: { value: '10' } }
   */
  async run(
    filePath: string,
    item: Record<string, unknown>,
    asJson = true
  ): Promise<OfficeCliResult> {
    return this.enqueue(filePath, async () => {
      const resident = await this.residentFor(filePath)
      const res = await resident.send(item, asJson)
      return this.toResult(res.Stdout, res.ExitCode, res.Stderr)
    })
  }

  /** Apply many commands in one atomic round-trip. */
  async batch(
    filePath: string,
    items: Record<string, unknown>[],
    options: { bestEffort?: boolean; stopOnError?: boolean } = {}
  ): Promise<OfficeCliResult> {
    return this.enqueue(filePath, async () => {
      const resident = await this.residentFor(filePath)
      const res = await resident.batch(items, options)
      return this.toResult(res.Stdout, res.ExitCode, res.Stderr)
    })
  }

  async viewText(filePath: string): Promise<OfficeCliResult<OfficeCliTextResult>> {
    return (await this.run(filePath, {
      command: 'view',
      mode: 'text'
    })) as OfficeCliResult<OfficeCliTextResult>
  }

  async viewOutline(filePath: string): Promise<OfficeCliResult<OfficeCliOutline>> {
    return (await this.run(filePath, {
      command: 'view',
      mode: 'outline'
    })) as OfficeCliResult<OfficeCliOutline>
  }

  async viewStats(filePath: string): Promise<OfficeCliResult<Record<string, unknown>>> {
    return (await this.run(filePath, {
      command: 'view',
      mode: 'stats'
    })) as OfficeCliResult<Record<string, unknown>>
  }

  async viewIssues(filePath: string): Promise<OfficeCliResult<OfficeCliIssues>> {
    return (await this.run(filePath, {
      command: 'view',
      mode: 'issues'
    })) as OfficeCliResult<OfficeCliIssues>
  }

  async validate(filePath: string): Promise<OfficeCliResult> {
    return await this.run(filePath, { command: 'validate' })
  }

  /**
   * Render the document to a standalone HTML snapshot (assets inlined) and
   * return the HTML source. Screenshots are produced from this by rendering it
   * in Electron's own Chromium — the upstream `view screenshot` would shell out
   * to an external Chrome/Edge install.
   */
  async html(filePath: string): Promise<string> {
    const binary = this.requireBinary()
    const out = join(os.tmpdir(), `michat-officecli-${Date.now()}.html`)
    try {
      const res = await runCli(binary, ['view', filePath, 'html', '-o', out], {
        env: this.childEnv(),
        timeoutMs: 180000
      })
      if (res.ExitCode !== 0 && res.ExitCode !== 2) {
        throw new Error(res.Stderr.trim() || `view html failed with exit ${res.ExitCode}`)
      }
      return readFileSync(out, 'utf8')
    } finally {
      try {
        rmSync(out, { force: true })
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Template merge — replaces {{key}} placeholders using officecli's own merge
   * engine (covers docx, xlsx and pptx, including headers/footers/charts).
   * `merge` is not a resident verb, so it runs as a one-shot CLI call.
   */
  async merge(
    templatePath: string,
    outputPath: string,
    data: Record<string, unknown>
  ): Promise<OfficeCliResult> {
    const binary = this.requireBinary()
    mkdirSync(dirname(outputPath), { recursive: true })
    const res = await runCli(
      binary,
      ['merge', templatePath, outputPath, '--data', JSON.stringify(data), '--json'],
      { env: this.childEnv(), timeoutMs: 180000 }
    )
    return this.toResult(res.Stdout, res.ExitCode, res.Stderr)
  }

  /**
   * Return officecli's embedded skill documentation: the catalogue when no name
   * is given, otherwise that skill's SKILL.md. Skills ship inside the binary.
   */
  async loadSkill(name?: string): Promise<string> {
    const binary = this.requireBinary()
    const args = name ? ['load_skill', name] : ['load_skill']
    const res = await runCli(binary, args, { env: this.childEnv(), timeoutMs: 60000 })
    return (res.Stdout || res.Stderr || '').trim()
  }

  /** Save (flush) without releasing the resident. */
  async save(filePath: string): Promise<OfficeCliResult> {
    return await this.run(filePath, { command: 'save' })
  }

  private toResult(stdout: string, exitCode: number, stderr: string): OfficeCliResult {
    const text = (stdout || '').trim()
    if (!text) {
      return {
        success: exitCode === 0 || exitCode === 2,
        message: stderr.trim() || undefined
      }
    }
    try {
      const parsed = JSON.parse(text) as OfficeCliResult
      if (typeof parsed.success === 'boolean') return parsed
      // Some commands emit a bare array/object (e.g. dump) rather than an envelope.
      return { success: exitCode === 0 || exitCode === 2, data: parsed as unknown }
    } catch {
      return {
        success: exitCode === 0 || exitCode === 2,
        message: text,
        error: exitCode === 0 || exitCode === 2 ? undefined : { error: stderr.trim() || text }
      }
    }
  }
}

export { OfficeCliDeliveryError, OfficeCliIndeterminateError }
export const officeCliService = new OfficeCliService()
