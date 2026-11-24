<div align="center">

# MiChat

> A local-first, open-source alternative to Google NotebookLM
> Built for learners and developers who want private LLMs, no Docker, and full control.

**Transform your documents into an intelligent, conversational knowledge base**

</div>

---

## Why MiChat?

I really like the idea behind **Google NotebookLM**:
upload documents, build context, and reason over them with LLMs.

But I wanted a few things it doesn’t give me:

- Using my own **private or self-managed LLM APIs**
- Keeping **all data local**, without cloud lock-in
- Trying the tool **without Docker or complex deployment**

While exploring GitHub, I found many impressive “Open Notebook” projects.
They are powerful and well-designed — but almost all of them rely on Docker.
For beginners and non-backend users, that alone can be a deal-breaker.

So I built **MiChat**:
a simple Electron-based desktop app that brings NotebookLM-style workflows
to a **local-first, Docker-free environment**.

This is my **first open-source project**.
It’s still early, but the core idea works — and I’m excited to share it and learn from the community.

---

## What MiChat does (so far)

- 📚 Build a local knowledge base from documents and notes
- 💬 Chat, summarize, and reason with your content using LLMs
- 🔌 Local llama.cpp models served through an OpenAI-compatible endpoint
- 🔍 RAG-powered retrieval with precise source traceability
- 🖥️ Desktop app built with Electron — no Docker, no server setup

---

## Who is this for?

MiChat is for you if:

- You like NotebookLM but want more control
- You prefer using private or self-hosted LLM APIs
- You don’t want to spin up Docker just to try an idea
- You want a simple desktop app for learning and research

---
## Key Features

### 📚 Document Management

- PDF, Word (.docx), PowerPoint (.pptx), and web pages
- Automatic structure parsing and content extraction
- Fast local storage with SQLite

### 🤖 AI-Powered Q&A

- Retrieval-Augmented Generation (RAG)
- Local llama.cpp chat and embedding models (no cloud provider required)
- Answers with precise source references

### 🔒 Local-First by Design

- All data stored locally
- Offline-friendly (LLM APIs optional)
- Full control over your knowledge assets

### 🔍 Vector Search

- Semantic search with sqlite-vec
- Fast and accurate retrieval

### ⚡ Lightweight & Cross-Platform

- Electron-based desktop app
- Windows and macOS support

---

## Project Status

MiChat is an early-stage project.
Some parts are still rough, but the foundation is in place.

I’m sharing it mainly to:

- learn from real usage
- improve learning and research workflows
- explore better knowledge visualization and retrieval

Feedback and suggestions are very welcome.

### Current limitations

- Only local llama.cpp models are supported; cloud providers are intentionally disabled.
- Scanned/image-only PDFs need an OCR engine, which is not bundled yet.
- Office document generation was removed; the note editor and quiz generation remain.
- Drizzle snapshots are complete for every journal entry; `pnpm check:migrations` enforces this.
- See `docs/security/dependency-exceptions.md` for accepted dependency advisories.

---

## Building

Requirements: Node.js 22 and pnpm 11.

```bash
pnpm install
pnpm dev              # development app
pnpm build            # typecheck + main/preload/renderer bundles
pnpm build:win        # Windows installer; requires models in resources/models
pnpm build:win:slim   # Windows installer without GGUF models
```

`pnpm build:win` enforces the runtime-asset check (`resources:check`). The slim
build skips that check; see `resources/README.md` for where to copy models after
installation.

---

## Roadmap

### ✅ Completed

- Local llama.cpp chat and embedding models
- Structured note generation
- Hierarchical, metadata-aware RAG with source citations
- Multi-format document import (PDF / Word / PowerPoint / Excel / Markdown / Web)
- Quiz generation from documents
- Local-first storage with no telemetry

### 🚧 In Development

- Audio upload and transcription

### 📋 Planned

More ideas are in the pipeline — feel free to suggest features in Issues.

---
