// import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join, basename } from 'path'
import fs from 'fs'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'
import { shouldOffloadChatModelToGpu } from './llama/runtimeProfile'
import { detectMachineInfo as detectMachineInfoImpl, type MachineInfo } from './llama/machineInfo'

export type { MachineInfo } from './llama/machineInfo'

type ServerKind = 'chat' | 'embedding'
type Backend = string

type RuntimeProfile = {
  backend: Backend
  chatCtxSize: number
  embeddingCtxSize: number
  threads: number
  batchSize: number
  ubatchSize: number
  nGpuLayers: number
}

export type ModelMetadata = {
  filename: string
  type: 'chat' | 'embedding'
  addedAt: string
}

function inferModelTypeFromFilename(filename: string): 'chat' | 'embedding' | 'unknown' {
  const id = filename.toLowerCase()
  if (id.includes('bge') || id.includes('embed') || id.includes('embedding') || id.includes('e5')) {
    return 'embedding'
  }
  if (
    id.includes('qwen') ||
    id.includes('llama') ||
    id.includes('mistral') ||
    id.includes('instruct') ||
    id.includes('chat') ||
    id.includes('gemma') ||
    id.includes('phi') ||
    id.includes('deepseek') ||
    id.includes('yi-') ||
    id.includes('glm') ||
    id.includes('internlm') ||
    id.includes('vicuna') ||
    id.includes('orca')
  ) {
    return 'chat'
  }
  return 'unknown'
}

function detectModelContextWindow(filename: string): number | null {
  const id = filename.toLowerCase()

  if (id.includes('gemma-4')) {
    if (id.includes('e2b') || id.includes('e4b')) {
      return 131072
    }
    return 262144
  }
  if (id.includes('qwen3.5')) {
    return 262144
  }
  if (id.includes('qwen3')) {
    return 32768
  }
  if (id.includes('mixtral') || id.includes('mistral')) {
    return 32768
  }
  if (id.includes('llama-4')) {
    return 262144
  }

  return null
}

export class LlamaService {
  private chatProc: ChildProcess | null = null
  private embedProc: ChildProcess | null = null
  private machine: MachineInfo | null = null
  private runtimeProfile: RuntimeProfile | null = null

  constructor(
    private readonly machineDetector: () => Promise<MachineInfo> = detectMachineInfoImpl
  ) {}

  private isWin(): boolean {
    return process.platform === 'win32'
  }

  private exeName(): string {
    return this.isWin() ? 'llama-server.exe' : 'llama-server'
  }

  /**
   * Root folder that contains:
   *   cpu-x64/, cuda-12.4-x64/, cuda-13.1-x64/, vulkan-x64/, models/
   */
  private getAutoRoot(): string {
    const candidates: string[] = []

    // 1) explicit env override
    if (process.env.KN_LLAMA_AUTO_ROOT) candidates.push(process.env.KN_LLAMA_AUTO_ROOT)
    if (process.env.KN_LLAMA_ROOT) candidates.push(process.env.KN_LLAMA_ROOT)

    // 2) dev cwd (often not reliable in electron)
    candidates.push(join(process.cwd(), 'resources'))

    // 3) IMPORTANT: locate resources relative to compiled out/main/*
    // out/main/services -> ../../../resources
    candidates.push(join(__dirname, '..', '..', '..', 'resources'))

    // 4) packaged runtime resources
    candidates.push(process.resourcesPath)

    for (const c of candidates) {
      if (!c) continue
      try {
        const hasModels = fs.existsSync(join(c, 'models'))
        const hasAnyBin = fs.existsSync(join(c, 'llama-bin', this.exeName()))
        if (hasModels && hasAnyBin) return c
      } catch {
        // ignore
      }
    }

    return ''
  }

  private getModelsDir(): string | null {
    const root = this.getAutoRoot()
    if (!root) return null
    const p = join(root, 'models')
    return fs.existsSync(p) ? p : null
  }

