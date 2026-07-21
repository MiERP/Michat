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
