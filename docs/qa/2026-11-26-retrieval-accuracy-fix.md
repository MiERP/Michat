# Retrieval accuracy fix — Q3, Q5, Q6, Q10 (2026-11-26)

## Root causes found in the real notebook

| Question | Root cause | Evidence |
| --- | --- | --- |
| Q3 — definition of “dữ liệu quan trọng” | The definition starts in chunk 8 of the Data Law and continues into chunk 9. Semantic retrieval returned only chunk 9 (the continuation), so the model never saw “Dữ liệu quan trọng là …”. | Chunk 8 ends at `… kinh tế vĩ`; chunk 9 starts `n ninh, đối ngoại, kinh tế vĩ …` |
| Q5 — Điều 8 list | Article-scoped retrieval returned only 5 chunks, while the full article spans chunks 43–52. The final group was cut at “tấn công, vô hiệu hóa”. | Chunks 43–52 in the Cybersecurity Law |
| Q6 — Điều 10 list | The chunk containing the “### Điều 10” heading had `sectionPath = [Chương II]`, so section expansion did not run. The model saw only the opening sentence. | Chunk 54, section metadata `Chương II` |
| Q10 — Điều 27 list | Adjacent chunks 122 and 123 overlap by “triển khai các giải pháp kỹ thuật”; the prompt concatenated both copies, so the model created an extra duplicated item. | Chunk 122 ends `c) … kỹ thuật;`; chunk 123 starts `khai … kỹ thuật; d) …` |

## Fixes

1. `searchDefinitionEvidence` finds the exact `<term> + là` clause, merges the following
   chunks by text overlap, and stops before the next numbered clause.
2. `getArticleContext` returns one complete, source-ordered block for an explicitly named
   article. Chunk overlap is removed by `mergeOverlappingChunks`.
3. List questions expand implicitly from a seed chunk that starts with an article heading
   (`### Điều 10 …`), restricted to that document.
4. When a structural article/definition block exists, supplemental semantic chunks are
   dropped (limit 0). This shortens the prompt and prevents unrelated sections from
   distracting the model.
5. Legal sub-items (`a)`, `b)`, …) now get a Markdown hard break before rendering, so they
   appear on separate lines instead of being collapsed into one paragraph.

## Verification on the real 3-law notebook

Qwen3.5-4B, fresh session per question, actual UI/IPC path, 1,160 chunks / 128 sections.

| # | Result | TTFT | Total |
| --- | --- | ---: | ---: |
| 1 | Correct — 01/07/2025 | 14.2s | 44.1s |
| 2 | Correct — cốt lõi / quan trọng / khác | 21.4s | 50.7s |
| 3 | Correct — full defining clause, all five impact areas | 7.8s | 22.9s |
| 4 | Correct — 01/01/2019 | 13.7s | 31.2s |
| 5 | Correct — all 6 groups and a–e sub-items | 16.4s | 136.4s |
| 6 | Correct — all 8 types (a–h) | 17.2s | 65.0s |
| 7 | Correct — five months | 22.1s | 58.8s |
| 8 | Correct — 01/01/2023 and 14/01/2024 | 16.8s | 61.3s |
| 9 | Correct — 3 groups and safeguards | 11.2s | 70.0s |
| 10 | Correct — 5 protection measures | 10.7s | 55.6s |
| 11 | Not in documents — correctly refused | 14.8s | 52.2s |

- Fully correct: **10/10**.
- Off-topic: **correct refusal**, no fabricated effective date.
- Average TTFT (10 legal questions): **15.2s**; average total: **59.6s**.
- Qwen3.5-4B server measured at **6.02 generated tokens/s**. The requested
  ≥10 tokens/s is a server model/offload limitation, not a MiChat retrieval
  limitation. See `2026-11-26-llm-server-throughput.md` for measurements and
  the exact settings to change in the external LLM server project.

### Final spot-check after the label fix (installed build)

| Question | Result | TTFT | Total |
| --- | --- | ---: | ---: |
| Điều 8 Luật An ninh mạng — 6 nhóm | Correct, 1./a)–e) labels preserved | 21.6s | 133.0s |
| Điều 10 — 8 loại hệ thống thông tin | Correct, all 8 types present (rendered as bullets) | 21.7s | 90.1s |
| Điều 27 — biện pháp bảo vệ dữ liệu | Correct, 1–5, no duplicated item | 16.2s | 57.6s |
| Điều 8 Luật Đất đai (not in notebook) | Correct refusal, no wrong-law citation | 30.8s | 70.5s |

The label prompt now avoids the previous `1.a)` / `1.b)` hybrid. Markdown
rendering keeps `a)`, `b)` … on separate lines. Final installer SHA-256:
`a1b11d9b1a1ff09786722a5b614fec96796a1ad8d15fc26f22416e5183690161`.
Test suite: 52 files, 362 tests passing.

## Gemma comparison

Gemma 4 E2B is faster (prompt eval ~300–500 t/s, generation ~7.0–7.7 t/s) and
answered most questions completely. It is **not stable as the default**: in a
fresh Q6 session it emitted 18,432 characters of `<unused8>` over 190 seconds.
Qwen answered Q6 correctly. Do not use Gemma as the production default until the
server/model template bug is fixed.

## Tests added

- `tests/rag/legalContext.test.ts` — definition term extraction, offset/text
  overlap merge, repeated-list-item removal, fallback prefix trimming.
- `tests/rag/knowledgeService.test.ts` — complete Điều 10 block via
  `getArticleContext`; definition split across chunks via `searchDefinitionEvidence`.
- `tests/renderer/formatMarkdown.test.ts` — legal sub-item line breaks.
- Existing ApiClient, IPC validation and config secret tests updated for the
  endpoint-only (no model fields) contract.

## UI formatting fix

The “1. 2. 3. on separate lines but a) b) inline” issue was Markdown collapsing
single newlines. `preserveLegalLineBreaks` now inserts a Markdown hard break before
lettered sub-items. Verified in the installed app:
`docs/qa/2026-11-26-q5-formatting-fixed.png`.

## Model ownership

MiChat no longer stores or exposes `chatModel` / `embeddingModel`. The public
config is `baseUrl`, optional `embeddingBaseUrl`, `contextWindow`, and the
optional API key. Legacy keys are deleted when the config is read or saved.
Model choice and runtime stay entirely in the external server.

