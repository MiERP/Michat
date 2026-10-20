import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { realpathSync } from 'fs'
import net from 'net'
import { resolve as resolvePath } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Minimal client for officecli's resident named-pipe protocol.
 *
 * Implemented from the protocol contract documented by the upstream Node SDK
 * (github.com/iOfficeAI/OfficeCLI, sdk/node/index.js, Apache-2.0):
 *   - pipe name    : "officecli-" + SHA256(canonical path)[:16]; on Windows and
 *                    macOS the canonical path is upper-cased before hashing.
 *                    Second pipe "<name>-ping" answers liveness probes even
 *                    while the main pipe is busy.
 *   - framing      : one request line + one response line, UTF-8, '\n' terminated.
 *                    One connection carries exactly one command.
 *   - request      : { Command, Args?, Props?, Json? }
 *   - response     : { ExitCode, Stdout, Stderr }
 *
 * Deliberate differences from the upstream SDK, tailored for a desktop app:
 *   - No auto-install / bundled-binary / network code paths.
 *   - A bounded read timeout on the reply. Upstream blocks forever by design;
 *     a UI process must not. Because a mutation may already have been applied
 *     before the reply was lost, a read timeout raises IndeterminateError and
 *     callers must recover by close()+open(), never by re-sending.
 *   - Retries re-attempt the CONNECT only (the command has not run yet).
 */

const CONNECT_TIMEOUT_MS = 30000
const MAX_CONNECT_RETRIES = 3
const DEFAULT_READ_TIMEOUT_MS = 120000
const OPEN_IDLE_SECONDS = 12 * 60

/** Transport-level failure: the command did not reach the resident. Safe to retry. */
export class OfficeCliDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfficeCliDeliveryError'
  }
}

/**
 * The command was written to the pipe but no reply arrived. Its outcome is
 * UNKNOWN — it may or may not have been applied. Never re-send.
 */
export class OfficeCliIndeterminateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfficeCliIndeterminateError'
  }
}

export interface OfficeCliResponse {
  ExitCode: number
  Stdout: string
  Stderr: string
}

export interface SendOptions {
  readTimeoutMs?: number
  connectTimeoutMs?: number
}

function canonicalPath(filePath: string): string {
  const resolved = resolvePath(filePath)
  if (process.platform === 'win32') {
    try {
      return realpathSync.native(resolved)
    } catch {
      return resolved
    }
  }
  return resolved
}

export function pipePaths(filePath: string): [string, string] {
  let full = canonicalPath(filePath)
  if (process.platform === 'win32' || process.platform === 'darwin') full = full.toUpperCase()
  const hash = createHash('sha256').update(full, 'utf8').digest('hex').toUpperCase().slice(0, 16)
  const name = `officecli-${hash}`
  if (process.platform === 'win32') {
    return [`\\\\.\\pipe\\${name}`, `\\\\.\\pipe\\${name}-ping`]
  }
  const tmp = process.env.TMPDIR || '/tmp'
  const base = `${tmp}/CoreFxPipe_${name}`
  return [base, `${base}-ping`]
}

function decodeLine(raw: Buffer): string {
  let text = raw.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.endsWith('\n')) text = text.slice(0, -1)
  if (text.endsWith('\r')) text = text.slice(0, -1)
  return text
}

function sendOnce(
  sockPath: string,
  line: Buffer,
  connectTimeoutMs: number,
  readTimeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false
    let written = false
    const chunks: Buffer[] = []
    const socket = net.createConnection(sockPath)

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(connectTimer)
      clearTimeout(readTimer)
      socket.destroy()
      fn()
    }

    const connectTimer = setTimeout(() => {
      finish(() =>
        reject(new OfficeCliDeliveryError(`connect timed out after ${connectTimeoutMs}ms`))
      )
    }, connectTimeoutMs)

    let readTimer: NodeJS.Timeout = setTimeout(() => undefined, 0)
    clearTimeout(readTimer)

    socket.once('connect', () => {
      clearTimeout(connectTimer)
      written = true
      socket.write(line)
      readTimer = setTimeout(() => {
        finish(() =>
          reject(
            new OfficeCliIndeterminateError(
              `no reply within ${readTimeoutMs}ms after the command was sent`
            )
          )
        )
      }, readTimeoutMs)
    })

    socket.on('data', (d: Buffer) => {
      chunks.push(d)
      if (d.length > 0 && d[d.length - 1] === 0x0a) {
        finish(() => resolve(Buffer.concat(chunks)))
      }
    })

    socket.once('end', () => {
      finish(() => resolve(Buffer.concat(chunks)))
    })

    socket.once('error', (err: Error) => {
      finish(() =>
        reject(
          new OfficeCliDeliveryError(
            `${written ? 'socket error after write' : 'connect failed'}: ${err.message}`
          )
        )
      )
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Forward one request. Only the CONNECT is retried — after the command has been
 * written, a failure is indeterminate and is surfaced as such.
 */
async function rpc(
  sockPath: string,
  req: Record<string, unknown>,
  options: SendOptions & { retries?: number } = {}
): Promise<OfficeCliResponse> {
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS
  const retries = options.retries ?? MAX_CONNECT_RETRIES
  const line = Buffer.from(`${JSON.stringify(req)}\n`, 'utf8')

  let raw: Buffer | null = null
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await sendOnce(sockPath, line, connectTimeoutMs, readTimeoutMs)
      break
    } catch (error) {
      if (error instanceof OfficeCliIndeterminateError) throw error
      if (attempt >= retries) {
        throw new OfficeCliDeliveryError(
          `resident unreachable (pipe busy or not running): ${(error as Error).message}`
        )
      }
      await sleep(50 * (attempt + 1))
    }
  }

  const text = decodeLine(raw)
  if (!text.trim()) {
    throw new OfficeCliIndeterminateError(
      'resident closed the connection without a reply (it may have crashed mid-command)'
    )
  }
  return JSON.parse(text) as OfficeCliResponse
}

