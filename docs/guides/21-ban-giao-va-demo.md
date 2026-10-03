# Bàn giao nexo — 01/10/2026

## Chức năng hiện có

- Hồ sơ cá nhân: sở thích, âm nhạc, trạng thái, avatar/cover, quyền xem hồ sơ và hiển thị hoạt động.
- Chat: ảnh/GIF/sticker/voice/file, reaction, thread, mention, ghim/bookmark, thông báo và tìm kiếm có bộ lọc. Icon tin nhắn thống nhất MessagesSquare.
- Workspace: quản trị riêng, vai trò, chuyển owner, lưu trữ/khôi phục, lời mời, kênh riêng và audit.
- Công việc: Kanban, người phụ trách, deadline, checklist, comment, file, nguồn từ chat, version/conflict và realtime.
- Họp: lịch, lobby chọn thiết bị trước publish, host/co-host, phòng chờ, khóa/kick/end, giơ tay, worker pool và phục hồi.
- Trang chủ ưu tiên công việc/lịch/thông báo; bản nháp và outbox giữ qua chuyển trang/reload; upload có tiến độ thật.
- Backend: controller theo miền, OpenAPI, PostgreSQL adapter, lease/presence, storage DB/S3, quota/retention, metrics/readiness và CI.

Source và kiểm chứng local không thay thế những gate cần môi trường ngoài ở cuối tài liệu.

## Cài đặt và chạy

