import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'

describe('packaged runtime dependencies', () => {
  it('keeps concat-map as an explicit production dependency for ExcelJS startup', () => {
    expect(packageJson.dependencies).toMatchObject({
      'concat-map': '0.0.1'
    })
  })

  it('keeps fd-slicer and pend as explicit production dependencies for word-extractor', () => {
    expect(packageJson.dependencies).toMatchObject({
      'fd-slicer': '1.1.0',
      pend: '1.2.0'
    })
  })
})
