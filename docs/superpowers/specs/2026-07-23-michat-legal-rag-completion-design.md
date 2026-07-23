# MiChat Legal RAG Completion Design

## Mục tiêu

Hoàn thiện MiChat thành trợ lý nghiên cứu pháp lý tiếng Việt, evidence-first, local-first, chạy được trên Windows laptop CPU-only 16 GB RAM, tối đa 100 tài liệu hoặc khoảng 20.000 chunks, với phản hồi đầu mục tiêu dưới 3 giây.

## Bất biến

- Chỉ dùng tài liệu người dùng nhập; không tự tra cứu pháp luật trực tuyến.
- Mọi kết luận pháp lý phải có citation; thiếu chứng cứ phải từ chối kết luận.
- Không tự khẳng định văn bản đang có hiệu lực tại thời điểm hiện tại.
- Remote provider bị chặn mặc định; chỉ chạy sau opt-in rõ ràng.
- Khi dùng remote, chỉ gửi truy vấn và evidence cần thiết sau lọc PII; không gửi source path, metadata nội bộ hoặc lịch sử thừa.
- Chat và retrieval luôn ưu tiên hơn embedding, OCR và graph enrichment.
- Structural graph deterministic phải dùng được dù không có LLM.
- Semantic graph là enrichment nền; lỗi enrichment không làm hỏng index hoặc structural graph đã có.
- Không thay SQLite, FTS5, sqlite-vec, RRF hoặc graph repository hiện có.

## Khối 1: Ingestion, Page IR và OCR

### Page IR

`PageInfo.metadata` lưu thêm:

- `extractionMethod`: `text`, `ocr` hoặc `mixed`.
- `textQuality`: điểm `[0, 1]` từ mật độ ký tự, tỷ lệ chữ/số, ký tự lỗi và marker pháp lý tiếng Việt.
- `ocrConfidence`: confidence OCR khi có.
- `layout`: `single-column`, `two-column` hoặc `unknown`.
- `warnings`: cảnh báo OCR/layout ngắn, không chứa nội dung tài liệu.

Offset trong `PageInfo` luôn trỏ vào `DocumentLoadResult.content` sau khi chọn text/OCR cuối cùng.

### Reading order PDF

PDF text items được gom dòng theo tọa độ Y, sắp X trong dòng, rồi phát hiện cụm cột theo khoảng trống ngang và độ phủ dọc. Header/footer toàn chiều rộng đứng trước/sau nội dung cột. Nếu confidence phát hiện cột thấp, fallback về thứ tự dòng Y/X an toàn.

### Quality gate

OCR chỉ chạy khi một trang có một trong các dấu hiệu:

- text rỗng hoặc quá ngắn;
- tỷ lệ chữ/số thấp;
- nhiều ký tự thay thế hoặc control;
- trang có ảnh nhưng thiếu text;
- điểm chất lượng dưới ngưỡng.

PDF text tốt không chạy OCR. Mỗi trang OCR tuần tự để giữ RAM thấp.

### OCR engine

- `tesseract.js` chạy local bằng WebAssembly.
- `@tesseract.js-data/vie` cung cấp trained data tiếng Việt đóng gói cùng ứng dụng; không tải mạng lúc chạy.
- `@napi-rs/canvas` render trang PDF sang ảnh trong main process.
- Worker OCR khởi tạo lười, dùng một worker mỗi tài liệu, terminate sau tài liệu để trả RAM.
- OCR scale mặc định `1.5`; có trần số pixel để tránh trang bất thường làm cạn RAM.
- Khi OCR lỗi, giữ text PDF hiện có và thêm warning; không làm mất tài liệu nếu vẫn có evidence đọc được.

### DOCX legal-aware

Loader giữ HTML heading nếu có, sau đó bổ sung section từ pattern `PHẦN`, `CHƯƠNG`, `MỤC`, `Điều` trên plain text. Legal parser hậu xử lý vẫn là nguồn chuẩn cho `Khoản` và `Điểm`.

