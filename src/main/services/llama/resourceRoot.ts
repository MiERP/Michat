import { join } from 'path'

export interface LlamaAutoRootOptions {
  env: NodeJS.ProcessEnv
  cwd: string
  dirname: string
  resourcesPath?: string
  isPackaged: boolean
  exeName: string
  exists: (candidate: string) => boolean
}

/**
 * Resolve the directory that contains `models/` and `llama-bin/`.
 *
 * Ordering rules:
 * - Explicit env overrides always win.
 * - Packaged builds only trust the app's own resource locations and never the
 *   current working directory, so launching from a folder that happens to
 *   contain a `resources/` tree cannot load third-party binaries or models.
 * - Development keeps the historical cwd-first behavior so `pnpm dev` can run
 *   from the repository root.
 */
export function resolveLlamaAutoRoot(options: LlamaAutoRootOptions): string {
  const candidates: string[] = []
  const { env, cwd, dirname, resourcesPath, isPackaged, exeName, exists } = options

  if (env.KN_LLAMA_AUTO_ROOT) candidates.push(env.KN_LLAMA_AUTO_ROOT)
  if (env.KN_LLAMA_ROOT) candidates.push(env.KN_LLAMA_ROOT)

  // out/main (bundled) and out/main/services (unbundled) both resolve here.
  const buildRoots = [
    join(dirname, '..', '..', 'resources'),
    join(dirname, '..', '..', '..', 'resources')
  ]

  if (isPackaged) {
    if (resourcesPath) candidates.push(resourcesPath)
    candidates.push(...buildRoots)
  } else {
    candidates.push(join(cwd, 'resources'), ...buildRoots)
    if (resourcesPath) candidates.push(resourcesPath)
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    if (!exists(join(candidate, 'models'))) continue
    if (!exists(join(candidate, 'llama-bin', exeName))) continue
    return candidate
  }

  return ''
}
