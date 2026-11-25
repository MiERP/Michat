# API-only architecture

MiChat is an API-only client. It does not ship, start, stop, or manage a model
runtime. Chat, embeddings, and model discovery come from an external **local**
OpenAI-compatible API that you run yourself.

## Recommended setup: llama-server

Run chat and embedding models as separate `llama-server` processes, or point
both settings at one server if it serves both endpoints.

```bash
# Chat model (example)
llama-server -m models/Qwen3.5-4B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 8192 --alias qwen-local

# Embedding model (example; must return 1024-dimensional vectors)
llama-server -m models/bge-m3-q4_k_m.gguf \
  --host 127.0.0.1 --port 8081 --embeddings --alias bge-m3
```

Then open **Settings → API**:

- Base URL: `http://127.0.0.1:8080/v1`
- Chat model: `qwen-local` (the alias or model id shown by `GET /v1/models`)
- Embedding model: `bge-m3`
- Embedding API base URL: `http://127.0.0.1:8081/v1` when embeddings run on a
  separate server; leave blank when they share the chat server.

MiChat never launches these processes and never reads model files. Starting,
stopping, GPU flags, and model downloads are the server's responsibility.

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
| `src/main/ai/apiClient.ts` | Builds and caches chat/embedding clients, tests `/models` |
| `src/main/ai/OpenAICompatibleClient.ts` | Streaming chat and embedding calls through the Vercel AI SDK |
| `src/main/ipc/apiHandlers.ts` | `api:get-config`, `api:save-config`, `api:test-connection`, `api:check-encryption` |

Embedding dimension validation still enforces 1024 dimensions before indexing.
When the embedding model or endpoint changes, MiChat compares the
`model@endpoint` signature stored with each vector against the current one and
re-embeds the affected notebooks in place; chunk IDs and citations are
preserved, and vectors from different spaces are never mixed in one search.

## Packaging

The installer contains the Electron app only; no GGUF files or model binaries.
`build/icon.ico` is applied to the app and installer by
`scripts/afterPack.cjs` (resedit) so branding does not depend on winCodeSign.
