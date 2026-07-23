# MiChat RAG Routing, Legal Graph, and Live State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ngăn assistant/social query kích hoạt RAG, loại evidence yếu, giữ lỗi legal graph gốc, và hiển thị graph status sống trong chat.

**Architecture:** Giữ pipeline hiện tại, thêm deterministic gates tại chat boundary và relevance gate sau rerank. Worker ghi tiến độ trước model call, extraction thử structured output rồi JSON-text fallback, renderer lấy trạng thái mới nhất từ `knowledgeStore` thay vì tin snapshot message. Không đổi DB schema, không thêm dependency, không tăng worker concurrency.

**Tech Stack:** TypeScript, Electron, React, Zustand, Vitest, AI SDK `generateText`/`Output.object`, SQLite/Drizzle.

---

## File Map

- Modify: `src/main/ipc/chatHandlers.ts` — assistant/social routing, legal-domain gate, metadata guard.
- Modify: `tests/services/chatLegalReasoning.test.ts` — social bypass, legal routing, empty evidence tests.
- Modify: `src/main/services/KnowledgeService.ts` — post-rerank relevance cutoff.
- Modify: `tests/rag/knowledgeService.test.ts` — weak/strong retrieval tests.
- Modify: `src/main/services/legalGraph/LegalGraphWorker.ts` — initial `0/sourceUnitCount` progress.
- Modify: `tests/rag/legalGraphWorker.test.ts` — first progress event test.
- Modify: `src/main/services/legalGraph/LegalGraphExtractionService.ts` — structured-first JSON fallback and causal errors.
- Modify: `src/main/services/legalGraph/LegalGraphRepository.ts` — sanitize without erasing error cause.
- Modify: `tests/rag/legalGraphExtractionService.test.ts` — fallback/cause tests.
- Modify: `src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx` — live status/progress/error/retry.
- Modify: `tests/renderer/legalReasoningPathCard.test.ts` — live override and retry tests.
- Verify only: `src/renderer/src/store/knowledgeStore.ts` — existing load/retry/progress subscription remains source of truth.

## Task 1: Assistant/Social and Legal-Domain Routing

**Files:**
- Modify: `tests/services/chatLegalReasoning.test.ts`
- Modify: `src/main/ipc/chatHandlers.ts:208`
- Modify: `src/main/ipc/chatHandlers.ts:490`
- Modify: `src/main/ipc/chatHandlers.ts:572`

- [ ] **Step 1: Write failing assistant/social bypass test**

Extend existing handler harness; return `knowledgeService` and `legalReasoningService` mocks from `sendLegalMessage`:

```ts
it('bypasses all RAG work for assistant self-introduction', async () => {
  mocks.getAllSettings.mockResolvedValue({
    language: 'vi-VN',
    defaultEmbeddingModel: 'local:embedding',
    ragEnableChitChatHeuristic: true,
    ragTopK: 3,
    ragThreshold: 0.5,
    rerankEnabled: false,
    rerankTopN: 3,
    rerankUseHeuristicFallback: true,
    prompts: { chat: {} }
  })

  const { knowledgeService, legalReasoningService } = await sendLegalMessage(
    'hãy tự giới thiệu về bản thân bạn'
  )

  expect(knowledgeService.search).not.toHaveBeenCalled()
  expect(legalReasoningService.reason).not.toHaveBeenCalled()
  const finish = sentEvents.find((event) => event.payload.type === 'finish')
  expect(finish?.payload.metadata?.citations).toEqual([])
  expect(finish?.payload.metadata?.legalReasoning).toBeUndefined()
})
```

- [ ] **Step 2: Write failing legal-domain preservation test**

```ts
it('keeps retrieval and legal reasoning for a legal-domain query', async () => {
  const { knowledgeService, legalReasoningService } = await sendLegalMessage(
    'Doanh nghiệp vi phạm thời hạn nộp hồ sơ bị xử phạt thế nào?'
  )

  expect(knowledgeService.search).toHaveBeenCalledOnce()
  expect(legalReasoningService.reason).toHaveBeenCalledOnce()
})
```

