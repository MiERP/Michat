# Audit Structured Markdown + Metadata-aware Retrieval

Ngày kiểm tra: 2026-10-21

## Kết luận

Luồng chính trong sơ đồ đã được nối end-to-end cho Markdown, DOCX, PDF có text và Web: loader/fetch → canonical Markdown → structure + metadata projection → document/section/chunk indexes → planner + hard scope → document/section/chunk retrieval → RRF/rerank → mở rộng context → citation. Dữ liệu cấu trúc được lưu bền vững ngoài chunk/vector.

Phạm vi nghiệm thu hiện chỉ gồm tài liệu văn bản cục bộ; luồng Web được loại khỏi đợt này theo quyết định sản phẩm. PDF chỉ chứa ảnh vẫn cần OCR engine được đóng gói. Các khoảng trống XLSX/PPTX, DOCX, reconciliation, section coverage, planner indexed lookup và enrichment đã được khép bằng triển khai cùng regression test.

## Dữ liệu được tạo và lưu

| Lớp                 | Dữ liệu bền vững                                                   | Mục đích                                                                      |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Document            | `documents.content`, hash raw/canonical, MIME, source, status      | Nguồn canonical và theo dõi vòng đời index                                    |
| Structure           | `documents.metadata.structure.pages/sections`                      | Trang, offset, heading path                                                   |
| Legal metadata      | `documentMetadata` + `documentMetadataInspector`                   | Giá trị, confidence, evidence, chỉnh sửa người dùng                           |
| Enrichment          | summary, keywords, entities, tags, TOC, source hash                | Planner, document/chunk metadata, FTS, vector cấp tài liệu, liên kết tri thức |
| Metadata projection | `document_metadata_values`                                         | Projection quan hệ để planner đọc metadata mà không quét JSON                 |
| Section             | bảng `sections`                                                    | Nội dung mục, heading path, offset, hash, chunk count                         |
| Chunk               | bảng `chunks`, `section_id`, metadata trang/mục/pháp lý/enrichment | Đơn vị retrieval và citation                                                  |
| Lexical index       | `fts_chunks`                                                       | BM25 trên nội dung + heading path + metadata pháp lý + keywords/entities/tags |
| Vector index        | `vec_documents`, `vec_sections`, `vec_embeddings`                  | Retrieval ba tầng document → section → chunk                                  |

## Phủ theo định dạng

| Định dạng        | Canonical/structured output                         | Cấu trúc được lưu                                   | Trạng thái                            |
| ---------------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------- |
| Markdown         | Giữ Markdown, suy lại heading tree từ nội dung cuối | Sections, heading paths, section rows               | Đầy đủ                                |
| DOCX             | HTML → Markdown; heading styles thành ATX headings; bảng GFM | Sections khi tài liệu có heading                    | Đầy đủ với heading và bảng (kể cả ô gộp) |
| PDF text         | Text theo trang; heuristic font-size chèn headings  | Pages; sections nếu heuristic nhận ra heading       | Một phần                              |
| HTML file        | Readability → Markdown                              | Sections nếu trang có headings                      | Tốt                                   |
| PPTX             | Section canonical theo từng slide/title             | Pages/slide numbers và section tree                 | Đầy đủ                                |
| XLSX             | Table blocks có sheet/row/column metadata           | `metadata.tables`; chunk metadata `sheetName`/`rowRange` và citation | Đầy đủ                                |
| TXT / legacy DOC | Text phẳng                                          | Không có section nếu nguồn không có heading         | Fallback hợp lệ                       |
| URL web          | Fetch/Readability → Markdown                        | Sections, chunks, vectors, FTS; đã nối IPC/store/UI | Đầy đủ với trang HTML công khai       |

## Luồng retrieval đã kiểm chứng

