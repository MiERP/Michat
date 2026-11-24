import { ipcMain } from 'electron'
import type { z } from 'zod'
import { validate, validateNoArgs, validateWithEvent } from './validation'

const registeredChannels = new Set<string>()

/** Register a handler that receives exactly one validated object argument. */
export function registerValidatedHandler<TSchema extends z.ZodType, TResult>(
  channel: string,
  schema: TSchema,
  handler: (args: z.infer<TSchema>) => Promise<TResult>
): void {
  registeredChannels.add(channel)
  ipcMain.handle(channel, validate(schema, handler))
}

/** Register a streaming handler that still needs the IPC event. */
export function registerStreamingHandler<TSchema extends z.ZodType, TResult>(
  channel: string,
  schema: TSchema,
  handler: (event: Electron.IpcMainInvokeEvent, args: z.infer<TSchema>) => Promise<TResult>
): void {
  registeredChannels.add(channel)
  ipcMain.handle(channel, validateWithEvent(schema, handler))
}

/** Register a handler that takes no renderer-supplied arguments. */
export function registerNoArgHandler<TResult>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent) => Promise<TResult>
): void {
  registeredChannels.add(channel)
  ipcMain.handle(channel, validateNoArgs(handler))
}

export function getRegisteredChannels(): string[] {
  return [...registeredChannels]
}