- [ ] **Step 3: Run test and verify red**

Run:

```powershell
pnpm exec vitest run tests/services/chatLegalReasoning.test.ts
```

Expected: self-introduction test fails because search runs.

- [ ] **Step 4: Replace broad short-query heuristic**

Replace `isLikelyChitChat` with normalized assistant/social detection:

```ts
function normalizeRoutingQuery(query: string): { normalized: string; ascii: string } {
  const normalized = query.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
  return {
    normalized,
    ascii: normalized.normalize('NFD').replace(/\p{M}/gu, '')
  }
}

function isAssistantSocialQuery(query: string): boolean {
  const { normalized, ascii } = normalizeRoutingQuery(query)
  if (!normalized) return true

  return [
    /^(hi|hello|hey|xin chao|chao)(\b|$)/,
    /^(cam on|thank you|thanks)(\b|$)/,
    /\b(tu gioi thieu|gioi thieu ve (ban than|ban)|ban la ai|ten ban la gi)\b/,
    /\b(ban|mimi) (co the|lam duoc) gi\b/
  ].some((pattern) => pattern.test(ascii))
}
```

Do not skip every short query. `Điều 2?` remains retrievable.

- [ ] **Step 5: Add independent legal-domain gate**

```ts
function isLikelyLegalQuery(query: string): boolean {
  const { ascii } = normalizeRoutingQuery(query)
  return /\b(phap ly|phap luat|luat|bo luat|nghi dinh|thong tu|dieu \d+|khoan \d+|quyen|nghia vu|vi pham|xu phat|che tai|hop dong|boi thuong|toa an|thu tuc|trach nhiem)\b/.test(
    ascii
  )
}
```

Compute once:

```ts
const assistantSocialQuery = isAssistantSocialQuery(content)
const legalDomainQuery = isLikelyLegalQuery(content)
```

Enter RAG only when `hasEmbeddingModel && !assistantSocialQuery`. Run `buildLegalReasoningSeeds` and `legalReasoningService.reason` only when `legalDomainQuery && citationMetadata.length > 0`. Do not use `LegalReasoningIntent.general` as domain gate.

- [ ] **Step 6: Guard final metadata**

Keep `citations: []` when no retained evidence. Omit `legalReasoning` unless reasoning actually ran:

```ts
const finalMetadata: ChatMessageMetadata = {
  ...(usageMetadata || {}),
  citations: citationMetadata,
  ...(legalComparison ? { legalComparison } : {}),
  ...(legalReasoning ? { legalReasoning } : {})
}
```

- [ ] **Step 7: Run routing tests and review diff**

```powershell
pnpm exec vitest run tests/services/chatLegalReasoning.test.ts
git diff -- src/main/ipc/chatHandlers.ts tests/services/chatLegalReasoning.test.ts
```

Expected: approved social case makes zero retrieval/reasoning calls; legal case keeps both.

## Task 2: Score-Type-Aware Retrieval Cutoff

**Files:**
- Modify: `tests/rag/knowledgeService.test.ts`
- Modify: `src/main/services/KnowledgeService.ts:1080`
- Modify: `src/main/services/KnowledgeService.ts:1196`

- [ ] **Step 1: Write weak and strong rerank tests**

Use existing search fixture and mocked `RerankService`:

```ts
it('drops weak candidates after heuristic rerank', async () => {
  rerankMock.mockResolvedValue({
    orderedIds: ['weak-chunk'],
    scores: new Map([['weak-chunk', 0.08]]),
    method: 'heuristic'
  })

  const results = await service.search(notebookId, 'hãy tự giới thiệu về bản thân bạn', {
    topK: 3,
    threshold: 0.5,
    rerank: { enabled: true, heuristicFallback: true }
  })

  expect(results).toEqual([])
})

it('keeps strongly reranked evidence', async () => {
  rerankMock.mockResolvedValue({
    orderedIds: ['legal-chunk'],
    scores: new Map([['legal-chunk', 0.72]]),
    method: 'heuristic'
  })

  const results = await service.search(notebookId, 'Điều 2 quy định nghĩa vụ gì?', {
    topK: 3,
    threshold: 0.5,
    rerank: { enabled: true, heuristicFallback: true }
  })

  expect(results.map((result) => result.chunkId)).toContain('legal-chunk')
})
```

