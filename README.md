# CollabSpace — nền tảng cộng tác thời gian thực

[Cấu trúc mã nguồn](docs/guides/24-cau-truc-du-an.md) · [Mục lục tài liệu](docs/README.md)

Đồ án: **Phát triển nền tảng không gian làm việc cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm**.

React/TypeScript + Node/Socket.IO + PostgreSQL + mediasoup. Cập nhật **01/10/2026**.

## Chức năng

- Cá nhân hóa profile, sở thích/âm nhạc/trạng thái, quyền riêng tư và presence.
- Chat ảnh/GIF/sticker/voice/file, reaction, thread/mention, pin/bookmark, thông báo và tìm kiếm có bộ lọc.
- Workspace, owner/admin/member, invitation, private channel, lưu trữ/khôi phục, quota và audit.
- Kanban: assignment/deadline/checklist/comment/file/source message, stable order, realtime và version conflict.
- Lịch họp/lobby, host/co-host, waiting/lock/kick/end/raise hand, screen share, worker pool và room affinity.
- URL định danh; home ưu tiên công việc/lịch/thông báo; bản nháp/outbox qua reload; retry chat không tạo trùng.
- Storage DB/S3, PostgreSQL adapter/presence TTL, readiness/metrics/logs, migration lock và retention.

Chat/gọi diễn ra trong kênh nhóm; chưa có direct message một-một. Âm nhạc trên profile là thông tin cá nhân, chưa tích hợp dịch vụ streaming.

## Chạy local

Node **22**, npm, Docker. Từ PowerShell ở thư mục gốc:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:migrate
```

Sửa JWT_SECRET thành chuỗi ngẫu nhiên ít nhất32 ký tự; kiểm DATABASE_URL/WEB_ORIGIN/VITE_API_URL. Cấu hình Resend hoặc SMTP để đăng ký/nhận OTP; hệ thống không log mã xác thực.

Hai terminal:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Web localhost:5173; API localhost:3001. Vite dùng polling watcher trong development Windows. DB đã có dữ liệu nâng cấp bằng migrate, không xóa volume. Tổng20 migration, bytea cũ vẫn tương thích.

## Kiểm tra

```powershell
npm run typecheck
npm run lint
npm test
npm run test:sfu
npm run build
```

npm test có5 frontend unit và15 API unit qua;8 DB/SFU suite skip theo mặc định. test:sfu chạy riêng9 test có PostgreSQL và mediasoup,0 skip. Kiểm signaling/worker không chứng minh RTP đa mạng.

```powershell
npm run benchmark:chat
node scripts/benchmarks/summarize-chat-load.mjs
npm run verify:restore
```

Benchmark local50/100/200 socket,2 API process,4tin/giây,30s ×2/mức:732tin,0lỗi/trùng trong kịch bản. Raw, phân vị và giới hạn ở [báo cáo20](docs/benchmarks/20-benchmark-va-nghiem-thu.md). Restore dùng hai DB QA mới, kiểm20 migration/dữ liệu Unicode và dọn đúng fixtures.

## API và vận hành

- GET /health: liveness.
- GET /ready: PostgreSQL và schema đã migrate020.
- GET /api/openapi.json: danh mục REST; socket types trong packages/shared/src/socket.ts.
- GET /api/operations/metrics: cần OPERATIONS_TOKEN riêng.
- SOCKET_ADAPTER=postgres: đồng bộ chat/task/notification giữa node, lease45s/heartbeat15s. WebSocket hoặc sticky-session nếu polling.
- SFU_PUBLIC_URL/room affinity: media socket đến đúng owner; một room/router trên một worker/node. Adapter không chia sẻ media transport.

[Triển khai HTTPS/Compose](docs/guides/10-trien-khai-production.md), [backend/storage/retention/backup](docs/guides/17-backend-va-van-hanh.md). Compose production truyền các env mới, kiểm /ready, proxy upload8MiB; vẫn cần secrets, domain, email, public IP và TURN thực.

## Tài liệu bàn giao

| Nội dung                            | Tài liệu                                              |
| ----------------------------------- | ----------------------------------------------------- |
| Checklist8 giai đoạn                | [13](docs/planning/13-trien-khai-theo-giai-doan-2026-09-30.md) |
| Quyền/quản trị/invitation           | [14](docs/modules/14-quan-tri-va-hop-dong.md)                 |
| Chat/thread/search/Kanban           | [15](docs/modules/15-chat-va-kanban.md)                       |
| Session/host/media                  | [16](docs/modules/16-dieu-hanh-hop-va-media.md)               |
| Backend và vận hành                 | [17](docs/guides/17-backend-va-van-hanh.md)                  |
| UI/drafts/before-after bundle       | [18](docs/modules/18-giao-dien-va-ban-nhap.md)                |
| Kiến trúc/ERD/6 sequence            | [19](docs/analysis/19-kien-truc-schema-va-luong.md)            |
| Benchmark/raw/QoS/procedure         | [20](docs/benchmarks/20-benchmark-va-nghiem-thu.md)              |
| Cài đặt/env/quyền/traceability/demo | [21](docs/guides/21-ban-giao-va-demo.md)                     |

Source đã triển khai và kiểm local; còn gate RTP3/6/10 đa mạng/TURN, email/S3 cloud, native zoom200%, máy yếu, CI remote và backup production. Không kết luận production-ready. Audit npm còn7 high trong devtool transitive; chi tiết giới hạn ở bàn giao.
