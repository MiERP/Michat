/**
 * Document parser utility process (plan Task 15).
 *
 * Every document loader (PDF, DOCX, PPTX, XLSX, HTML, Markdown) runs here
 * instead of in the Electron main process, so a crafted document can only
 * crash or exhaust memory in a disposable child process.
 *
 * The entry deliberately does not import `electron`: the port is reached
 * through `process.parentPort`, which lets a plain Node smoke test require the
 * built bundle with a stub port and exercise the real loader code.
 */

import { handleParserRequest, serializeParserError } from '../services/import/parserProtocol'
import Logger from '../../shared/utils/logger'

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

if (parentPort) {
  parentPort.on('message', (event) => {
    void (async () => {
      const data = event?.data as { id?: unknown } | undefined
      try {
        const response = await handleParserRequest(data as never)
        parentPort.postMessage(response)
      } catch (error) {
        // handleParserRequest already catches parse failures; this covers a
        // broken request payload or a failure while serializing the response.
        const id = typeof data?.id === 'number' ? data.id : 0
        parentPort.postMessage({ id, ok: false, error: serializeParserError(error) })
      }
    })()
  })

  process.on('unhandledRejection', (reason) => {
    Logger.error('ParserWorker', 'Unhandled rejection in parser process:', reason)
  })
}