export interface OfficeCliResidentOptions {
  readTimeoutMs?: number
  /** Extra environment for the process that starts the resident. */
  env?: Record<string, string>
}

/**
 * A handle to the resident that owns one document. Constructing it does not
 * start anything; call start()/ensureStarted() first.
 */
export class OfficeCliResident {
  readonly filePath: string
  private readonly binary: string
  private readonly options: OfficeCliResidentOptions
  private readonly mainPipe: string
  private readonly pingPipe: string

  constructor(filePath: string, binary: string, options: OfficeCliResidentOptions = {}) {
    this.filePath = canonicalPath(filePath)
    this.binary = binary
    this.options = options
    const [main, ping] = pipePaths(this.filePath)
    this.mainPipe = main
    this.pingPipe = ping
  }

  /** True when a resident is alive AND serving this exact file. */
  async alive(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await rpc(
        this.pingPipe,
        { Command: '__ping__' },
        {
          connectTimeoutMs: timeoutMs,
          readTimeoutMs: timeoutMs,
          retries: 0
        }
      )
      const served = (res.Stdout || '').trim()
      if (!served) return false
      const a = resolvePath(served)
      const b = resolvePath(this.filePath)
      return process.platform === 'win32' || process.platform === 'darwin'
        ? a.toLowerCase() === b.toLowerCase()
        : a === b
    } catch {
      return false
    }
  }

  /**
   * Start (or reuse) the resident for this document. Idempotent: `officecli open`
   * replaces a stale resident and leaves a healthy one alone.
   */
  async start(): Promise<void> {
    if (await this.alive()) {
      await this.setIdleTimeout(OPEN_IDLE_SECONDS)
      return
    }
    try {
      await execFileAsync(this.binary, ['open', this.filePath], {
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, ...(this.options.env || {}) }
      })
    } catch (error) {
      throw new OfficeCliDeliveryError(
        `could not start resident for ${this.filePath}: ${(error as Error).message}`
      )
    }
    await this.setIdleTimeout(OPEN_IDLE_SECONDS)
  }

  /** Best-effort: a failure here is not fatal, the resident keeps its schedule. */
  async setIdleTimeout(seconds: number): Promise<void> {
    try {
      await rpc(
        this.pingPipe,
        { Command: '__set-idle-timeout__', Args: { seconds: String(seconds) } },
        { connectTimeoutMs: 2000, readTimeoutMs: 5000, retries: 0 }
      )
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Forward one command in batch-item shape:
   *   { command: 'set', path: '/Sheet1/A1', props: { value: '10' } }
   * Every key other than `command`/`op`/`props` is forwarded verbatim as an
   * argument (stringified), mirroring the resident's string dictionary.
   */
  async send(
    item: Record<string, unknown>,
    asJson = true,
    options: SendOptions = {}
  ): Promise<OfficeCliResponse> {
    const command = (item.command ?? item.op) as string | undefined
    if (!command) throw new OfficeCliDeliveryError("send(item): item needs a 'command' key")

    const args: Record<string, string> = {}
    for (const key of Object.keys(item)) {
      if (key === 'command' || key === 'op' || key === 'props') continue
      const value = item[key]
      if (value !== null && value !== undefined) args[key] = String(value)
    }

    const props = item.props as Record<string, unknown> | undefined
    const propsMapped: Record<string, string> | undefined = props
      ? Object.fromEntries(
          Object.entries(props)
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => [k, String(v)])
        )
      : undefined

    const req: Record<string, unknown> = { Command: command, Json: asJson }
    if (Object.keys(args).length > 0) req.Args = args
    if (propsMapped && Object.keys(propsMapped).length > 0) req.Props = propsMapped

    return rpc(this.mainPipe, req, {
      readTimeoutMs: options.readTimeoutMs ?? this.options.readTimeoutMs
    })
  }

  /** Apply many commands in one round-trip (atomic unless bestEffort). */
  async batch(
    items: Record<string, unknown>[],
    options: { force?: boolean; stopOnError?: boolean; bestEffort?: boolean } & SendOptions = {}
  ): Promise<OfficeCliResponse> {
    return this.send(
      {
        command: 'batch',
        batchJson: JSON.stringify(items),
        force: options.force ?? true,
        stopOnError: options.stopOnError ?? false,
        bestEffort: options.bestEffort ?? false
      },
      true,
      options
    )
  }

  /**
   * Flush and release the document. A missing ack still means "closed" unless the
   * resident proves it is still alive.
   */
  async close(): Promise<void> {
    try {
      await rpc(this.pingPipe, { Command: '__close__' }, { readTimeoutMs: 60000 })
    } catch (error) {
      if (await this.alive()) throw error
    }
  }
}

/** Run a one-shot CLI command (for verbs the resident pipe does not serve). */
export async function runCli(
  binary: string,
  args: string[],
  options: { timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<OfficeCliResponse> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout: options.timeoutMs ?? 120000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) }
    })
    return { ExitCode: 0, Stdout: stdout, Stderr: stderr }
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message: string }
    return {
      ExitCode: typeof err.code === 'number' ? err.code : 1,
      Stdout: err.stdout ?? '',
      Stderr: err.stderr ?? err.message
    }
  }
}
