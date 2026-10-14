# nexo — nền tảng cộng tác thời gian thực

[Cấu trúc mã nguồn](docs/guides/24-cau-truc-du-an.md) · [Mục lục tài liệu](docs/README.md)

Đồ án: **Phát triển nền tảng không gian làm việc cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm**.

React/TypeScript + Node/Socket.IO + PostgreSQL + mediasoup. Cập nhật **01/10/2026**.

## Chức năng

- Cá nhân hóa profile, sở thích/âm nhạc/trạng thái, quyền riêng tư và presence.
- Chat ảnh/GIF/sticker/voice/file, reaction, thread/mention, pin/bookmark, thông báo và tìm kiếm có bộ lọc.
- Workspace, owner/admin/member, invitation, private channel, lưu trữ/khôi phục, quota và audit.
- Kanban: assignment/deadline/checklist/comment/file/source message, stable order, realtime và version conflict.
- Lịch họp/lobby, host/co-host, waiting/lock/kick/end/raise hand, screen share, worker pool và room affinity.
- Kết quả cuộc họp: agenda từ lịch, ghi chú chung realtime (khóa theo phiên bản), tạo việc Kanban ngay trong họp và một tin tổng kết tự đăng vào kênh khi phiên kết thúc.
- URL định danh; home ưu tiên công việc/lịch/thông báo; bản nháp/outbox qua reload; retry chat không tạo trùng.
- Storage DB/S3, PostgreSQL adapter/presence TTL, readiness/metrics/logs, migration lock và retention.

**Phân hệ quản lý & hướng dẫn đồ án tốt nghiệp** (`/app/thesis`, migration 022–024). Đặc tả: [docs/academic/01-dac-ta-nghiep-vu.md](docs/academic/01-dac-ta-nghiep-vu.md).

- **Vai trò:** quản trị hệ thống, giáo vụ khoa, lãnh đạo khoa, giảng viên, sinh viên. Có phân tách trách nhiệm giữa các vai trò.
- **Vòng đời đợt đồ án** (7 giai đoạn) có điều kiện chuyển giai đoạn:
  - nhập danh sách SV và tự xét điều kiện;
  - đề tài có quy trình duyệt và kiểm tra trùng lặp;
  - nhóm đăng ký nguyện vọng có thứ tự;
  - GV nhận nhóm có kiểm tra sức chứa và định mức, và tự tạo không gian làm việc cho đồ án.
- **Thực hiện đồ án:**
  - máy trạng thái kiểm soát bằng trigger PostgreSQL;
  - bản nộp có phiên bản và SHA-256, không sửa được;
  - nhật ký hướng dẫn phải được hai phía xác nhận.
- **Phản biện và bảo vệ:** hội đồng 3–5 thành viên (chủ tịch phải là TS); lịch bảo vệ chống trùng giờ bằng `EXCLUDE USING gist`, có thuật toán xếp lịch tự động.
- **Chấm điểm:** rubric có trọng số; điểm hội đồng lệch nhiều thì chủ tịch phải giải trình; khóa điểm sau khi chốt; sổ cái điểm hash-chain chống sửa; có quy trình phúc khảo.
- **Báo cáo:** dashboard, cảnh báo đồ án có nguy cơ, xuất CSV, thông báo realtime.

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

Chạy API và web cùng lúc bằng một lệnh (Ctrl+C dừng cả hai):

```powershell
npm run dev
```

Cần chạy riêng thì dùng `npm run dev:api` hoặc `npm run dev:web`.

Web localhost:5173; API localhost:3001. Vite dùng polling watcher trong development Windows. DB đã có dữ liệu nâng cấp bằng migrate, không xóa volume. Tổng 21 migration, bytea cũ vẫn tương thích.

Google Sign-In cần đăng ký đúng origin của web trong Google Cloud; xem [xử lý lỗi origin_mismatch](docs/guides/google-oauth-local.md). Dev server dùng cổng của `WEB_ORIGIN` trong `.env` (mẫu mặc định 5173), báo lỗi nếu cổng bận.

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

Dữ liệu demo phân hệ đồ án: đặt `SEED_ACADEMIC_PASSWORD` trong `.env` rồi chạy `npm run seed:academic` (thêm `-- --reset` để tạo lại). Tài khoản `giaovu@demo.nexo.test` là quản trị hệ thống kiêm giáo vụ; `truongkhoa@…`, `gv.son@…` là lãnh đạo khoa; `gv.*@…` là giảng viên; `sv01…sv30@…` là sinh viên.

Benchmark local50/100/200 socket,2 API process,4tin/giây,30s ×2/mức:732tin,0lỗi/trùng trong kịch bản. Raw, phân vị và giới hạn ở [báo cáo20](docs/benchmarks/20-benchmark-va-nghiem-thu.md). Restore dùng hai DB QA mới, kiểm20 migration/dữ liệu Unicode và dọn đúng fixtures.

## API và vận hành

- GET /health: liveness.
- GET /ready: PostgreSQL và schema đã migrate 021.
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
