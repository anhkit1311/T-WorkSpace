# Kiến trúc hiện tại — 01/10/2026

[Kiến trúc, ERD và sáu sequence diagram](19-kien-truc-schema-va-luong.md) là tài liệu đối chiếu source hiện tại.

- React/TypeScript SPA, URL tài nguyên và IndexedDB drafts.
- Node REST/Socket.IO điều khiển; PostgreSQL lưu dữ liệu, quyền kênh, invitations, task và meeting sessions.
- PostgreSQL adapter LISTEN/NOTIFY đồng bộ nhiều API; presence/API lease45s. Không dùng Redis trong source hiện tại.
- mediasoup worker pool phân room theo số phòng; một router/room trên một worker/node. DB affinity và media-location định tuyến tới owner.
- Private DB bytea hoặc S3 qua API xác thực; metadata/quota/cleanup ở PostgreSQL.
- RTP/RTCP đi WebRTC tới SFU, dùng STUN/TURN khi cần; adapter không chia sẻ transport.

Hợp đồng REST ở /api/openapi.json, socket types ở packages/shared/src/socket.ts. Event gửi/nhận chat là send_message/new_message; event cũ message:send/message:created trong thiết kế ban đầu không phải contract hiện tại.

[Backend và vận hành17](../guides/17-backend-va-van-hanh.md), [media16](../modules/16-dieu-hanh-hop-va-media.md), [bằng chứng20](../benchmarks/20-benchmark-va-nghiem-thu.md). Signaling đã kiểm riêng; RTP đa mạng cần môi trường chạy lại.
