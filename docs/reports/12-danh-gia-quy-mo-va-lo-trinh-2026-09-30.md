# Rà soát quy mô đồ án — 30/09/2026

## 1. Kết luận và phạm vi

Dự án đã vượt mức demo chat đơn giản: có xác thực, phân quyền workspace, chat có lịch sử, tệp đính kèm, hội nghị SFU, lịch họp và thu thập QoS. Tuy nhiên, chưa đủ bằng chứng để gọi là hệ thống vận hành ở quy mô lớn. Ba khoảng thiếu chính là **vòng đời quản trị chưa đầy đủ, cộng tác công việc chưa sâu và khả năng mở rộng/vận hành chưa được kiểm chứng**.

Bản này đánh giá mã nguồn, migration, cấu hình triển khai, script kiểm thử và tài liệu hiện tại. Không thay đổi mã ứng dụng. Không chấm điểm đẹp/xấu, tương phản hay trải nghiệm mobile khi chưa kiểm tra giao diện chạy thực tế. Các chức năng “chưa thấy” nghĩa là chưa tìm thấy luồng hoàn chỉnh trong mã nguồn hiện tại, không khẳng định chúng chưa từng được lên kế hoạch. Không thay thế rubric của giảng viên; các mục mới dưới đây là đề xuất kỹ thuật.

