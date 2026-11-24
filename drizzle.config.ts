import type { Config } from 'drizzle-kit'

export default {
  // Database dialect
  dialect: 'sqlite',

  // Schema file location
  schema: './src/main/db/schema.ts',

  // Migration output directory
  out: './src/main/db/migrations',

  // Development database file path (used by drizzle-kit push)
  // The production path is determined at runtime by Electron app.getPath('userData')
  dbCredentials: {
    url: './michat.db'
  }
} satisfies Config
