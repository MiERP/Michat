/**
 * Client for the isolated document parser (plan Task 15).
 *
 * The main process keeps one lazily started `utilityProcess` and talks to it
 * over the structured-clone message channel. A parse that hangs is killed, a
 * crashed worker is relaunched, and an exit rejects every in-flight request so
 * indexing fails with an actionable error instead of hanging forever.
 */

import { join } from 'path'
import * as electronModule from 'electron'
import Logger from '../../../shared/utils/logger'
import { FileParserService } from '../FileParserService'
import type { DocumentLoadResult, LoadOptions } from '../loaders/types'
import {
  PARSER_WORKER_SERVICE_NAME,
  isParserWorkerResponse,
  type ParserWorkerRequest
} from './parserProtocol'

/** Generous ceiling for 100 MB documents; a hung parse is killed after this. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** Stop relaunching after repeated crashes and surface the failure instead. */
const MAX_CONSECUTIVE_CRASHES = 3

export interface ParserWorkerProcessLike {
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  on(event: 'error', listener: (type: string, location: string, report: string) => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
  pid?: number
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
}

export type ParserWorkerFork = (modulePath: string) => ParserWorkerProcessLike

export interface ParserWorkerClientOptions {
  /** Absolute path to the built worker bundle. */
  modulePath?: string
  /** Injectable fork implementation, used by tests. */
  fork?: ParserWorkerFork
  timeoutMs?: number
  /** In-process parser used only outside Electron (unit tests, CLI smoke). */
  fallback?: (filePath: string, options?: LoadOptions) => Promise<DocumentLoadResult>
}

interface PendingRequest {
  resolve: (result: DocumentLoadResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function defaultModulePath(): string {
  // Both `electron-vite dev` and the packaged app place the main bundle in
  // <app>/out/main, with parserWorker.js emitted next to index.js.
  return join(__dirname, 'parserWorker.js')
}

export class ParserWorkerClient {
  private child: ParserWorkerProcessLike | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private nextRequestId = 1
  private consecutiveCrashes = 0
  private disposed = false
  private readonly options: ParserWorkerClientOptions

  constructor(options: ParserWorkerClientOptions = {}) {
    this.options = options
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async parseFile(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    if (this.disposed) {
      throw new Error('Document parser has been shut down')
    }

    const fork = this.resolveFork()
    if (!fork) {
      // Not running inside Electron (unit tests, Node smoke). Electron builds
      // never take this path: isolation is not silently downgraded there.
      const fallback =
        this.options.fallback ?? ((path, opts) => new FileParserService().parseFile(path, opts))
      return fallback(filePath, options)
    }

    if (this.consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES) {
      throw new Error(
        'The isolated document parser crashed repeatedly and has been disabled for this session. Restart MiChat and try a different file.'
      )
    }

    const child = this.ensureChild(fork)
    const id = this.nextRequestId++
    const request: ParserWorkerRequest = { id, filePath, options }

    return new Promise<DocumentLoadResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(
            `Document parsing timed out after ${Math.round(this.timeoutMs / 1000)}s; the file was rejected.`
          )
        )
        // A stuck parse holds the worker's event loop; restart it so the next
        // import is not stuck behind the same document.
        this.restart('parse timeout')
      }, this.timeoutMs)
      timer.unref?.()

      this.pending.set(id, { resolve, reject, timer })

      try {
        child.postMessage(request)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`Failed to start document parsing: ${(error as Error).message}`))
      }
    })
  }

  /** PID of the live parser process, or undefined when it is not running. */
  get workerPid(): number | undefined {
    return this.child?.pid
  }

  /** Terminates the worker. Pending requests reject with a shutdown error. */
  dispose(): void {
    this.disposed = true
    const child = this.child
    this.child = null
    this.rejectAll(new Error('Document parser was shut down before the parse finished'))
    if (child) {
      try {
        child.kill()
      } catch {
        // The process is already gone.
      }
    }
  }

  private resolveFork(): ParserWorkerFork | null {
    if (this.options.fork) return this.options.fork
    if (!process.versions.electron) return null

    const utilityProcess = (electronModule as Partial<typeof electronModule>).utilityProcess
    if (!utilityProcess || typeof utilityProcess.fork !== 'function') return null

    return (modulePath) =>
      utilityProcess.fork(modulePath, [], {
        serviceName: PARSER_WORKER_SERVICE_NAME,
        // Drain both pipes below; leaving them buffered would block the child.
        stdio: 'pipe'
      }) as unknown as ParserWorkerProcessLike
  }

  private ensureChild(fork: ParserWorkerFork): ParserWorkerProcessLike {
    if (this.child) return this.child

    const modulePath = this.options.modulePath ?? defaultModulePath()
    const child = fork(modulePath)
    this.child = child

    child.on('message', (message) => this.handleMessage(message))
    child.on('exit', (code) => {
      // An exit after dispose()/restart() is intentional; pending requests were
      // already rejected with an actionable error there.
      if (this.child !== child) {
        Logger.debug('ParserWorkerClient', `Parser process stopped (code ${code})`)
        return
      }
      this.child = null
      this.consecutiveCrashes += 1
      Logger.error(
        'ParserWorkerClient',
        `Parser process exited unexpectedly (code ${code}); ${this.pending.size} request(s) rejected`
      )
      this.rejectAll(
        new Error(
          `The document parser process stopped unexpectedly (exit code ${code}). The document was not imported; please retry.`
        )
      )
    })
    child.on('error', (type, location, report) => {
      Logger.error('ParserWorkerClient', `Parser process error (${type} at ${location}): ${report}`)
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      Logger.debug('ParserWorker', chunk.toString('utf8').trimEnd())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      Logger.warn('ParserWorker', chunk.toString('utf8').trimEnd())
    })

    Logger.info('ParserWorkerClient', `Document parser process started (${modulePath})`)
    return child
  }

  private handleMessage(message: unknown): void {
    if (!isParserWorkerResponse(message)) {
      Logger.warn('ParserWorkerClient', 'Ignoring malformed message from parser process')
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)

    if (message.ok) {
      this.consecutiveCrashes = 0
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error))
    }
  }

  private restart(reason: string): void {
    const child = this.child
    this.child = null
    this.rejectAll(new Error(`Document parser restarted: ${reason}`))
    if (child) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
