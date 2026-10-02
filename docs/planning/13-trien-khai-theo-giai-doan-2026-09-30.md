# Triển khai mở rộng — 30/09/2026

## Khảo sát và baseline

- Không có Git checkout trong thư mục hiện tại; bảo toàn source và migration 001–011.
- Frontend: `AppContext` điều hướng bằng state; `SocketContext` kết nối realtime; `MeetingContext` quản lý media; các trang nằm trong `apps/web/src/features`.
- Backend: `server.ts` REST, `socket.ts` signaling/chat/presence; service workspace và lịch họp; `mediasoup/room-manager.ts` quản lý worker/phòng.
- PostgreSQL: auth/OTP/session, workspace/membership/channel/message, file/reaction/read/preference, meeting history/schedule. Migration có checksum và transaction.
- Hạ tầng: Docker Compose PostgreSQL/API/web, Nginx TLS; benchmark chat/signaling và tài liệu triển khai. Chưa có bằng chứng RTP thật đa mạng hay nhiều API instance.
- Baseline: typecheck, lint, build qua; `npm test` 14 qua, 1 integration skip theo mặc định; chạy riêng integration PostgreSQL qua, không skip.

## Đối chiếu báo cáo 12

| Phát hiện                           | Đối chiếu source hiện tại                                                |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Home mở view không truyền ID        | Xác nhận: thẻ nhóm/kênh gọi `setActiveView`                              |
| Lobby tắt mic/cam sau produce       | Xác nhận: `joinCall` produce rồi `enterRoom` mới toggle                  |
| Presence/broadcast trong tiến trình | Xác nhận Map/EventEmitter; chưa có adapter liên node                     |
| Bằng chứng tải/RTP                  | Báo cáo cũ chỉ loopback/signaling; chưa đo bổ sung                       |
| QoS candidate pair/loss tích lũy    | Còn trong mediasoup client, cần sửa ở giai đoạn đo kiểm                  |
| CSS/theme                           | 9 lớp global; CSS entry build 181.71 kB; dark đang được ép trong context |
| Quản trị kênh                       | Chưa có CRUD kênh hay private membership                                 |
| Idempotency/backfill                | Chưa có clientMessageId; ACK timeout khuyên kiểm tra lịch sử thủ công    |

Lịch họp và cá nhân hóa/profile/media chat đã có; phát triển tiếp, không tạo lại. Đã sửa CORS PATCH/DELETE và grid mobile khi nghiệm thu lịch họp.

## Checklist theo giai đoạn

Trạng thái: `[ ]` chưa hoàn tất, `[x]` đã kiểm chứng. Không đánh dấu toàn giai đoạn khi còn tiêu chí chưa đạt.

### 1. Hành vi lõi

- [x] URL mang workspace/channel/meeting ID; home mở đúng đối tượng; reload/back/forward/copy link và lỗi quyền/không tồn tại rõ ràng.
- [x] Lựa chọn lobby áp dụng trước publish; dọn track/transport khi lỗi/rời; chặn join/producer trùng.
- [x] Client message ID + unique DB; retry mất ACK không nhân đôi; UI gửi/lỗi/retry; backfill reconnect với quyền hiện tại.
- [x] Typecheck/lint/unit/build/integration và nghiệm thu trình duyệt.

### 2. Quản trị

- [x] Workspace sửa/lưu trữ/khôi phục/rời/chuyển owner/role bằng transaction, bảo vệ owner.
- [x] Invitation hash/expiry/revoke/resend/accept, tiếp tục sau auth, rate limit.
- [x] CRUD/order/archive/private channel; cùng quyền REST/socket/search/file/schedule/media; thu hồi realtime.
- [x] Trang quản trị, quota và audit; kiểm thử quyền chéo và lời mời.

## Nghiệm thu giai đoạn 1–2