Use existing constructor/mock seam. Do not add public production API for tests.

- [ ] **Step 2: Run test and verify weak case red**

```powershell
pnpm exec vitest run tests/rag/knowledgeService.test.ts
```

Expected: weak candidate still appears.

- [ ] **Step 3: Add method-specific cutoffs**

```ts
const MIN_PROVIDER_RERANK_SCORE = 0.2
const MIN_HEURISTIC_RERANK_SCORE = 0.15
```

After rerank ordering:

```ts
const minimumRerankScore =
  rerankMethod === 'provider'
    ? MIN_PROVIDER_RERANK_SCORE
    : rerankMethod === 'heuristic'
      ? MIN_HEURISTIC_RERANK_SCORE
      : undefined

const relevantRankedChunkIds =
  minimumRerankScore == null
    ? finalRankedChunkIds
    : finalRankedChunkIds.filter(
        (chunkId) => (rerankScores.get(chunkId) ?? Number.NEGATIVE_INFINITY) >= minimumRerankScore
      )

const fusedChunkIds = relevantRankedChunkIds.slice(0, topK)
if (fusedChunkIds.length === 0) return []
```

Raw RRF stays ranking-only. Direct legal structure results with score `1` remain unchanged.

- [ ] **Step 4: Extend existing retrieval metric**

```ts
rerankMethod,
retainedCandidates: fusedChunkIds.length
```

Do not add source content or secrets to logs.

- [ ] **Step 5: Run retrieval and chat tests**

```powershell
pnpm exec vitest run tests/rag/knowledgeService.test.ts tests/services/chatLegalReasoning.test.ts
git diff -- src/main/services/KnowledgeService.ts tests/rag/knowledgeService.test.ts
```

Expected: weak list empty; legal evidence retained; empty evidence produces no citations/reasoning.

## Task 3: Initial Legal Graph Progress

**Files:**
- Modify: `tests/rag/legalGraphWorker.test.ts`
- Modify: `src/main/services/legalGraph/LegalGraphWorker.ts:187`

- [ ] **Step 1: Write failing first-progress test**

```ts
it('publishes 0/source progress before first model extraction', async () => {
  const events: LegalGraphProgress[] = []
  extractor.extractDocument.mockImplementation(async () => {
    expect(events[0]).toEqual(
      expect.objectContaining({
        documentId: 'document-1',
        status: 'processing',
        processedUnitCount: 0,
        sourceUnitCount: chunks.length
      })
    )
    return candidate
  })

  await createWorker({ onProgress: (progress) => events.push(progress) }).runOnce()
})
```

- [ ] **Step 2: Run test and verify red**

```powershell
pnpm exec vitest run tests/rag/legalGraphWorker.test.ts
```

Expected: first event occurs after extraction progress, not before model call.

- [ ] **Step 3: Persist and emit initial progress after source load**

Immediately after source validation:

```ts
const sourceUnitCount = source.chunks.length
const initialized = this.repository.updateJobProgress(
  job.id,
  this.workerId,
  0,
  sourceUnitCount,
  this.now(),
  this.leaseMs
)
if (!initialized) throw new Error('Legal graph job lease was lost')
```

Emit existing processing payload with `processedUnitCount: 0` and `sourceUnitCount`. Reuse current progress builder/fields; never include source text. Keep sequential extraction callback unchanged.

- [ ] **Step 4: Run worker test and review diff**

```powershell
pnpm exec vitest run tests/rag/legalGraphWorker.test.ts
git diff -- src/main/services/legalGraph/LegalGraphWorker.ts tests/rag/legalGraphWorker.test.ts
```

