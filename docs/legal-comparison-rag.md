# Legal Comparison RAG

## Metadata tự động

Ngay sau indexing, MiChat tự trích xuất:

- Số, ký hiệu và loại văn bản.
- Cơ quan, ngày ban hành.
- Phạm vi điều chỉnh và đối tượng áp dụng.
- Ngày hiệu lực được tuyên bố trong văn bản.
- Quan hệ sửa đổi, thay thế, bãi bỏ được ghi trong văn bản.

Trạng thái hiện hành không được suy đoán từ PDF. Giá trị mặc định là `unknown` tới khi có nguồn chính thức hoặc người dùng xác nhận.

## Legal Metadata Inspector

1. Mở Knowledge Base.
2. Rê chuột lên tài liệu pháp lý.
3. Chọn biểu tượng cán cân.
4. Xem giá trị, confidence, evidence và số Điều.
5. Sửa trường bị nhận diện sai hoặc chọn `Trích xuất lại`.

Trường được sửa có provenance `user_corrected` và không bị ghi đè khi reindex.

## Hỏi so sánh

Ví dụ:

- `So sánh quy định về thời hạn nộp hồ sơ giữa hai văn bản.`
- `Văn bản nào được áp dụng khi hai điều khoản khác nhau?`
- `Có mâu thuẫn giữa các quy định này không?`

MiChat truy xuất tối đa năm văn bản, hai evidence mỗi văn bản. Nếu notebook lớn hơn giới hạn, câu trả lời ghi rõ văn bản chưa được so sánh.

## Đọc kết quả

- `resolved`: Có quan hệ thay thế/bãi bỏ đã xác minh trong evidence.
- `needs_metadata`: Thiếu trạng thái hoặc ngày hiệu lực. Không có kết luận ưu tiên.
- `insufficient_evidence`: Chưa đủ điều khoản hoặc quan hệ văn bản.
- `potential_conflict`: Có dấu hiệu khác biệt quy phạm; chưa phải kết luận xung đột.

Citation chỉ mở evidence đã đưa vào comparison context. Citation ngoài evidence bị loại trước khi lưu chat.

## Legal Knowledge Graph

Sau indexing, MiChat gắn modality cho từng legal chunk và xếp lịch trích xuất graph nền. Ba modality được hỗ trợ:

- `obligation`: nghĩa vụ, thường có dấu hiệu “phải”, “có trách nhiệm”, “bắt buộc”.
- `permission`: quyền hoặc sự cho phép, thường có dấu hiệu “có quyền”, “được phép”.
- `prohibition`: cấm đoán, thường có dấu hiệu “không được”, “nghiêm cấm”.

Graph dùng ontology đóng. Triple ngoài danh mục bị từ chối:

- `references`, `defines`, `applies_to`.
- `requires`, `permits`, `prohibits`.
- `exception_to`, `condition_for`, `sanction_for`.
- `amends`, `replaces`, `repeals`.

Dữ liệu nằm trong cùng file SQLite của notebook qua `legal_nodes`, `legal_relations` và `legal_extraction_jobs`. Traversal dùng recursive CTE, index hai chiều và adjacency cache theo notebook; không cần graph server hoặc dependency mới.

## Evidence-first

Mỗi relation phải có:

- Đoạn nguồn nguyên văn liên tục và `chunkId`.
- Offset nguồn ổn định, Điều/Khoản/Điểm khi parser xác định được.
- Confidence, model provenance, prompt version, extractor version và ontology version.

Traversal chỉ dùng relation có confidence từ `0.75` trở lên. Trước khi đưa path vào context, MiChat tải lại chunk gốc và xác nhận evidence vẫn tồn tại. Relation không xác minh được bị loại. Graph chỉ mở rộng và kiểm chứng retrieval; văn bản pháp luật gốc cùng citation vẫn là căn cứ hiển thị cho người dùng.

MiChat không hiển thị chain-of-thought. UI chỉ hiển thị reasoning path kiểm toán được, dạng `Điều/Khoản → quan hệ → thực thể/chế tài`, thu gọn mặc định ngay trong câu trả lời.

## Trạng thái extraction

- `pending`: đã xếp lịch, chưa chạy.
- `processing`: model local đang trích xuất.
- `retry`: lỗi tạm thời; job chờ chạy lại với backoff.
- `ready`: graph đã thay thế nguyên tử và sẵn sàng traversal.
- `failed`: hết số lần thử hoặc lỗi dữ liệu không thể retry.

Backfill tự chạy khi MiChat khởi động cho tài liệu pháp lý đã index nhưng thiếu graph hoặc khác extractor/prompt/ontology version. Worker chạy concurrency `1` để bảo vệ latency model local và tạm dừng trong lúc chat đang stream.

Refresh do đổi version giữ graph đã xác minh cho tới khi graph mới thay thế thành công. Nếu refresh đang chờ hoặc lỗi, reasoning vẫn dùng graph cũ và ghi limitation. Reindex nội dung xóa graph cũ ngay vì chunk offset và citation đã thay đổi.

## Retry và vận hành

Trong Knowledge Base, trạng thái graph hiển thị cạnh tài liệu. Chọn retry để đưa job về `pending`; retry không xóa graph cũ. Khi đóng ứng dụng, MiChat yêu cầu worker dừng, chờ tối đa 5 giây, giải phóng lease, rồi mới checkpoint và đóng SQLite.

Nếu graph chưa sẵn sàng, chat tiếp tục RAG trực tiếp từ source chunks. Không có reasoning path không đồng nghĩa không có câu trả lời; câu trả lời vẫn phải dựa trên evidence và citation gốc.

## Giới hạn

SQLite-native graph phù hợp MiChat desktop và backup cùng database. Thiết kế hiện tại giới hạn traversal tối đa bốn hop, số seed/path và lượng evidence mở rộng để giữ latency ổn định. Không phù hợp graph hàng chục triệu cạnh; khi đạt ngưỡng đó mới cần graph adapter hoặc graph database chuyên dụng.
