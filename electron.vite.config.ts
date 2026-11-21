import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { buildContentSecurityPolicy } from './src/main/security/csp'

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

function injectCspPlugin() {
  let isDev = false
  return {
    name: 'inject-csp',
    configResolved(config: { command: string }) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html: string) {
      return html.replace('%CSP%', buildContentSecurityPolicy({ isDev }))
    }
  }
}

export default defineConfig({
  main: {
    plugins: [copyMigrationsPlugin()],
    build: {
      emptyOutDir: false,
      rollupOptions: {
        // The document parser runs in its own utility process, so it needs a
        // second main-process entry emitted next to index.js.
        input: {
          index: resolve('src/main/index.ts'),
          parserWorker: resolve('src/main/workers/parserWorker.ts')
        }
      },
      // electron-vite auto-externalizes all dependencies from package.json.
      // ESM-only packages (no CJS entry) MUST be force-bundled inline,
      // otherwise the CJS output will contain require("remark") which fails at runtime
      // because these packages only provide ESM exports.
      externalizeDeps: {
        exclude: ['remark', 'remark-gfm', 'remark-parse', 'unified', 'unist-util-visit']
      }
    }
  },
  preload: {
    build: {
      emptyOutDir: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [tailwindcss(), react(), injectCspPlugin()],
    build: {
      emptyOutDir: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/katex') || id.includes('rehype-katex')) return 'katex'
            if (id.includes('node_modules/remark-math')) return 'katex'
            if (
              id.includes('node_modules/@tiptap') ||
              id.includes('node_modules/prosemirror') ||
              id.includes('node_modules/tiptap-markdown')
            ) {
              return 'editor'
            }
            if (id.includes('node_modules/highlight.js') || id.includes('rehype-highlight')) {
              return 'highlight'
            }
            return undefined
          }
        }
      }
    }
  }
})
