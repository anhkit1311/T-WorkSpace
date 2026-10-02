# 3. Lộ trình thực hiện theo bước nhỏ

## Bước 1 — Nền móng (đã hoàn thành)

- Tạo cấu trúc thư mục.
- Chốt tên đề tài, phạm vi MVP và kiến trúc cấp cao.
- Ghi tiêu chí nghiệm thu để tránh mở rộng không kiểm soát.

## Bước 2 — Khởi tạo mã nguồn (đã hoàn thành)

- Tạo monorepo với workspace cho `web`, `api`, `shared`.
- Thêm TypeScript, lint, format, test và cấu hình môi trường.
- Tạo health check cho API và trang shell đầu tiên cho Web.

**Nghiệm thu:** chạy được lệnh cài đặt, kiểm tra kiểu, test và khởi động hai service.

## Bước 3 — Dữ liệu và xác thực (đã triển khai mã nguồn)

- Tạo schema User, Workspace, Membership, Channel, Message.
- Tạo migration; dữ liệu người dùng và workspace được tạo qua luồng đăng ký/API thực.
- Đăng ký/đăng nhập, hash mật khẩu, access token và refresh session.

**Nghiệm thu:** migration chạy trên PostgreSQL sạch; đăng ký/đăng nhập trả access token, refresh token nằm trong cookie `HttpOnly` và được xoay vòng; logout thu hồi phiên.

## Bước 4 — Realtime Core

- Socket.IO rooms theo Workspace/Channel.
- Gửi/nhận tin nhắn và lưu lịch sử.
- Presence online/offline/typing, reconnect và kiểm tra quyền.

## Bước 5 — SFU/WebRTC

- Chạy mediasoup ở local.
- Implement router, WebRtcTransport, Producer, Consumer.
- Join/leave, mute/camera/screen share và xử lý cleanup.

## Bước 6 — Giao diện và trải nghiệm

- Layout ba vùng: Workspace, Channel, nội dung Chat/Video.
- Dynamic video grid, loading/error state, responsive và accessibility cơ bản.

## Bước 7 — Kiểm thử và báo cáo

- Unit/integration test cho quyền, message và signaling.
- Load test WebSocket.
- Đo latency, jitter, packet loss và CPU/băng thông khi tăng số participant.
- Hoàn thiện chương cơ sở lý thuyết, phân tích, thiết kế, cài đặt, kiểm thử và kết luận.
