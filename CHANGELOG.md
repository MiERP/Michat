# Changelog

All notable changes to MiChat are documented in this file.

## [2.2.2] - 2026-11-26

### Fixed

- The packaged-app smoke test waited for `window.electron`, which the minimal preload no longer
  exposes, and matched the start button by its English label — so the packaged smoke step failed
  on every machine since the minimal-preload security fix. It now only requires `window.api` and
  locates the onboarding start button by DOM position, which works in every UI language.
- Questions that explicitly name an article now retrieve chunks inside that article by
  query-term overlap, not just the globally highest-ranked chunk. This fixes large amended
  articles such as Điều 112a of the 2022 IP Law, where the time-limit clause was split from
  the article heading and missed by normal semantic search.
- Adjacent clauses from the same large article are kept in the prompt context, so a list split
  across chunks (for example “Chín tháng … / Năm tháng …”) is not truncated after the first
  item.
- Questions asking for an effective date now extract the verbatim “có hiệu lực thi hành từ
  ngày …” clause and place it ahead of unrelated dates such as the promulgation date.
- Questions asking for a time limit extract the relevant month/day clause for the named object
  (for example the five-month deadline for trademark opposition).
- Definition questions now scan for the exact defining clause (`<term> là ...`) and merge the
  following chunks with source-offset overlap removal. This fixes cases where the definition
  began at the end of one chunk and continued in the next (for example `dữ liệu quan trọng`
  in Điều 3 of the Data Law).
- Questions naming an article (and list questions whose seed chunk starts with an article
  heading) now receive one complete, source-ordered article block instead of a handful of
  ranked chunks. All clauses are present, and overlapping chunk text is removed exactly once.
  This fixes truncated or duplicated lists such as Điều 8, Điều 10 and Điều 27.
- Article selection is scoped to the document named/implied by the question. A question about
  a law that is not in the notebook no longer receives an article with the same number from a
  different law. Very long articles use a query-relevant window for prompt clipping, so a
  clause near the end can still be cited.
- Legal answer labels are preserved: parent clauses stay `1.`, `2.` and sub-items stay
  `a)`, `b)`, … instead of being merged into `1.a)`. Markdown now keeps lettered sub-items on
  separate lines.
- Chat requests now disable the chat template's thinking channel
  (`chat_template_kwargs.enable_thinking = false`). Gemma 4 E2B on llama.cpp was emitting its
  internal reasoning as normal content, sometimes in Korean; with the switch off it answers
  directly in Vietnamese. Templates that do not define the switch ignore it.

### Changed

- Settings → API now asks only for the server endpoint (plus optional separate embedding
  endpoint, API key, and context window). MiChat no longer requires model names; it uses the
  first model advertised by the external server at `/v1/models`. Model choice and switching
  remain entirely on the server side.
- The connection check no longer lists advertised model ids. That list showed the server's
  alias (for example `qwen3.5-4b`), which could differ from the loaded model file in the
  external server manager and looked like MiChat had chosen the wrong model.
- Removed model ids from MiChat's public API configuration and save payload. Legacy
  `chatModel` / `embeddingModel` keys are deleted when read or saved; MiChat only keeps the
  endpoint, optional API key, context window, and embedding endpoint.
- On a multi-model gateway with no embedding-like model id, embeddings now fail fast with
  "load an embedding model" instead of silently embedding with the chat model. A single-model
  server keeps using its only advertised id.
- Chat and embedding requests refuse HTTP redirects, so a compromised local gateway cannot
  forward the conversation or embedding body to a remote host.
- The prompt context budget now scales with whole-article/definition blocks and respects the
  configured context window, so listing three or more articles keeps every article instead of
  dropping the later ones.
- The bundled benchmark configuration now uses `Qwen3.5-4B` for chat because the previously
  selected `gemma4-2B` produced Korean analysis and incomplete legal answers. The app remains
  model-agnostic; this only affects the test machine.

## [2.2.1] - 2026-11-25

### Fixed

- If Chromium's renderer exits before the first paint because security software blocks the
  Electron sandbox (observed with Kaspersky 21.27), MiChat asks for confirmation, writes a
  compatibility marker, relaunches with `--no-sandbox`, and opens normally. Machines where the
  sandbox works keep it enabled; the fallback is local to the affected user profile.