  /**
   * Hardware detection is asynchronous: PowerShell startup can take seconds
   * and must never block the UI before the window is visible.
   */
  private async detectMachineInfo(): Promise<MachineInfo> {
    if (this.machine) return this.machine

    const info = await this.machineDetector()
    this.machine = info
    Logger.info(
      'LlamaService',
      `MACHINE CONFIG (DETECTED) CPU=${info.cpuCores}C/${info.cpuThreads}T RAM=${info.ramMB}MB GPU="${info.gpuName}" vendor=${info.gpuVendor} type=${info.gpuType} vram=${info.gpuVramMB}MB dGPU=${info.hasDGPU}`
    )
    return info
  }

  /**
   * Decide which backend folder to use.
   * We now use unified `llama-bin`.
   */
  private pickBackend(): Backend {
    const root = this.getAutoRoot()
    const override = process.env.KN_LLAMA_BACKEND
    if (override && root) {
      const p = join(root, override, this.exeName())
      if (fs.existsSync(p)) return override
    }
    return 'llama-bin'
  }

  private async computeRuntimeProfile(): Promise<RuntimeProfile> {
    if (this.runtimeProfile) return this.runtimeProfile

    const backend = this.pickBackend()
    const info = await this.detectMachineInfo()

    const envProfile = process.env.KN_LLAMA_PROFILE
    const isLowSpec = envProfile === 'low' || (info.ramMB > 0 && info.ramMB <= 8192)
    const isMidSpec =
      envProfile === 'mid' || (!isLowSpec && (info.ramMB === 0 || info.ramMB <= 16384))

    const modelSizeMB = this.getDefaultChatModelSizeMB()
    const useGpu = shouldOffloadChatModelToGpu(info, modelSizeMB)
    const defaultThreads = useGpu
      ? Math.min(8, info.cpuThreads || 4)
      : info.cpuCores || Math.min(18, info.cpuThreads || 4)
    const threads = Number(process.env.KN_LLAMA_THREADS || Math.max(2, defaultThreads))

    const modelContext = this.getDetectedModelContext()

    let chatCtxSize: number
    if (modelContext && !isLowSpec) {
      chatCtxSize = Math.min(modelContext, isMidSpec ? 16384 : 131072)
    } else if (modelContext && isLowSpec) {
      chatCtxSize = Math.min(modelContext, 8192)
    } else {
      chatCtxSize = isLowSpec ? 2048 : isMidSpec ? 4096 : 8192
    }

    const profile: RuntimeProfile = {
      backend,
      chatCtxSize,
      // bge-m3 handles long inputs; a larger ctx/ubatch also lets the embedding
      // server process whole document-level texts instead of rejecting them.
      embeddingCtxSize: 2048,
      threads,
      batchSize: isLowSpec ? 128 : 512,
      ubatchSize: isLowSpec ? 64 : 256,
      nGpuLayers: useGpu ? 999 : 0
    }

    this.runtimeProfile = profile
    Logger.info(
      'LlamaService',
      `RUNTIME PROFILE backend=${profile.backend} ctx(chat=${profile.chatCtxSize},embed=${profile.embeddingCtxSize}) threads=${profile.threads} batch=${profile.batchSize}/${profile.ubatchSize} ngl=${profile.nGpuLayers} model=${modelSizeMB}MB vram=${info.gpuVramMB}MB`
    )

    return profile
  }

  private getDefaultChatModelSizeMB(): number {
    try {
      const chatModel = this.getDefaultModelFile('chat')
      return chatModel ? Math.ceil(fs.statSync(chatModel).size / (1024 * 1024)) : 0
    } catch {
      return 0
    }
  }

  private getDetectedModelContext(): number | null {
    const modelsDir = this.getModelsDir()
    if (!modelsDir) return null

    try {
      const chatModel = this.getDefaultModelFile('chat')
      if (!chatModel) return null
      return detectModelContextWindow(chatModel)
    } catch {
      return null
    }
  }