Expected: first event `0/N`; later processing/ready/failed behavior unchanged.

## Task 4: Structured Output Fallback and Causal Errors

**Files:**
- Modify: `tests/rag/legalGraphExtractionService.test.ts`
- Modify: `src/main/services/legalGraph/LegalGraphExtractionService.ts:22`
- Modify: `src/main/services/legalGraph/LegalGraphExtractionService.ts:258`
- Modify: `src/main/services/legalGraph/LegalGraphRepository.ts:118`

- [ ] **Step 1: Write failing fallback test**

```ts
it('falls back to validated JSON text when structured output fails', async () => {
  generateTextMock
    .mockRejectedValueOnce(new Error('structured output unsupported'))
    .mockResolvedValueOnce({ text: JSON.stringify(validOutput) })

  const candidate = await new LegalGraphExtractionService().extractDocument(
    document,
    [chunk],
    activeModel
  )

  expect(candidate.nodes).toHaveLength(2)
  expect(generateTextMock).toHaveBeenCalledTimes(2)
  expect(generateTextMock.mock.calls[0][0].experimental_output).toBeDefined()
  expect(generateTextMock.mock.calls[1][0].experimental_output).toBeUndefined()
})
```

- [ ] **Step 2: Write failing causal-error test**

```ts
it('preserves provider cause when structured and text requests fail', async () => {
  generateTextMock
    .mockRejectedValueOnce(new Error('provider structured failure'))
    .mockRejectedValueOnce(new Error('provider text failure'))

  await expect(
    new LegalGraphExtractionService().extractDocument(document, [chunk], activeModel)
  ).rejects.toThrow('provider text failure')
})
```

Also assert error type is `LegalGraphRetryableError` and `cause` is an `Error`.

- [ ] **Step 3: Run test and verify red**

```powershell
pnpm exec vitest run tests/rag/legalGraphExtractionService.test.ts
```

Expected: only one request exists and outer message is generic.

- [ ] **Step 4: Add stdlib JSON extraction helpers**

```ts
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model response did not contain a JSON object')
  return JSON.parse(text.slice(start, end + 1))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

- [ ] **Step 5: Keep structured request first; fallback once**

First call keeps:

```ts
experimental_output: Output.object({ schema: legalGraphOutputSchema })
```

On structured generation/object parse failure, call once without `experimental_output`:

```ts
const fallback = await generateText({ model, system, prompt, abortSignal })
return legalGraphOutputSchema.parse(extractJsonObject(fallback.text))
```

Do not fallback after evidence-integrity validation failures. Invented evidence and unknown endpoints remain permanent failures.

- [ ] **Step 6: Preserve both short causes**

```ts
throw new LegalGraphRetryableError(
  `Legal graph model request failed: structured=${getErrorMessage(structuredError)}; fallback=${getErrorMessage(fallbackError)}`,
  { cause: fallbackError }
)
```

- [ ] **Step 7: Sanitize DB text without replacing cause**

```ts
function sanitizeError(error: Error): string {
  return error.message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}
```

No stack, prompt, source text, or credentials in `lastError`.

- [ ] **Step 8: Run extraction/worker tests and review**

```powershell
pnpm exec vitest run tests/rag/legalGraphExtractionService.test.ts tests/rag/legalGraphWorker.test.ts
git diff -- src/main/services/legalGraph/LegalGraphExtractionService.ts src/main/services/legalGraph/LegalGraphRepository.ts tests/rag/legalGraphExtractionService.test.ts
```

Expected: structured success one call; fallback two calls; provider cause retained; permanent validation unchanged.

## Task 5: Live Legal Graph Card State

**Files:**
- Modify: `tests/renderer/legalReasoningPathCard.test.ts`
- Modify: `src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx:1`
- Verify: `src/renderer/src/store/knowledgeStore.ts:131`
- Verify: `src/renderer/src/store/knowledgeStore.ts:282`

- [ ] **Step 1: Enable DOM test environment for this file**

```ts
// @vitest-environment jsdom
```

Use installed `react-dom/client` and `react-dom/test-utils`; add no dependency.

- [ ] **Step 2: Write failing live-failed override test**

Seed snapshot `pending`, evidence `document-1`, and live store status:

```ts
useKnowledgeStore.setState({
  legalGraphStatuses: {
    'document-1': {
      status: 'failed',
      attempts: 5,
      sourceUnitCount: 218,
      processedUnitCount: 0,
      nodeCount: 0,
      relationCount: 0,
      lastError: 'Ollama model request failed: connection refused'
    }
  }
})

