# Backend, storage và vận hành — 01/10/2026

## Module và hợp đồng

`server.ts` chỉ điều phối HTTP. Các controller `auth/routes`, `profiles/routes`, `workspaces/routes`, `chat/routes`, `tasks/routes`, `meetings/routes`, `files/routes` dùng context/utils chung. Quyền và transaction nằm trong service; REST và socket dùng cùng service. `packages/shared/src/socket.ts` là catalog TypeScript các event/ACK. REST catalog có thể mở tại `/api/openapi.json`; policy/payload đầy đủ ở tài liệu14–16. Catalog còn generic response ở một số endpoint, chưa dùng để sinh SDK.

REST lỗi `{error:{code,message}}`, UUID validation, version409 cho task. Socket ACK `{success,error?,...}`; deadline client10s. Chat có ID/fingerprint bền vững, một số thao tác toggle (reaction/pin/bookmark) không có idempotency token, không tự retry khi ACK mất.

## Database và migration

Pool mặc định10 mỗi API, connect5s, statement15s, query20s; tổng pool phải tính theo số node và giới hạn PostgreSQL. Migration dùng **một connection**, advisory lock778921402 cho toàn runner, transaction từng file và checksum. Không sửa migration đã áp dụng. Migration019 thêm metadata storage/lease/adapter,020 thêm trigger hàng đợi object cleanup.

`node scripts/database/verify-restore.mjs` sau build, với Docker PostgreSQL đang chạy. Script chỉ tạo hai database tên QA ngẫu nhiên, chạy hai migration runner đồng thời, pg_dump custom rồi pg_restore và đối chiếu schema/dữ liệu Unicode; dọn đúng hai database đã tạo. `POSTGRES_CONTAINER` mặc định `infra-postgres-1`. Kết quả thật:20 migration; một runner áp dụng20, runner còn lại skip20; restore giữ20 migration và tin tiếng Việt. Raw `evidence/restore-2026-10-01.json`. Bản dump chỉ chứa QA, không phải bản sao lưu dữ liệu thực tế.

Backup vận hành: dùng `pg_dump --format=c --no-owner`, lưu ngoài public web/git, mã hóa và đặt retention ở nơi lưu. Restore vào DB **mới**, chạy `pg_restore --no-owner --exit-on-error`, kiểm checksum/schema/count/quyền trước đổi DATABASE_URL. Sao lưu bucket S3/versioning riêng: dump DB không chứa object S3. Lịch backup phụ thuộc nơi triển khai, chưa có scheduler production được chạy.

## Storage và retention

`FILE_STORAGE_PROVIDER=db` tương thích tệp bytea cũ; `s3` lưu object bằng AWS SDK, metadata vẫn ở PostgreSQL. Bucket private; API xác thực quyền trước và sau khi fetch object, không phát URL public. `S3_BUCKET/REGION/ENDPOINT/FORCE_PATH_STYLE`, AWS credential chain chuẩn, abort10s/retry2. Không đưa credentials vào VITE_*.

Upload8MB, signature theo MIME (PNG/JPEG/GIF/WebP/WebM/Ogg/MP4/MP3/PDF/text/ZIP/DOCX); không thay thế antivirus hoặc phân tích toàn bộ archive. Quota512MiB/workspace và128MiB/user/workspace, serialize theo workspace lock. Metadata S3 bị xóa kể cả cascade sẽ vào queue; xóa object thất bại giữ retry sau1h. Background mỗi10phút giữ một ngày cho upload chưa gắn, chỉ xóa file không được message/task tham chiếu. File đã gắn không bị retention này xóa. Hàng đợi xử lý một object/lần để giới hạn transaction; có thể cần worker riêng khi backlog lớn. Dọn OTP/session/rate/helper payload quá hạn; không tự xóa audit/chat hợp lệ.

`storage.test.js`: DB + HTTP mock tương thích S3 SDK, spoofed MIME, quota, quyền, pending/attached retention, queue retry. Đã kiểm protocol/SDK, chưa kiểm credentials/bucket cloud thực.

