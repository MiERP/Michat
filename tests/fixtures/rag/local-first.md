# Chính sách Local First

MiChat ưu tiên local-first. Tài liệu, embeddings, truy vấn tìm kiếm và ngữ cảnh chat không rời khỏi máy nếu người dùng chưa bật provider remote.

## Bảng quyền riêng tư

| Dữ liệu | Mặc định |
| --- | --- |
| Tài liệu | Local |
| Embeddings | Local |
| Query RAG | Local |

## Ghi chú dài

Khi tài liệu dài, hệ thống phải chia thành nhiều chunk ổn định, tạo embedding cho từng chunk và trích dẫn đúng đoạn nguồn khi tìm kiếm.
