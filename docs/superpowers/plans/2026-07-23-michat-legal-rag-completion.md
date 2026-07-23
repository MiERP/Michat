# MiChat Legal RAG Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện ingestion OCR, retrieval/rerank, privacy routing, semantic graph và temporal reasoning đúng design đã khóa.

**Architecture:** Giữ deterministic core trên SQLite/RRF hiện có. OCR và semantic extraction chạy local theo quality/priority gate; remote chỉ nhận evidence tối thiểu đã lọc PII.

**Tech Stack:** Electron, TypeScript, Vitest, SQLite FTS5, sqlite-vec, PDF.js, tesseract.js, @napi-rs/canvas.

---

### Task 1: Offline OCR và PDF Page IR

**Files:**
- Create: `src/main/services/ocr/TesseractOcrService.ts`
- Modify: `src/main/services/loaders/types.ts`
- Modify: `src/main/services/loaders/PdfLoader.ts`
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Test: `tests/rag/pdfLoader.test.ts`
- Test: `tests/rag/ocrService.test.ts`

- [ ] Viết test reading-order hai cột, quality gate và OCR ảnh tiếng Việt.
- [ ] Chạy test, xác nhận fail vì chưa có Page IR/OCR.
- [ ] Thêm OCR worker lười, local `vie` data và PDF canvas render.
- [ ] Thêm page quality, extraction metadata và OCR fallback.
- [ ] Chạy test OCR/PDF, xác nhận pass offline.

### Task 2: DOCX legal-aware sections

**Files:**
- Modify: `src/main/services/loaders/DocxLoader.ts`
- Test: `tests/loaders/docxLoader.test.ts`

- [ ] Viết test DOCX/plain HTML không có heading tag nhưng có `CHƯƠNG`/`Điều`.
- [ ] Thêm deterministic legal section fallback.
- [ ] Chạy loader tests.

### Task 3: Dynamic sqlite-vec dimensions

**Files:**
- Modify: `src/main/vectorstore/SQLiteVectorStore.ts`
- Modify: `src/main/vectorstore/VectorStoreManager.ts`
- Modify: `src/main/services/KnowledgeService.ts`
- Test: `tests/rag/knowledgeService.test.ts`

- [ ] Viết test store dimension khác 1024 và mismatch fail sớm.
- [ ] Tạo vec table theo dimension đã validate.
- [ ] Làm cache notebook dimension-aware và reindex-safe.
- [ ] Chạy knowledge/vector tests.

### Task 4: Query expansion, rerank deadline và context budget

**Files:**
- Create: `src/main/services/VietnameseLegalQueryService.ts`
- Modify: `src/main/services/RerankService.ts`
- Modify: `src/main/services/KnowledgeService.ts`
- Modify: `src/main/ipc/chatHandlers.ts`
- Modify: `src/shared/types/knowledge.ts`
- Test: `tests/rag/knowledgeService.test.ts`
- Test: `tests/rag/rerankService.test.ts`
- Test: `tests/services/chatLegalReasoning.test.ts`

- [ ] Viết test deterministic expansion và BM25 candidate scoring.
- [ ] Viết test provider timeout fallback.
- [ ] Thêm FTS expansion, deadline 650 ms và score gate tương ứng.
- [ ] Thêm context budget theo locality/intent và evidence diversity.
- [ ] Chạy retrieval/chat tests.

### Task 5: Privacy-safe remote routing

**Files:**
- Create: `src/main/security/piiRedaction.ts`
- Modify: `src/main/providers/ProviderManager.ts`
- Modify: `src/main/ipc/chatHandlers.ts`
- Test: `tests/providerPolicy.test.ts`
- Test: `tests/services/chatLegalReasoning.test.ts`

- [ ] Viết test redaction email/phone/CCCD/source path.
- [ ] Expose active provider locality không lộ config secret.
- [ ] Thu gọn remote payload còn system contract, redacted query và evidence.
- [ ] Chạy provider/chat tests.

### Task 6: Semantic graph deterministic

**Files:**
- Create: `src/main/services/legalGraph/VietnameseLegalSemanticExtractor.ts`
- Modify: `src/main/services/legalGraph/LegalGraphExtractionService.ts`
- Modify: `src/main/services/legalGraph/legalGraphPrompt.ts`
- Test: `tests/rag/legalGraphExtractionService.test.ts`
- Test: `tests/rag/legalGraphKnowledge.integration.test.ts`

- [ ] Viết test obligation, prohibition, definition và sanction tiếng Việt.
- [ ] Extract semantic nodes/relations với exact evidence offsets.
- [ ] Merge semantic candidate vào structural candidate, dedupe fingerprint.
- [ ] Đổi extractor version/model label, giữ atomic replace.
- [ ] Chạy graph tests.

### Task 7: Relation rebuild và temporal reasoning

**Files:**
- Create: `src/main/services/LegalTemporalService.ts`
- Modify: `src/main/services/KnowledgeService.ts`
- Modify: `src/main/services/LegalComparisonService.ts`
- Test: `tests/rag/knowledgeService.test.ts`
- Test: `tests/rag/legalComparisonService.test.ts`

- [ ] Viết test stale relation bị xóa khi reindex metadata đổi.
- [ ] Viết test current validity phải abstain khi thiếu as-of date.
- [ ] Viết test historical as-of interval khi đủ metadata.
- [ ] Rebuild relation arrays từ inspector mỗi lần.
- [ ] Tích hợp temporal assessment vào comparison resolution.
- [ ] Chạy comparison/knowledge tests.

### Task 8: Scheduler và benchmark

**Files:**
- Create: `src/main/services/LocalTaskScheduler.ts`
- Modify: `src/main/services/loaders/PdfLoader.ts`
- Modify: `src/main/services/legalGraph/LegalGraphWorker.ts`
- Modify: `src/main/ipc/chatHandlers.ts`
- Create: `tests/evals/legalRagCompletionEval.test.ts`
- Create: `scripts/benchmark-legal-rag.ps1`
- Modify: `package.json`

- [ ] Viết scheduler test: background không nhận unit mới khi interactive active.
- [ ] Gate OCR page và graph article theo scheduler.
- [ ] Đo retrieval, rerank timeout, context/redaction và OCR fixture.
- [ ] Xuất báo cáo JSON có latency, pass/fail và môi trường.

### Task 9: Verification và packaging

**Files:**
- Modify nếu cần: `electron-builder.yml`
- Modify nếu cần: `scripts/smoke-packaged.ps1`

- [ ] Chạy targeted tests sau từng task.
- [ ] Chạy `pnpm run typecheck`.
- [ ] Chạy `pnpm run test:rag` và full `pnpm test`.
- [ ] Chạy `pnpm run build`.
- [ ] Chạy `pnpm run check:package`.
- [ ] Review `git diff`, xác nhận không revert thay đổi có sẵn.
