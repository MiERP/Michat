import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Native SQLite and Office integration tests otherwise contend for CPU on Windows.
    maxWorkers: 2,
    // Migration + extension setup can exceed 10s on a cold Windows machine.
    hookTimeout: 30_000,
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/db/migrations/**', 'src/main/index.ts'],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        branches: 35,
        functions: 40,
        lines: 42,
        statements: 42
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src')
    }
  }
})
