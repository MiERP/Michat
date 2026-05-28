import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('math works', () => {
    expect(1 + 1).toBe(2)
  })

  it('strings work', () => {
    expect('hello'.toUpperCase()).toBe('HELLO')
  })
})
