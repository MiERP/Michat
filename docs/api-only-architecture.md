# API-only architecture

MiChat no longer ships or manages a model runtime. Chat, embeddings, and model
discovery come from a single external **local** OpenAI-compatible API.

## Configuration

Settings → API stores `baseUrl`, optional `apiKey`, `chatModel`,
`embeddingModel`, an optional separate `embeddingBaseUrl`, and `contextWindow`.

- Base URLs must be loopback (`localhost`, `127.0.0.1`, `::1`) and normally end
  in `/v1`.
- The API key is encrypted with Electron `safeStorage` when available and is
  never returned to the renderer.
- “Test connection” calls `GET {baseUrl}/models` with the optional Bearer token.

## Main process

| Module | Role |
| --- | --- |
| `src/main/ai/apiConfigManager.ts` | Encrypted persistence and public view of the API configuration |
| `src/main/ai/apiClient.ts` | Builds chat/embedding clients from the configuration, tests `/models` |
| `src/main/ai/OpenAICompatibleClient.ts` | Streaming chat and embedding calls through the Vercel AI SDK |
| `src/main/ipc/apiHandlers.ts` | `api:get-config`, `api:save-config`, `api:test-connection`, `api:check-encryption` |

Embedding dimension validation still enforces 1024 dimensions before indexing.

## Removed

- `src/main/services/LlamaService.ts`, `src/main/services/llama/`, `src/main/ipc/llamaHandlers.ts`
- `src/main/providers/` (registry, manager, policy, capability descriptors)
- model import/removal/list IPC and preload APIs
- bundled `resources/llama-bin` and `resources/models`
- runtime-asset checks and the model-less/slim packaging split

## Packaging

The installer contains the Electron app only; no GGUF files or llama binaries.
`build/icon.ico` is applied to the app and installer by
`scripts/afterPack.cjs` (resedit) so branding does not depend on winCodeSign.
