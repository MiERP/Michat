Windows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.

Try the new cross-platform PowerShell https://aka.ms/pscore6

PS C:\Windows\system32> cd D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama
PS D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama> pnpm dev

> michat@1.1.1 dev D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama
> electron-vite dev

vite v7.2.7 building ssr environment for development...
✓ 274 modules transformed.
out/main/index.js  727.10 kB
✓ built in 1.24s
[Migrations] Copied migration files to D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\db\migrations

electron main process built successfully

-----

vite v7.2.7 building ssr environment for development...
✓ 1 modules transformed.
out/preload/index.js  12.51 kB
✓ built in 30ms

electron preload scripts built successfully

-----

dev server running for the electron renderer process at:

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose

starting electron app...


[Main] License startup check: valid, expiresAt=2026-07-31
[LlamaService] ensureStarted() called
[LlamaService] Auto root = D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\resources
[LlamaService] MACHINE CONFIG (DETECTED) CPU=4C/8T RAM=40640MB GPU="Intel(R) Iris(R) Xe Graphics" vendor=Intel type=Onboard vram=2048MB dGPU=false
[LlamaService] Binary = D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\resources\llama-bin\llama-server.exe
[LlamaService] Cannot locate chat model (.gguf). Set KN_LLAMA_AUTO_ROOT/models or KN_LLAMA_CHAT_MODEL.
[LlamaService] Cannot locate embedding model (.gguf). Set KN_LLAMA_AUTO_ROOT/models or KN_LLAMA_EMBED_MODEL.
[LlamaService] llama.cpp servers did not become ready within timeout
[Main] Initializing database...
[Database] Initializing database at: C:\Users\Admin\AppData\Roaming\michat\michat.db
[Database] sqlite-vec extension loaded
[Database] sqlite-vec version: v0.1.7-alpha.2
[Database] Configuration: { journal_mode: 'wal', wal_autocheckpoint: 100, synchronous: 1 }
[Database] Integrity check passed
[Database] Database initialized successfully
[Database] Running migrations from: D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\db\migrations
[Database] Migrations completed successfully
[Database] Initializing extension tables (Vector + FTS)...
[Database] Extension tables initialized successfully
[Main] Database initialized
[Main] Initializing Provider Manager...
[ProviderRegistry] Provider registry initialized
[ProviderRegistry] Registered provider: llama
[ProviderRegistry] Registered provider: llama-embed
[ProviderManager] Registered 2 builtin providers: llama, llama-embed
[ProviderManager] Provider manager initialized
[ProviderManager] Provider manager initialization complete (llama-only mode)
[Main] Provider Manager initialized
[Main] Initializing Session Auto Switch Service...
[Main] Session Auto Switch Service initialized
[Main] Initializing Knowledge Service...
[FileParserService] Registered 6 document loaders
[Main] Knowledge Service initialized
[Main] Initializing Update Service...
[UpdateService] Running in development mode, auto-update disabled
[Main] Update Service initialized
[Main] Initializing electron-store...
[Main] electron-store initialized
[Main] Initializing Shortcut Manager...
[Main] Shortcut Manager initialized
[ProviderHandlers] Provider handlers registered (llama-only mode)
[IPC] Settings handlers registered
[KnowledgeHandlers] Knowledge handlers registered
[MindMapHandlers] Mind map handlers registered
[UpdateHandlers] Update handlers registered
[IPC] Shortcut handlers registered
[LlamaHandlers] Llama model management handlers registered
[IPC] All handlers registered
[Main] Shortcuts registered
[PdfLoader] Kh├┤ng thß╗â tß║úi PDF.js worker, chuyß╗ân sang chß║┐ ─æß╗Ö inline
[IPC] get-all-notebooks
[IPC] Retrieved 0 notebooks
[IPC] get-all-notebooks
[IPC] Retrieved 0 notebooks
[IPC] Settings changed, broadcasting to all windows
[IPC] Settings changed, broadcasting to all windows
[IPC] Settings changed, broadcasting to all windows
[ProviderConfigManager] Config encrypted for llama
[IPC] Settings changed, broadcasting to all windows
[ProviderConfigManager] Config encrypted for llama
[IPC] create-notebook: {
  title: 'Sß╗ò ghi ch├║ mß╗¢i 1',
  description: 'Bß║»t ─æß║ºu h├ánh tr├¼nh ghi ch├║ cß╗ºa bß║ín'
}
[Database] Created notebook: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[IPC] Notebook created successfully: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[KnowledgeHandlers] get-documents: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[KnowledgeHandlers] get-stats: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[ItemHandlers] items:get: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[ItemHandlers] Retrieved 0 items
[ItemHandlers] items:get: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[ItemHandlers] Retrieved 0 items
[KnowledgeHandlers] get-documents: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[KnowledgeHandlers] get-stats: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[ItemHandlers] items:get: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[ItemHandlers] Retrieved 0 items
[ItemHandlers] items:get: notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7
[ItemHandlers] Retrieved 0 items
[KnowledgeHandlers] add-documents-from-folder: {
  notebookId: 'notebook_2cdbde2c-a37c-4b81-b494-39cad28f24d7',
  folderPath: 'D:\\MiChat\\MiChat-1.1-know\\vanbantest'
}
[KnowledgeService] File copied: D:\MiChat\MiChat-1.1-know\vanbantest\24_2018_QH14_luß║¡t an ninh mß║íng.pdf -> C:\Users\Admin\AppData\Roaming\michat\knowledge-files\doc_7283c4b7-7f29-4d7c-8e18-7852155e0903.pdf
[FileParserService] Parsing file with PdfLoader
[PdfLoader] ─Éang tß║úi PDF vß╗¢i 24 trang
[ChunkingService] Split text into 294 chunks
[KnowledgeService] Document doc_7283c4b7-7f29-4d7c-8e18-7852155e0903: 294 chunks
[AISDKProvider] Provider llama initialized
[ProviderRegistry] Created instance for provider: llama
[AISDKProvider] Provider llama configured
[AISDKProvider] Provider llama configured
[ProviderManager] Using default embedding model: llama - bge-m3-q4_k_m.gguf
[EmbeddingService] Processing 294 texts in 15 batches
[AISDKProvider] Creating embeddings for 20 texts with model: bge-m3-q4_k_m.gguf
[AISDKProvider] Provider llama does not support dimensions parameter, ignoring
[EmbeddingService] Attempt 1 failed: RetryError [AI_RetryError]: Failed after 3 attempts. Last error: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
    at _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1821:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async Promise.all (index 0)
    at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
    at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
    at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
    at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
    at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
    at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
    at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
    at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
    at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
  cause: undefined,
  reason: 'maxRetriesExceeded',
  errors: [
    APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
        at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
        at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
        at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
        at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
        at async Promise.all (index 0)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
        at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
        at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
        at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
        at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
        at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
        at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
        at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
      cause: [Error],
      url: 'http://127.0.0.1:8001/v1/embeddings',
      requestBodyValues: [Object],
      statusCode: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
      data: undefined,
      [Symbol(vercel.ai.error)]: true,
      [Symbol(vercel.ai.error.AI_APICallError)]: true
    },
    APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
        at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
        at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
        at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
        at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
        at async Promise.all (index 0)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
        at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
        at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
        at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
        at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
        at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
        at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
        at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
      cause: [Error],
      url: 'http://127.0.0.1:8001/v1/embeddings',
      requestBodyValues: [Object],
      statusCode: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
      data: undefined,
      [Symbol(vercel.ai.error)]: true,
      [Symbol(vercel.ai.error.AI_APICallError)]: true
    },
    APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
        at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
        at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
        at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
        at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
        at async Promise.all (index 0)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
        at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
        at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
        at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
        at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
        at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
        at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
        at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
      cause: [Error],
      url: 'http://127.0.0.1:8001/v1/embeddings',
      requestBodyValues: [Object],
      statusCode: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
      data: undefined,
      [Symbol(vercel.ai.error)]: true,
      [Symbol(vercel.ai.error.AI_APICallError)]: true
    }
  ],
  lastError: APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
      at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
      at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
      at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
      at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
      at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
      at async Promise.all (index 0)
      at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
      at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
      at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
      at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
      at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
      at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
      at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
      at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
      at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
    cause: Error: connect ECONNREFUSED 127.0.0.1:8001
        at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16) {
      errno: -4078,
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 8001
    },
    url: 'http://127.0.0.1:8001/v1/embeddings',
    requestBodyValues: {
      model: 'bge-m3-q4_k_m.gguf',
      input: [Array],
      encoding_format: 'float',
      dimensions: undefined,
      user: undefined
    },
    statusCode: undefined,
    responseHeaders: undefined,
    responseBody: undefined,
    isRetryable: true,
    data: undefined,
    [Symbol(vercel.ai.error)]: true,
    [Symbol(vercel.ai.error.AI_APICallError)]: true
  },
  [Symbol(vercel.ai.error)]: true,
  [Symbol(vercel.ai.error.AI_RetryError)]: true
}
[AISDKProvider] Creating embeddings for 20 texts with model: bge-m3-q4_k_m.gguf
[AISDKProvider] Provider llama does not support dimensions parameter, ignoring
[EmbeddingService] Attempt 2 failed: RetryError [AI_RetryError]: Failed after 3 attempts. Last error: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
    at _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1821:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async Promise.all (index 0)
    at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
    at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
    at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
    at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
    at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
    at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
    at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
    at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
    at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
    at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
  cause: undefined,
  reason: 'maxRetriesExceeded',
  errors: [
    APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
        at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
        at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
        at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
        at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
        at async Promise.all (index 0)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
        at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
        at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
        at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
        at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
        at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
        at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
        at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
      cause: [Error],
      url: 'http://127.0.0.1:8001/v1/embeddings',
      requestBodyValues: [Object],
      statusCode: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
      data: undefined,
      [Symbol(vercel.ai.error)]: true,
      [Symbol(vercel.ai.error.AI_APICallError)]: true
    },
    APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
        at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
        at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
        at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
        at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
        at async Promise.all (index 0)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
        at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
        at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
        at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
        at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
        at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
        at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
        at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
      cause: [Error],
      url: 'http://127.0.0.1:8001/v1/embeddings',
      requestBodyValues: [Object],
      statusCode: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
      data: undefined,
      [Symbol(vercel.ai.error)]: true,
      [Symbol(vercel.ai.error.AI_APICallError)]: true
    },
    APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
        at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
        at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
        at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
        at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
        at async Promise.all (index 0)
        at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
        at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
        at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
        at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
        at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
        at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
        at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
        at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
        at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
        at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
      cause: [Error],
      url: 'http://127.0.0.1:8001/v1/embeddings',
      requestBodyValues: [Object],
      statusCode: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
      data: undefined,
      [Symbol(vercel.ai.error)]: true,
      [Symbol(vercel.ai.error.AI_APICallError)]: true
    }
  ],
  lastError: APICallError [AI_APICallError]: Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8001
      at handleFetchError (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:293:14)
      at postToApi (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\provider-utils\dist\index.js:911:11)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
      at async OpenAICompatibleEmbeddingModel.doEmbed (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\@ai-sdk\openai-compatible\dist\index.js:1278:9)
      at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6351:41)
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
      at async _retryWithExponentialBackoff (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1809:12)
      at async Promise.all (index 0)
      at async fn (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:6329:25)
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\node_modules\ai\dist\index.js:1658:22
      at async AISDKProvider.createEmbeddings (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:2265:20)
      at async EmbeddingService.withRetry (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3456:16)
      at async EmbeddingService.embedBatchWithAdaptiveSplit (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3363:14)
      at async EmbeddingService.embedBatch (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:3310:30)
      at async KnowledgeService._indexContent (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18740:30)
      at async KnowledgeService.addDocumentFromFile (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18871:7)
      at async KnowledgeService.addDocumentsFromFolder (D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:18923:9)
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21470:26
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:20581:14
      at async D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama\out\main\index.js:21459:25
      at async Session.<anonymous> (node:electron/js2c/browser_init:2:107280) {
    cause: Error: connect ECONNREFUSED 127.0.0.1:8001
        at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16) {
      errno: -4078,
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 8001
    },
    url: 'http://127.0.0.1:8001/v1/embeddings',
    requestBodyValues: {
      model: 'bge-m3-q4_k_m.gguf',
      input: [Array],
      encoding_format: 'float',
      dimensions: undefined,
      user: undefined
    },
    statusCode: undefined,
    responseHeaders: undefined,
    responseBody: undefined,
    isRetryable: true,
    data: undefined,
    [Symbol(vercel.ai.error)]: true,
    [Symbol(vercel.ai.error.AI_APICallError)]: true
  },
  [Symbol(vercel.ai.error)]: true,
  [Symbol(vercel.ai.error.AI_RetryError)]: true
}
[AISDKProvider] Creating embeddings for 20 texts with model: bge-m3-q4_k_m.gguf
[AISDKProvider] Provider llama does not support dimensions parameter, ignoring
[