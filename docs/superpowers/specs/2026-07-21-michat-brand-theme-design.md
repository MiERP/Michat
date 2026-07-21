# Thiết kế nhận diện MiChat đậm thương hiệu

## Mục tiêu

Áp dụng hai màu logo MiChat — xanh `#0B9444` và cam `#F7941D` — cho toàn ứng dụng ở cả giao diện sáng và tối. Giao diện giữ nguyên bố cục Tri thức, Chat và Không gian sáng tạo.

## Nguyên tắc màu

- Xanh là màu cấu trúc: nền, thanh điều hướng, trạng thái chọn, đường viền focus và liên kết.
- Cam là màu hành động: nút chính, điểm nhấn quan trọng và gradient thương hiệu.
- Thanh điều hướng dùng gradient xanh, cam chỉ xuất hiện ở cuối dải để tránh chói.
- Nút chính dùng gradient cam; nút phụ, nguy hiểm và ghost giữ ý nghĩa hiện tại.
- Giao diện sáng dùng nền xanh rất nhạt và thẻ gần trắng.
- Giao diện tối dùng nền xanh đen và thẻ xanh sâu, không dùng nền xám xanh cũ.

## Thành phần thay đổi

- Token màu và gradient trong `src/renderer/src/assets/theme.css`.
- Nút mặc định trong `src/renderer/src/components/ui/button.tsx`.
- Header dùng chung trong `src/renderer/src/components/ui/panel-header.tsx`.
- Thanh điều hướng trong `src/renderer/src/components/common/TopNavigationBar.tsx`.
- Trạng thái tài liệu được chọn trong `src/renderer/src/components/notebook/source/DocumentList.tsx`.

## Không thay đổi

- Kích thước và tỷ lệ ba vùng làm việc.
- Chức năng Chat, RAG, metadata pháp lý và Không gian sáng tạo.
- Ý nghĩa màu đỏ của thao tác nguy hiểm.
- Cơ chế chuyển giao diện sáng/tối hiện có.

## Tiêu chí đạt

- Hai chế độ sáng/tối đều đọc rõ, không có chữ chìm trên gradient.
- Nút chính màu cam; focus và trạng thái chọn màu xanh.
- Thanh điều hướng và panel header có nhận diện thống nhất.
- Build, typecheck, lint và kiểm tra Electron không phát sinh lỗi.