1. Query planner tách scope người dùng khỏi metadata suy ra.
2. Scope người dùng luôn là hard constraint.
3. Số hiệu văn bản duy nhất là hard constraint; dạng rút gọn bỏ năm cũng được đối chiếu.
4. Loại văn bản, cơ quan, ngày, tiêu đề, entity, keyword và tag là preferred hint; broad retrieval luôn chạy nên hint không loại bằng chứng ngữ nghĩa.
5. Document vector + keyword document lookup chọn tài liệu khi hierarchical retrieval bật, kể cả bên trong hard scope người dùng.
6. Section vector chọn mục khi index section phủ đủ.
7. Chunk vector + FTS được hợp nhất bằng RRF, sau đó áp lifecycle/feedback, knowledge links và rerank.
8. Chunk trúng được mở rộng lên toàn mục; fallback là chunk trước/hiện tại/sau.
9. Context có title, section, page, legal metadata và citation id; UI hiển thị tooltip và mở panel nguồn khi bấm `[n]`.

## Lỗi đã sửa trong đợt audit

- Planner mới không nhận số hiệu rút gọn như `15/NĐ-CP` khi dữ liệu lưu là `15/2024/NĐ-CP`.
- Preferred pass có thể dừng khi đủ số lượng và không chạy broad pass, làm mất tài liệu đúng nhưng không có metadata suy ra.
- `document_metadata_values` được ghi nhưng planner vẫn đọc JSON của toàn bộ corpus; planner nay đọc relational projection và hard scope theo document id đã resolve.
- Embedding lỗi sau khi tạo section để lại section mồ côi; điều này làm section-vector coverage thiếu và vô hiệu hóa tầng section cho cả notebook. Cleanup nay xóa section rows và section vectors.
- Helper citation được tách khỏi component React để hết lỗi lint Fast Refresh.
- Enrichment trước đây chỉ nằm ở document JSON; nay keywords/entities/tags được projection sang bảng quan hệ, chunk metadata và FTS sau mỗi lần cập nhật.
- Tầng document trước đây bị bỏ qua khi có hard scope; nay hard scope tạo candidate set và document retrieval tiếp tục thu hẹp bên trong tập đó.
- Web fetch trước đây dừng ở service rời; nay có luồng service → IPC → preload → store → UI và đi qua cùng pipeline canonical Markdown.
- Web redirect được kiểm tra lại ở từng hop; redirect từ URL công khai sang localhost/private network bị chặn trước request kế tiếp.

## Khoảng trống còn lại

### Ưu tiên cao

1. **PDF scan không có OCR engine đóng gói.** `ocrEnabled` mới là trường dự phòng; cần đóng gói model OCR cục bộ và pipeline render trang trước khi PDF ảnh được chấp nhận vào production.

### Ưu tiên trung bình

Không còn khoảng trống mức trung bình trong phạm vi tài liệu văn bản. Reconciliation khôi phục tài liệu `processing` dở dang khi khởi động; section coverage được tính theo candidate scope; số hiệu văn bản được lookup trực tiếp qua `(notebook_id, field, value_normalized)`; enrichment lấy sáu trích đoạn phủ đều toàn văn bản.

### Nợ chất lượng

- ESLint không còn error nhưng còn warnings toàn repository, chủ yếu `any` và Prettier ở mã cũ.
- Migration backfill metadata cũ cần được theo dõi khi nâng schema; planner vẫn chuẩn hóa lại `value_display` để tương thích dữ liệu cũ.

## Bằng chứng kiểm thử

- Full suite bằng Electron ABI: **30 test files, 165 tests passed**.
- TypeScript node + renderer: passed.
- Production build và resource check: passed.
- ESLint: **0 errors, 421 warnings**.

Lệnh DB tests dùng Electron với `ELECTRON_RUN_AS_NODE=1` vì ứng dụng dev đang giữ binary `better-sqlite3` build cho Electron ABI; chạy Vitest bằng Node thường sẽ báo ABI mismatch dù ứng dụng và test logic không lỗi.
