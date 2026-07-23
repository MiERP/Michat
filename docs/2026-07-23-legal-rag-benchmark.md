# MiChat Legal RAG benchmark — 2026-07-23

Máy đo: máy Windows hiện tại, CPU-only llama.cpp, Gemma 4 E2B Q4_K_M, BGE-M3 Q4_K_M, notebook `E2E Audit 5 tài liệu - 2026-07-22`.

## Kết quả chính

| Ca | Evidence | Chữ đầu | Hoàn tất | Route | Kết quả |
|---|---:|---:|---:|---|---|
| Không có evidence | 406 ms | 410 ms | 410 ms | `no_evidence` | Đạt `<1 giây` |
| Điều 25A | 73 ms | 75 ms | 76 ms | `direct_lookup` | Đạt `<3 giây` |
| Tổng hợp Nghị định 103/2025/NĐ-CP | 264 ms | 6.421 giây | 11.500 giây | `compact_synthesis` | Đạt `6–15 giây` |
| So sánh phạm vi hai luật | 81 ms | 5.277 giây | 11.136 giây | `deep_reasoning` | Đạt `10–25 giây` hoàn tất |
| So sánh hai file cùng Luật 07/2022/QH15 | 655 ms | 6.669 giây | 16.452 giây | `deep_reasoning` | Đạt `10–25 giây`, kết luận canonical đúng |
| Câu ghép hiệu lực + Điều 25A | 56 ms | 58 ms | 58 ms | `direct_lookup` | Trả cả ngày hiệu lực và nội dung điều |
| Điều 25A đầy đủ | 45 ms | 52 ms | 52 ms | `direct_lookup` | Trả đủ khoản 1–6 từ 10 chunks |

Cold startup đến khi cửa sổ chat sẵn sàng sau warm-up: **14,96 giây**. Chi phí cold model chuyển khỏi câu hỏi đầu tiên sang startup.

## Bộ 8 câu gốc

- Thành công: **8/8**.
- Context overflow: **0/8**.
- Evidence-backed affirmative answers có citation: **6/6 (100%)**.
- Hai câu từ chối/không đủ evidence không gắn citation: Singapore tax và kiểm tra quan hệ không có đường chứng cứ.
- Prompt local: `compact_synthesis` 704 tokens + 64 output; `deep_reasoning` 768 tokens + 128 output. Không vượt budget 1.024/1.152 tokens.

## Giới hạn đo

- Remote opt-in chưa benchmark end-to-end vì máy không có remote provider/credential đã cấu hình. Routing opt-in, PII minimization và prompt budget đã có automated tests.
- `electron-builder --dir` từng treo do thư mục repack cũ nằm trong workspace và bị đóng gói lặp. Artifact benchmark được repack từ staging đã kiểm chứng; cần loại thư mục `.asar-repack-*` trước release packaging chính thức.
