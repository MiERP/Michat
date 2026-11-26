# System map

MiChat is a local-first Electron desktop client for a notebook-scoped knowledge
base. It uses one external, loopback-only OpenAI-compatible API for chat and
embeddings. MiChat does **not** ship, start, stop, or manage a model server;
run `llama-server` or another compatible server yourself.

## Processes

| Process       | Responsibility                                                                               |
| ------------- | -------------------------------------------------------------------------------------------- |
| Electron main | SQLite, migrations, document parsing, chunking, embeddings, retrieval, IPC, updates, windows |
| Preload       | Curated `window.api` bridge; no Node.js access in the renderer                               |
| Renderer      | React UI, notebook/chat state, settings, citations, quiz view                                |
| Parser worker | Isolated `utilityProcess` that parses untrusted documents with a timeout                     |
| External API  | Chat completions, embeddings, and `GET /v1/models`; supplied by the user                     |

There are no child model processes. The main process never spawns
`llama-server`; it only sends HTTP requests to the configured loopback URL.

## Main-process modules

| Path                                        | Role                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/main/index.ts`                         | Startup order: compatibility mode, database, services, IPC, window, shutdown barrier |
| `src/main/ai/apiConfigManager.ts`           | Persist the API URL, context window, and encrypted key                               |
| `src/main/ai/apiClient.ts`                  | Discover the server's model, then build and cache chat/embedding providers           |
| `src/main/ai/OpenAICompatibleClient.ts`     | Streaming chat and embedding calls through the Vercel AI SDK                         |
| `src/main/db/`                              | Drizzle schema, migrations, queries, SQLite and `sqlite-vec` setup                   |
| `src/main/services/rag/`                    | Ingestion, chunking, embedding, vector/FTS retrieval, reranking, prompt context      |
| `src/main/services/BackgroundJobService.ts` | Idle-only queue for enrichment, links, backfill, and summaries                       |
| `src/main/ipc/`                             | Validated IPC handlers grouped by domain                                             |
| `src/main/security/`                        | CSP, navigation guards, loopback URL validation, secure web preferences              |
| `src/main/compatMode.ts`                    | Per-user renderer-sandbox fallback for blocked environments                          |

## Data flow

### Import

1. The renderer sends a file path or URL through validated IPC.
2. `KnowledgeIngestionService` validates size/type and hands bytes to the parser worker.
3. A loader extracts Markdown, headings, pages, tables, and legal metadata.
4. `ChunkingService` splits by structure; `SectionIndexService` builds section vectors.
5. `EmbeddingService` batches chunks to the configured embedding endpoint.
6. Chunks, vectors, FTS rows, sections, and document metadata are written to SQLite.

### Chat

1. `send-message` validates the request and resolves the chat provider.
2. Conversation history, persona, long-term memory, and RAG context are merged into one system message.
3. `KnowledgeRetrievalService` runs metadata-aware, hierarchical vector + FTS retrieval and optional reranking.
4. `buildRAGContext` clips documents to the token budget and keeps citation anchors.
5. The external chat API streams tokens; the main process forwards text, reasoning, usage, and finish events.

At startup and after saving the API configuration, MiChat compares the
model + endpoint signature stored on each embedding row with the current
embedding model and endpoint. A mismatch (or a chunk without a vector) triggers
a guarded, in-place re-embed of the affected notebook: chunks, FTS rows,
sections, and citations stay intact while chunk, document, and section vectors
move to the new model space.

### Background

Enrichment, link generation, vector backfill, and notebook summaries run only
while the app is idle. Heavy jobs are spaced out and cancelled when the user
starts chatting again.

## Boundaries

- API URLs must be loopback (`localhost`, `127.0.0.1`, `::1`).
- API keys are encrypted with Electron `safeStorage` when available and never returned to the renderer.
- The renderer has no Node.js access; navigation and external links are guarded.
- No telemetry; notebooks, documents, vectors, and chats stay in the local database.
- No bundled models, GGUF files, or model binaries.

## Packaging

`electron-vite` builds `out/main`, `out/preload`, and `out/renderer`.
`electron-builder` packages those bundles plus production dependencies into
`app.asar`; `better-sqlite3` and `sqlite-vec` are unpacked. The installer adds
the app icon and version metadata through `scripts/afterPack.cjs`.

## Related docs

- [API-only architecture](api-only-architecture.md)
- [Versioning and releases](versioning.md)
