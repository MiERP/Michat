# Runtime resources

The app runs fully locally, so it needs assets that are **too large to keep in
Git**. They are gitignored on purpose:

```
resources/
  models/                 *.gguf            (chat + embedding models)
  llama-bin/              llama-server[.exe] + runtime DLLs/SOs
```

Because these paths are ignored, a fresh clone (and CI) has none of them. The
app still boots, but chat, embedding, indexing, RAG and quizzes will be
unavailable.

## Check what is missing

```bash
pnpm resources:check
# report only (used by `pnpm dev`):
pnpm resources:check:warn
# validate a different target, e.g. before a macOS build:
node scripts/check-resources.cjs --platform=mac-arm64
```

The check is wired into `prebuild` (strict) and `predev` (warn-only). Packaging a
release without the assets therefore fails before electron-builder runs.

## Populate the directory

1. **llama.cpp runtime** — download the release for the target platform from the
   llama.cpp project and copy `llama-server` (plus the shared libraries next to
   it) into `resources/llama-bin/`.
   - Windows: `llama-server.exe`, `llama-*.dll`, `ggml-*.dll`
   - macOS/Linux: `llama-server` and the matching `.dylib`/`.so` files
2. **Models** — copy `.gguf` files into `resources/models/`. At least one chat
   model and one embedding model are required. Embedding models must produce
   **1024-dimensional** vectors (the vector schema is fixed at 1024); `bge-m3`
   is the known-good choice. The app refuses to keep a model with a different
   dimension.

## Environment overrides

| Variable | Effect |
| --- | --- |
| `KN_LLAMA_AUTO_ROOT` / `KN_LLAMA_ROOT` | Root that contains `models/` and `llama-bin/` |
| `KN_LLAMA_SERVER_BIN` | Absolute path to `llama-server` |
| `KN_LLAMA_BACKEND` | Backend folder name inside the root (default `llama-bin`) |

`electron-builder.yml` copies the whole `resources/` tree into the packaged
app's resources directory, so the packaged layout must match the structure
above.

## Model-less builds

When models are distributed separately, use the slim packaging config:

```bash
pnpm build:win:slim   # Windows installer without GGUF models
pnpm package:ci       # unpacked build + asar check (used by CI)
```

`electron-builder.slim.yml` keeps `llama-bin` but excludes `models/`. After
installation, copy the chat and embedding `.gguf` files into
`<install dir>/resources/models/` (per-user installs default to
`%LOCALAPPDATA%\Programs\MiChat\resources\models`). The strict `prebuild`
check is intentionally skipped by the slim script; normal `pnpm build:win`
still requires models in `resources/models/`.
