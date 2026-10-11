# Tổng quan đề tài

## Lý do chọn đề tài

Làm việc từ xa, học trực tuyến và sinh hoạt cộng đồng qua mạng đã trở thành hoạt động thường ngày. Tuy vậy, một nhóm làm việc điển hình vẫn phải dùng song song nhiều nền tảng: một ứng dụng cho trao đổi hằng ngày, một công cụ khác cho họp video và một công cụ nữa để giao việc. Mỗi lần chuyển công cụ là một lần đứt mạch công việc. Ngữ cảnh cuộc thảo luận không đi theo nhóm vào cuộc họp, thông tin "ai đang rảnh" không hiển thị cạnh kênh đang trao đổi, và lịch sử dự án bị phân tán qua nhiều dịch vụ.

Các nền tảng như Discord và Slack cho thấy mô hình tổ chức **không gian làm việc (workspace) chứa các kênh (channel)** giải quyết tốt phần tổ chức của bài toán [@slack], [@discord]. Một phòng ban hay một lớp học trở thành một workspace, mỗi chủ đề hay hoạt động là một kênh, và người dùng có thể chuyển giữa kênh văn bản với kênh thoại/video mà không rời ứng dụng. Để xây dựng một nền tảng như vậy cần giải quyết đồng thời hai bài toán kỹ thuật khó: phân phối tin nhắn và trạng thái hiện diện với độ trễ thấp, tin cậy tới nhiều kết nối đồng thời; và tổ chức hội nghị âm thanh/hình ảnh đa điểm ngay trên trình duyệt mà không làm quá tải thiết bị của người tham gia khi phòng đông lên. Đây là hai lõi của kỹ thuật web thời gian thực, nên đề tài phù hợp cho một đồ án tốt nghiệp kết hợp giữa thiết kế phần mềm và đánh giá định lượng.

## Vấn đề cần giải quyết

Đồ án tập trung vào ba vấn đề cụ thể:

1. **Công cụ giao tiếp bị phân mảnh.** Nhắn tin và gọi video nằm ở các ứng dụng khác nhau nên ngữ cảnh công việc bị chia cắt.
2. **Giới hạn của hội nghị Mesh ngang hàng.** Khi mọi người kết nối trực tiếp với nhau, mỗi trình duyệt phải mã hóa và tải lên một luồng riêng cho từng người còn lại. Băng thông tải lên (uplink) và CPU tăng tuyến tính theo số người, nên trình duyệt quá tải ngay khi vài người cùng bật camera.
3. **Đồng bộ trạng thái tức thời.** Trạng thái trực tuyến, đang gõ và tin nhắn mới phải tới đúng người, đúng kênh với độ trễ thấp. Hệ thống còn phải chịu được việc một người mở nhiều tab, mất mạng đột ngột, và máy chủ chạy nhiều tiến trình.

## Mục tiêu

Đồ án đặt ra bốn mục tiêu, được đối chiếu lại ở Chương 6:

- **O1 – Không gian làm việc tích hợp.** Xây dựng một nền tảng web "tất cả trong một" tổ chức theo *Workspace → Channel*, cho phép chuyển đổi tự do giữa các workspace và giữa kênh văn bản với kênh thoại/video.
- **O2 – Nhắn tin và trạng thái hiện diện thời gian thực.** Cung cấp nhắn tin thời gian thực theo kênh, không mất và không trùng tin khi gửi lại hay kết nối lại, cùng trạng thái hiện diện đồng bộ (trực tuyến, ngoại tuyến, đang gõ).
- **O3 – Hội nghị truyền hình đa điểm.** Tổ chức hội nghị đa điểm ngay trên trình duyệt, không cài thêm phần mềm, dựa trên SFU để uplink và CPU của client không tăng theo số người tham gia, kèm các chức năng điều hành cuộc họp.
- **O4 – Đánh giá định lượng.** Đo chất lượng truyền (độ trễ, jitter, mất gói), khả năng chịu tải của lõi WebSocket, và so sánh SFU với Mesh trong cùng điều kiện.

## Phạm vi

### Đối tượng sử dụng

Nhóm dự án làm việc phân tán, tổ chức giáo dục ứng dụng học trực tuyến và các cộng đồng trên mạng.

### Trong phạm vi

