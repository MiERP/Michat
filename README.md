<div align="center">

# MiChat

[![Latest release](https://img.shields.io/github/v/release/MiERP/Michat?label=release)](https://github.com/MiERP/Michat/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

> A local-first, open-source alternative to Google NotebookLM
> Bring your own local OpenAI-compatible API. No Docker, no bundled model runtime.

**Turn your documents into a searchable, conversational knowledge base**

[Download](#download) · [Quick start](#quick-start) · [Architecture](docs/api-only-architecture.md) · [Versioning](docs/versioning.md)

</div>

---

## Why MiChat?

I really like the idea behind **Google NotebookLM**:
upload documents, build context, and reason over them with LLMs.

But I wanted a few things it doesn't give me:

- Using my own **private or self-managed local API**
- Keeping **all data and model traffic local**, without cloud lock-in
- Trying the tool **without Docker, model downloads, or a bundled runtime**

Many "Open Notebook" projects are powerful, but most rely on Docker or ship a
model stack. MiChat is a small Electron desktop app that keeps the notebook
workflow and leaves the model server to an application you already trust.

This is my **first open-source project**. It's still early, but the core idea
works, and feedback is very welcome.

---

## What MiChat does

- 📚 Build a local knowledge base from documents, notes, and web pages
- 💬 Chat, summarize, and reason with your content
- 🔌 Connect to any **local OpenAI-compatible API** (LM Studio, llama.cpp server,
  Ollama, vLLM, or your own gateway)
- 🔍 RAG retrieval with precise source traceability
- 🖥️ Native desktop app built with Electron — no Docker required

MiChat does **not** bundle models, start a model server, or manage model files.
You configure an API once and MiChat uses it for chat and embeddings.

### What's new in 2.2.0

- **Better legal-document answers:** `Chương`/`Mục`/`Điều` headings become real sections, so
  retrieval can use document → section → chunk context instead of isolated 250-character chunks.
- **More reliable citations:** article-number boost for questions that name `Điều N`, plus
  definition-question handling for `khoản 10b`/`10c`-style definitions.
- **No more empty answers:** persona, memory, and RAG context are merged into one system message
  that OpenAI-compatible chat templates accept.
- **Faster replies:** tighter RAG budget, `temperature=0.2`, 1,400-token output cap, and shorter
  grounded answers.

> Upgrading from 2.1.x: re-index each legal PDF once (source panel → **Trích xuất lại**) so the
> new section index is built. Chat answers improve only after the document is re-indexed.

### What's new in 2.2.1

- **llama-server-first setup:** the default API address is now `http://127.0.0.1:8080/v1`
  (llama-server's default). MiChat remains a pure client: it does not start, stop, bundle, or
  manage the model server.
- **Separate embedding server:** Settings → API now exposes an optional embedding base URL, so a
  chat `llama-server` on 8080 and a `bge-m3` embedding server on 8081 can be used together.
- **Faster first answer:** retrieval validates the query vector instead of making a separate
  embedding probe, and chat/embedding providers are cached until the saved configuration changes.
- **Safe embedding changes:** if the embedding model or endpoint changes, MiChat detects the
  stale vectors and re-embeds the affected notebooks in place instead of searching incompatible
  vectors. Chunk IDs and citations are preserved.
- **Stricter privacy:** a legacy or hand-edited `embeddingBaseUrl` must also be loopback-only.
- **Compatibility mode:** if security software (for example Kaspersky) blocks Electron's renderer
  sandbox, MiChat detects the renderer exit before the first paint, asks for confirmation, writes
  a local marker, and relaunches once with `--no-sandbox`. Other machines keep the sandbox
  enabled. After adding MiChat to the security software exclusions, run
  `MiChat.exe --reset-compat-mode` (or delete `%APPDATA%\michat\compat-no-sandbox`) to return to
  the default sandbox.

---

## Download

Get the latest build from
[GitHub Releases](https://github.com/MiERP/Michat/releases/latest):

- Windows installer: `michat-<version>-setup.exe`
- Source archives for every tag

Local builds are unsigned, so Windows SmartScreen may show a warning.

---

## Quick start

1. Start your own `llama-server` (MiChat does not launch it):

   ```bash
   # Chat model
   llama-server -m models/Qwen3.5-4B-Q4_K_M.gguf \
     --host 127.0.0.1 --port 8080 --ctx-size 8192 --alias qwen-local

   # Embedding model (1024-dimensional, for example bge-m3)
   llama-server -m models/bge-m3-q4_k_m.gguf \
     --host 127.0.0.1 --port 8081 --embeddings --alias bge-m3
   ```

2. Install and open MiChat, then go to **Settings → API**.
3. Enter:
   - **Base URL** — `http://127.0.0.1:8080/v1` (llama-server default)
   - **API key** — optional; encrypted with the OS keystore when available
   - **Chat model** — exact model id advertised by `/v1/models` (for example `qwen-local`)
   - **Embedding model** — must return **1024-dimensional** vectors (for example `bge-m3`)
   - **Embedding API base URL** — `http://127.0.0.1:8081/v1` when embeddings run separately;
     leave blank when chat and embeddings share one server
   - **Context window** — used for automatic session switching
4. Click **Test Connection**, then **Save**.
5. Import documents or create notes and start chatting.

Only loopback endpoints are accepted: `localhost`, `127.0.0.1`, or `::1`.

The API must expose OpenAI-compatible:

- `GET /v1/models`
- chat completions (streaming)
- embeddings

---

## Key features

### 📚 Document management

- PDF, Word (`.docx`), PowerPoint (`.pptx`), Excel, Markdown, text, and web pages
- Structure-aware parsing with headings, sections, pages, and metadata
- Fast local storage with SQLite and Drizzle

### 🤖 AI-powered Q&A

- Retrieval-Augmented Generation (RAG) with hierarchical, metadata-aware search
- Bring your own local chat and embedding models through one API
- Answers with precise source references
- Quiz generation from indexed knowledge

### 🔒 Local-first by design

- All notebooks, documents, embeddings, and chats stay on your machine
- Only the configured loopback API is contacted
- API keys are encrypted at rest and never exposed to the renderer
- No telemetry

### ⚡ Lightweight

- No Docker, no bundled model runtime, no multi-gigabyte model downloads
- Installer stays under 200 MB
- Source builds for Windows, macOS, and Linux

---

## Requirements

- An external local OpenAI-compatible API with chat and embedding endpoints
- Windows 10/11 for the published installer
- Node.js 22 and pnpm 11 when building from source
- Embeddings must produce 1024-dimensional vectors

macOS and Linux can be built from source, but packaged installers for those
platforms are not validated yet.

---

## Building and testing

```bash
pnpm install
pnpm dev              # development app
pnpm build            # typecheck + main/preload/renderer bundles
pnpm test             # unit and integration tests
pnpm test:e2e         # Playwright Electron smoke test
pnpm build:win        # Windows installer
pnpm release:build    # version check + Windows installer
```

`package.json` is the single source of truth for the version. Use
`pnpm version:patch|minor|major --note "..."` before building a new release.
See [`docs/versioning.md`](docs/versioning.md) for the full release flow.

---

## Project status

MiChat is early-stage. The API-only 2.x line is the current direction: MiChat
owns the notebook, retrieval, and chat experience, while a separate local server
owns model execution.

### Current limitations

- MiChat does not bundle models or a model runtime. A local OpenAI-compatible
  API must be provided by another application.
- Only loopback API endpoints are accepted.
- Scanned/image-only PDFs need an OCR engine, which is not bundled yet.
- Office document generation was removed; the note editor and quiz generation
  remain.
- Packaged and signing flows for macOS/Linux still need their own CI coverage.
- See [`docs/security/dependency-exceptions.md`](docs/security/dependency-exceptions.md)
  for accepted dependency advisories.

---

## Roadmap

### ✅ Completed

- API-only architecture (v2.0.0)
- External local OpenAI-compatible API configuration and connection test
- Encrypted API key storage
- Structured note generation
- Hierarchical, metadata-aware RAG with source citations
- Multi-format document import
- Quiz generation from documents
- Local-first storage with no telemetry

### 🚧 In development

- Audio upload and transcription

### 📋 Planned

More ideas are in the pipeline — feel free to open an issue.

---

## Documentation

- [API-only architecture](docs/api-only-architecture.md)
- [Versioning and releases](docs/versioning.md)
- [System map](docs/system-map.md)
- [Dependency exceptions](docs/security/dependency-exceptions.md)

---

## License

MiChat is released under the [GNU Affero General Public License v3.0](LICENSE).
