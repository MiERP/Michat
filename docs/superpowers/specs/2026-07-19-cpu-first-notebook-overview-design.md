# CPU-First Notebook Overview Design

## Goal

Tạo bản tổng quan điều hành đúng nguồn, cô đọng, bao quát trong 300–500 từ bằng đúng một lượt LLM, không phụ thuộc GPU và không tăng thời gian tuyến tính theo số tài liệu.

## Flow

1. Đọc mọi tài liệu đã lập chỉ mục và chunk từ SQLite.
2. Chia ngân sách nguồn cố định công bằng giữa các tài liệu.
3. Chọn chunk cục bộ theo tín hiệu: vị trí đầu/giữa/cuối, tiêu đề, số liệu/ngày tháng, từ khóa pháp lý, loại trùng lặp.
4. Ghép gói nguồn tối đa 9.000 ký tự.
5. Gọi model chat một lần để sinh bản tổng quan 300–500 từ với citation [n].
6. Lưu overview theo fingerprint hiện có.

## Quality

- Mỗi tài liệu nhận ngân sách đại diện.
- Không tạo brief bằng LLM và không tóm tắt qua hai tầng.
- Ưu tiên thông tin nền tảng, thay đổi chính, quyền/nghĩa vụ, số liệu và lưu ý.
- Không phân tích chuyên sâu hoặc bổ sung kiến thức ngoài nguồn.

## Cleanup

Xóa luồng document brief, cache document_briefs, stage UI liên quan và giới hạn brief không còn dùng.

## Verification

- Nhiều tài liệu vẫn chỉ gọi generateText một lần.
- Gói nguồn không vượt 9.000 ký tự và chứa đại diện mọi tài liệu.
- Bộ chọn ưu tiên chunk pháp lý/số liệu và giữ độ phủ đầu/giữa/cuối.
- Prompt yêu cầu 300–500 từ, tối đa 500 từ.