- Migration 012 thêm client message ID/fingerprint/unique; 013 thêm quản trị/private access/invitation/audit; 014 thêm một owner duy nhất và constraint trigger bảo vệ membership owner khi commit. Không sửa migration đã áp dụng.
- 2 test frontend: URL định danh giữ tiếng Việt/query; cả 4 tổ hợp mic/camera không publish nguồn bị tắt. Integration: 6 retry đồng thời chỉ 1 bản ghi; bỏ ACK/gửi lại chỉ 1 broadcast; phân trang after; thu hồi quyền chặn retry/backfill.
- Trình duyệt: 2 nhóm, chuyển kênh, reload, back/forward và home → phòng họp nhóm B đúng ID; lobby cho chọn tắt thiết bị trước khi xin quyền; join mic/camera tắt thành công; client thứ hai nhận 0 producer. Đây là kiểm chứng không phát nguồn bị tắt, **không phải** đo RTP thật.
- UI quản trị tải dữ liệu thật; tạo `qa-rieng-tu` từ modal thành công. Fixtures QA dùng email `example.test`; tình trạng dọn dữ liệu ở cuối tài liệu.
- Integration quản trị kiểm quyền REST/socket/search/file/schedule/media; grant/revoke private; archive/restore; invitation sai email/hết hạn/thu hồi/nhận đồng thời; chuyển owner và DB chặn xóa owner.
- Typecheck/lint/build qua; integration và SFU signaling qua, không skip. Email production chưa chạy thử: chức năng trả trạng thái gửi thất bại rõ ràng, liên kết vẫn có thể sao chép.

Chi tiết chính sách và API: [14-quan-tri-va-hop-dong.md](../modules/14-quan-tri-va-hop-dong.md).

### 3. Chat và thông báo

- [x] Thread panel/count/unread/pagination/deep link; mention ID và notification bền vững.
- [x] Notification pagination/read/sync/mute/current rights; message pin và bookmark.
- [x] Search filter/pagination/context; đo tiếng Việt và query plan trước chọn index.

Migration 015; module `chat/conversations.ts`, ThreadPanel, NotificationsPage, bộ lọc search. Integration thêm 52 phản hồi kiểm hai trang không trùng, read bền vững, mention/quyền/mute, idempotency, pin/bookmark cá nhân, tìm tiếng Việt và ký tự `%/_`, mở tin ngoài 100 tin gần nhất, thu hồi private. Browser gửi tin → đánh dấu → chủ đề → phản hồi → reload URL. Query mẫu 10.000 tin trong transaction rollback: 10 mẫu và EXPLAIN ANALYZE/BUFFERS lưu tại `evidence/search-2026-09-30.json`; dùng index timeline hiện có. Chưa đủ bằng chứng chọn trigram/FTS hay tuyên bố tải production; tìm kiếm hiện phân biệt dấu tiếng Việt.

### 4. Kanban

- [x] Task CRUD/archive/priority/deadline/assignee/checklist/comment/file/filter/activity.
- [x] Realtime, drag và keyboard, URL, tạo từ chat, version/conflict và stable order; test đồng thời/quyền.

Migration 016–017. Kiểm thử PostgreSQL/Socket.IO mới `tasks.test.js` qua cùng 3 suites trước; typecheck/lint/build qua. Browser: tạo từ chat giữ source, giao cho QA, thêm/đánh dấu checklist, chuyển sang Đang làm qua select, bảng xác nhận Checklist 1/1. Sửa watcher Vite Windows vì native event đã cache file mới ở trạng thái rỗng, gây lazy import undefined dù build đúng; bật polling chỉ trong dev Windows. Chi tiết hợp đồng/giới hạn: `15-chat-va-kanban.md` (bảng tối đa500, comment/activity100 gần nhất).

### 5. Điều hành họp

- [x] Session/host/cohost/waiting/lock/kick/end/raise hand/limits/host leave policy.
- [ ] Mỗi event kiểm quyền, cleanup transport; retry bounded/ICE/DTLS, TURN cấu hình; test media thật riêng.

