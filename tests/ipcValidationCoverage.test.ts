import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const IPC_DIR = join(process.cwd(), 'src/main/ipc')
const WRAPPERS = [
  'validate',
  'validateWithEvent',
  'registerValidatedHandler',
  'registerStreamingHandler',
  'registerNoArgHandler'
]

describe('IPC validation coverage', () => {
  it('wraps every ipcMain.handle registration in a validation helper', () => {
    const files = readdirSync(IPC_DIR).filter(
      (file) => file.endsWith('.ts') && !['handlerRegistry.ts', 'validation.ts'].includes(file)
    )
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    let registrations = 0

    for (const file of files) {
      const source = readFileSync(join(IPC_DIR, file), 'utf8')
      const pattern = /ipcMain\.handle\(\s*(['"`])([^'"`]+)\1\s*,\s*([A-Za-z]+)([\s\S]{0,800})/g
      for (const match of source.matchAll(pattern)) {
        registrations++
        const channel = match[2]
        const wrapper = match[3]
        const body = match[4]
        // Some streaming handlers wrap the call themselves with validate(...)(event, args).
        const selfValidated = wrapper === 'async' && /\b(validate|validateWithEvent)\(/.test(body)
        if (!WRAPPERS.includes(wrapper) && !selfValidated) {
          offenders.push(`${file}: ${channel} uses ${wrapper}`)
        }
      }
    }

    expect(registrations).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
