import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Native SQLite and Office integration tests otherwise contend for CPU on Windows.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/db/migrations/**', 'src/main/index.ts'],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        branches: 10,
        functions: 15,
        lines: 15,
        statements: 15
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src')
    }
  }
})
