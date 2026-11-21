/**
 * Message protocol between the main process and the isolated document parser
 * utility process.
 *
 * Only JSON-serializable payloads cross the process boundary: `DocumentLoadResult`
 * contains plain strings, numbers and arrays produced by the loaders.
 */

import { stat } from 'fs/promises'
import { FileParserService } from '../FileParserService'
import { MAX_IMPORT_BYTES } from './fileValidation'
import type { DocumentLoadResult, LoadOptions } from '../loaders/types'

export const PARSER_WORKER_SERVICE_NAME = 'MiChat Document Parser'

export interface ParserWorkerRequest {
  id: number
  filePath: string
  options?: LoadOptions
}

export type ParserWorkerResponse =
  | { id: number; ok: true; result: DocumentLoadResult }
  | { id: number; ok: false; error: string }

export function isParserWorkerRequest(value: unknown): value is ParserWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ParserWorkerRequest>
  return (
    typeof candidate.id === 'number' &&
    Number.isFinite(candidate.id) &&
    typeof candidate.filePath === 'string' &&
    candidate.filePath.length > 0
  )
}

export function isParserWorkerResponse(value: unknown): value is ParserWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ParserWorkerResponse>
  if (typeof candidate.id !== 'number') return false
  if (candidate.ok === true) return 'result' in candidate
  if (candidate.ok === false) return typeof candidate.error === 'string'
  return false
}

export function serializeParserError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown parser error'
  }
}

/**
 * Re-validates the file inside the worker so a file swapped between the main
 * process validation and the parse request cannot smuggle a larger or
 * unsupported document past the import policy (TOCTOU).
 */
export async function assertWorkerParseTarget(filePath: string): Promise<void> {
  const stats = await stat(filePath)
  if (!stats.isFile()) {
    throw new Error('Document parser requires a regular file')
  }
  if (stats.size > MAX_IMPORT_BYTES) {
    throw new Error(`File is too large (${stats.size} bytes; maximum is ${MAX_IMPORT_BYTES} bytes)`)
  }
}

/**
 * Runs one parse request. Never throws: failures are turned into an error
 * response so a single malformed document cannot tear down the worker.
 */
export async function handleParserRequest(
  request: ParserWorkerRequest,
  parser: FileParserService = new FileParserService()
): Promise<ParserWorkerResponse> {
  const raw = request as { id?: unknown } | undefined
  const requestId = typeof raw?.id === 'number' && Number.isFinite(raw.id) ? raw.id : 0

  try {
    if (!isParserWorkerRequest(request)) {
      return { id: requestId, ok: false, error: 'Invalid parser request' }
    }

    await assertWorkerParseTarget(request.filePath)
    const result = await parser.parseFile(request.filePath, request.options)
    return { id: request.id, ok: true, result }
  } catch (error) {
    return {
      id: requestId,
      ok: false,
      error: serializeParserError(error)
    }
  }
}
