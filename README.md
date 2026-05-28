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
- 🔌 Provider-based LLM design (OpenAI, DeepSeek, Ollama, and more)
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
- Multiple LLM providers
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

---

## Roadmap

### ✅ Completed

- AI LLM conversation with multiple providers
- Structured note generation
- One-click mind map generation
- RAG-based document retrieval
- Multi-format document import (PDF / Word / PPT / Web)

### 🚧 In Development

- Audio upload and transcription
- Quiz generation from documents
- One-click PPT generation from notes

### 📋 Planned

More ideas are in the pipeline — feel free to suggest features in Issues.

---