## Khối 2: Runtime Scheduler, Routing và Privacy

### Scheduler

Scheduler process-local có hai trạng thái:

- `interactive`: chat/retrieval/rerank.
- `background`: OCR, embedding batch, semantic graph enrichment.

Background task kiểm tra scheduler trước mỗi đơn vị nhỏ như page hoặc article. Khi chat bắt đầu, background không nhận đơn vị mới. Task đang chạy được hoàn tất, không kill giữa chừng để tránh dữ liệu dở.

Thứ tự ưu tiên: chat streaming, retrieval/rerank, embedding, OCR, semantic graph enrichment.

### Remote routing

`ProviderManager` tiếp tục chặn remote khi `allowRemoteProviders=false`. Khi remote đã được cho phép:

- bỏ archived-session memory và source path;
- chỉ giữ system evidence contract, câu hỏi hiện tại và evidence đã chọn;
- lọc email, số điện thoại, CCCD/CMND, tài khoản ngân hàng và chuỗi định danh dài;
- telemetry chỉ ghi số ký tự trước/sau lọc, không ghi PII gốc.

Local provider giữ lịch sử hội thoại hiện tại như cũ.

## Khối 3: Retrieval, Rerank và Context

### Retrieval

- Dense retrieval, FTS5 BM25 và RRF giữ nguyên.
- Query expansion tiếng Việt deterministic tạo biến thể nhỏ cho nhóm pháp lý: chế tài/xử phạt/mức phạt, nghĩa vụ/phải, quyền/được phép, hiệu lực/thời điểm áp dụng, sửa đổi/thay thế/bãi bỏ.
- Chỉ FTS query dùng biến thể; dense embedding dùng câu hỏi gốc để giữ latency.
- Kết quả được dedupe theo chunk và canonical legal coordinate trước rerank.

### Rerank

- Provider reranker có deadline mặc định 650 ms.
- Timeout, lỗi provider hoặc không có model: fallback ngay về local BM25-style candidate reranker.
- Fallback tính IDF trên candidate set, chuẩn hóa theo độ dài, rồi blend với RRF/base score.
- RRF nguyên bản vẫn là fallback cuối nếu candidate reranker không tạo score hợp lệ.

### Context budget

- local lookup: 12.000 chars tổng, 2.400 chars mỗi chunk;
- local comparison/reasoning: 18.000 chars tổng, 3.200 chars mỗi chunk;
- remote opt-in: tối đa 28.000 chars tổng, 4.000 chars mỗi chunk sau PII redaction.

Ưu tiên evidence diversity theo document và legal coordinate. Không cắt giữa marker `Điều/Khoản/Điểm` nếu có thể. Citation metadata chỉ giữ chunks thực sự có trong prompt và được final answer dùng.

## Khối 4: Legal Graph và Semantic Enrichment

### Structural core

Giữ document/article/clause/point nodes, references và declared document relations hiện có. Reindex luôn replace graph atomically.

### Semantic enrichment tiếng Việt

Worker nền chạy deterministic extractor trên từng article-aware chunk:

- `subject`: chủ thể đứng trước modal phrase hoặc sau `đối với`;
- `action`: hành vi sau `phải`, `được`, `không được`, `có trách nhiệm`;
- `concept`: thuật ngữ trong cấu trúc `X là/được hiểu là`;
- `sanction`: cụm `phạt tiền`, `phạt cảnh cáo`, `đình chỉ`, `tước quyền`, `buộc ...`;
- relations: `requires`, `permits`, `prohibits`, `defines`, `applies_to`, `sanction_for`.

Mọi relation cần evidence exact substring và offset hợp lệ. Confidence dưới ngưỡng bị bỏ. Extractor không suy diễn chủ thể hoặc hành vi ngoài câu nguồn.