## Realtime nhiều node

Đặt `SOCKET_ADAPTER=postgres`, cùng DATABASE_URL và SOCKET_CHANNEL_PREFIX, **API_INSTANCE_ID khác nhau**. Dùng WebSocket hoặc sticky-session cho polling. Adapter PostgreSQL LISTEN/NOTIFY dùng bảng socket_io_attachments; không hỗ trợ connection state recovery. Client backfill từ DB khi reconnect. DB mất thì readiness503; adapter không bảo đảm broadcast liên node khi PostgreSQL hỏng. [Tài liệu chính thức](https://socket.io/docs/v4/postgres-adapter/).

Presence lease45s, heartbeat15s, snapshot chỉ người chia sẻ workspace và cho hiển thị hoạt động. Disconnect tab cuối mới offline; crash tự hết lease. Thu hồi membership/private access phát server-side event, ngắt socket ở mọi node; mọi thao tác còn kiểm quyền DB hiện tại. Meeting connections của instance hết lease được leave/transfer/end theo chính sách host.

`distributed.test.js` fork **hai tiến trình API**: chat retry một bản ghi/broadcast, notifications/task liên node, presence hai node, thu hồi private và REST403. SFU misroute bị từ chối; adapter không chia sẻ router/transport.

## SFU và vận hành

MEDIASOUP_WORKERS mặc định2, tối đa8; router mới chọn worker ít phòng, room chỉ có một router. Worker chết đóng peers của worker đó; API/chat tiếp tục, join mới thay worker. Test kill worker thật, phòng worker khác giữ peer, tạo worker thay thế và đọc resource usage. Consumer trùng/concurrent và transport/source có giới hạn.

Session gắn media_instance_id, node khác không tạo SFU thứ hai. Khi owner hết lease, phiên cũ kết thúc trước phiên mới. Công bố `SFU_PUBLIC_URL` có thể truy cập từ trình duyệt ở mỗi node media. Frontend tra media-location trước join, mở WebSocket media riêng đến owner, giữ chat qua API; `VITE_SFU_URL` là endpoint khởi tạo khi chưa có owner. Nếu hai người khởi tạo đồng thời qua hai node, DB chọn một owner, yêu cầu sai node bị từ chối; tham gia lại sẽ tra owner mới. Không phân tán một room qua nhiều SFU. Đã kiểm DB/signaling misroute; routing frontend nhiều endpoint cần nghiệm thu deployment riêng.

`/health` liveness; `/ready` kiểm DB và migration020; protected `/api/operations/metrics` dùng OPERATIONS_TOKEN, số request/lỗi/duration, pool, socket/room/peer/worker và resource worker. REQUEST_LOGS=true xuất JSON requestID/method/path/status/duration, không query/token/body. Shutdown SIGTERM/SIGINT: ngừng HTTP/socket, đóng router/worker/pool, deadline10s. Realtime burst250/10s/socket và write120/min/user lưu PostgreSQL; upload30/min/user.

CI `.github/workflows/verify.yml`: npm ci, typecheck, lint, unit, migrate, PostgreSQL + SFU integration, build. Workflow chưa chạy trên GitHub vì workspace không có checkout/remote. Audit npm phát hiện7 high thuộc công cụ lint transitive; chưa tự đổi major hoặc coi đã xử lý. Cần gate lại trước triển khai production.

## Nghiệm thu

9 kiểm thử `npm run test:sfu` qua,0skip, gồm storage/two-process/worker failure và localAPI lease hết hạn kết thúc phiên/ghi lịch sử rời. Lease/presence cleanup nay chạy cả mode local; session affinity được ghi cho mọi socketjoin. Legacy connection không có lease được xét sau45s, không giữ ghost participant mãi sau restart. Migration/restore QA qua; typecheck/lint/build cuối qua,20 migration skip đúng checksum. Compose production được kiểm config, proxy upload8MiB/readiness/hashedassets và các env mới; chưa triển khai host thật. Chưa có bằng chứng RTP đa mạng/TURN/email/cloud S3 production.