- Pre-paint renderer exits with reasons such as `killed` or `abnormal-exit` are handled too.
- If compatibility mode also fails, MiChat closes the hidden window and exits cleanly instead of
  leaving a silent background process holding the database.
- `MiChat.exe --reset-compat-mode` clears the compatibility marker after security-software
  exclusions are configured.

### Changed

- MiChat is now explicitly a client for an external `llama-server` (or any OpenAI-compatible
  server). It does not start, stop, bundle, or manage the model runtime. The default API address
  is `http://127.0.0.1:8080/v1`, llama-server's default port.
- Settings → API exposes an optional embedding base URL, so chat and embedding models can run on
  separate `llama-server` ports. The embedding URL is validated as loopback-only, including
  values loaded from older configuration files.
- Retrieval validates the query embedding directly instead of issuing a separate dimension-probe
  request on the first search after startup.
- Chat and embedding providers are cached until the saved API configuration changes, avoiding
  repeated provider construction for every message and embedding batch.
- Changing the embedding model or embedding endpoint is now detected at startup and after saving
  the API configuration. Each vector stores a `model@endpoint` signature; a mismatch or a missing
  chunk vector triggers an in-place re-embed instead of searching incompatible embedding spaces,
  and a failed re-embed leaves the old metadata so the next pass retries. Chunk IDs, FTS rows,
  sections, and existing citations are preserved.
- Removed stale model-runtime documentation and unused direct dependencies; the system map now
  describes the current API-only architecture.

## [2.2.0] - 2026-11-25

### Added

- Legal-aware section detection for Vietnamese legal documents: `Chương`, `Mục`, and `Điều`
  headings are recognized even when they use the same font size as body text. Re-indexing a legal
  PDF/plain-text document now creates sections and enables document → section → chunk retrieval.
- Article-number boost: questions that name `Điều N` retrieve a wider candidate pool and put
  matching sections first.
- Flat + hierarchical retrieval merge: the section tier can no longer hide an exact definition
  chunk that lives outside the selected sections.
- Definition-question handling: wider candidate pool, no section de-duplication, and separate
  chunks for definitions that share one large section (for example `10b` and `10c` of the IP law).

### Changed

- Merge persona, long-term memory, and RAG context into a single leading system message. This
  fixes empty answers and HTTP 500 responses from chat templates that reject multiple system
  messages.
- Default RAG settings: `ragTopK=5`, `ragThreshold=0.5`, heuristic rerank disabled.
- RAG context budget: 4,000 tokens total, 1,400 tokens per document.
- Chat generation: temperature `0.2`, output cap `1,400` tokens, and instructions for concise
  answers, exact clause labels, verbatim definitions, and minimal citations.
- Stale-stream timeout raised from 5 to 10 minutes so long legal answers are not aborted.

### Fixed

- Assistant messages no longer stay empty when the chat template rejects the request because it
  contains multiple system messages.
- Long answers (more than five minutes) no longer fail during generation.

## [2.1.0] - 2026-11-25

### Changed

- Show the installed version and the latest release version beside the update-check button; localize update status and point project links at MiERP/Michat.

## [2.0.1] - 2026-11-24

### Changed

- Relicensed MiChat under AGPL-3.0-only and updated license links/metadata.

## [2.0.0] - 2026-11-24

### Changed

- Replaced the bundled llama.cpp runtime, provider registry, and model management with a single configurable external local OpenAI-compatible API. MiChat now only configures, tests, and uses the API from Settings > API.

## [1.1.1] - 2026-11-24

### Changed

- Release hardening: CI packaging smoke, asar validation, CJK/encoding gates, and Windows E2E onboarding smoke.
- Split `KnowledgeService` into focused RAG modules and reconstructed the missing Drizzle snapshots.
- Removed the hardcoded informational license service and dead provider/image-generation code.
- Completed `vi-VN` translations, removed all Chinese comments/strings, and eliminated lint warnings.
- Branded the app and installer with the MiChat icon and fixed the Vietnamese product description.