  /**
   * Locate llama-server binary.
   * Priority:
   *  1) KN_LLAMA_SERVER_BIN (absolute path)
   *  2) bundled resources (if you bundled it)
   *  3) start-llama-auto backend folder chosen by pickBackend()
   *  4) fallbacks across all folders
   */
  getLlamaServerBin(): string | null {
    // 0) explicit override
    const override = process.env.KN_LLAMA_SERVER_BIN
    if (override && fs.existsSync(override)) return override

    // 1) auto root (IMPORTANT)
    const root = this.getAutoRoot()
    if (!root) return null

    // 2) pick backend folder and look for llama-server.exe inside
    const backend = this.pickBackend()
    const primary = join(root, backend, this.exeName())
    if (fs.existsSync(primary)) return primary

    // 3) fallback: try common folders in order
    const candidates = [join(root, 'llama-bin', this.exeName())]

    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }

    return null
  }

  private getDefaultModelFile(kind: ServerKind): string | null {
    const modelsDir = this.getModelsDir()
    if (!modelsDir) return null

    const configuredModelKey = kind === 'chat' ? 'defaultChatModel' : 'defaultEmbeddingModel'
    const configuredModel = settingsManager.getSettingSync(configuredModelKey)
    if (typeof configuredModel === 'string' && configuredModel) {
      const configuredFilename = configuredModel.startsWith('llama:')
        ? configuredModel.slice('llama:'.length)
        : configuredModel
      const configuredPath = join(modelsDir, configuredFilename)
      if (fs.existsSync(configuredPath)) {
        return configuredPath
      }
    }

    const envKey = kind === 'chat' ? 'KN_LLAMA_CHAT_MODEL' : 'KN_LLAMA_EMBED_MODEL'
    const envModel = process.env[envKey]
    if (envModel) {
      const direct = join(modelsDir, envModel)
      if (fs.existsSync(direct)) return direct
      if (fs.existsSync(envModel)) return envModel
    }

    const defaults =
      kind === 'chat'
        ? [
            'Qwen3.5-2B-Q8_0.gguf',
            'gemma-4-E2B-it-uncensored-Q4_K_M.gguf',
            'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
            'Qwen3-4B-Instruct-Q4_K_M.gguf'
          ]
        : ['bge-m3-q4_k_m.gguf', 'bge-m3-q4_k_m.gguf'.toUpperCase()]

    for (const f of defaults) {
      const p = join(modelsDir, f)
      if (fs.existsSync(p)) return p
    }

    const all = fs.readdirSync(modelsDir).filter((x) => x.toLowerCase().endsWith('.gguf'))
    if (all.length === 0) return null

    if (kind === 'chat') {
      const pickChat =
        all.find((x) => inferModelTypeFromFilename(x) === 'chat') ||
        all.find((x) => x.toLowerCase().includes('instruct') || x.toLowerCase().includes('chat'))

      if (!pickChat) {
        Logger.warn(
          'LlamaService',
          'No chat-capable GGUF model found in models directory. Please import a chat model (e.g. Qwen/Llama/Mistral Instruct).'
        )
        return null
      }

      return join(modelsDir, pickChat)
    }

    const pickEmbedding =
      all.find((x) => inferModelTypeFromFilename(x) === 'embedding') ||
      all.find((x) => x.toLowerCase().includes('bge') || x.toLowerCase().includes('embed'))

    if (!pickEmbedding) {
      Logger.warn(
        'LlamaService',
        'No embedding GGUF model found in models directory. Please import an embedding model (e.g. bge/e5).'
      )
      return null
    }

    return join(modelsDir, pickEmbedding)
  }

  private getPort(kind: ServerKind): number {
    const envKey = kind === 'chat' ? 'KN_LLAMA_CHAT_PORT' : 'KN_LLAMA_EMBED_PORT'
    const v = Number(process.env[envKey] || (kind === 'chat' ? 8000 : 8001))
    return Number.isFinite(v) ? v : kind === 'chat' ? 8000 : 8001
  }

  async getRuntimeInfo(): Promise<{
    backend: Backend
    chatPort: number
    embedPort: number
    chatCtxSize: number
    embeddingCtxSize: number
    threads: number
  }> {
    const runtime = await this.computeRuntimeProfile()
    return {
      backend: runtime.backend,
      chatPort: this.getPort('chat'),
      embedPort: this.getPort('embedding'),
      chatCtxSize: runtime.chatCtxSize,
      embeddingCtxSize: runtime.embeddingCtxSize,
      threads: runtime.threads
    }
  }

  /** Non-blocking fallback used by services that cannot await (e.g. quiz sizing). */
  getChatContextSizeSync(): number {
    return this.runtimeProfile?.chatCtxSize ?? 8192
  }

  private getHost(): string {
    return process.env.KN_LLAMA_HOST || '127.0.0.1'
  }

  private async isServerUp(kind: ServerKind): Promise<boolean> {
    const host = this.getHost()
    const port = this.getPort(kind)
    const baseUrl = `http://${host}:${port}/v1`
    try {
      const r = await fetch(`${baseUrl}/models`, { method: 'GET' })
      if (!r.ok) return false

      // Kiểm tra model đang chạy có khớp model đang được cấu hình không.
      // Nếu user đổi model trong Settings, server cũ vẫn chạy model cũ —
      // phải coi như "down" để ensure*Started() tự restart với model mới.
      const expected = this.getDefaultModelFile(kind)
      if (!expected) return true

      const payload = (await r.json()) as { data?: Array<{ id?: string }> }
      const ids = (payload.data || []).map((m) => (m.id || '').toLowerCase())
      if (ids.length === 0) return true

      const expectedLower = expected.toLowerCase()
      const expectedBase = basename(expectedLower)
      const matches = ids.some(
        (id) =>
          id === expectedLower ||
          id.endsWith(expectedBase) ||
          expectedLower.endsWith(id)
      )
      if (!matches) {
        Logger.warn(
          'LlamaService',
          `Server ${kind} is running a different model than configured (expected ${expectedBase})`
        )
        return false
      }
      return true
    } catch {
      return false
    }
  }

  private buildArgs(kind: ServerKind, modelPath: string, runtime: RuntimeProfile): string[] {
    const host = this.getHost()
    const port = this.getPort(kind)

    const parsePositiveInt = (value: string | undefined, fallback: number): number => {
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
    }

    // llama.cpp requires every embedding input to fit in one physical batch, so
    // the embedding ubatch must cover realistic text lengths (not just 256).
    const embeddingBatch = 1024
    const defaultBatchSize =
      kind === 'embedding' ? Math.max(runtime.batchSize, embeddingBatch) : runtime.batchSize
    const defaultUbatchSize =
      kind === 'embedding' ? Math.max(runtime.ubatchSize, embeddingBatch) : runtime.ubatchSize

    const batchSize =
      kind === 'embedding'
        ? parsePositiveInt(process.env.KN_LLAMA_EMBED_BATCH_SIZE, defaultBatchSize)
        : parsePositiveInt(process.env.KN_LLAMA_CHAT_BATCH_SIZE, runtime.batchSize)

    const ubatchSize =
      kind === 'embedding'
        ? parsePositiveInt(process.env.KN_LLAMA_EMBED_UBATCH_SIZE, defaultUbatchSize)
        : parsePositiveInt(process.env.KN_LLAMA_CHAT_UBATCH_SIZE, runtime.ubatchSize)

    const ctxSize =
      kind === 'embedding'
        ? process.env.KN_LLAMA_EMBED_CTX_SIZE || String(runtime.embeddingCtxSize)
        : process.env.KN_LLAMA_CTX_SIZE || String(runtime.chatCtxSize)

    const reasoningMode =
      kind === 'chat' && /^(on|off|auto)$/i.test(process.env.KN_LLAMA_REASONING || '')
        ? String(process.env.KN_LLAMA_REASONING).toLowerCase()
        : 'off'

    const args = [
      '--host',
      host,
      '--port',
      String(port),
      '--model',
      modelPath,
      '--ctx-size',
      ctxSize,
      '--threads',
      String(runtime.threads),
      '--batch-size',
      String(batchSize),
      '--ubatch-size',
      String(ubatchSize)
    ]

    if (kind === 'embedding') {
      args.push('--embedding')
    } else {
      // Disable chain-of-thought/reasoning mode by default for local chat:
      // it adds latency and causes the UI to stream internal thinking.
      args.push('--reasoning', reasoningMode)
    }

    if (runtime.nGpuLayers > 0) {
      args.push('--n-gpu-layers', String(runtime.nGpuLayers))
    }

    // Newer llama.cpp builds require an explicit mode value for --flash-attn.
    // Pass a mode explicitly so --no-warmup is not misparsed as the flag value.
    args.push('--flash-attn', process.env.KN_LLAMA_NO_FLASH_ATTN === '1' ? 'off' : 'auto')

    // b8797+: skip warmup to reduce startup time
    if (process.env.KN_LLAMA_NO_SKIP_WARMUP !== '1') {
      args.push('--no-warmup')
    }

    const extraEnvKey = kind === 'chat' ? 'KN_LLAMA_CHAT_ARGS' : 'KN_LLAMA_EMBED_ARGS'
    const extra = process.env[extraEnvKey]
    if (extra) args.push(...extra.split(' ').filter(Boolean))

    return args
  }

  private async spawnServer(
    kind: ServerKind,
    bin: string,
    modelPath: string
  ): Promise<void> {
    const runtime = await this.computeRuntimeProfile()
    const args = this.buildArgs(kind, modelPath, runtime)
    const label = kind === 'chat' ? 'chat' : 'embedding'

    Logger.info('LlamaService', `Starting ${label} server: ${bin} ${args.join(' ')}`)

    const proc = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env }
    })

    // Capture stderr for debugging server issues
    if (proc.stderr) {
      let stderrBuf = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderrBuf += text
        // Log last meaningful line (avoid flooding)
        const lines = text.split('\n').filter((l: string) => l.trim())
        for (const line of lines) {
          if (/error|fatal|fail|exception/i.test(line)) {
            Logger.error('LlamaService', `[${label}] ${line.trim()}`)
          }
        }
        // Keep buffer bounded
        if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-4096)
      })
    }

    proc.on('error', (err) =>
      Logger.error(
        'LlamaService',
        `${kind === 'chat' ? 'Chat' : 'Embedding'} server failed to start:`,
        err
      )
    )

    proc.on('exit', (code, signal) => {
      Logger.warn(
        'LlamaService',
        `${kind === 'chat' ? 'Chat' : 'Embedding'} server exited code=${code} signal=${signal}`
      )
      if (kind === 'chat') {
        this.chatProc = null
      } else {
        this.embedProc = null
      }
    })

    if (kind === 'chat') {
      this.chatProc = proc
    } else {
      this.embedProc = proc
    }
  }

  private async waitForServer(kind: ServerKind, timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.isServerUp(kind)) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  async ensureChatStarted(): Promise<boolean> {
    const chatModel = this.getDefaultModelFile('chat')
    if (!chatModel) {
      Logger.warn(
        'LlamaService',
        'Cannot locate chat model (.gguf) while checking chat availability. Please import a chat model.'
      )
      return false
    }

    if (await this.isServerUp('chat')) return true

    Logger.warn('LlamaService', 'Chat server is down (or model changed). Attempting restart...')

    await this.detectMachineInfo()

    const bin = this.getLlamaServerBin()
    if (!bin) {
      Logger.warn(
        'LlamaService',
        'Cannot locate llama-server binary while restarting chat server. Set KN_LLAMA_SERVER_BIN or KN_LLAMA_AUTO_ROOT.'
      )
      return false
    }

    // Giải phóng port nếu process cũ vẫn còn (ví dụ đang chạy model cũ)
    try {
      this.chatProc?.kill()
    } catch {
      // ignore
    }
    this.chatProc = null
    // Model changed → recompute ctx/ubatch profile for the new model.
    this.runtimeProfile = null
    // Chờ OS giải phóng port trước khi spawn process mới
    await new Promise((r) => setTimeout(r, 1500))

    await this.spawnServer('chat', bin, chatModel)

    // Model 4B+ trên CPU có thể mất tới ~1 phút để load
    const ready = await this.waitForServer('chat', 60000)
    if (!ready) {
      Logger.warn('LlamaService', 'Chat server did not become ready within timeout')
      return false
    }

    Logger.info('LlamaService', 'Chat server is up')
    return true
  }

  async ensureEmbeddingStarted(): Promise<boolean> {
    const embeddingModel = this.getDefaultModelFile('embedding')
    if (!embeddingModel) {
      Logger.warn(
        'LlamaService',
        'Cannot locate embedding model (.gguf) while checking embedding availability. Please import an embedding model (e.g. bge/e5).'
      )
      return false
    }

    if (await this.isServerUp('embedding')) return true

    Logger.warn('LlamaService', 'Embedding server is down (or model changed). Attempting restart...')

    await this.detectMachineInfo()

    const bin = this.getLlamaServerBin()
    if (!bin) {
      Logger.warn(
        'LlamaService',
        'Cannot locate llama-server binary while restarting embedding server. Set KN_LLAMA_SERVER_BIN or KN_LLAMA_AUTO_ROOT.'
      )
      return false
    }

    // Giải phóng port nếu process cũ vẫn còn (ví dụ đang chạy model cũ)
    try {
      this.embedProc?.kill()
    } catch {
      // ignore
    }
    this.embedProc = null
    // Model changed → recompute ctx/ubatch profile for the new model.
    this.runtimeProfile = null
    // Chờ OS giải phóng port trước khi spawn process mới
    await new Promise((r) => setTimeout(r, 1500))

    await this.spawnServer('embedding', bin, embeddingModel)

    const ready = await this.waitForServer('embedding', 30000)
    if (!ready) {
      Logger.warn('LlamaService', 'Embedding server did not become ready within timeout')
      return false
    }

    Logger.info('LlamaService', 'Embedding server is up')
    return true
  }

  async ensureStarted(): Promise<void> {
    Logger.info('LlamaService', 'ensureStarted() called')

    const root = this.getAutoRoot()
    Logger.info('LlamaService', `Auto root = ${root || '(empty)'}`)

    const chatUp = await this.isServerUp('chat')
    const embUp = await this.isServerUp('embedding')
    if (chatUp && embUp) {
      Logger.info('LlamaService', 'llama.cpp servers already running')
      return
    }

    // trigger detection early so backend selection is meaningful
    await this.detectMachineInfo()

    const bin = this.getLlamaServerBin()
    Logger.info('LlamaService', `Binary = ${bin || '(null)'}`)

    if (!bin) {
      Logger.warn(
        'LlamaService',
        'Cannot locate llama-server binary. Set KN_LLAMA_SERVER_BIN or KN_LLAMA_AUTO_ROOT.'
      )
      return
    }

    // Delegate to the ensure* methods so a stale process running a different
    // model is killed before spawning the configured one.
    if (!chatUp && !(await this.ensureChatStarted())) {
      Logger.warn('LlamaService', 'Chat server did not become ready within timeout')
    }
    if (!embUp && !(await this.ensureEmbeddingStarted())) {
      Logger.warn('LlamaService', 'Embedding server did not become ready within timeout')
    }

    if ((await this.isServerUp('chat')) && (await this.isServerUp('embedding'))) {
      Logger.info('LlamaService', 'llama.cpp servers are up')
    } else {
      Logger.warn('LlamaService', 'llama.cpp servers did not become ready within timeout')
    }
  }

  async stop(): Promise<void> {
    Logger.info('LlamaService', 'Stopping llama.cpp servers...')
    try {
      this.chatProc?.kill()
    } catch (e) {
      Logger.warn('LlamaService', 'Failed to kill chat process:', e as any)
    }
    this.chatProc = null
    try {
      this.embedProc?.kill()
    } catch (e) {
      Logger.warn('LlamaService', 'Failed to kill embedding process:', e as any)
    }
    this.embedProc = null
  }

  // ==================== GGUF Model Management ====================

  private getMetadataPath(): string | null {
    const modelsDir = this.getModelsDir()
    if (!modelsDir) return null
    return join(modelsDir, 'metadata.json')
  }

  private readMetadata(): Record<string, ModelMetadata> {
    const metaPath = this.getMetadataPath()
    if (!metaPath) return {}
    try {
      if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      }
    } catch (e) {
      Logger.warn('LlamaService', 'Failed to read metadata.json:', e)
    }
    return {}
  }

  private writeMetadata(meta: Record<string, ModelMetadata>): void {
    const metaPath = this.getMetadataPath()
    if (!metaPath) return
    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch (e) {
      Logger.error('LlamaService', 'Failed to write metadata.json:', e)
    }
  }

  /**
   * List all .gguf models in the models directory with metadata.
   */
  listModels(): Array<{
    filename: string
    type: 'chat' | 'embedding' | 'unknown'
    sizeMB: number
    addedAt: string | null
  }> {
    const modelsDir = this.getModelsDir()
    if (!modelsDir) return []

    const metadata = this.readMetadata()
    const files = fs.readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith('.gguf'))

    return files.map((filename) => {
      const filePath = join(modelsDir, filename)
      const stats = fs.statSync(filePath)
      const meta = metadata[filename]

      const inferredType = inferModelTypeFromFilename(filename)
      return {
        filename,
        type: meta?.type || inferredType,
        sizeMB: Math.round(stats.size / (1024 * 1024)),
        addedAt: meta?.addedAt || null
      }
    })
  }

  /**
   * Import a .gguf model file: copy to models dir and save metadata.
   */
  async importModel(
    sourcePath: string,
    type: 'chat' | 'embedding'
  ): Promise<{ filename: string; sizeMB: number }> {
    const modelsDir = this.getModelsDir()
    if (!modelsDir) {
      // Create models dir if autoRoot exists but models/ doesn't
      const root = this.getAutoRoot()
      if (!root) throw new Error('Cannot locate llama resources root. Set KN_LLAMA_AUTO_ROOT.')
      const dir = join(root, 'models')
      fs.mkdirSync(dir, { recursive: true })
      // re-check
      const newModelsDir = this.getModelsDir()
      if (!newModelsDir) throw new Error('Failed to create models directory')
      return this.importModelToDir(sourcePath, type, newModelsDir)
    }
    return this.importModelToDir(sourcePath, type, modelsDir)
  }

  private async importModelToDir(
    sourcePath: string,
    type: 'chat' | 'embedding',
    modelsDir: string
  ): Promise<{ filename: string; sizeMB: number }> {
    const filename = basename(sourcePath)
    if (!filename.toLowerCase().endsWith('.gguf')) {
      throw new Error('Only .gguf files are supported')
    }

    const destPath = join(modelsDir, filename)

    // Check if already exists
    if (fs.existsSync(destPath)) {
      throw new Error(`Model "${filename}" already exists in models directory`)
    }

    // Verify source exists
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`)
    }

    Logger.info('LlamaService', `Importing model: ${sourcePath} -> ${destPath} (type: ${type})`)

    // Copy file
    fs.copyFileSync(sourcePath, destPath)

    // Save metadata
    const metadata = this.readMetadata()
    metadata[filename] = {
      filename,
      type,
      addedAt: new Date().toISOString()
    }
    this.writeMetadata(metadata)

    const stats = fs.statSync(destPath)
    const sizeMB = Math.round(stats.size / (1024 * 1024))
    Logger.info('LlamaService', `Model imported: ${filename} (${sizeMB} MB, type: ${type})`)

    return { filename, sizeMB }
  }

  /**
   * Remove a model from the models directory.
   */
  removeModel(filename: string): void {
    const modelsDir = this.getModelsDir()
    if (!modelsDir) throw new Error('Models directory not found')

    const filePath = join(modelsDir, filename)
    if (!fs.existsSync(filePath)) {
      throw new Error(`Model file not found: ${filename}`)
    }

    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid filename')
    }

    fs.unlinkSync(filePath)

    // Remove metadata
    const metadata = this.readMetadata()
    delete metadata[filename]
    this.writeMetadata(metadata)

    Logger.info('LlamaService', `Model removed: ${filename}`)
  }
}
