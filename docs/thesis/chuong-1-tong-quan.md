# CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI

## 1.1. Bối cảnh

Làm việc từ xa, học trực tuyến và sinh hoạt cộng đồng qua mạng đã trở thành hình thức thường xuyên. Tuy vậy, một nhóm làm việc điển hình vẫn phải dùng song song nhiều nền tảng: một ứng dụng nhắn tin cho trao đổi hằng ngày, một công cụ khác cho họp video, một công cụ nữa để giao việc. Mỗi lần chuyển công cụ là một lần đứt mạch: ngữ cảnh cuộc trò chuyện không đi theo cuộc họp, trạng thái "ai đang rảnh" không hiển thị cùng chỗ với kênh thảo luận, và lịch sử bị phân tán.

Các nền tảng như Discord hay Slack cho thấy mô hình **không gian (server/workspace) → kênh (channel)** giải quyết tốt vấn đề tổ chức. Mỗi phòng ban hoặc lớp học là một không gian, mỗi chủ đề hay hoạt động là một kênh, và người dùng có thể chuyển giữa kênh văn bản với kênh thoại/video mà không rời ứng dụng.

## 1.2. Vấn đề cần giải quyết

1. **Phân mảnh công cụ giao tiếp.** Nhắn tin và gọi video tách rời nhau làm luồng công việc bị phân mảnh.
2. **Giới hạn của mô hình Mesh P2P.** Khi mọi người kết nối trực tiếp với nhau, mỗi máy phải mã hóa và gửi một luồng riêng cho từng người còn lại. Uplink và CPU tăng tuyến tính theo số người, nên trình duyệt quá tải khi nhiều người cùng bật camera.
3. **Đồng bộ trạng thái tức thời ở quy mô lớn.** Trạng thái trực tuyến, đang gõ và tin nhắn mới phải tới đúng người, đúng kênh với độ trễ thấp. Hệ thống cũng phải chịu được việc một người mở nhiều tab, mất mạng đột ngột, hoặc máy chủ chạy nhiều tiến trình.

## 1.3. Mục tiêu

- Xây dựng một nền tảng "all-in-one" trên trình duyệt, tổ chức theo **Workspace → Channel**, cho phép chuyển đổi liên tục giữa các phòng ban/lớp học và giữa kênh văn bản với kênh thoại/video.
- Cung cấp **nhắn tin thời gian thực** theo kênh và **đồng bộ trạng thái hiện diện** (online, offline, đang gõ).
- Tổ chức **hội nghị truyền hình đa điểm** ngay trên trình duyệt, không cài thêm phần mềm, dùng máy chủ **SFU** để uplink và CPU của client không tăng theo số người.
- **Đánh giá định lượng** chất lượng truyền (độ trễ, jitter, mất gói), khả năng chịu tải của lõi WebSocket, và so sánh Mesh với SFU trên cùng điều kiện.

## 1.4. Đối tượng và phạm vi

**Đối tượng sử dụng:** nhóm làm việc phân tán, tổ chức giáo dục ứng dụng E-learning, cộng đồng trực tuyến.

**Phạm vi:**

- Ứng dụng Web đơn trang (SPA) chạy trên trình duyệt hiện đại (Chromium, Firefox, Safari).
- Kiến trúc phân tầng Workspace/Channel, phân quyền theo vai trò ở tầng không gian (owner/admin/member) và tầng phiên họp (host/cohost/member).
- Kênh văn bản: tin nhắn, trả lời theo luồng (thread), nhắc tên, tệp đính kèm, tìm kiếm.
- Kênh thoại/video: tham gia/rời phòng, bật/tắt micro/camera, chia sẻ màn hình, điều hành phòng (phòng chờ, khóa, mời ra).
- Ngoài phạm vi: ứng dụng di động gốc, ghi hình cuộc họp, mã hóa đầu-cuối (E2EE) qua SFU, triển khai đa vùng.

Hệ thống có thêm một số chức năng mở rộng hỗ trợ cộng tác (bảng công việc Kanban, đăng nhập Google, hồ sơ cá nhân). Các chức năng này được trình bày ở phần hiện thực nhưng không phải trọng tâm đánh giá.

## 1.5. Phương pháp thực hiện

1. **Nghiên cứu lý thuyết:** giao thức WebSocket, bộ giao thức WebRTC (SDP, ICE/STUN/TURN, DTLS-SRTP, RTP/RTCP), các mô hình hội nghị Mesh/MCU/SFU.
2. **Phân tích và thiết kế:** yêu cầu chức năng/phi chức năng, kiến trúc ba khối (Client – Signaling/API – SFU), cơ sở dữ liệu nhiều tầng và RBAC.
3. **Hiện thực:** máy chủ Node.js + Socket.IO + PostgreSQL; SFU mediasoup với pool worker; SPA React/TypeScript với lưới video động.
4. **Thực nghiệm và đánh giá:** kiểm thử tự động; tải WebSocket 50/100/200 kết nối; thực nghiệm Mesh/SFU với 2–8 client trình duyệt thật (Chromium headless, camera giả) để đo uplink, downlink, CPU, RTT, jitter, mất gói; phân tích gói tin.

## 1.6. Công nghệ sử dụng

| Tầng | Công nghệ |
| --- | --- |
| Giao diện | React 19, TypeScript, Vite, mediasoup-client, socket.io-client |
| Máy chủ ứng dụng | Node.js 22, TypeScript, Socket.IO 4, JWT (jose) |
| Máy chủ media | mediasoup 3 (worker C++), VP8 simulcast, Opus |
| Dữ liệu | PostgreSQL 17 (dữ liệu, adapter Socket.IO, presence TTL), lưu tệp DB/S3 |
| Hạ tầng | Docker Compose, Nginx (HTTPS, reverse proxy), coturn (STUN/TURN) |
| Kiểm thử | node:test, kịch bản tải Socket.IO, phòng thí nghiệm media (Chromium + CDP) |

## 1.7. Bố cục báo cáo

- **Chương 1:** tổng quan, vấn đề, mục tiêu, phạm vi.
- **Chương 2:** cơ sở lý thuyết về Web thời gian thực, WebRTC và các mô hình hội nghị.
- **Chương 3:** phân tích yêu cầu, thiết kế kiến trúc, cơ sở dữ liệu và phân quyền.
- **Chương 4:** hiện thực lõi thời gian thực, lõi SFU và giao diện.
- **Chương 5:** kiểm thử, thực nghiệm và đánh giá.
- **Chương 6:** kết luận và hướng phát triển.
