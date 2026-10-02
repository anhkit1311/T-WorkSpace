# Checklist đồ án — 01/10/2026

Theo dõi bằng chức năng và bằng chứng, không dùng tỷ lệ hoàn thành ước lượng.

- [x] Profile cá nhân hóa/quyền riêng tư/activity và chat media/icon.
- [x] URL định danh/lobby/outbox idempotency/reconnect backfill.
- [x] Governance/private channel/invitation/owner integrity/audit.
- [x] Thread/mention/notification/pin/bookmark/search.
- [x] Kanban/version/concurrency/source/file/checklist/comment.
- [x] Meeting sessions/host/co-host/waiting/lock/kick/end/limits và signaling tests.
- [x] Backend modules/storage/migration lock/adapter2 node/presenceTTL/worker failure/metrics.
- [x] Home ưu tiên việc/drafts/upload progress/focus/sidebar mobile và responsive trong phạm vi đã ghi.
- [x] Chat load50/100/200:6 lượt có raw; restore20 migrations; ERD/sequence/contracts/traceability/demo.
- [ ] Browser invitation acceptance/private revoke giữa2 tài khoản QA (còn gate tạo tài khoản tạm).
- [ ] RTP thật3/6/10 client đa mạng, screen/TURN/impairment.
- [ ] Native zoom200%, benchmark máy yếu, cloud S3/email/backup production và CI remote.

[Checklist chi tiết theo giai đoạn13](13-trien-khai-theo-giai-doan-2026-09-30.md), [bàn giao21](../guides/21-ban-giao-va-demo.md), [benchmark20](../benchmarks/20-benchmark-va-nghiem-thu.md). Không đánh dấu nghiệm thu cuối hoặc production-ready khi những gate này còn mở.

## Đóng băng phạm vi — từ 03/10/2026

Không thêm chức năng mới ngoài đề cương. Kanban, Google OAuth, profile/âm nhạc, bookmark… giữ nguyên và trình bày là chức năng mở rộng trong báo cáo. Thời gian còn lại dành cho:

- [ ] Thực nghiệm Mesh so với SFU (băng thông uplink, CPU client, N = 2/4/6).
- [ ] SFU load test 3/6/10 client (headless Chromium, fake media) và thu QoS latency/jitter/loss.
- [ ] Bắt gói tin Wireshark: STUN, DTLS, RTP/RTCP (SR/RR, NACK, PLI).
- [ ] Dynamic grid: phân trang tile, tạm dừng consumer khi tile bị ẩn.
- [ ] Báo cáo đồ án theo đề cương (chương 1–6).

Chỉ sửa lỗi hoặc thay đổi phục vụ trực tiếp các mục trên.
