import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 复制迁移文件的插件
function copyMigrationsPlugin() {
  return {
    name: 'copy-migrations',
    closeBundle() {
      const srcDir = resolve('src/main/db/migrations')
      const destDir = resolve('out/main/db/migrations')

      // 递归复制目录
      function copyDir(src: string, dest: string) {
        if (!existsSync(dest)) {
          mkdirSync(dest, { recursive: true })
        }

        const entries = readdirSync(src)
        for (const entry of entries) {
          const srcPath = join(src, entry)
          const destPath = join(dest, entry)

          if (statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath)
          } else {
            try {
              copyFileSync(srcPath, destPath)
            } catch (err: any) {
              // On Windows, the file may be locked by a running Electron instance.
              // Warn but don't crash the build — the existing file is still usable.
              console.warn(`[Migrations] Could not copy ${entry}: ${err.message}`)
            }
          }
        }
      }

      if (existsSync(srcDir)) {
        copyDir(srcDir, destDir)
        console.log('[Migrations] Copied migration files to', destDir)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [copyMigrationsPlugin()],
    build: {
      emptyOutDir: false,
      // electron-vite auto-externalizes all dependencies from package.json.
      // ESM-only packages (no CJS entry) MUST be force-bundled inline,
      // otherwise the CJS output will contain require("remark") which fails at runtime
      // because these packages only provide ESM exports.
      externalizeDeps: {
        exclude: ['remark', 'remark-gfm', 'remark-parse', 'unified', 'unist-util-visit']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [tailwindcss(), react()]
  }
})
