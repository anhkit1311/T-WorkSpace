# Nhận diện nexo

Tên sản phẩm được viết thường: **nexo**. Logo gồm nét chữ n bo mềm và một đường nối đi qua, gợi nhịp cầu giữa các thành viên, đồng thời phù hợp với phong cảnh và các bề mặt kính mờ của website.

## Thành phần và tài nguyên

- `apps/web/src/shared/ui/NexoLogo.tsx`: logo React dùng chung ở landing, đăng nhập và thanh điều hướng sau đăng nhập. `NexoMark` kế thừa `currentColor`; SVG trang trí không nhận focus và không đọc lặp qua screen reader.
- `apps/web/src/shared/ui/nexo-logo.css`: wordmark Playfair Display, weight 500, tracking -0.045em. Kích thước kế thừa từ vị trí đặt logo để giữ bố cục hiện tại.
- `apps/web/public/nexo-mark.svg`: biểu tượng xanh đậm trên nền sáng/kính mờ.
- `apps/web/public/nexo-mark-light.svg`: biểu tượng sáng trên nền tối.
- `apps/web/public/favicon.svg`: biểu tượng sáng trong ô xanh đậm bo góc, không phụ thuộc font.
- `apps/web/public/orbit-connect.svg`: cùng biểu tượng favicon ở đường dẫn tài nguyên cũ để giữ tương thích.
- `apps/web/public/avatar-fallback.svg`: avatar mặc định dùng biểu tượng mới trên nền sáng tròn.

Màu biểu tượng: #17233e / #f3f6fc. Artboard 64 × 64; nét chính 5.5, nét nối 4.5, opacity nét nối 0.55. Khi thay đổi hình học, cập nhật đồng thời component React và các SVG tĩnh. Không cần canvas hay vòng render animation cho logo.

## Phạm vi đổi tên

Tên hiển thị được cập nhật ở giao diện, tiêu đề/description trình duyệt, nội dung tìm kiếm, thông báo, lịch họp xuất ra, template email xác thực/lời mời, tiêu đề OpenAPI, package gốc và tài liệu. Email dùng wordmark chữ nexo. Tên hiển thị SMTP cũ được chuẩn hóa sang nexo, giữ nguyên địa chỉ gửi đã cấu hình.

Các định danh kỹ thuật sau được giữ vì chúng liên quan đến tính tương thích, không phải tên thương hiệu hiển thị:

| Định danh | Lý do |
| --- | --- |
| IndexedDB `collabspace-drafts` | Giữ các bản nháp và tệp đính kèm đã lưu trên thiết bị |
| Khóa theme cũ `collabspace-theme` | Tiếp tục dọn tùy chọn theme lỗi thời |
| `SOCKET_CHANNEL_PREFIX=collabspace` | Giữ namespace giao tiếp giữa các API instance |
| UID lịch `${id}@collabspace` | Sự kiện lịch đã xuất vẫn giữ cùng định danh, tránh tạo bản trùng |
| Địa chỉ SMTP fallback cũ | Không tự đổi domain gửi thư; cấu hình SMTP_FROM bằng địa chỉ đã xác thực khi triển khai |

Tên package workspace `@doan/*`, cấu trúc database, URL API và quyền truy cập không thay đổi. Snapshot/ảnh kiểm tra của lần đổi tên nằm trong `backups/nexo-rebrand-20261003`.
