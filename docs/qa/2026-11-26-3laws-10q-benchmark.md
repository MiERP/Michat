# 3-law, 10-question benchmark (2026-11-26)

## Setup

- MiChat 2.2.2, installed Windows build.
- Notebook: `3 luật: SHTT, An ninh mạng, Dữ liệu`.
- Documents:
  - `07_2022_QH15_luật sở hữu trí tuệ.pdf` — 676 chunks
  - `24_2018_QH14_luật an ninh mạng.pdf` — 276 chunks
  - `60_2024_QH15_luật dữ liệu.pdf` — 208 chunks
- Index: 1,160 chunks, 128 sections, BGE-M3 embeddings (1024 dimensions).
- Chat model: `qwen3.5-4b` on `127.0.0.1:8080`, 16,384 context, CPU 4 threads,
  `--reasoning-budget 0`.
- Embeddings: `bge` on `127.0.0.1:8081`.
- Each question used a fresh chat session. Timings are wall-clock from the renderer
  send call; TTFT is the first non-empty text delta.

## Results

| # | Question | Correct? | TTFT | Total | Citation |
| --- | --- | --- | ---: | ---: | --- |
| 1 | Luật Dữ liệu 60/2024/QH15 có hiệu lực từ ngày nào? | Yes — 01/07/2025 | 59.7s | 81.0s | Luật Dữ liệu Điều 45 |
| 2 | Dữ liệu được phân loại theo tính chất quan trọng thành những loại nào? | Yes — cốt lõi/quan trọng/khác | 71.4s | 90.7s | Luật Dữ liệu Điều 13 |
| 3 | Luật Dữ liệu định nghĩa dữ liệu quan trọng là gì? | Yes — đúng định nghĩa Điều 3 | 125.2s | 150.2s | Luật Dữ liệu Điều 3 |
| 4 | Luật An ninh mạng 24/2018/QH14 có hiệu lực từ ngày nào? | Yes — 01/01/2019 | 48.2s | 63.4s | Luật An ninh mạng Điều 43 |
| 5 | Điều 8 Luật An ninh mạng gồm những nhóm hành vi bị nghiêm cấm nào? | Partial — nêu 6 nhóm nhưng gộp/đánh số lại và thiếu một số hành vi con | 54.9s | 97.4s | Luật An ninh mạng Điều 8 |
| 6 | Hệ thống thông tin quan trọng về an ninh quốc gia gồm những loại nào? | Yes — đủ a–h | 65.0s | 113.3s | Luật An ninh mạng Điều 10 |
| 7 | Điều 112a: thời hạn phản đối đơn nhãn hiệu là bao lâu? | Yes — năm tháng | 54.4s | 62.9s | Luật SHTT Điều 112a |
| 8 | Luật SHTT 07/2022/QH15 có hiệu lực từ ngày nào? Dữ liệu thử nghiệm nông hóa phẩm có hiệu lực từ ngày nào? | Yes — 01/01/2023 và 14/01/2024 | 54.2s | 69.1s | Luật SHTT Điều 3 |
| 9 | Điều 23 Luật Dữ liệu quy định chuyển/xử lý dữ liệu xuyên biên giới thế nào? | Yes — đủ 3 nhóm và điều kiện bảo đảm | 53.2s | 112.5s | Luật Dữ liệu Điều 23 |
| 10 | Điều 27 Luật Dữ liệu quy định những biện pháp bảo vệ dữ liệu nào? | Yes — đủ 5 nhóm | 52.3s | 81.5s | Luật Dữ liệu Điều 27 |

## Summary

- Fully correct: **9/10**.
- Partial: **1/10** (`Điều 8` broad list). Weighted score: **9.5/10**.
- Average TTFT: **63.9s**; median **54.6s**.
- Average total: **92.2s**; median **86.1s**; fastest **62.9s**, slowest **150.2s**.
- Retrieval itself is fast (direct search measured ~136–225 ms); most of the time is
  prompt processing and ~5 tok/s generation on the 4-thread CPU server.

## Fixes made during the benchmark

1. The initial `gemma4-2B` server returned Korean analysis, incomplete answers and one
   stream that never emitted `finish`. Switched the test server to `Qwen3.5-4B`.
2. `Điều 112a` is split across many chunks; global retrieval returned a nearby clause but
   missed the five-month trademark deadline. Added article-scoped chunk ranking and
   adjacent-clause inclusion.
3. `Điều 3 Hiệu lực thi hành` was retrieved through an exception chunk, so the model used
   the promulgation date / exception dates. Added verbatim direct-evidence extraction for
   effective-date and time-limit questions.
4. Definition questions now rerank a wider pool so the actual defining clause is not lost
   under classification articles.

## Remaining limitations

- Broad list questions (`Điều 8`) can still be summarized too aggressively by the 4B model;
  retrieval returned the correct five chunks from Điều 8.
- Q8 can include extra retrieved documents in the citation list even though the answer cites
  the correct IP-law clauses.
- CPU-only generation is slow; using Vulkan/GPU layers or more threads should be measured
  separately.