LLM prompt/schema hiện có được giữ làm đường nâng cấp sau, nhưng không nằm critical path và chưa tự động gửi tài liệu ra remote.

### Declared relation rebuild

Mỗi lần metadata đổi, các relation `amends/replaces/repealedBy` tự sinh được rebuild từ đầu cho toàn notebook. ID cũ không còn được cộng dồn. Provenance tự sinh nằm trong metadata inspector; relation không có evidence không được dùng để kết luận.

## Khối 5: Temporal Reasoning

### Temporal facts

Mỗi document tạo timeline facts từ evidence có sẵn: `issuedAt`, `effectiveFrom`, `effectiveTo`, `amends`, `replaces`, `repeals` và trạng thái được tài liệu tự tuyên bố. Mỗi fact giữ evidence/provenance. Auto-extracted status không đồng nghĩa với xác minh hiện hành.

### As-of reasoning

- Parse ngày cụ thể trong câu hỏi: `dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`.
- Chỉ so sánh interval khi user cung cấp ngày as-of hoặc yêu cầu timeline lịch sử.
- Không có ngày as-of: trả `needs_user_facts` cho câu hỏi “văn bản nào đang/còn hiệu lực”.
- Thiếu `effectiveFrom/effectiveTo` hoặc relation evidence: trả `needs_metadata`/`insufficient_evidence`.
- Kết quả luôn ghi rõ “theo metadata/evidence trong tài liệu đã nhập”, không xác nhận pháp luật hiện hành ngoài bộ tài liệu.

## Khối 6: Vector Dimension, Packaging và Eval

### Dynamic vector dimension

sqlite-vec table được tạo theo dimension hợp lệ: `vec_embeddings_<dimension>`. Table 1024 hiện tại tiếp tục dùng tên `vec_embeddings` để giữ dữ liệu cũ. Notebook store cache phải đổi khi model dimension đổi. Query và upsert sai dimension fail sớm; không chỉ warning.

### Packaging

- Bundle OCR WASM, worker và `vie.traineddata.gz` trong package.
- Native canvas binary được rebuild/pack theo Electron hiện có.
- Startup không khởi tạo OCR worker.
- Packaged smoke kiểm tra resolve được OCR assets, không buộc chạy OCR đầy đủ.

### Eval gates

1. PDF hai cột giữ Điều/Khoản đúng thứ tự.
2. PDF scan tiếng Việt lấy được marker `Điều` và số điều từ fixture ảnh thật.
3. PDF text tốt không gọi OCR.
4. DOCX legal headings tạo section từ `CHƯƠNG` và `Điều` dù không có h1-h6.
5. Dynamic dimension index/query được vector khác 1024.
6. Rerank timeout trả fallback dưới deadline cộng tolerance.
7. Semantic graph tạo subject/action/sanction nodes và evidence-backed relations.
8. Temporal không kết luận hiện hành khi thiếu as-of date; giải được interval lịch sử khi đủ evidence.
9. Remote payload không còn PII/source path/history thừa.
10. Typecheck, RAG tests, full tests, build và packaged smoke pass.

### Performance gates

- Hybrid retrieval trên 20.000 synthetic chunks: p95 mục tiêu dưới 1.200 ms sau warmup.
- Provider rerank timeout không chặn quá 750 ms.
- Build context và PII redaction dưới 100 ms với 28.000 chars.
- First-token dưới 3 giây được đo end-to-end với local provider đang cấu hình; nếu model generation riêng vượt ngưỡng, báo riêng retrieval latency và model latency.

## Phạm vi không làm

- Không crawler hoặc tự tải văn bản pháp luật.
- Không xác nhận legal validity hiện hành từ Internet.
- Không dùng OCR/LLM semantic extraction đồng bộ trong chat path.
- Không thay database hoặc thêm distributed queue.
- Không hỗ trợ ngôn ngữ ngoài tiếng Việt trong legal parser/OCR profile này.
