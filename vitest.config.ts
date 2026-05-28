import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/db/migrations/**', 'src/main/index.ts'],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        branches: 50,
        functions: 50,
        lines: 60,
        statements: 60
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src')
    }
  }
})
