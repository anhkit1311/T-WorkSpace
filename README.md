# Dịch vụ call center, video conferencing, e-learning cho TDTU

[Cấu trúc mã nguồn](docs/guides/24-cau-truc-du-an.md) · [Mục lục tài liệu](docs/README.md)

Đồ án: **Xây dựng các dịch vụ call center, video conferencing, e-learning cho doanh nghiệp**. Doanh nghiệp áp dụng là Đại học Tôn Đức Thắng (TDTU), dùng nội bộ.

Kiến trúc modular monolith: React/TypeScript + Node.js/Socket.IO + PostgreSQL; mediasoup (SFU) cho họp và lớp live; Asterisk 22 điều khiển qua ARI cho tổng đài. Cập nhật **17/10/2026**.

## Ba dịch vụ

| Dịch vụ | Trạng thái |
| --- | --- |
| Call center (VoIP) | Đang spike: Asterisk 22 trong Docker, PJSIP UDP/WS, ARI (`infra/asterisk`, `scripts/callcenter`); schema `025_call_center` |
| Họp trực tuyến | Chạy được: lịch họp, phòng chờ, host/co-host, khóa phòng, giơ tay, chia sẻ màn hình, agenda, biên bản. Còn thiếu ghi hình, danh sách tham dự, phòng hội đồng |
| E-learning | Mới có giao diện mẫu; chưa có backend |

Chat nhóm giữ làm kênh trao đổi nội bộ: ảnh/file/voice, reaction, thread/mention, ghim, tìm kiếm, gửi lại không trùng. Schema chat 1-1 (`026_direct_messages`) đã có; giao diện và API chat 1-1 chưa làm.

Nền tảng chung: đăng nhập email OTP và Google, hồ sơ, presence, lưu file DB/S3, metrics, migration có khóa.

Ngoài phạm vi đề tài, vẫn giữ code nhưng đã ẩn khỏi menu chính: Kanban (`/app/tasks`). Phân hệ quản lý đồ án tốt nghiệp đã được gỡ; chỉ còn khoa, bộ môn, giảng viên và phân quyền (trang "Quản trị hệ thống"). Các bảng `thesis_*` (migration 022–024) vẫn giữ trong DB, không còn code dùng.

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

### Tổng đài (spike Asterisk 22)

Điền `ASTERISK_ARI_PASSWORD` và `ASTERISK_SPIKE_SIP_PASSWORD` (≥ 12 ký tự) trong `.env`, rồi:

```powershell
npm run callcenter:up        # build Asterisk 22 từ mã nguồn (lần đầu vài phút), mở 5060/udp, 8088, 10000-10099/udp
npm run callcenter:ari-spike # in StasisStart khi có cuộc gọi vào ứng dụng ARI "nexo"
npm run callcenter:seed -- giaovu@demo.nexo.test gv.ha@demo.nexo.test  # 2 phòng ban, hotline 19001234 (IVR phím 1/2), máy lẻ cho từng email
```

- Máy lẻ thử: 1001, 1002 (Zoiper/Linphone, UDP 127.0.0.1:5060) và 1101 (trình duyệt), cùng mật khẩu `ASTERISK_SPIKE_SIP_PASSWORD`.
- Trang thử JsSIP: `http://localhost:<cổng web>/softphone-test.html` (chỉ có ở dev server).
- Số thử: 1001/1002/1101 gọi nhau; 8000 echo kiểm tra tiếng; 9000 chuyển vào ARI.
- Không có SIP trunk: tổng đài chỉ dùng nội bộ TDTU. Máy lẻ của các phòng ban gọi nhau, sinh viên gọi hotline từ trình duyệt (đã đăng nhập). Số ngoài (0…, 00…, +…) bị từ chối.
- Máy khác trong LAN: đặt `ASTERISK_EXTERNAL_IP` là IP LAN của máy chạy Docker.

## Kiểm tra

```powershell
npm run typecheck
npm run lint
npm test
npm run test:sfu
npm run test:e2e
npm run build
```

`test:e2e` (Playwright, dùng Chrome đã cài) chạy trên `npm run dev` và DB local: đăng nhập, trang Quản trị hệ thống, hai người họp video với camera giả và tự vào lại phòng sau khi mất mạng. Tài khoản test tạo trong `e2e/global-setup.mjs` và bị xoá khi chạy xong.

npm test có5 frontend unit và15 API unit qua;8 DB/SFU suite skip theo mặc định. test:sfu chạy riêng9 test có PostgreSQL và mediasoup,0 skip. Kiểm signaling/worker không chứng minh RTP đa mạng.

```powershell
npm run benchmark:chat
node scripts/benchmarks/summarize-chat-load.mjs
npm run verify:restore
```

Dữ liệu demo khoa CNTT: tạo quản trị hệ thống trước (`node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin`), đặt `SEED_ACADEMIC_PASSWORD` trong `.env` rồi chạy `npm run seed:academic` (thêm `-- --reset` để tạo lại). `giaovu@demo.nexo.test` là giáo vụ khoa, `truongkhoa@…` là lãnh đạo khoa, `gv.*@…` là giảng viên, `sv01…sv30@…` là sinh viên.

Benchmark local50/100/200 socket,2 API process,4tin/giây,30s ×2/mức:732tin,0lỗi/trùng trong kịch bản. Raw, phân vị và giới hạn ở [báo cáo20](docs/benchmarks/20-benchmark-va-nghiem-thu.md). Restore dùng hai DB QA mới, kiểm20 migration/dữ liệu Unicode và dọn đúng fixtures.

## API và vận hành

- GET /health: liveness.
- GET /ready: PostgreSQL và schema đã migrate tới 026.
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
