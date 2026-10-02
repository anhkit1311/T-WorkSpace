# 1. Phân tích đề tài và phạm vi

## 1.1. Nguồn yêu cầu

Phần mô tả do sinh viên cung cấp là yêu cầu nghiệp vụ và định hướng kỹ thuật của đồ án. Ảnh đính kèm chỉ xác nhận tên đề tài đã đăng ký; không được xem là chỉ dẫn thao tác hay yêu cầu hệ thống.

## 1.2. Bài toán

Các nhóm làm việc từ xa, lớp học trực tuyến và cộng đồng số thường phải dùng nhiều công cụ rời rạc cho chat, quản lý nhóm và gọi video. Điều này làm đứt mạch công việc, khó theo dõi trạng thái thành viên và tăng chi phí chuyển đổi giữa các nền tảng.

## 1.3. Người dùng mục tiêu

- Thành viên của nhóm làm việc phân tán.
- Học viên và giảng viên trong tổ chức E-learning.
- Thành viên và quản trị viên cộng đồng trực tuyến.

## 1.4. Phạm vi chức năng

### Trong phạm vi MVP

- Đăng ký/đăng nhập và quản lý phiên.
- Workspace/Server, Channel và thành viên.
- Phân quyền tối thiểu: owner, admin, member.
- Chat thời gian thực theo Channel.
- Presence: online, offline, typing.
- Voice/Video Channel: join, leave, publish/consume audio-video.
- Điều khiển micro, camera, screen sharing.
- Lưu lịch sử tin nhắn và thông tin phiên hội nghị.

### Để sau MVP

- File sharing nâng cao, tìm kiếm toàn văn, reaction và thread.
- Ghi hình hội nghị, phụ đề tự động, thông báo đẩy.
- SSO, audit log nâng cao, multi-region và tự động mở rộng SFU.

## 1.5. Yêu cầu phi chức năng ban đầu

| Nhóm             | Mục tiêu ban đầu                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Realtime         | Tin nhắn và Presence được phát tới các client đang kết nối trong vài trăm mili-giây ở môi trường thử nghiệm |
| Media            | Hỗ trợ hội nghị đa điểm bằng SFU, tránh gửi một luồng tới từng peer                                         |
| Bảo mật          | Mật khẩu băm, xác thực token, kiểm tra quyền theo Workspace/Channel                                         |
| Tin cậy          | Client tự reconnect; server không phát sự kiện sang Workspace/Channel không được phép                       |
| Đo kiểm          | Có kịch bản tải WebSocket và báo cáo QoS WebRTC                                                             |
| Khả năng bảo trì | TypeScript, module hóa, migration có version và log có cấu trúc                                             |

## 1.6. Tiêu chí nghiệm thu MVP

Một phiên bản được xem là đạt MVP khi có thể trình diễn liên tục: tạo tài khoản, đăng nhập, vào Workspace, chọn Channel, hai trình duyệt trao đổi tin nhắn và trạng thái, sau đó ít nhất ba trình duyệt tham gia cùng một Video Channel với thao tác bật/tắt thiết bị và rời phòng.