Kiểm tra thực hiện lại trong lần rà soát này:

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck` | Qua |
| `npm run lint` | Qua |
| `npm test` | 14 test qua; 1 test tích hợp bị skip theo cấu hình mặc định |
| `npm run build` | Qua cả shared, API và web |
| `npm run test:sfu` | Test tích hợp PostgreSQL + Socket.IO + SFU signaling qua, không skip |
| Audio/video thật qua nhiều trình duyệt và mạng khác nhau | Chưa thực hiện trong lần rà soát này |
| Giao diện thực tế, bàn phím, screen reader và các kích thước màn hình | Chưa xác minh trong lần rà soát này |

Test tích hợp SFU qua **không đồng nghĩa** đã kiểm chứng ICE/DTLS và luồng RTP thật. Benchmark có sẵn cũng ghi rõ giới hạn đó.

## 2. Những phần đã có và nên tiếp tục phát triển

| Mảng | Đã thấy trong mã nguồn |
|---|---|
| Tài khoản | Đăng ký, OTP email, Google login, refresh/logout, quên/đổi mật khẩu, hồ sơ và tùy chọn riêng tư |
| Workspace | Tạo nhóm, liệt kê nhóm/kênh, vai trò owner/admin/member, thêm tài khoản đã đăng ký và loại thành viên |
| Chat | Lịch sử phân trang cursor, tìm kiếm trong kênh/toàn nhóm đã tham gia, typing/presence, sửa/xóa, reply, reaction, tệp/voice message, pin/mute kênh và trạng thái đọc |
| Cuộc họp | Mediasoup SFU, mic/camera/screen share, chọn thiết bị và chất lượng, preview, bố cục và ghim người tham gia, active speaker, chat trong họp, xử lý gián đoạn kết nối |
| Lịch | Tạo/sửa/hủy lịch họp, lịch sử tham gia, xuất `.ics` |
| Đo kiểm | Thu QoS định kỳ ở client, hiển thị RTT/bitrate/loss/jitter, xuất CSV/JSON; benchmark chat/signaling và báo cáo motion |
| Hạ tầng | Migration có checksum/transaction, PostgreSQL, rate limit HTTP dùng DB, Docker/Nginx/TLS và hướng dẫn production |

Không nên đề xuất lại OTP, pagination, search, reaction hay QoS như thể chúng chưa có. Cần hoàn thiện tính nhất quán và độ tin cậy của các phần này.

## 3. Những vấn đề cụ thể cần xử lý trước khi mở rộng

P1: ưu tiên cao vì ảnh hưởng hành vi/quyền riêng tư hoặc chặn phạm vi mở rộng dự kiến. P2: cải thiện chất lượng và khả năng bảo trì. P3: hoàn thiện sau. Đây là mức ưu tiên của bản rà soát, không phải kết luận rằng tất cả mục đều là lỗi bảo mật.

| Mức | Phát hiện và căn cứ | Ảnh hưởng | Hướng xử lý, tiêu chí nghiệm thu |
|---|---|---|---|
| P1 | `WorkspaceHomePage.tsx:329`: bấm tên kênh chỉ gọi `setActiveView`, không truyền workspace/channel ID. Các nút trên thẻ nhóm cũng chỉ đổi view. | Người dùng chọn kênh B nhưng trang chat/họp có thể mở lựa chọn mặc định hoặc trước đó. | Điều hướng mang theo ID; nghiệm thu với hai workspace, nhiều kênh và reload/back. |
| P1 | `MeetingPage.tsx:511` áp dụng previewCam/previewMic sau `joinCall`; `MeetingContext.tsx:338–367` lấy track mới và produce trước đó. | Khi chọn tắt trước khi tham gia, có khả năng phát media trong khoảng ngắn trước khi bị tắt. Đây là suy luận từ thứ tự mã, chưa đo thời gian phát thực tế. | Truyền trạng thái mong muốn vào join; disable track hoặc không produce nguồn đã tắt trước khi publish. Kiểm tra remote không nhận media ngoài lựa chọn của người dùng. |
| P1 khi scale nhiều API | `socket.ts:163` lưu presence bằng Map, thu hồi membership bằng EventEmitter nội bộ; chưa thấy adapter liên server. | Hai API instance không tự đồng bộ broadcast/presence/thu hồi quyền. | Adapter liên server + trạng thái presence dùng TTL + sự kiện thu hồi quyền xuyên instance; test client ở hai node. |
| P1 với mục tiêu đồ án | `docs/benchmarks/benchmark-report.md`: chỉ 1/3/5/8 client, 15 tin tuần tự mỗi mức, loopback và chưa truyền RTP. | Chưa chứng minh chịu tải, hội nghị đa điểm thật hay QoS mạng thực. | Tăng bài đo, lưu từng mẫu và tiến hành cuộc gọi thật; báo cáo đúng phạm vi đã đo. |
| P2 | `getQosMetrics` trong `webrtc/mediasoup-service.ts`: cộng candidate-pair thành công, loss là tỷ lệ tích lũy; lịch sử QoS giữ trong state client. | Có thể đếm sai bitrate khi nhiều candidate pair; loss không phải mất gói của khoảng lấy mẫu. Reload mất lịch sử chưa xuất. | Chọn pair thực đang dùng, tách send/receive, tính delta theo SSRC và xử lý reset counter. Ghi rõ đơn vị/cửa sổ đo; lưu raw samples theo phiên thử nghiệm. |
| P2 | `main.tsx` import 9 lớp CSS global; build hiện có CSS entry 181.71 kB, gzip 32.51 kB. | Cascade khó kiểm soát và khó giữ nhất quán khi thêm trang. Kích thước này chưa tự chứng minh giao diện chậm. | Hợp nhất token/lớp style, bỏ rule không dùng bằng bằng chứng coverage, tách CSS theo feature; đo lại trên thiết bị mục tiêu. |
| P2 | MASTER mô tả light cream/plum nhưng `AppContext.tsx:78` ép dark; brand/components có nhiều giá trị màu trực tiếp. | Tài liệu thiết kế và sản phẩm không khớp, khó duy trì theme. | Chốt dark hiện tại hoặc thiết kế nhiều theme có chủ đích; cập nhật token và tài liệu tương ứng. |
| P2 | Trang chủ nói có thể thêm kênh trong Tin nhắn nhưng chưa thấy API tạo kênh. | Giao diện hướng dẫn hành động chưa khả dụng. | Thêm chức năng quản lý kênh hoặc sửa hướng dẫn theo hành vi thật. |

## 4. Chức năng nên bổ sung để tăng chiều sâu nghiệp vụ

### A. Quản trị workspace và kênh — nên làm trước

Hiện có nền tảng phân quyền, nhưng chưa thấy vòng đời quản trị hoàn chỉnh:

- Sửa thông tin nhóm, lưu trữ/khôi phục nhóm, rời nhóm và chuyển chủ sở hữu. Việc xóa vĩnh viễn cần chính sách rõ ràng, không mặc định xóa dữ liệu cộng tác ngay.
- Đổi vai trò admin/member bằng API có quyền kiểm tra, bảo vệ chủ nhóm cuối cùng và ghi lịch sử thay đổi.
- Invitation qua email/link có token hash, thời hạn, trạng thái pending/accepted/revoked; hỗ trợ người chưa có tài khoản. Endpoint `approve` hiện thêm membership, chưa đủ để kết luận đã có workflow yêu cầu gia nhập.
- CRUD và sắp xếp kênh; kênh công khai trong workspace/kênh riêng tư; quyền thành viên theo kênh. Kênh riêng tư phải được bảo vệ ở REST, socket, search và download.
- Trang quản trị thành viên: tìm/lọc, lời mời chờ, vai trò, nhật ký và dung lượng sử dụng.

**Ca bảo vệ tốt:** chủ nhóm mời người mới → người đó đăng ký và nhận lời → vào kênh riêng → bị thu hồi quyền → không thể nhận socket, tìm kiếm hay tải tệp của kênh đó.

### B. Chat cho nhóm đông — phát triển trên những phần đã có

- Thread có vùng xem riêng, số phản hồi và unread theo thread; reply hiện tại là nền tảng, không tương đương đầy đủ với thread.
- Mention `@user`, thông báo bền vững, trung tâm thông báo, đánh dấu đã đọc và tùy chọn theo nhóm/kênh. Hiện đã có toast thông báo, unread và mute; phần cần thêm là lưu/sync và truy cập lại thông báo.
- Ghim tin nhắn quan trọng, bookmark cá nhân; phân biệt với pin kênh đang có.
- Tìm kiếm theo người gửi, khoảng ngày, loại tệp; phân trang kết quả thay cho giới hạn 20 kết quả toàn cục.
- Trạng thái gửi/đã gửi/lỗi và retry có `clientMessageId` chống lưu trùng khi ACK mất. Cursor/backfill để lấy lại tin bị bỏ lỡ khi reconnect.
- Thư viện tệp của workspace với quyền, bộ lọc và quota; chỉ thêm DM nếu còn thời gian sau khi quản trị nhóm hoàn chỉnh.

### C. Điều hành cuộc họp — tăng tính thực tế của SFU

Đã có preview/chọn thiết bị, screen share, pin/active speaker, chat và lịch. Nên bổ sung:

- Host/co-host, phòng chờ, khóa phòng, duyệt người vào, loại người tham gia, kết thúc cho mọi người.
- “Yêu cầu tắt mic” hoặc host mute producer có chính sách rõ ràng; không cho host tự bật mic/camera của người khác.
- Raise hand và phản hồi nhanh; giới hạn số người/nguồn media theo cấu hình.
- Phiên họp có ID, trạng thái và host riêng, liên kết lịch hẹn với phiên thực tế; hiện lịch sử chủ yếu là bản ghi tham gia socket.
- Thử nghiệm TURN cho mạng hạn chế, ICE restart/rejoin có kiểm soát; tùy chọn chất lượng hiện tại chưa thay thế cơ chế thích ứng băng thông.
- Simulcast hoặc SVC phù hợp codec, chọn layer theo kích thước tile/điều kiện mạng; so sánh chất lượng và tài nguyên trước/sau.

Recording, phụ đề và AI tóm tắt là hướng mở rộng tốn nhiều xử lý/lưu trữ. Chọn một khi chức năng cơ bản và bài đo SFU đã ổn, không đưa tất cả vào phạm vi bắt buộc.

### D. Một module cộng tác công việc — chọn một

**Khuyến nghị Kanban/task** nếu muốn tăng quy mô nghiệp vụ: giao người phụ trách, hạn chót, ưu tiên, checklist, comment, attachment và activity log; trạng thái cập nhật realtime. Luồng chat → tạo task → họp → cập nhật kết quả giúp sản phẩm trở thành môi trường làm việc rõ hơn.

Nếu muốn trọng tâm nghiên cứu thuật toán, chọn **tài liệu cộng tác CRDT** thay Kanban: cùng sửa, cursor người dùng, snapshot và lịch sử. Module này khó hơn đáng kể. Không bắt buộc triển khai cả hai để đạt đồ án tốt; cân đối với trọng tâm WebRTC hiện tại.

## 5. Những giao diện cần cải thiện

| Trang/khu vực | Cải thiện nên làm | Nghiệm thu |
|---|---|---|
| Trang chủ | Sửa điều hướng đúng nhóm/kênh; ưu tiên “tiếp tục công việc”, lịch sắp tới, unread/mention; số nhóm/kênh chỉ là thông tin phụ. | Bấm từng thẻ mở đúng đối tượng; nội dung lấy từ dữ liệu thật. |
| Navigation | Workspace hiện tại rõ ràng; URL cho workspace/channel/meeting, deep link và back/forward; nút quản trị theo quyền. | Copy link sang tab khác/reload vẫn đúng màn hình. |
| Chat | Giữ composer dễ truy cập; thread/context dưới dạng panel; chuyển nhóm, tải lịch sử, gửi lỗi và upload progress nhất quán. Giảm fetch lại preference theo từng toast bằng cache/invalidation. | Không mất bản nháp khi chuyển panel; retry không nhân đôi tin. |
| Meetings | Giữ lobby chọn thiết bị đang có; tôn trọng lựa chọn mic/camera; điều khiển chính rõ trên mobile; trạng thái joining/reconnecting/permission denied phân biệt; QoS chi tiết có thể thu gọn. | Phòng 3–6 người, share màn hình và mất mạng vẫn rõ trạng thái. |
| Settings/members | Thêm trang riêng cho quản trị kênh, lời mời, vai trò, quota và audit; tránh dồn vào chat. | Member không thấy hành động quản trị và API vẫn chặn khi gọi trực tiếp. |
| Profile | Tách hồ sơ công khai với tài khoản, bảo mật và thông báo; thêm quản lý phiên đăng nhập nếu mở rộng session management. | Tùy chọn riêng tư áp dụng nhất quán ở profile/presence/search. |
| Empty/error states | Onboarding ngắn: tạo nhóm → mời người → mở kênh; hướng dẫn phải trỏ vào chức năng thực tế. | Người chưa có nhóm không rơi vào màn hình chat vô ích. |

Về accessibility, đã có skip link, nhãn icon, focus handling cho modal và reduced-motion. Cần kiểm tra tiếp toàn bộ bàn phím, menu/sidebar, thông báo động, tương phản, zoom 200%, touch target và responsive ở 375/768/1024/1440px. Không coi sự hiện diện của thuộc tính ARIA là bằng chứng toàn bộ UI đạt chuẩn.

Về performance, đã lazy-load trang và vendor; không cần đề xuất lại code splitting như tính năng thiếu. Kiểm tra danh sách chat lâu dài có cần virtualization, giới hạn bộ nhớ QoS và hiệu ứng trên máy yếu. Có báo cáo motion trước đó nhưng cần đo lại sau mỗi thay đổi lớn của thiết kế.

## 6. Database, API, backend và vận hành

### Database

Các migration hiện có ràng buộc FK, unique, check và index; không cần thiết kế lại DB từ đầu. Mở rộng theo module được chọn:

- `workspace_invitations`, `channel_memberships`, `audit_events` cho quản trị.
- `notifications`, `notification_reads`, `message_mentions` cho thông báo.
- `meeting_sessions` và dữ liệu thí nghiệm QoS theo phiên; samples lớn cần retention, không giữ vô hạn trong bảng nghiệp vụ.
- `tasks`, `task_assignees`, `task_comments`, `task_activity` nếu chọn Kanban; trạng thái cập nhật đồng thời cần version/optimistic locking.
- Tệp hiện lưu toàn bộ `bytea` trong PostgreSQL, tối đa 8 MB/tệp. Đây là lựa chọn MVP hợp lệ; khi tăng số tệp, chuyển nội dung sang object storage, DB giữ metadata/object key. Thêm quota, kiểm tra signature/MIME, xử lý tệp mồ côi và chính sách xóa.
- Search hiện `ILIKE '%...%'`, chưa thấy trigram/FTS index. Đo `EXPLAIN ANALYZE` trên dữ liệu lớn rồi chọn `pg_trgm` hoặc FTS; kiểm tra riêng tiếng Việt/dấu, không giả định FTS mặc định giải quyết mọi trường hợp. PostgreSQL hỗ trợ index trigram cho LIKE/ILIKE: [tài liệu PostgreSQL 16](https://www.postgresql.org/docs/16/pgtrgm.html).
- Tuning pool/timeouts theo số instance; migration chạy một lần có khóa; backup tự động và diễn tập restore. Checksum/transaction đang có không ngăn hai runner đồng thời.

### API và backend

- Tách `server.ts` thành route/controller, validation, service và repository theo module. Giữ modular monolith trước; không cần chia microservice chỉ để tăng số service.
- Hợp đồng OpenAPI cho REST và danh mục event Socket.IO: payload, ACK, lỗi, quyền và timeout. Shared TypeScript không thay thế tài liệu giao thức cho reviewer/client khác.
- Chuẩn hóa validation ở ranh giới REST/socket và định dạng lỗi; API mới phải kiểm tra quyền tại server.
- Bổ sung quota và rate limit cho realtime, upload và tạo tài nguyên. HTTP đã có rate limit dùng PostgreSQL; socket chưa thấy kiểm soát tần suất event.
- Idempotency/retry cho tin nhắn và thao tác tạo tài nguyên; optimistic locking khi sửa task/lịch để tránh mất cập nhật.
- Structured logging có request ID, metrics/tracing; `/health` hiện trả `ok` vô điều kiện, cần readiness kiểm DB và tài nguyên cần thiết; shutdown đóng socket/pool/worker có thời hạn.
- Password reset đã thu hồi refresh sessions nhưng access token còn TTL. Nếu cần thu hồi tức thời, thêm session/version kiểm tra xuyên REST/socket; nghiệm thu phiên đang hoạt động sau đổi mật khẩu.

### Mở rộng realtime/media

Production Compose hiện có PostgreSQL/API/web, chưa có Redis/TURN hoặc thiết kế phân phối room. Redis adapter có thể chuyển broadcast giữa API instance, nhưng **không tự đồng bộ Map presence hay mediasoup room**. Phải thiết kế từng phần; nếu giữ HTTP polling, cần sticky session theo [hướng dẫn Socket.IO](https://socket.io/docs/v4/using-multiple-nodes/). [Redis adapter](https://socket.io/docs/v4/redis-adapter/) thường không hỗ trợ connection-state recovery, vì vậy không thay thế backfill tin nhắn.

`room-manager.ts` hiện dùng một worker và room map trong tiến trình. Mediasoup worker chạy trên một CPU core theo [tài liệu scalability](https://mediasoup.org/documentation/v3/scalability/). Bước hợp lý là worker pool và phân bổ phòng theo tải, sau đó room-to-media-node routing nếu chạy nhiều host. Tăng replica API đơn thuần không làm cùng phòng SFU trải dài đúng giữa các node.

TURN giúp relay khi đường trực tiếp không khả dụng; cần triển khai và kiểm tra với firewall/NAT hạn chế, không mặc định mọi cuộc gọi SFU đều cần relay. Xem [tài liệu WebRTC TURN](https://webrtc.org/getting-started/turn-server).

Chưa thấy workflow CI trong repository hiện tại. Nên có typecheck/lint/unit/integration và build trong CI, migration/rollback plan, cấu hình secrets ngoài source, resource limit/healthcheck, theo dõi lỗi và backup. Docker/TLS template là nền tảng triển khai, chưa phải bằng chứng production đã hoạt động.

## 7. Bằng chứng cần có để bảo vệ một đồ án lớn

1. Ma trận requirement → use case → UI/API/DB → test → kết quả. Phân biệt đã triển khai, đã chạy thật và dự kiến.
2. ERD cập nhật đủ migration 001–011 và các module mới; sequence diagram auth, gửi tin, join/produce/consume, reconnect và thu hồi quyền.
3. E2E trình duyệt cho đăng ký/OTP, invitation, quyền kênh, chat/upload, lịch và tham gia họp. Tests hiện tập trung API, chưa thấy bộ E2E frontend.
4. Bài tải chat đề xuất: 50/100/200 socket, nhiều workspace và kênh, mỗi mức chạy 10–15 phút/lặp 3 lần, ghi từng mẫu, tỷ lệ lỗi, duplicates, reconnect và p50/p95/p99. Đây là **mục tiêu thử nghiệm**, chưa phải khả năng đã đạt.
5. Bài media đề xuất: 3/6/10 client thật, truyền audio/video, thêm screen share, ít nhất hai môi trường mạng, thử loss/jitter/giới hạn băng thông và tái kết nối. Chốt số client theo phần cứng, không hứa trước 10 client sẽ đạt chất lượng.
6. CPU/RAM riêng cho API, mediasoup worker, DB; băng thông send/receive, packet loss theo cửa sổ, jitter/RTT, FPS/resolution nếu thu được. Lưu raw data, phiên bản code/config và điều kiện đo.
7. So sánh một thay đổi có ý nghĩa: một worker với worker pool, video một layer với simulcast, hoặc query search trước/sau index. Thảo luận cả giới hạn và kết quả không đạt.
8. Demo trên HTTPS với email thật, ít nhất hai thiết bị; video backup cho demo; hướng dẫn cài đặt sạch và bản thuyết minh khớp kết quả đo.

## 8. Phạm vi và thứ tự đề xuất

| Đợt | Kết quả cần đạt | Ước lượng tham khảo cho một người |
|---|---|---|
| 1 — Khép kín sản phẩm | Sửa hai hành vi P1; quản trị nhóm/kênh, lời mời/vai trò; deep link; quyền kênh và audit cơ bản | 1–2 tuần |
| 2 — Cộng tác và điều hành | Host/phòng chờ; mention/thông báo bền vững; một module Kanban nhỏ hoàn chỉnh | 2–3 tuần |
| 3 — Độ tin cậy và đo kiểm | Realtime đa instance, worker pool/TURN theo nhu cầu, QoS chuẩn hóa; E2E/CI, tải và media thật | 2–3 tuần |
| 4 — Hoàn thiện bảo vệ | UI QA, triển khai, ERD/sequence/test matrix, biểu đồ thực nghiệm và kịch bản demo | Khoảng 1 tuần |

Ước lượng chưa biết năng lực nhóm, thời hạn và rubric nên chỉ dùng để sắp phạm vi, không phải cam kết lịch. Nếu thời gian ít, ưu tiên đợt 1 và bằng chứng SFU/QoS trong đợt 3; thu nhỏ Kanban và hoãn recording/AI/CRDT. Nếu còn 6–9 tuần, gói **quản trị đầy đủ + Kanban + điều hành họp + bài đo tải/media đáng tin cậy** là hướng mở rộng cân đối.

Không nên dùng số bảng DB, số trang hay số công nghệ làm thước đo quy mô. Một đồ án mạnh cần nghiệp vụ trọn vẹn, phân quyền nhất quán, hệ thống phục hồi được và kết quả thực nghiệm có thể tái lập.
