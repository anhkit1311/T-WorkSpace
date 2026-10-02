# Nhật ký tiến độ

## 2026-09-08 — Khởi tạo nền tảng & Cấu trúc Monorepo

- Khởi tạo cấu trúc `docs`, `apps/web`, `services/api`, `packages/shared`, `infra`.
- Xác định phạm vi MVP, kiến trúc phân tầng (Signaling, Media, Data) và lộ trình triển khai.
- Cấu hình monorepo, TypeScript, ESLint, Prettier và Docker Compose cho PostgreSQL.
- Thiết kế schema CSDL cho User, Workspace, Membership, Channel, Message, RefreshSession.

## 2026-09-10 — Xác thực & Kết nối CSDL (Bước A)

- Cấu hình biến môi trường `.env` và cơ chế xác thực JWT kết hợp Refresh Token trong Cookie HttpOnly.
- Triển khai toàn bộ API xác thực tại backend: `register`, `login`, `refresh`, `logout`, `me`.
- Nối API Auth vào Web UI: Đăng nhập/Đăng ký thực tế, kiểm soát phiên đăng nhập và định tuyến bảo mật.

## 2026-09-12 — Real-time Core: Chat & Trạng thái Hiện diện (Bước B)

- Tích hợp Socket.IO server tại backend và socket.io-client tại frontend.
- Cấu hình xác thực token trong quá trình bắt tay kết nối WebSocket.
- Quản lý phòng Socket.IO theo từng kênh hội thoại (`channelId`).
- Lưu trữ lịch sử tin nhắn bền vững vào PostgreSQL và phát sóng tức thời qua sự kiện `new_message`.
- Triển khai tính năng gõ phím thời gian thực (`user_typing` có debounce) và quản lý người dùng trực tuyến (`user_presence`).

## 2026-09-13 — Hội nghị Truyền hình Đa điểm WebRTC SFU (Bước C)

- Cài đặt và tích hợp thành công C++ Media Server **mediasoup** (backend) và **mediasoup-client** (web).
- Xây dựng module `MediasoupRoomManager`: Quản lý tiến trình Worker C++, phân tách các phòng họp qua từng `Router`, tạo WebRtcTransport (gửi/nhận) và quản lý Producers/Consumers.
- Thiết kế giao thức báo hiệu (Signaling Protocol) qua Socket.IO: `join_meeting`, `create_webrtc_transport`, `connect_webrtc_transport`, `produce`, `consume`, `resume_consumer`, `close_producer`, `leave_meeting`.
- Hoàn thiện giao diện Video Conference trong `MeetingPage.tsx`:
  - Sảnh chờ (Lobby): Xem trước webcam, kiểm tra micro và tùy chọn phòng họp.
  - Lưới video động (Dynamic Video Grid): Tự động phát video và âm thanh của các thành viên từ xa qua SFU.
  - Chia sẻ màn hình (Screen Sharing) độ phân giải cao 1080p.
  - Thanh công cụ điều khiển cuộc họp: Bật/tắt micro, camera, chia sẻ màn hình, giơ tay, ghi hình, rời phòng.

## 2026-09-13 — Đo kiểm QoS Chuyên sâu, Xuất Benchmark & Hoàn thiện Báo cáo (Bước D)

- Cải tiến bộ đo kiểm WebRTC trong `MediasoupClientService`: Tính toán thông lượng băng thông tức thời (instant bitrate) qua delta bytes/time thay vì giá trị tích lũy.
- Xây dựng cơ chế lưu vết lịch sử đo kiểm `qosHistory` trong `MeetingContext`.
- Tích hợp bảng điều khiển **QoS Inspector** với biểu đồ sóng thời gian thực (SVG Sparkline) cho RTT và Bitrate.
- Thêm chức năng **Xuất dữ liệu đo kiểm (Export CSV & JSON)** tải trực tiếp về máy tính phục vụ làm số liệu báo cáo luận văn.
- Hoàn thiện bộ tài liệu học thuật chuẩn đồ án tốt nghiệp trong `docs/`:
  - `05-hien-thuc-webrtc-sfu.md`: Hiện thực hóa WebRTC + SFU mediasoup.
  - `06-do-kiem-danh-gia-qos.md`: Báo cáo đo kiểm và đánh giá chất lượng dịch vụ QoS.
  - `07-huong-dan-cai-dat-van-hanh.md`: Hướng dẫn cài đặt, vận hành và kịch bản thuyết trình trước Hội đồng.
- Hoàn tất kiểm thử chất lượng: 100% test pass, 0 lỗi typecheck, 0 lỗi lint, build production thành công.
