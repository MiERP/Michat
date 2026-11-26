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
- Embedding API base URL: `http://127.0.0.1:8081/v1` when embeddings run on a
  separate server; leave blank when they share the chat server.

Model names are not entered here. MiChat calls `GET /v1/models` on each endpoint
and uses the first model the server advertises (`qwen-local` and `bge-m3` in the
example above).

MiChat never launches these processes and never reads model files. Starting,
stopping, GPU flags, and model downloads are the server's responsibility.

## Configuration

Settings → API stores `baseUrl`, optional `apiKey`, an optional separate
`embeddingBaseUrl`, and `contextWindow`. Model names are not configuration:
MiChat takes the first model advertised by each endpoint at `GET /models`, so
the external server owns model selection and switching.

- Base URLs must be loopback (`localhost`, `127.0.0.1`, `::1`) and normally end
  in `/v1`.
- The API key is encrypted with Electron `safeStorage` when available and is
  never returned to the renderer.
- “Test connection” checks reachability only. It does not display model names,
  because the server owns model choice and may expose an alias that differs
  from the loaded model file.
- If chat and embeddings share one gateway, its embedding model id should contain
  `embed`, `bge`, `e5`, or `gte`. A single-model server always uses its only
  advertised id, but a multi-model gateway with no embedding-like id gets no
  embedding provider: MiChat refuses instead of silently embedding with a
  chat model, and the first embedding call explains that no embedding model
  is loaded on the server.
- Discovered models are cached for 60 seconds; saving the API configuration
  clears the cache. Legacy `chatModel` / `embeddingModel` keys are removed from
  the store and are not part of the renderer contract.
- Switching to a different embedding model on the server is picked up within
  that 60-second window: the changed model signature marks the affected
  notebooks stale and their vectors are re-embedded automatically before
  retrieval.

## Main process

| Module                                  | Role                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/main/ai/apiConfigManager.ts`       | Encrypted persistence and public view of the API configuration                     |
| `src/main/ai/apiClient.ts`              | Builds and caches chat/embedding clients, tests `/models`                          |
| `src/main/ai/OpenAICompatibleClient.ts` | Streaming chat and embedding calls through the Vercel AI SDK                       |
| `src/main/ipc/apiHandlers.ts`           | `api:get-config`, `api:save-config`, `api:test-connection`, `api:check-encryption` |

Embedding dimension validation still enforces 1024 dimensions before indexing.
When the embedding model or endpoint changes, MiChat compares the
`model@endpoint` signature stored with each vector against the current one and
re-embeds the affected notebooks in place; chunk IDs and citations are
preserved, and vectors from different spaces are never mixed in one search.

## Packaging

The installer contains the Electron app only; no GGUF files or model binaries.
`build/icon.ico` is applied to the app and installer by
`scripts/afterPack.cjs` (resedit) so branding does not depend on winCodeSign.