expect(container.textContent).toContain('Phân tích đồ thị thất bại')
expect(container.textContent).toContain('Ollama model request failed: connection refused')
expect(container.textContent).not.toContain('Đang chờ phân tích đồ thị')
```

- [ ] **Step 3: Write progress and retry tests**

For live processing `54/218`:

```ts
expect(container.textContent).toContain('54/218')
expect(container.textContent).toContain('25%')
```

Click `Thử lại` and assert:

```ts
expect(window.api.knowledge.retryLegalGraph).toHaveBeenCalledWith('document-1')
```

- [ ] **Step 4: Run renderer test and verify red**

```powershell
pnpm exec vitest run tests/renderer/legalReasoningPathCard.test.ts
```

Expected: card renders snapshot only; no progress/error/retry.

- [ ] **Step 5: Subscribe card to existing Zustand status map**

```ts
import { ReactElement, useEffect, useId, useMemo, useState } from 'react'
import type { LegalGraphDocumentStatus } from '../../../../../shared/types/legalReasoning'
import { useKnowledgeStore } from '../../../store/knowledgeStore'
```

Deduplicate evidence IDs and load once per mount/change:

```ts
const documentIds = useMemo(
  () => [...new Set((result.evidence ?? []).map((item) => item.documentId))],
  [result.evidence]
)
const statuses = useKnowledgeStore((state) => state.legalGraphStatuses)
const loadLegalGraphStatus = useKnowledgeStore((state) => state.loadLegalGraphStatus)
const retryLegalGraph = useKnowledgeStore((state) => state.retryLegalGraph)

useEffect(() => {
  void Promise.all(documentIds.map((documentId) => loadLegalGraphStatus(documentId)))
}, [documentIds, loadLegalGraphStatus])
```

Existing `setupKnowledgeListeners` updates same map. Do not add component IPC listener or polling.

- [ ] **Step 6: Derive effective live status**

Priority: `failed`, `processing`, `pending`, `ready`, then snapshot fallback:

```ts
const liveEntries = documentIds
  .map((documentId) => ({ documentId, status: statuses[documentId] }))
  .filter(
    (entry): entry is { documentId: string; status: LegalGraphDocumentStatus } =>
      Boolean(entry.status)
  )

const effectiveEntry =
  liveEntries.find((entry) => entry.status.status === 'failed') ??
  liveEntries.find((entry) => entry.status.status === 'processing') ??
  liveEntries.find((entry) => entry.status.status === 'pending') ??
  liveEntries.find((entry) => entry.status.status === 'ready')
```

Map live `processing`/`pending` to card `pending`; preserve failed/ready/unavailable.

- [ ] **Step 7: Render progress, failure, and retry**

```ts
const progressPercent =
  sourceUnitCount > 0 ? Math.round((processedUnitCount / sourceUnitCount) * 100) : 0
```

Show `processed/source` plus percent. Failed state shows `lastError` and:

```tsx
<button type=button onClick={() => void retryLegalGraph(effectiveEntry.documentId)}>
  Thử lại
