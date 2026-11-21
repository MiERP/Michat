# System Map

> Historical snapshot (2026-05-04). Office assistant, mind maps, React Flow and
> cloud-provider sections below are obsolete; use README and the current source
> as the source of truth.

## Snapshot
- Updated at: `2026-05-04`
- Repository path or name: `D:\MiChat\MiChat-1.1-know\MiChat-1.1.1-merge-llama`
- Detected languages: TypeScript, TSX, SQL, CSS, HTML, JSON, YAML
- Detected frameworks/tools: Electron, electron-vite, React 19, React Router, Zustand, Tailwind CSS 4, Radix UI, TipTap, React Flow (`@xyflow/react`), better-sqlite3, Drizzle ORM, sqlite-vec, Vercel AI SDK (`ai`), Zod, electron-store, electron-updater, i18next, pdfjs-dist, mammoth, officeparser, xlsx, exceljs, docxtemplater
- Monorepo or single-project: Single-project Electron desktop app
- Primary manifests/configs examined: `package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `drizzle.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`, `src/main/ipc/validation.ts`, `src/main/db/index.ts`, `src/main/db/schema.ts`, `src/main/db/queries.ts`, `src/main/config/defaults.ts`, `src/main/config/store.ts`, `src/main/config/settingsManager.ts`, `src/main/config/ProviderConfigManager.ts`, `src/main/config/secureStorage.ts`
- Confidence note: High confidence on module layout, entry points, IPC boundaries, persistence model, and renderer-to-main dependency direction. Medium confidence on packaged runtime behavior that depends on bundled llama binaries/models and on remote `/models` responses. Low confidence on cross-platform behavior outside Windows because hardware detection and local runtime heuristics are Windows-specific or best-effort elsewhere.
- Git state: repository initialized and pushed to `origin/main` on GitHub; generated source map should be treated as repo-local documentation, not a build artifact.

## Repository Overview
- This repository implements MiChat, an Electron desktop application for building notebook-scoped knowledge bases from files, notes, and URLs, then using local AI models to chat over that knowledge and generate derived artifacts.
- Core capabilities:
  - notebook and note management backed by local SQLite
  - chat sessions with streaming assistant output
  - RAG-style ingestion, chunking, embedding, vector search, keyword search, and optional reranking
  - local llama.cpp runtime management for chat and embedding servers
  - notebook-derived quiz generation with persisted quiz sessions and scoring
  - notebook-derived mind map generation with versioned tree data
  - provider, prompt, shortcut, language, theme, and update settings
  - local file/URL import and template-based Word/Excel export
- Overall architectural style: layered Electron desktop app with a strict main/preload/renderer split. The renderer owns UI state, the preload exposes a curated IPC surface, and the main process owns persistence, AI orchestration, OS integration, and long-running services.
- Process/runtime model: Electron main process + Electron preload bridge + React renderer. The main process also spawns and monitors external llama-server child processes and uses local SQLite as the primary durable store.

## Workspace Or Project Structure
- `src/main`
  Electron main-process code: startup, IPC handlers, DB schema/query logic, vector store, AI providers, services, settings, windows.
- `src/preload`
  Context bridge layer that exposes `window.api` and selected event listeners to the renderer.
- `src/renderer/src`
  React application: routes, pages, notebook workspace, settings dialog, Zustand stores, UI primitives, and i18n wiring.
- `src/shared`
  Shared types, enums, utility functions, model classification helpers, and logger used by both main and renderer.
- `src/main/db/migrations`
  Drizzle migration history. These SQL files are copied into `out/main/db/migrations` at build time by `electron.vite.config.ts`.
- `out`
  Build output for Electron main/preload/renderer bundles. Runtime migration lookup in `src/main/db/index.ts` assumes compiled output lands here.
- `build`
  Packaging resource directory used by Electron Builder for installer metadata and platform assets.
- `resources`
  Runtime binary/model root expected by `LlamaService`. The current code uses a unified `llama-bin` folder plus a `models` directory. Source control keeps lightweight metadata/icons and ignores large GGUF models and local binaries.
- `docs`
  Repository documentation artifacts. Current state includes this canonical `system-map.md`.
- Build output relationship:
  - source lives under `src/**`
  - `electron-vite` builds to `out/**`
  - `electron-builder` packages the built app and unpacks selected runtime dependencies/resources
- Runtime/resource note:
  - `resources/models` is expected at runtime, but large `.gguf` model files are ignored from Git.
  - `resources/llama-bin` is expected by `LlamaService`; local binaries are ignored from Git to avoid committing platform binaries and large artifacts.

## Architecture Layers
- `Renderer UI and state layer`
  Main files/directories: `src/renderer/src/App.tsx`, `src/renderer/src/components/**`, `src/renderer/src/store/**`, `src/renderer/src/hooks/**`
  Responsibility: render notebook and settings UI, maintain client-side state with Zustand, subscribe to streaming/progress events, and call `window.api`.
  Dependency direction: called by React bootstrap; calls into preload `window.api`; does not directly access Node, SQLite, or service classes.
- `Preload IPC bridge layer`
  Main files/directories: `src/preload/index.ts`, `src/preload/index.d.ts`
  Responsibility: define the renderer-visible API surface, wrap IPC calls, and expose event subscriptions.
  Dependency direction: called by renderer; calls Electron `ipcRenderer`; mirrors channel names defined in main-process handlers.
- `IPC boundary and validation layer`
  Main files/directories: `src/main/ipc/index.ts`, `src/main/ipc/*Handlers.ts`, `src/main/ipc/validation.ts`
  Responsibility: register handler groups, validate inbound payloads with Zod, translate UI requests into service/query calls, and emit progress or stream events back to windows.
  Dependency direction: called by preload/renderer via IPC; calls services, query helpers, and Electron window APIs.
- `Application/service orchestration layer`
  Main files/directories: `src/main/services/**`, `src/main/providers/**`
  Responsibility: own the actual business flows: chat orchestration, retrieval, indexing, quiz/mind map generation, session rollover, updates, shortcuts, license checks, and template generation.
  Dependency direction: called by IPC handlers and startup bootstrap; calls persistence/config/vector store/providers/external binaries.
- `Persistence and infrastructure layer`
  Main files/directories: `src/main/db/**`, `src/main/vectorstore/**`, `src/main/config/**`
  Responsibility: durable data model, migrations, relational queries, vector table access, FTS tables, settings storage, secret encryption, and resource path resolution.
  Dependency direction: called by services and queries; calls SQLite, Drizzle, filesystem, Electron app paths, and safe storage APIs.
- `Shared contract/util layer`
  Main files/directories: `src/shared/types/**`, `src/shared/utils/**`, `src/shared/config/models/**`
  Responsibility: provide shared type contracts, enums, logger, and model classification logic used across process boundaries.
  Dependency direction: imported by both main and renderer; does not own runtime side effects except logging helpers.

## Module Map
- `Bootstrap and window orchestration`
  - purpose: starts the Electron app, orders service initialization, registers IPC, creates the main window, and manages shutdown cleanup
  - key paths: `src/main/index.ts`, `src/main/windows/mainWindow.ts`, `src/main/windows/quizWindow.ts`, `src/main/windows/mindMapWindow.ts`
  - depends on: DB init, provider manager, knowledge/update/shortcut/license/llama services, IPC registry
  - used by: process startup only; all runtime features depend on its initialization order
  - major external dependencies: `electron`, `@electron-toolkit/utils`, `electron-updater`
  - why it matters: startup order is not abstracted; DB, local AI runtime, settings-backed services, and IPC all come up here, so regressions in this file can make the whole app boot partially or inconsistently

- `Preload API surface`
  - purpose: exposes the entire renderer-callable contract and event subscription surface as `window.api`
  - key paths: `src/preload/index.ts`, `src/preload/index.d.ts`
  - depends on: Electron `ipcRenderer`, handler channel names defined in main
  - used by: all renderer stores and most route-level components
  - major external dependencies: `@electron-toolkit/preload`, Electron `contextBridge`
  - why it matters: channel names and payload shapes are mostly string-based conventions; any mismatch here breaks renderer behavior silently at runtime

- `IPC validation and handler registry`
  - purpose: validates inbound payloads, wires channel names to handlers, and instantiates some service objects at registration time
  - key paths: `src/main/ipc/index.ts`, `src/main/ipc/validation.ts`, `src/main/ipc/chatHandlers.ts`, `src/main/ipc/knowledgeHandlers.ts`, `src/main/ipc/providerHandlers.ts`
  - depends on: service layer, query helpers, Electron sender/window APIs, Zod schemas
  - used by: preload-exposed renderer calls and all progress/stream event paths
  - major external dependencies: `zod`, Electron `ipcMain`
  - why it matters: this is the contract boundary; dead channels, stale validation schemas, or event-name drift become cross-process failures rather than local type errors

- `SQLite schema, queries, and migration runtime`
  - purpose: defines the durable relational model for notebooks, sessions, messages, documents, chunks, embeddings, quizzes, mind maps, quiz sessions, and ordered items
  - key paths: `src/main/db/index.ts`, `src/main/db/schema.ts`, `src/main/db/queries.ts`, `src/main/db/migrations/**`
  - depends on: `better-sqlite3`, Drizzle, `sqlite-vec`, Electron user-data path resolution
  - used by: nearly every main-process feature except pure UI-only concerns
  - major external dependencies: `better-sqlite3`, `drizzle-orm`, `sqlite-vec`
  - why it matters: relational data, FTS tables, and vector tables are coordinated manually, so schema or cleanup changes have broad blast radius and can create hidden data skew

- `Vector store abstraction`
  - purpose: provides notebook-scoped vector-store instances and raw sqlite-vec query/upsert/delete operations
  - key paths: `src/main/vectorstore/VectorStoreManager.ts`, `src/main/vectorstore/SQLiteVectorStore.ts`
  - depends on: raw SQLite instance from `src/main/db/index.ts`
  - used by: `KnowledgeService` and notebook deletion cleanup in `db/queries.ts`
  - major external dependencies: `sqlite-vec`
  - why it matters: semantic retrieval depends on vector dimensions and notebook scoping staying synchronized with relational chunk/embedding metadata; the abstraction does not enforce that consistency for callers

- `Provider resolution and AI SDK adapter`
  - purpose: resolves the active provider/model from settings and stored configs, then adapts it to streaming chat and embedding APIs
  - key paths: `src/main/providers/ProviderManager.ts`, `src/main/providers/base/AISDKProvider.ts`, `src/main/providers/registry/builtinProviders.ts`, `src/main/config/ProviderConfigManager.ts`
  - depends on: settings manager, provider config manager, builtin descriptor registry, model classifier
  - used by: chat, embeddings, rerank, session summarization, quiz generation, mind map generation, provider settings
  - major external dependencies: `ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/deepseek`, `qwen-ai-provider`, `ollama-ai-provider-v2`
  - why it matters: the abstraction looks provider-agnostic, but current builtin registration is effectively llama-centric; future provider expansion will touch both registry logic and settings assumptions

- `Local llama runtime management`
  - purpose: detects machine capabilities, locates bundled llama binaries/models, starts local chat and embedding servers, and imports/removes GGUF files
  - key paths: `src/main/services/LlamaService.ts`, `src/main/ipc/llamaHandlers.ts`, `electron-builder.yml`
  - depends on: filesystem layout, child processes, local HTTP health checks, packaged resource paths
  - used by: startup bootstrap, settings UI, provider model injection
  - major external dependencies: local `llama-server` binaries and GGUF files
  - why it matters: app defaults assume this runtime exists and is reachable on fixed local ports; if resource layout or startup heuristics drift, many AI features fail together

- `Knowledge ingestion and retrieval`
  - purpose: turns notebook sources into chunks + embeddings + searchable metadata and later executes hybrid retrieval
  - key paths: `src/main/services/KnowledgeService.ts`, `src/main/services/FileParserService.ts`, `src/main/services/EmbeddingService.ts`, `src/main/services/RerankService.ts`, `src/main/services/WebFetchService.ts`, `src/main/services/loaders/**`, `src/main/services/rag/**`: document metadata projections (`DocumentRetrievalMetadata`) and the section index lifecycle (`SectionIndexService`) extracted from `KnowledgeService`; `src/main/services/import/ParserWorkerClient.ts`
  - depends on: DB schema, vector store, providers, loaders, web parsing, the document parser utility process
  - used by: knowledge IPC, chat RAG augmentation, citation previews, notebook source management
  - major external dependencies: `pdfjs-dist`, `mammoth`, `officeparser`, `xlsx`, `cheerio`, `turndown`
  - why it matters: it owns the manual sync between relational chunk rows, vector rows, FTS rows, copied source files, and notebook stats; mistakes here create partial indexing states that other layers assume are valid

- `Document parser utility process`
  - purpose: runs every document loader (PDF, DOCX, PPTX, XLSX, HTML, Markdown) outside the Electron main process so a crafted or corrupt document can only crash or exhaust memory in a disposable child
  - key paths: `src/main/workers/parserWorker.ts`, `src/main/services/import/parserProtocol.ts`, `src/main/services/import/ParserWorkerClient.ts`, `electron.vite.config.ts` (second main-process entry), `scripts/smoke-parser-worker.cjs`, `scripts/smoke-packaged.ps1`
  - depends on: Electron `utilityProcess`, `out/main/parserWorker.js` built next to `out/main/index.js`, import validation (`fileValidation.ts`)
  - used by: `KnowledgeService.addDocumentFromFile` and `KnowledgeService.reindexDocument` through `ParserWorkerClient.parseFile`
  - why it matters: the worker re-checks size/type in its own process (TOCTOU), has a parse timeout, and rejects all in-flight requests when it exits; the main process never falls back to in-process parsing inside Electron, so a broken worker bundle surfaces as a failed import instead of silently removing the isolation boundary

- `Chat orchestration and session lifecycle`
  - purpose: persists chat history, injects persona/memory/RAG context, streams assistant output, tracks token usage, and auto-switches long sessions
  - key paths: `src/main/ipc/chatHandlers.ts`, `src/main/services/SessionAutoSwitchService.ts`, `src/main/db/queries.ts`, `src/renderer/src/store/chatStore.ts`
  - depends on: provider manager, knowledge service, query helpers, preload event channels
  - used by: notebook process panel and any renderer chat UI
  - major external dependencies: Vercel AI SDK stream protocol
  - why it matters: this flow crosses persistence, retrieval, streaming events, and session rollover; a change in one stage can create duplicate messages, stale caches, or invisible context drift

- `Derived artifact generation`
  - purpose: generates versioned quizzes and mind maps from indexed notebook content
  - key paths: `src/main/services/QuizService.ts`, `src/main/services/MindMapService.ts`, `src/main/ipc/quizHandlers.ts`, `src/main/ipc/mindmapHandlers.ts`, `src/renderer/src/store/quizStore.ts`, `src/renderer/src/store/mindmapStore.ts`
  - depends on: provider manager, settings prompts, indexed documents/chunks, item ordering
  - used by: notebook workspace and dedicated quiz/mind map windows
  - major external dependencies: `ai` `streamObject`, `zod`
  - why it matters: these features reuse indexed knowledge but have separate versioning, separate window routes, and separate progress channels, so wiring gaps can leave the service correct while the UI path is dead

- `Settings, secrets, license, updates, shortcuts`
  - purpose: stores user settings, encrypts provider secrets when possible, validates the hardcoded license state, registers shortcut handling, and manages app updates
  - key paths: `src/main/config/store.ts`, `src/main/config/settingsManager.ts`, `src/main/config/secureStorage.ts`, `src/main/services/LicenseService.ts`, `src/main/services/ShortcutManager.ts`, `src/main/services/UpdateService.ts`, `src/main/ipc/settingsHandlers.ts`
  - depends on: electron-store, Electron `safeStorage`, filesystem, BrowserWindow broadcasting, updater APIs
  - used by: startup, settings dialog, process panel gating, shortcut-triggered UI flows
  - major external dependencies: `electron-store`, Electron `safeStorage`, `electron-updater`
  - why it matters: several contracts here are platform- or environment-dependent, including safe-storage fallback, hardcoded license expiry updates, and update publishing metadata

- `Renderer shell and workspace composition`
  - purpose: composes the visible product from routes, panels, dialogs, and feature-specific Zustand stores
  - key paths: `src/renderer/src/App.tsx`, `src/renderer/src/components/pages/NotebookListPage.tsx`, `src/renderer/src/components/notebook/NotebookLayout.tsx`, `src/renderer/src/components/notebook/SourcePanel.tsx`, `src/renderer/src/components/notebook/ProcessPanel.tsx`, `src/renderer/src/components/notebook/NotePanel.tsx`
  - depends on: preload API, feature stores, i18n, UI primitives
  - used by: renderer bootstrap only, but represents almost all user-facing behavior
  - major external dependencies: React, React Router, Zustand, i18next, Radix UI, TipTap, `@xyflow/react`
  - why it matters: route declarations, store subscriptions, and event-listener setup are the real UI wiring; dead routes or unused listener utilities can leave substantial code paths unreachable

## Entry Points
- `src/main/index.ts`
  Initializes the Electron app, license state, local llama runtime, database, services, IPC, and the main window. This is the primary runtime bootstrap.
- `src/preload/index.ts`
  Defines the preload bridge and the entire `window.api` contract. This is the renderer's only intended path into main-process functionality.
- `src/renderer/src/main.tsx`
  Bootstraps the React renderer, global theme CSS, i18n import side effect, and top-level error boundary.
- `src/renderer/src/App.tsx`
  Declares the active renderer routes and startup hooks for theme, platform detection, onboarding state, notebook loading, and chat listener setup.
- `src/main/ipc/index.ts`
  Registration root for IPC handlers. Also instantiates `MindMapService` and `QuizService` and wires all handler groups together.
- `src/main/windows/mainWindow.ts`
  Creates the primary BrowserWindow, installs CSP headers, loads the renderer URL/file, and syncs background color with settings.
- `src/main/windows/quizWindow.ts`
  Creates a dedicated quiz window and routes it to `#/quiz/...`.
- `src/main/windows/mindMapWindow.ts`
  Creates a dedicated mind-map window and routes it to `#/mindmap/...`.
- `src/main/ipc/settingsHandlers.ts`
  Registers settings-related IPC and global settings-change broadcasting to all windows.
- `drizzle.config.ts`
  Tooling entry point for migration generation/push against the SQLite schema.
- `electron.vite.config.ts`
  Build configuration entry point for main/preload/renderer bundles and migration file copying.
- `electron-builder.yml`
  Packaging entry point that controls extra resources, unpacked dependencies, publish target, and installer settings.

## Key Symbols
- `app.whenReady() callback in src/main/index.ts`
  - kind: method
  - file path: `src/main/index.ts`
  - responsibility: owns the true startup sequence: license check, llama startup, DB init, provider/service creation, IPC registration, and window creation
  - directly depends on: `LicenseService.ensureLicenseOnStartup`, `LlamaService.ensureStarted`, DB init helpers, `ProviderManager`, `KnowledgeService`, `UpdateService`, `ShortcutManager`, `registerAllHandlers`, `createMainWindow`
  - used by / called by: Electron app lifecycle
  - why it matters: this is the highest-blast-radius orchestration point; reordering steps here can break boot in non-obvious ways, especially when later services assume DB or local runtimes already exist

- `registerAllHandlers`
  - kind: function
  - file path: `src/main/ipc/index.ts`
  - responsibility: creates some service instances and registers every IPC handler group
  - directly depends on: `MindMapService`, `QuizService`, all handler registration functions
  - used by / called by: `src/main/index.ts`
  - why it matters: IPC wiring is centralized but string-based, so this function is where missing handler groups or stale registrations become runtime holes

- `validate`
  - kind: function
  - file path: `src/main/ipc/validation.ts`
  - responsibility: wraps IPC handlers with single-object argument validation and consistent error shaping
  - directly depends on: Zod schemas, logger
  - used by / called by: most IPC handler files
  - why it matters: many IPC contracts rely on this wrapper for safety, but the contracts are still channel-name conventions; stale schemas can reject valid UI calls or allow outdated surfaces to linger

- `validateWithEvent`
  - kind: function
  - file path: `src/main/ipc/validation.ts`
  - responsibility: validates IPC payloads while preserving access to `event.sender` for streaming/progress handlers
  - directly depends on: Zod schemas, logger
  - used by / called by: `src/main/ipc/chatHandlers.ts`
  - why it matters: chat streaming depends on this specialized path; changing it can break event-driven flows without affecting ordinary request/response handlers

- `ProviderManager`
  - kind: class
  - file path: `src/main/providers/ProviderManager.ts`
  - responsibility: registers builtin providers and resolves active chat, embedding, and rerank providers from settings and stored config
  - directly depends on: provider registry, builtin descriptors, settings manager, provider config manager
  - used by / called by: chat, embeddings, rerank, quiz, mind map, session auto-switch summary generation
  - why it matters: almost every AI-facing feature funnels through this class, and current defaults assume local llama endpoints rather than a generic provider marketplace

- `ProviderManager.getActiveChatProvider`
  - kind: method
  - file path: `src/main/providers/ProviderManager.ts`
  - responsibility: parses the `provider:model` setting, resolves the configured provider, validates chat capability, and configures the target model
  - directly depends on: settings manager, `getConfiguredProvider`, `AISDKProvider`
  - used by / called by: chat handlers, quiz service, mind map service, session auto-switch summary generation
  - why it matters: if this contract changes, multiple product features fail together because they all assume the same model-resolution format

- `AISDKProvider.sendMessageStream`
  - kind: method
  - file path: `src/main/providers/base/AISDKProvider.ts`
  - responsibility: adapts AI SDK `streamText` output into the app's custom `message-chunk` protocol, including reasoning events and usage metadata
  - directly depends on: AI SDK `streamText`, provider client instances, message conversion helper
  - used by / called by: `src/main/ipc/chatHandlers.ts`, `SessionAutoSwitchService.generateSummary`
  - why it matters: renderer chat logic expects its event shape exactly; changing chunk semantics here can break streaming UI while leaving provider calls technically successful

- `LlamaService.ensureStarted`
  - kind: method
  - file path: `src/main/services/LlamaService.ts`
  - responsibility: locates local runtime resources, picks a backend, starts chat and embedding llama-server processes, and waits for readiness
  - directly depends on: backend detection methods, filesystem layout, child-process spawn, local HTTP checks
  - used by / called by: startup callback in `src/main/index.ts`
  - why it matters: app defaults assume local servers exist on startup; failure here creates a broad "configured but unusable" state across chat and embeddings

- `initDatabase`
  - kind: function
  - file path: `src/main/db/index.ts`
  - responsibility: opens SQLite, loads `sqlite-vec`, enables WAL, creates the Drizzle DB handle, and starts checkpoint timers
  - directly depends on: Electron user-data path, `better-sqlite3`, Drizzle, `sqlite-vec`
  - used by / called by: `src/main/index.ts`
  - why it matters: vector search, migrations, and query helpers all assume this succeeds before anything else touches persistence

- `KnowledgeService`
  - kind: class
  - file path: `src/main/services/KnowledgeService.ts`
  - responsibility: manages document lifecycle, indexing, retrieval, reindexing, source-file copying, and citation/page lookup
  - directly depends on: DB, vector store manager, embedding/chunking/file-parser/web-fetch/rerank services
  - used by / called by: knowledge IPC and chat RAG
  - why it matters: this is the knowledge backbone of the application; many later features assume documents are indexed correctly and consistently

- `KnowledgeService._indexContent`
  - kind: method
  - file path: `src/main/services/KnowledgeService.ts`
  - responsibility: the true indexing pipeline: chunk generation, chunk row insertion, FTS insertion, embedding generation, embedding row insertion, vector upsert, and final status update
  - directly depends on: `ChunkingService`, `EmbeddingService`, raw SQLite FTS statements, `vectorStoreManager`
  - used by / called by: `addDocument`, `addDocumentFromFile`, `reindexDocument`
  - why it matters: this is a manual multi-store sync routine; partial failures can leave relational rows, vector rows, and FTS rows out of sync

- `KnowledgeService.search`
  - kind: method
  - file path: `src/main/services/KnowledgeService.ts`
  - responsibility: executes hybrid retrieval via embeddings + FTS + reciprocal rank fusion + optional reranking, then hydrates documents/chunks for citations
  - directly depends on: `EmbeddingService.embed`, `SQLiteVectorStore.query`, raw FTS SQL, `RerankService`
  - used by / called by: `src/main/ipc/chatHandlers.ts`, `src/main/ipc/knowledgeHandlers.ts`
  - why it matters: relevance and citation quality depend on multiple retrieval stages agreeing on IDs and score semantics; this is a subtle hotspot for ranking regressions

- `SessionAutoSwitchService.recordTokenUsageAndCheckSwitch`
  - kind: method
  - file path: `src/main/services/SessionAutoSwitchService.ts`
  - responsibility: updates accumulated session token counts and transparently rolls conversations into a new session when the threshold is reached
  - directly depends on: `db/queries.updateSessionTokens`, `switchSession`
  - used by / called by: chat completion logic in `src/main/ipc/chatHandlers.ts`
  - why it matters: this mutates chat topology implicitly; a bug here can archive sessions unexpectedly or lose continuity across hidden session boundaries

- `MindMapService.generateMindMap`
  - kind: method
  - file path: `src/main/services/MindMapService.ts`
  - responsibility: creates the persisted record, aggregates indexed chunks, calls structured generation, validates output, and inserts the corresponding `items` row
  - directly depends on: DB, settings manager, provider manager, `streamObject`
  - used by / called by: `src/main/ipc/mindmapHandlers.ts`
  - why it matters: this service is structurally correct but the renderer route/listener wiring around it is incomplete, so feature correctness and feature reachability can diverge

- `QuizService.generateQuiz`
  - kind: method
  - file path: `src/main/services/QuizService.ts`
  - responsibility: creates the persisted quiz record, aggregates notebook content, runs structured question generation, validates questions, and creates the corresponding `items` row
  - directly depends on: DB, settings manager, provider manager, `streamObject`
  - used by / called by: `src/main/ipc/quizHandlers.ts`
  - why it matters: quiz generation shares much of the same knowledge assumptions as RAG, but adds versioning and session scoring, so regressions show up in more than one user flow

- `setupChatListeners`
  - kind: function
  - file path: `src/renderer/src/store/chatStore.ts`
  - responsibility: subscribes to stream, error, and auto-switch events and reconciles them into renderer state
  - directly depends on: preload event hooks, Zustand store mutation
  - used by / called by: `src/renderer/src/App.tsx`
  - why it matters: the renderer does not wait for a final full response; it relies on this listener graph, so stale event names or cache cleanup bugs appear as broken UI rather than thrown errors

- `useShortcutExecutor`
  - kind: function
  - file path: `src/renderer/src/hooks/useShortcutExecutor.ts`
  - responsibility: bridges main-process shortcut actions into renderer `CustomEvent`s
  - directly depends on: `window.electron.ipcRenderer`, `ShortcutAction`
  - used by / called by: `src/renderer/src/App.tsx`
  - why it matters: shortcut handling is split across main IPC events and renderer custom events; missing action coverage leaves dead listeners in UI components

- `ProcessPanel`
  - kind: component
  - file path: `src/renderer/src/components/notebook/ProcessPanel.tsx`
  - responsibility: main chat workspace panel, provider/license gating, title editing, input handling, and send/stop controls
  - directly depends on: chat store, notebook store, settings/provider config events
  - used by / called by: `NotebookLayout`
  - why it matters: this is the main user action surface; it combines business gating and UI input handling, so stale listeners or missing shortcut events directly affect the core workflow

- `defaultSettings`
  - kind: constant
  - file path: `src/main/config/defaults.ts`
  - responsibility: defines default models, prompt templates, RAG thresholds, rerank defaults, theme/language defaults, and default shortcuts
  - directly depends on: shared settings and shortcut types
  - used by / called by: config store initialization, settings manager merge logic, prompt consumers
  - why it matters: several cross-file contracts originate here, including fixed ports/models and retrieval thresholds; drift between this constant and consuming logic creates subtle behavior mismatches

## Main Flows
- `App startup sequence`
  1. `src/main/index.ts` waits for `app.whenReady()`.
  2. `LicenseService.ensureLicenseOnStartup()` validates the hardcoded license name/key and caches the resulting status.
  3. `LlamaService.ensureStarted()` attempts to auto-start local chat and embedding servers.
  4. `initDatabase()` opens SQLite and loads `sqlite-vec`.
  5. `runMigrations()` applies SQL migrations from the compiled output folder.
  6. `initExtensions()` ensures `vec_embeddings` and `fts_chunks` virtual tables exist.
  7. Provider, session-switch, knowledge, update, and shortcut services are instantiated.
  8. `registerAllHandlers(...)` wires IPC.
  9. `createMainWindow()` loads the renderer and later update/shortcut services receive the window reference.

- `Primary user chat flow`
  1. `ProcessPanel` calls `chatStore.sendMessage(sessionId, content)`.
  2. `chatStore.sendMessage()` sends the request through `window.api.sendMessage()`.
  3. `src/main/ipc/chatHandlers.ts` persists the user message and an empty assistant placeholder.
  4. The handler loads message history, validates/cleans it, and prepends persona and archived-session memory prompts.
  5. If an embedding model is configured and the input is not treated as chit-chat, `KnowledgeService.search()` retrieves RAG context.
  6. `ProviderManager.getActiveChatProvider()` resolves the active model and `AISDKProvider.sendMessageStream()` starts streaming.
  7. `message-chunk` and `message-error` events are emitted back to the renderer.
  8. `setupChatListeners()` merges chunk updates into the current assistant message in Zustand state.
  9. On completion, the main process persists final content, reasoning content, and citations.
  10. Token usage is recorded and `SessionAutoSwitchService.recordTokenUsageAndCheckSwitch()` may archive/switch sessions.

- `Knowledge ingestion pipeline`
  1. `SourcePanel` chooses file, folder, URL, text, or note ingestion.
  2. The renderer calls the relevant `window.api.knowledge.*` method.
  3. `knowledgeHandlers.ts` forwards to `KnowledgeService`.
  4. `KnowledgeService.addDocument*()` creates a `documents` row with status `processing`.
  5. Files are parsed through `FileParserService` loaders or URLs through `WebFetchService`.
  6. `_indexContent()` chunks the content and inserts `chunks` rows.
  7. `_indexContent()` inserts matching FTS rows into `fts_chunks`.
  8. `EmbeddingService.embedBatch()` generates embeddings via the active embedding provider.
  9. Embedding metadata rows are inserted and vectors are upserted into `vec_embeddings`.
  10. The document status is updated to `indexed` and progress events are sent to the renderer.

- `Hybrid retrieval flow`
  1. `KnowledgeService.search()` embeds the query.
  2. `SQLiteVectorStore.query()` performs KNN retrieval over `vec_embeddings`.
  3. Raw SQLite FTS SQL queries `fts_chunks`.
  4. Reciprocal rank fusion combines vector and keyword candidates.
  5. `RerankService.rerank()` optionally applies provider or heuristic reranking.
  6. Matching chunks and documents are reloaded from relational tables.
  7. Expanded neighboring chunk context and citation metadata are returned to the caller.

- `Quiz generation flow`
  1. The renderer calls `window.api.quiz.generate(notebookId, options)`.
  2. `quizHandlers.ts` delegates to `QuizService.generateQuiz()`.
  3. The service creates a `quizzes` row in `generating` state plus a new `items` row.
  4. Notebook content is aggregated from recently indexed documents/chunks.
  5. Prompt text is resolved from settings and difficulty/question count are injected.
  6. `streamObject()` generates a structured quiz payload.
  7. The result is validated, deduplicated, and converted into `chunkMapping`.
  8. The persisted quiz row is updated to `completed`, and `quiz:progress` events drive the renderer UI.

- `Mind map generation flow`
  1. The renderer calls `window.api.mindmap.generate(notebookId)`.
  2. `mindmapHandlers.ts` delegates to `MindMapService.generateMindMap()`.
  3. The service creates a `mind_maps` row in `generating` state plus a new `items` row.
  4. Recent indexed notebook content is aggregated and trimmed for prompt size.
  5. Prompt text is resolved from settings and `streamObject()` generates a structured tree.
  6. The tree is validated, normalized, deduplicated, and rechecked against real chunk IDs.
  7. The persisted mind map row is updated to `completed`, and `mindmap:progress` events are emitted.

- `Notebook deletion cascade`
  1. The renderer calls `window.api.deleteNotebook(id)`.
  2. `delete-notebook` IPC delegates to `db/queries.deleteNotebook(id)`.
  3. The query layer loads local-file paths and notebook chunk IDs.
  4. The vector store deletes embeddings by chunk IDs.
  5. Raw SQLite deletes notebook rows from `fts_chunks`.
  6. The notebook row is deleted; relational cascades remove sessions, messages, documents, chunks, embeddings, quizzes, mind maps, and items.
  7. Copied local source files are deleted from the knowledge-files directory.
  8. `vectorStoreManager.closeStore(id)` closes the notebook-scoped store instance.

## Dependency Map
- `Central dependency spine`
  - Renderer components and Zustand stores call `window.api` methods or subscribe to preload events.
  - `src/preload/index.ts` bridges those calls to string-named IPC channels.
  - `src/main/ipc/*.ts` validates payloads, coordinates services, and persists state.
  - Services depend on the query layer, provider layer, Electron platform APIs, filesystem storage, and local/remote model boundaries.
  - Durable state is split across SQLite relational tables, `sqlite-vec` virtual tables, FTS virtual tables, and `electron-store`.

- `Highest fan-in modules`
  - `src/preload/index.ts`
    - many renderer pages, hooks, and stores depend on this contract
  - `src/main/db/schema.ts`
    - every persistent feature inherits table and relation assumptions from here
  - `src/main/db/queries.ts`
    - notebook/session/message/item CRUD converges here
  - `src/main/ipc/validation.ts`
    - a large share of renderer-to-main contracts depend on these schemas
  - `src/main/providers/ProviderManager.ts`
    - chat, embeddings, rerank, settings validation, and provider status all depend on this resolver
  - `src/main/config/defaults.ts`
    - ports, model IDs, prompt templates, retrieval thresholds, and shortcuts fan out from here
  - `src/main/index.ts`
    - boot order and service composition are centralized here

- `Fragile couplings`
  - Embedding dimension `1024` is repeated across `src/main/db/index.ts`, `src/main/vectorstore/SQLiteVectorStore.ts`, `src/main/vectorstore/VectorStoreManager.ts`, and `src/main/services/KnowledgeService.ts`; changing model dimensions requires synchronized edits and migration care.
  - Local llama ports `8000` and `8001` are repeated across `src/main/config/defaults.ts`, `src/main/config/store.ts`, `src/main/providers/registry/builtinProviders.ts`, and `src/main/services/LlamaService.ts`.
  - Knowledge indexing must keep `documents`, `chunks`, `embeddings`, `vec_embeddings`, and `fts_chunks` in sync manually; partial failure leaves search quality or cleanup behavior inconsistent.
  - String-based IPC channel names must stay aligned between `src/preload/index.ts` and the corresponding main-process handlers.
  - `ProviderConfigManager` relies on Electron `safeStorage`, but has a plaintext fallback path when encryption is unavailable.

- `Major external boundaries`
  - Local llama HTTP services for chat and embeddings
  - Filesystem storage under Electron `userData`
  - Packaged runtime resources declared in `resources/` and `electron-builder.yml`
  - Remote update checks through the updater service / GitHub release infrastructure
  - User-provided files, folders, notes, and fetched URLs for knowledge ingestion

- `Circular dependencies or hidden loops`
  - No obvious TypeScript import cycle was confirmed from the central files inspected.
  - The most important runtime feedback loop is behavioral: settings -> provider resolution -> knowledge/chat generation -> persisted usage -> session auto-switch -> renderer refresh.
  - The database has self-referential session lineage through `chat_sessions.parentSessionId`, which matters for archived-session prompt reconstruction.

## Impact Map
- `If src/preload/index.ts changes`
  - likely regression: renderer pages silently lose IPC methods or event subscriptions because channel names or payload shapes drift
  - verify by: opening notebook/chat/settings flows and checking that stream/progress events still arrive

- `If src/main/db/schema.ts or migrations change`
  - likely regression: startup migration failures, orphaned rows, broken Drizzle query assumptions, or extension/table mismatch
  - verify by: launching on a non-empty profile and creating/deleting notebooks, sessions, sources, quizzes, and mind maps

- `If src/main/db/queries.ts changes`
  - likely regression: notebook/session/message CRUD breaks, delete cascades miss copied files or vector cleanup, item ordering becomes unstable
  - verify by: create/edit/delete notebooks and confirm local knowledge files disappear when expected

- `If src/main/services/KnowledgeService.ts`, `src/main/services/rag/**`, or the parser worker changes`
  - likely regression: indexing stalls, vector and FTS rows desynchronize, citations reference missing chunks, reindex cleanup leaves stale search results, or file imports fail because the parser worker bundle/message protocol drifted
  - verify by: ingest a mixed-source notebook, search it, then reindex/remove a document and compare results; run `pnpm smoke:parser-worker` after a build and the packaged parser smoke from `pnpm check:package`

- `If src/main/providers/ProviderManager.ts` or `src/main/providers/base/AISDKProvider.ts` changes
  - likely regression: wrong active model/provider resolution, broken embedding availability, or invalid assumptions about local keyless providers
  - verify by: switching providers/models in settings and running both chat and indexing

- `If src/main/services/LlamaService.ts changes`
  - likely regression: app boots with default providers configured but local runtime never becomes reachable, especially on first run
  - verify by: cold-start the desktop app on a machine without prestarted servers and inspect provider readiness

- `If src/main/ipc/chatHandlers.ts changes`
  - likely regression: stream events break, assistant messages double-save, citations/reasoning content disappear, or session rollover stops
  - verify by: sending multi-turn messages, forcing longer responses, and checking persisted history after reload

- `If src/main/config/defaults.ts changes`
  - likely regression: first-run defaults point to missing models, wrong ports, unusable prompts, or shortcut conflicts
  - verify by: testing a fresh profile with no prior settings store

- `If src/renderer/src/components/notebook/NotebookLayout.tsx`, `ProcessPanel.tsx`, or `src/renderer/src/store/chatStore.ts` changes
  - likely regression: the main workspace renders but chat/session/source side effects no longer stay in sync
  - verify by: opening a notebook, chatting, indexing content, switching tabs, and reloading the window

## Cross-Validation Findings
- `Mind map dedicated window route does not match the active router`
  - `src/main/windows/mindMapWindow.ts` opens `#/mindmap/:notebookId` and `#/mindmap/view/:mindMapId`.
  - `src/renderer/src/components/pages/MindMapPage.tsx` exists as the expected page.
  - `src/renderer/src/App.tsx` does not register `/mindmap/:notebookId` or `/mindmap/view/:mindMapId`.
  - impact: opening a separate mind map window is likely to land on an unrouted page in the current renderer.

- `mindmap:progress is emitted and exposed, but the listener setup appears unused`
  - `src/main/ipc/mindmapHandlers.ts` emits `mindmap:progress`.
  - `src/preload/index.ts` exposes the event subscription.
  - `src/renderer/src/store/mindmapStore.ts` defines `setupMindMapListeners()`.
  - No call site for `setupMindMapListeners()` was found in the renderer search.
  - impact: generation progress may never update in the UI even if main-process events fire.

- `message-complete looks like a dead event`
  - `src/main/ipc/chatHandlers.ts` emits `message-complete`.
  - No matching preload exposure was found.
  - No renderer subscriber was found.
  - impact: this event currently appears unused and can mislead future maintainers about stream completion behavior.

- `shortcut:send-message listener appears dead`
  - `src/renderer/src/components/notebook/ProcessPanel.tsx` listens for `shortcut:send-message`.
  - `src/renderer/src/hooks/useShortcutExecutor.ts` dispatches only create notebook, close notebook, toggle knowledge base, and toggle creative space events.
  - `src/shared/types/index.ts` does not define a send-message shortcut action.
  - impact: the send-message shortcut path appears incomplete or stale.

- `Provider model discovery IPC surface appears stale or partially disconnected`
  - `fetch-models` and `get-provider-models` are registered in main and exposed in preload.
  - No renderer call sites for either method were found in the inspected tree.
  - `ProviderSchemas.fetchModels` requires a non-empty `apiKey`, while the default built-in llama-local stack is keyless.
  - impact: this IPC surface may be leftover code or may no longer match the intended product behavior.

- `resources/ contains local runtime layout, but large assets are intentionally ignored from Git`
  - `src/main/services/LlamaService.ts` expects a resource root with `llama-bin` and `models`.
  - the workspace has `resources/icon.png`, `resources/llama-bin/`, and `resources/models/`, but `.gitignore` excludes GGUF models and local binaries.
  - impact: fresh clones need runtime binaries/models supplied separately before local llama startup can succeed.

## Hotspots
- `High fan-in files`
  - `src/preload/index.ts`
  - `src/main/db/schema.ts`
  - `src/main/db/queries.ts`
  - `src/main/ipc/validation.ts`
  - `src/main/providers/ProviderManager.ts`
  - `src/main/config/defaults.ts`

- `High fan-out / orchestration-heavy files`
  - `src/main/index.ts`
  - `src/main/services/KnowledgeService.ts`
  - `src/main/services/LlamaService.ts`
  - `src/main/ipc/chatHandlers.ts`
  - `src/renderer/src/components/notebook/NotebookLayout.tsx`
  - `src/renderer/src/components/notebook/ProcessPanel.tsx`
  - `src/renderer/src/store/chatStore.ts`

- `Cross-store consistency hotspots`
  - Knowledge indexing and deletion touch relational rows, vector rows, FTS rows, copied local files, and progress events.
  - Notebook deletion spans DB cascades plus manual vector/FTS/filesystem cleanup.
  - Session auto-switch couples usage accounting, session archiving, and prompt reconstruction.

- `Configuration hotspots`
  - Model IDs, ports, prompt templates, retrieval thresholds, and shortcuts originate in a few central defaults/config files.
  - Packaged resource paths are shared assumptions across runtime startup and build-time packaging.

- `UI-to-main contract hotspots`
  - Any rename or payload drift in preload or IPC validation can break the renderer without obvious compile-time protection.
  - Route registration and secondary-window hash paths must stay synchronized manually.

## Unknowns And Low-Confidence Areas
- `Packaged runtime resources`
  - what is unknown: how chat/embedding binaries and bundled model assets are supplied for public distribution
  - why confidence is low: source control intentionally ignores large GGUF models and local binaries, while runtime and builder config expect them
  - how to resolve: inspect CI/build artifacts or run a packaged app and compare the unpacked resources layout

- `Provider model discovery product path`
  - what is unknown: whether `fetch-models` / `get-provider-models` are intentionally dormant, partially migrated, or still used behind an uninspected UI path
  - why confidence is low: the IPC exists, but no renderer call site was found and the schema conflicts with keyless defaults
  - how to resolve: exercise the settings UI end-to-end with devtools/network logging and confirm intended provider onboarding flows

- `Cross-platform runtime behavior`
  - what is unknown: whether path resolution, llama startup, and packaging assumptions behave the same on macOS and Linux
  - why confidence is low: the inspected session stayed on Windows code paths and static reads
  - how to resolve: run smoke tests on each supported OS, especially around `safeStorage`, path separators, and spawned runtimes

- `Updater behavior in real packaged builds`
  - what is unknown: whether update checks/downloads/install prompts work cleanly outside development
  - why confidence is low: updater logic was inspected statically only
  - how to resolve: test against a packaged release channel with valid update metadata


## Suggested First Read For Future Sessions
- `src/main/index.ts`
  - best single-file view of startup order, service composition, and app-wide orchestration

- `src/preload/index.ts`
  - canonical renderer-to-main contract for methods and event subscriptions

- `src/main/ipc/chatHandlers.ts`
  - highest-value business flow: streaming chat, citations, persistence, and session rollover entry point

- `src/main/services/KnowledgeService.ts`
  - most important hotspot for ingestion, retrieval, reranking, and multi-store consistency

- `src/main/db/schema.ts`
  - durable data model for notebooks, sessions, documents, chunks, embeddings, quizzes, mind maps, settings, and license state

- `src/main/db/queries.ts`
  - practical CRUD and cascade behavior that many IPC paths ultimately rely on

- `src/main/providers/ProviderManager.ts`
  - central resolver for active chat, embedding, and rerank providers/models

- `src/main/services/LlamaService.ts`
  - local runtime assumptions, binary/model path logic, and startup failure modes

- `src/renderer/src/App.tsx`
  - active route surface and the fastest way to notice missing route coverage such as mind map windows

- `src/renderer/src/components/notebook/NotebookLayout.tsx`
  - main workspace shell where notebook-level panels, tabs, and derived features meet

- `src/renderer/src/store/chatStore.ts`
  - renderer-side streaming state, message reconciliation, and notebook chat UX behavior

- `src/main/config/defaults.ts`
  - default prompts, thresholds, ports, models, and shortcuts that shape first-run behavior
