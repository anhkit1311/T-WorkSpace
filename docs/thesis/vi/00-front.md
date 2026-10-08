@ABSTRACT

Nhóm làm việc từ xa, lớp học trực tuyến và các cộng đồng trên mạng thường phải dùng song song nhiều công cụ: một ứng dụng nhắn tin cho trao đổi hằng ngày, một dịch vụ khác cho họp video và một công cụ nữa để giao việc. Mỗi lần chuyển công cụ là một lần đứt mạch ngữ cảnh. Đồ án này thiết kế, hiện thực và đánh giá **nexo**, một không gian cộng tác chạy trên trình duyệt, kết hợp nhắn tin thời gian thực theo kênh, trạng thái hiện diện, hội nghị truyền hình đa điểm và quản lý công việc trong cùng một ứng dụng, tổ chức theo mô hình *Workspace → Channel*.

Hệ thống gồm một client đơn trang viết bằng React/TypeScript, một máy chủ ứng dụng Node.js đảm nhận REST, nhắn tin qua Socket.IO và signaling WebRTC, một máy chủ định tuyến chọn lọc (SFU) mediasoup với nhóm worker C++, và cơ sở dữ liệu PostgreSQL vốn còn được dùng để đồng bộ sự kiện và trạng thái hiện diện giữa các tiến trình ứng dụng. Tin nhắn được gửi theo một giao thức lũy đẳng (mã tin do client sinh, outbox bền vững ở client và ràng buộc duy nhất trong cơ sở dữ liệu), nhờ đó việc mất xác nhận hay kết nối lại không làm mất hoặc nhân đôi tin. Client hội nghị dùng simulcast VP8 ba lớp và một lưới video động chỉ yêu cầu những lớp mà nó thực sự hiển thị.

Hệ thống được đánh giá bằng kiểm thử tự động, một bài kiểm tra tải WebSocket và một phòng thí nghiệm media, trong đó mỗi người tham gia là một tiến trình Chromium headless riêng. Với 200 socket đồng thời, độ trễ nhận tin ở phân vị 95 luôn dưới 50 ms, không có tin bị mất hay bị trùng. So với một hiện thực Mesh ngang hàng toàn phần được dùng làm hệ thống chuẩn trên cùng phần cứng, SFU giữ uplink của mỗi client gần như không đổi khi phòng đông lên, trong khi uplink và CPU của client Mesh tăng tuyến tính và phiên Mesh sập ở sáu người. Mọi thực nghiệm đều chạy trên một máy qua mạng nội bộ; việc đo trên nhiều mạng, qua TURN và ở quy mô triển khai thật là hướng phát triển tiếp theo.

**Từ khóa:** cộng tác thời gian thực, WebSocket, Socket.IO, WebRTC, SFU, mediasoup, simulcast, QoS.

@ABBREVIATIONS

| Chữ viết tắt | Ý nghĩa |
| --- | --- |
| ACK | Acknowledgement – xác nhận |
| API | Application Programming Interface – giao diện lập trình ứng dụng |
| CDP | Chrome DevTools Protocol |
| CPU | Central Processing Unit – bộ xử lý trung tâm |
| DTLS | Datagram Transport Layer Security |
| FPS | Frames per second – số khung hình mỗi giây |
| GCC | Google Congestion Control |
| ICE | Interactive Connectivity Establishment |
| JWT | JSON Web Token |
| MCU | Multipoint Control Unit |
| NACK | Negative Acknowledgement – yêu cầu gửi lại gói |
| NAT | Network Address Translation – biên dịch địa chỉ mạng |
| P2P | Peer-to-peer – ngang hàng |
| PLI | Picture Loss Indication – yêu cầu khung khóa |
| QoS | Quality of Service – chất lượng dịch vụ |
| RBAC | Role-Based Access Control – phân quyền theo vai trò |
| REST | Representational State Transfer |
| RTCP | RTP Control Protocol |
| RTP | Real-time Transport Protocol |
| RTT | Round-trip time – thời gian khứ hồi |
| SDP | Session Description Protocol |
| SFU | Selective Forwarding Unit – bộ định tuyến chọn lọc |
| SPA | Single-Page Application – ứng dụng đơn trang |
| SRTP | Secure Real-time Transport Protocol |
| SSRC | Synchronisation Source – định danh nguồn |
| STUN | Session Traversal Utilities for NAT |
| TTL | Time to live – thời gian sống |
| TURN | Traversal Using Relays around NAT |
| UDP / TCP | User Datagram Protocol / Transmission Control Protocol |
| VP8 | Chuẩn mã hóa video định nghĩa trong RFC 6386 |
| WebRTC | Web Real-Time Communication |
