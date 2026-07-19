import { describe, expect, it } from 'vitest'
import { NotebookOverviewGenerationRegistry } from '../../src/main/ipc/notebookOverviewGenerationRegistry'

describe('NotebookOverviewGenerationRegistry', () => {
  it('aborts a notebook generation on cancel', () => {
    const registry = new NotebookOverviewGenerationRegistry()
    const controller = registry.start('notebook_1')

    expect(registry.cancel('notebook_1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(registry.cancel('notebook_1')).toBe(false)
  })

  it('aborts all active generations during application shutdown', () => {
    const registry = new NotebookOverviewGenerationRegistry()
    const first = registry.start('notebook_1')
    const second = registry.start('notebook_2')

    registry.cancelAll()

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
  })
})
