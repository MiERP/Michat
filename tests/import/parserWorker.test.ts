import { EventEmitter } from 'events'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ParserWorkerClient,
  type ParserWorkerProcessLike
} from '../../src/main/services/import/ParserWorkerClient'
import {
  handleParserRequest,
  isParserWorkerRequest,
  isParserWorkerResponse,
  type ParserWorkerRequest
} from '../../src/main/services/import/parserProtocol'

class FakeParserProcess extends EventEmitter implements ParserWorkerProcessLike {
  readonly pid = 4242
  readonly stdout = null
  readonly stderr = null
  readonly messages: ParserWorkerRequest[] = []
  killed = false

  postMessage(message: unknown): void {
    this.messages.push(message as ParserWorkerRequest)
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'michat-parser-worker-'))
})

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const loadedResult = {
  content: 'Parsed by the worker',
  mimeType: 'text/markdown',
  metadata: { characterCount: 20 }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('parser worker protocol', () => {
  it('recognizes valid requests and responses', () => {
    expect(isParserWorkerRequest({ id: 1, filePath: '/tmp/a.md' })).toBe(true)
    expect(isParserWorkerRequest({ id: 1 })).toBe(false)
    expect(isParserWorkerRequest(null)).toBe(false)

    expect(isParserWorkerResponse({ id: 1, ok: true, result: loadedResult })).toBe(true)
    expect(isParserWorkerResponse({ id: 1, ok: false, error: 'boom' })).toBe(true)
    expect(isParserWorkerResponse({ id: 1, ok: false })).toBe(false)
    expect(isParserWorkerResponse('nope')).toBe(false)
  })

  it('parses a document and returns a serializable result', async () => {
    const filePath = join(directory, 'note.md')
    await writeFile(filePath, '# Heading\n\nLocal-first body.', 'utf8')

    const response = await handleParserRequest({ id: 7, filePath })

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result.mimeType).toBe('text/markdown')
      expect(response.result.content).toContain('Local-first body.')
      expect(response.result.structure?.sections?.[0]?.title).toBe('Heading')
    }
  })

  it('rejects directories and unsupported files without throwing', async () => {
    const folder = join(directory, 'folder')
    await mkdir(folder)
    expect(await handleParserRequest({ id: 1, filePath: folder })).toMatchObject({
      id: 1,
      ok: false
    })

    const executable = join(directory, 'payload.exe')
    await writeFile(executable, 'MZ')
    const response = await handleParserRequest({ id: 2, filePath: executable })
    expect(response).toMatchObject({ id: 2, ok: false })
    if (!response.ok) expect(response.error).toMatch(/unsupported file type/i)
  })

  it('answers malformed requests with an error response instead of crashing', async () => {
    const response = await handleParserRequest({ filePath: '' } as ParserWorkerRequest)
    expect(response).toMatchObject({ ok: false })
  })
})

describe('ParserWorkerClient', () => {
  it('round-trips a parse request through the forked process', async () => {
    const child = new FakeParserProcess()
    const client = new ParserWorkerClient({ fork: () => child, timeoutMs: 5_000 })

    const promise = client.parseFile('/documents/a.md')
    await flush()

    expect(child.messages).toHaveLength(1)
    expect(client.workerPid).toBe(4242)
    child.emit('message', { id: child.messages[0].id, ok: true, result: loadedResult })

    await expect(promise).resolves.toMatchObject({ content: 'Parsed by the worker' })
    client.dispose()
    expect(child.killed).toBe(true)
  })

  it('rejects in-flight parses when the parser process exits', async () => {
    const child = new FakeParserProcess()
    const client = new ParserWorkerClient({ fork: () => child, timeoutMs: 5_000 })

    const promise = client.parseFile('/documents/b.pdf')
    await flush()
    child.emit('exit', 1)

    await expect(promise).rejects.toThrow(/stopped unexpectedly \(exit code 1\)/)
    expect(client.workerPid).toBeUndefined()
  })

  it('kills a hung parse and rejects it with a timeout', async () => {
    const child = new FakeParserProcess()
    const client = new ParserWorkerClient({ fork: () => child, timeoutMs: 20 })

    await expect(client.parseFile('/documents/hang.pdf')).rejects.toThrow(/timed out/i)
    expect(child.killed).toBe(true)
  })

  it('stops relaunching after repeated crashes and surfaces the failure', async () => {
    const children: FakeParserProcess[] = []
    const client = new ParserWorkerClient({
      fork: () => {
        const child = new FakeParserProcess()
        children.push(child)
        return child
      },
      timeoutMs: 5_000
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const promise = client.parseFile('/documents/crash.pdf')
      await flush()
      children[children.length - 1].emit('exit', 133)
      await expect(promise).rejects.toThrow(/stopped unexpectedly/)
    }

    await expect(client.parseFile('/documents/crash.pdf')).rejects.toThrow(/crashed repeatedly/)
  })

  it('falls back to in-process parsing only when Electron is unavailable', async () => {
    const client = new ParserWorkerClient({
      fallback: async () => loadedResult
    })

    await expect(client.parseFile('/documents/fallback.md')).resolves.toMatchObject(loadedResult)
  })
})