Migration018; `meetings/sessions.ts`, MeetingControls và roster user/tab. 5 suites `test:sfu` qua0skip; frontend unit QoS qua3test. Typecheck/lint/build qua trước sửa QoS, chạy gate lại cuối giai đoạn. Retry ICE bounded, DTLS cleanup, TURN credentials TTL1h và VP8 simulcast đã triển khai. Browser join mic/cam tắt thấy host1user. Checkbox media để mở vì chưa có kiểm chứng RTP đa mạng/TURN, không coi signaling là RTP. Hợp đồng và giới hạn: `16-dieu-hanh-hop-va-media.md`.

### 6. Backend và vận hành

- [x] Module/errors/contracts/OpenAPI; pool/timeouts/migration lock/retention/backup restore QA.
- [x] Storage provider tương thích DB/quota/signature/cleanup; adapter/presence TTL/revocation 2 node.
- [x] SFU worker pool/affinity/failure; structured log/readiness/shutdown/rate limit/CI cấu hình.

Migration019–020;9 test:sfu qua0skip; hai API child process và worker kill thật. Restore QA có raw evidence,20 migration và dữ liệu Unicode giữ nguyên. Chi tiết giới hạn (cloud storage/backup scheduler/CI remote/room routing nhiều SFU) ở `17-backend-va-van-hanh.md`.

### 7. UI

- [x] Token/theme/CSS; home ưu tiên công việc; drafts/progress/states; responsive 375/768/1024/1440 trong phạm vi nghiệm thu.
- [ ] Keyboard/focus/zoom200/reduced motion/long content và đo máy yếu.

### 8. Bằng chứng và bàn giao

- [ ] E2E auth/invite/private channel/chat/task/meeting; test quyền/retry/concurrency/cleanup/migration.
- [x] Chat load 50/100/200: 6 lượt, raw ACK/receipt/resource/reconnect, p50/p95/p99; không lỗi/trùng trong kịch bản 4tin/s local.
- [ ] RTP thật 3/6/10 đa mạng/TURN/impairment; có định nghĩa QoS và procedure chạy lại, chưa có raw RTP.
- [x] README/env/ERD/architecture/6 sequences/permission/contracts/traceability/demo/restore cập nhật.

Giai đoạn7: hợp nhất 8 CSS override, home priorities, IndexedDB draft/outbox/File và version gốc task, upload progress thật, Tab/Escape/inert cho panel/sidebar. Chat/home/profile/admin/notifications/board kiểm các viewport; meeting/panel kiểm375. Chưa native zoom200% hoặc máy yếu; reduced motion thực tế bật. Chi tiết và giới hạn ở [18](../modules/18-giao-dien-va-ban-nhap.md).

Giai đoạn8: frontend5/API15 unit qua (8 DBsuite skip mặc định); test:sfu9 qua0skip; typecheck/lint/build và migration checksum20file qua. DB restore QA, schema snapshot36table+view, load732tin/21.344receipt/36lostACK retry/6reconnect có raw. Browser schedule→join mic/cam tắt→host hand/waiting/lock/end qua. Invitation nhận của tài khoản mới/private revoke E2E chưa hoàn tất; auto-review chặn tạo thêm QAaccount, đã hỏi quyền cụ thể. [Bàn giao21](../guides/21-ban-giao-va-demo.md), [benchmark20](../benchmarks/20-benchmark-va-nghiem-thu.md).

## Giới hạn kiểm chứng

Dữ liệu UI QA của hai nhóm QA còn giữ lại: auto-review chặn thao tác xoá vĩnh viễn, đang chờ người dùng cho phép phạm vi cụ thể. Phiên trình duyệt đã đăng xuất. Tạo tài khoản QA thứ hai cho E2E invitation cũng chưa được cho phép; các kiểm tra bằng tài khoản QA hiện có đã hoàn tất.

Chưa có credentials email production, host HTTPS/public IP/TURN và thiết bị đa mạng trong phạm vi đã kiểm tra. Không coi test signaling là kiểm chứng RTP, và không kết luận production-ready.