- Ứng dụng web đơn trang chạy trên các trình duyệt hiện đại (Chromium, Firefox, Safari).
- Mô hình phân cấp workspace và kênh, phân quyền theo vai trò ở cấp workspace (owner/admin/member) và ở cấp phiên họp (host/co-host/member).
- Kênh văn bản: tin nhắn, trả lời theo luồng (thread), nhắc tên, cảm xúc, ghim, lưu, tệp đính kèm và tìm kiếm.
- Kênh thoại/video: tham gia và rời phòng, bật/tắt micro và camera, chia sẻ màn hình, lưới video động và điều hành phòng (phòng chờ, khóa phòng, cho vào, mời ra, tắt micro người khác, giơ tay, kết thúc).
- Theo dõi chất lượng: thu thập và xuất RTT, jitter, tỉ lệ mất gói và bitrate của cuộc gọi.

Hệ thống còn có một số chức năng hỗ trợ: bảng công việc Kanban, đăng nhập bằng Google và hồ sơ cá nhân. Các chức năng này được trình bày ở chương hiện thực nhưng không phải trọng tâm đánh giá.

### Ngoài phạm vi

Ứng dụng di động gốc, ghi hình cuộc họp, mã hóa đầu-cuối xuyên qua SFU và triển khai đa vùng nằm ngoài phạm vi đồ án.

## Phương pháp thực hiện

Đồ án được thực hiện qua bốn bước:

1. **Nghiên cứu lý thuyết** về giao thức WebSocket, bộ giao thức WebRTC (SDP, ICE/STUN/TURN, DTLS-SRTP, RTP/RTCP) và các mô hình hội nghị Mesh, MCU, SFU.
2. **Phân tích và thiết kế**: yêu cầu chức năng và phi chức năng, sơ đồ khối hệ thống với ba khối chính (client, máy chủ ứng dụng/signaling, máy chủ media SFU), cơ sở dữ liệu và mô hình phân quyền.
3. **Hiện thực**: máy chủ Node.js + Socket.IO + PostgreSQL, SFU mediasoup với nhóm worker, và client đơn trang React/TypeScript có lưới video động.
4. **Thực nghiệm và đánh giá**: kiểm thử tự động, kiểm tra tải WebSocket với 50/100/200 kết nối, và một phòng thí nghiệm media trong đó mỗi người tham gia là một trình duyệt Chromium headless thật với camera giả. Phòng thí nghiệm đo uplink, downlink, CPU, RTT, jitter và tỉ lệ mất gói cho cả hệ thống chuẩn Mesh lẫn SFU.

## Công nghệ sử dụng

Bảng 1.1 liệt kê các công nghệ chính của từng tầng. Client được xây dựng bằng React [@react], máy chủ dùng Node.js và Socket.IO [@socketio], còn máy chủ media dùng mediasoup [@mediasoup].

TABLE: Bảng 1.1. Công nghệ sử dụng trong hệ thống
| Tầng | Công nghệ |
| --- | --- |
| Giao diện | React 19, TypeScript 5, Vite 6, mediasoup-client 3, socket.io-client 4 |
| Máy chủ ứng dụng | Node.js 22, TypeScript, Socket.IO 4, JWT (jose), băm mật khẩu scrypt |
| Máy chủ media | mediasoup 3 (worker C++), simulcast VP8, Opus |
| Dữ liệu | PostgreSQL 17 (dữ liệu, adapter Socket.IO, presence có TTL); lưu tệp trong cơ sở dữ liệu hoặc S3 |
| Hạ tầng | Docker Compose, Nginx (HTTPS, reverse proxy), coturn (STUN/TURN) |
| Kiểm thử | node:test, kịch bản tải Socket.IO, phòng thí nghiệm media (Chromium + Chrome DevTools Protocol) |

## Bố cục báo cáo

Phần còn lại của báo cáo được tổ chức như sau:

- **Chương 2** tóm tắt cơ sở lý thuyết cần cho đồ án: giao tiếp web thời gian thực, WebRTC và các mô hình hội nghị đa điểm.
- **Chương 3** trình bày yêu cầu, sơ đồ khối hệ thống và phân tích từng khối, cơ sở dữ liệu, phân quyền và các giao thức thời gian thực.
- **Chương 4** mô tả việc triển khai hệ thống qua các sơ đồ giải thuật và những đoạn mã then chốt.
- **Chương 5** trình bày thực nghiệm, đánh giá hệ thống so với hệ thống chuẩn Mesh và so với các yêu cầu đặt ra.
- **Chương 6** kết luận, đối chiếu lại các mục tiêu của chương này và đề xuất hướng phát triển.