</button>
```

If live status is ready but paths empty, keep explanation that evidence has not mapped to a verified node path. Old messages fall back to snapshot if evidence/status no longer exists.

- [ ] **Step 8: Run renderer test and review**

```powershell
pnpm exec vitest run tests/renderer/legalReasoningPathCard.test.ts
git diff -- src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx tests/renderer/legalReasoningPathCard.test.ts
```

Expected: stale pending becomes live failed; progress/error/retry pass.

## Task 6: Verification and Real Electron Proof

**Files:**
- Verify: all modified files.
- Create: screenshots outside repo unless user requests tracked artifacts.

- [ ] **Step 1: Run targeted suite**

```powershell
pnpm exec vitest run tests/services/chatLegalReasoning.test.ts tests/rag/knowledgeService.test.ts tests/rag/legalGraphWorker.test.ts tests/rag/legalGraphExtractionService.test.ts tests/renderer/legalReasoningPathCard.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run typechecks, focused lint, build**

```powershell
pnpm run typecheck:node
pnpm run typecheck:web
pnpm exec eslint src/main/ipc/chatHandlers.ts src/main/services/KnowledgeService.ts src/main/services/legalGraph/LegalGraphWorker.ts src/main/services/legalGraph/LegalGraphExtractionService.ts src/main/services/legalGraph/LegalGraphRepository.ts src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx tests/services/chatLegalReasoning.test.ts tests/rag/knowledgeService.test.ts tests/rag/legalGraphWorker.test.ts tests/rag/legalGraphExtractionService.test.ts tests/renderer/legalReasoningPathCard.test.ts
pnpm run build
```

Expected: every command exits `0`. Do not fix unrelated repository failures.

- [ ] **Step 3: Review complete diff**

```powershell
git diff --check
git diff -- src/main/ipc/chatHandlers.ts src/main/services/KnowledgeService.ts src/main/services/legalGraph/LegalGraphWorker.ts src/main/services/legalGraph/LegalGraphExtractionService.ts src/main/services/legalGraph/LegalGraphRepository.ts src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx tests/services/chatLegalReasoning.test.ts tests/rag/knowledgeService.test.ts tests/rag/legalGraphWorker.test.ts tests/rag/legalGraphExtractionService.test.ts tests/renderer/legalReasoningPathCard.test.ts
```

Expected: approved files only; pre-existing user changes untouched.

- [ ] **Step 4: Start real app**

```powershell
pnpm dev
```

Expected: Electron opens without `Electron uninstall`.

- [ ] **Step 5: Verify and capture assistant/social case**

Send exactly:

```text
hãy tự giới thiệu về bản thân bạn
```

Expected: normal answer, no citation panel, no legal reasoning card, no search/reason call. Capture full app screenshot.

- [ ] **Step 6: Verify and capture legal case**

Send:

```text
Luật Dữ liệu quy định quyền và nghĩa vụ pháp lý nào đối với tổ chức xử lý dữ liệu?
```

Expected: relevant citations, legal card, live status. Processing shows `processed/source` and percent; failed shows provider/model cause and `Thử lại`. Capture expanded card screenshot.

- [ ] **Step 7: Exercise retry when failed**

Click `Thử lại` once. Expected: retry targets evidence document; card moves to live pending/processing or reports new specific failure, never stale snapshot pending.

- [ ] **Step 8: Final evidence report**

Report modified files, test/typecheck/lint/build results, exact queries, absolute screenshot paths, and external model limitation. Do not claim graph extraction success when provider remains unavailable.

---

## Self-Review Checklist

- [ ] Both approved success cases have automated and real-app checks.
- [ ] Assistant/social and legal-domain gates stay separate.
- [ ] Short legal queries are not skipped by length alone.
- [ ] Raw RRF is never semantic confidence.
- [ ] Empty retained evidence cannot create citation/reasoning metadata.
- [ ] Worker persists `0/sourceUnitCount` before first model request.
- [ ] Structured output remains first; JSON fallback happens once.
- [ ] Provider/model cause survives to sanitized `lastError`.
- [ ] Renderer uses existing store/listener; no duplicate listener or polling.
- [ ] No dependency, DB schema, concurrency, commit, push, or unrelated change.