Yêu cầu Node 22, npm, Docker PostgreSQL 17 và trình duyệt WebRTC. Đã kiểm Windows/Node 22.19.0. PowerShell tại thư mục gốc:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run test:sfu
npm run build
```

Sửa JWT_SECRET thành ít nhất 32 ký tự ngẫu nhiên, DATABASE_URL/WEB_ORIGIN/VITE_API_URL đúng môi trường trước khi chạy API. Đăng ký/OTP cần email provider; hệ thống không log mã OTP hoặc cung cấp đăng nhập bỏ qua xác thực. Migration runner có khóa/checksum, tổng 20 migration. DB đã có dữ liệu nâng cấp bằng migrate, giữ nguyên tệp bytea; không xóa volume.

Mở hai terminal chạy lần lượt `npm run dev:api` và `npm run dev:web`. Web ở localhost:5173, API:3001. `/health` là liveness; `/ready` kiểm DB/migration020; `/api/openapi.json` là danh mục REST. Production output ở dist/web và dist/api.

[Hướng dẫn production](10-trien-khai-production.md) có HTTPS/Nginx/Compose. Compose mẫu đã qua `config --quiet`; chưa triển khai host production/TLS.

## Cấu hình

| Miền       | Biến                                                               | Chính sách                                              |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| API/Web    | API_PORT, WEB_ORIGIN, VITE_API_URL                                 | 3001/5173 local; VITE là dữ liệu công khai              |
| Auth       | JWT_SECRET, ACCESS_TOKEN_TTL, REFRESH_SESSION_DAYS                 | Secret ≥32 ký tự, JWT15m, refresh30 ngày                |
| Email      | RESEND_API_KEY hoặc SMTP_HOST/PORT/SECURE/USER/PASS/FROM           | Cần provider để OTP; delivery thật kiểm riêng           |
| OTP/Google | OTP_*, GOOGLE_CLIENT_ID, VITE_GOOGLE_CLIENT_ID, REQUIRE_GOOGLE_OTP | Chính sách trong .env.example, OAuth origin đúng domain |
| DB         | DATABASE_URL, DB_POOL_MAX                                          | Pool10/node; tính tổng theo số node; timeout5/15/20s    |
| Realtime   | SOCKET_ADAPTER, SOCKET_CHANNEL_PREFIX, API_INSTANCE_ID             | local/postgres; prefix chung, ID riêng                  |
| SFU        | MEDIASOUP_WORKERS/ANNOUNCED_IP/MIN_PORT/MAX_PORT                   | 2 worker, cap8; local40000–49999, Compose40000–40099    |
| Routing    | SFU_PUBLIC_URL, VITE_SFU_URL                                       | Endpoint HTTPS owner; frontend tra media-location       |
| Limits     | MEETING_MAX_USERS/TABS_PER_USER/SOURCES_PER_PEER                   | 20/2/3; waiting vẫn tính vào user limit                 |
| TURN       | TURN_URLS, TURN_SHARED_SECRET                                      | Secret server → credentials1h; coturn chạy riêng        |
| Storage    | FILE_STORAGE_PROVIDER, *_FILE_QUOTA_BYTES                          | db/s3; workspace512MiB, user128MiB/workspace            |
| S3         | S3_BUCKET/REGION/ENDPOINT/FORCE_PATH_STYLE, AWS credential chain   | Bucket private; không đưa keys vào VITE/log             |
| Operations | REQUEST_LOGS, OPERATIONS_TOKEN                                     | JSON log tùy chọn; metrics có secret riêng              |

Nguồn đầy đủ: .env.example và infra/.env.prod.example. Giá trị mẫu không phải secret production. Upload ≤8.000.000 byte; Nginx cho body8MiB, API kiểm size/signature/quota chính xác. S3 cloud cần credentials và nghiệm thu riêng.

## Ma trận quyền

Nội dung kênh yêu cầu membership hiện tại; private channel còn cần channel membership, kể cả owner/admin. Workspace/kênh lưu trữ chỉ đọc, chặn ghi/media/invite.

| Thao tác                                | Owner                                 | Admin     | Member    |
| --------------------------------------- | ------------------------------------- | --------- | --------- |
| Hồ sơ của mình                          | Có                                    | Có        | Có        |
| Hồ sơ người khác                        | Cùng workspace và visibility cho phép | Như owner | Như owner |
| Chat/task/search/file/lịch              | Quyền kênh hiện tại                   | Như owner | Như owner |
| Gửi chat/upload/tạo và sửa task         | Quyền ghi kênh                        | Như owner | Như owner |
| Sửa/xóa tin                             | Tác giả hoặc quản trị                 | Như owner | Tác giả   |
| Ghim tin                                | Quản trị + quyền ghi                  | Có        | Không     |
| Bookmark/reaction/read/mute             | Cá nhân + quyền kênh                  | Như owner | Như owner |
| Metadata/private membership/invite      | Có                                    | Có        | Không     |
| Đổi role/chuyển owner/archive workspace | Có                                    | Không     | Không     |
| Rời workspace                           | Chuyển owner trước                    | Có        | Có        |
| Sửa/hủy lịch                            | Creator/admin + quyền kênh            | Có        | Creator   |
| Join/media/giơ tay                      | Quyền ghi + admission/limits          | Như owner | Như owner |
| Admit/kick/mute/lock/waiting            | Khi là host/co-host phiên             | Như owner | Như owner |
| End/transfer host/bổ nhiệm co-host      | Chỉ host phiên                        | Như owner | Như owner |

Người ngoài không đọc nội dung. Nhận invite cần token hợp lệ và tài khoản verified đúng recipient. Metrics cần OPERATIONS_TOKEN riêng, không phụ thuộc vai trò workspace. Vai trò workspace không tự trở thành host phiên đang chạy. Thu hồi quyền ngắt socket xuyên node; API/search/download vẫn kiểm quyền mới. Chi tiết: [14](../modules/14-quan-tri-va-hop-dong.md), [15](../modules/15-chat-va-kanban.md), [16](../modules/16-dieu-hanh-hop-va-media.md).

## Đối chiếu yêu cầu

| Yêu cầu                         | Source/migration                                    | Test và kết quả                                                                |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Profile/privacy/activity        | profiles/routes, ProfilePage;010                    | Integration profile/presence + browser save/reload: qua                        |
| Chat media/icon                 | files/service, ChatAttachment, LiveChatPage, Icon   | Quyền file và browser upload144B: qua; voice thiết bị thật chưa đo bổ sung     |
| URL/lobby                       | navigation, AppContext, local-media, MeetingContext | Core unit + browser history/lobby: qua                                         |
| Retry/backfill                  | service/socket/outbox;012                           | 6 retry đồng thời, lost ACK; load36 retry/6 reconnect: không trùng             |
| Governance/owner/invite/private | governance/channel_access;013–014                   | Lifecycle/concurrency/quyền/constraint: qua; browser invite còn gate           |
| Thread/mention/notif/search     | conversations, ThreadPanel, Notifications;015       | 52 replies, read/mute, deleted root, reaction race, search raw: qua            |
| Kanban                          | tasks/service, TaskBoard;016–017                    | 409/order/fingerprint/source/file/archive/revoke + browser: qua                |
| Điều hành họp                   | sessions/socket/MeetingControls;018                 | Sessions tests + browser schedule→join→hand/waiting/lock/end: qua signaling/UI |
| DB/retention/storage            | db/migrate/files/maintenance;019–020                | S3 protocol mock + restore20 migrations: qua; cloud chưa kiểm                  |
| Nhiều node/presence/affinity    | postgres adapter/presence/sessions                  | 2 API process và expired lease: qua DB/signaling; TLS nhiều endpoint chưa kiểm |
| Worker/operations               | room-manager/server/CI/Compose                      | Kill worker thật, health/CORS/error, Compose config: qua local                 |
| Home/drafts/progress/focus      | HomePriorities/drafts/useDraft/dialog/CSS           | Reload giữ File/bản nháp, Tab/Escape/mobile: qua phạm vi ở18                   |
| Hủy/timeout media               | webrtc/operation/MeetingContext                     | 2 unit cancel/late cleanup + browser join không nguồn: qua                     |
| Chat50/100/200                  | benchmark-chat-load                                 | 6 lượt,732 tin,21.344 receipt: qua kịch bản local4tin/s                        |
| Before/after                    | Dynamic import mediasoup                            | Raw production entry graph: JavaScript tải đầu giảm                            |
| RTP3/6/10/TURN                  | QoS collector/export                                | Chưa có raw; procedure ở20                                                     |
| Zoom200%/máy yếu                | Responsive/MotionConfig                             | Reduced motion và viewport đã kiểm; native zoom/CPU còn mở                     |

[ERD và sáu sequence diagram](../analysis/19-kien-truc-schema-va-luong.md); [raw benchmark và định nghĩa QoS](../benchmarks/20-benchmark-va-nghiem-thu.md); [UI/bản nháp](../modules/18-giao-dien-va-ban-nhap.md).

Gate hiện tại: typecheck/lint/build qua; frontend unit5 qua; API unit15 qua/8 DB suite skip có chủ đích; chạy riêng test:sfu9 qua,0 skip. Migration/restore QA20 migrations qua. Không đánh dấu toàn giai đoạn5/7/8 khi còn các gate bên ngoài.

## E2E trình duyệt

- QA verified login; tạo hai workspace và private channel; URL/reload/back/forward giữ đúng tài nguyên.
- Chat → bookmark/thread/reply → task có nguồn → assignee/checklist/Đang làm. Main/thread/task draft giữ qua chuyển trang và reload. File QA giữ qua reload, gửi/download thật.
- Profile: lưu sở thích/âm nhạc/bio236 ký tự, reload giữ dữ liệu.
- Mở link lời mời khi đã logout → login → nhận bằng thành viên QA đã có → về chat, giữ vai trò owner và kết nối. Đây là ca idempotent, chưa chứng minh cấp quyền cho thành viên mới.
- Lịch → vào đúng phòng với mic/cam tắt → host giơ tay/phòng chờ/khóa → kết thúc. UI về lobby, lịch sử Đã kết thúc. Không có RTP khi nguồn tắt.
- Responsive và keyboard ở18. Browser invite acceptance/private revoke giữa hai tài khoản chưa hoàn tất: auto-review chặn tạo thêm QA account, đã hỏi phạm vi tài khoản tạm. API tests cho luồng này đã qua.

Fixtures UI dùng email example.test. Script `scripts/testing/ui-qa-fixtures.mjs cleanup` kiểm đúng UUID/owner/email đã ghi, không xóa theo mẫu tên. Lần QA này chưa dọn: auto-review chặn xoá vĩnh viễn hai workspace QA và tài khoản giả do chưa có quyền xoá cụ thể; đã gửi yêu cầu cho người dùng. Phiên QA đã đăng xuất, viewport trở về mặc định. Không phải tài khoản mẫu cho production.

## Demo bảo vệ 10–15 phút

1. Login tài khoản verified, mở home với công việc/lịch/thông báo thật; sửa profile và xem từ thành viên cùng nhóm.
2. Tạo workspace/invite; tài khoản thứ hai nhận. Private channel cấp hai người rồi revoke, minh họa socket ngắt và REST/search/file bị chặn.
3. Gửi chat/file/sticker/GIF/voice, mention/thread/bookmark/pin; Ctrl+K lọc và mở context. Ngắt mạng/retry cùng ID/backfill.
4. Tạo task từ tin, assignee/deadline/checklist/comment/file. Hai tab sửa cùng version để minh họa409 và giữ draft; chuyển cột bằng select.
5. Lịch/lobby/host/waiting/admit/lock/kick/end. Với thiết bị và mạng thật mới dùng QoS trình bày RTP.
6. Mở raw benchmark/restore, giải thích4tin/s local và giới hạn; trình bày before/after bundle, ERD/quyền/sequence.

## Vận hành và gate còn mở

Backup DB vào nơi riêng, restore DB mới, bucket backup riêng và retention theo [17](17-backend-va-van-hanh.md). TTL dọn OTP/session/rate/helper/pending upload/presence; không tự xóa audit/chat/notification hợp lệ. Board500, thread50/page, notification30/page, task comment/activity100 gần nhất. Audit npm gần nhất có7 high trong devtool transitive; chưa tự đổi major.

Chưa kiểm: email/OTP delivery thật, browser invite với QA account thứ hai được cho phép, HTTPS/public IP/TURN và RTP3/6/10 client đa mạng, native zoom200%, máy yếu, S3 cloud, backup scheduler/restore production và CI remote. Không kết luận production-ready từ bằng chứng local.
