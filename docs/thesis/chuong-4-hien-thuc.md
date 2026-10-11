# CHƯƠNG 4. HIỆN THỰC HỆ THỐNG

## 4.1. Tổ chức mã nguồn

Dự án là một monorepo npm workspaces gồm ba gói, dùng chung TypeScript:

```text
apps/web/            SPA React: app/ (providers, layout), features/<module>/, shared/
services/api/        Node.js: modules/<nghiệp vụ>/, infrastructure/ (db, realtime, email), migrations/
packages/shared/     Kiểu dữ liệu và hợp đồng sự kiện Socket.IO dùng chung client/server
experiments/         Phòng thí nghiệm media Mesh/SFU (Chương 5)
scripts/             Benchmark WebSocket, kiểm chứng sao lưu, fixture kiểm thử
infra/               Docker Compose (dev/prod), Nginx
```

Mỗi chức năng (auth, workspaces, chat, meetings, tasks, files, profiles) có route/service riêng ở backend và page/component/API client ở frontend. Hợp đồng sự kiện `ClientToServerEvents`/`ServerToClientEvents` nằm trong `packages/shared`, nên khi thay đổi tên hoặc kiểu dữ liệu, trình biên dịch báo lỗi ở cả hai phía.

## 4.2. Lõi thời gian thực (Node.js + Socket.IO)

### 4.2.1. Xác thực và kiểm quyền từng sự kiện

`infrastructure/realtime/socket.ts` khởi tạo Socket.IO trên cùng HTTP server với REST, và có hai lớp middleware:

1. **Lúc kết nối:** đọc access token (JWT ký HS256, hạn ngắn) từ `handshake.auth.token`, xác minh và nạp người dùng. Kết nối không có token hợp lệ bị từ chối với lỗi `UNAUTHORIZED`.
2. **Trước mỗi sự kiện** (`socket.use`):
   - giới hạn tần suất ghi (`limitActor`: 120 thao tác/60 giây mỗi người dùng);
   - với sự kiện kênh, kiểm `channel_access` theo quyền **hiện tại** trong DB, không dựa vào phòng đã `join` từ trước;
   - với signaling media, kiểm quyền ghi kênh video, kiểm socket đang ở đúng phòng và đã được cho vào (admitted). Nhờ vậy người ở phòng chờ hoặc đã bị mời ra không thể `produce`/`consume`.

Thu hồi quyền có hiệu lực ngay: server phát `access_revoked` tới `user:<id>` rồi ngắt mọi socket của người đó.

### 4.2.2. Phân phối tin nhắn theo kênh

Khi nhận `send_message`, server thực hiện:

1. Kiểm quyền ghi, độ dài nội dung (≤ 4000 ký tự), tệp đính kèm thuộc đúng kênh.
2. Mở giao dịch, lấy *advisory lock* theo `(author, clientMessageId)`, rồi so sánh *fingerprint* (băm nội dung, reply, tệp) với bản ghi đã có:
   - chưa có → `INSERT`, lưu mention/notification, `COMMIT`, phát `new_message`;
   - đã có và giống hệt (client gửi lại do mất ACK) → trả lại tin cũ, **không phát lại**;
   - đã có nhưng khác nội dung → báo xung đột.
3. Phát `new_message` tới các phòng `user:<id>` của những người **đang có quyền đọc kênh**, xác định bằng truy vấn `channel_access`. Không phát theo phòng Workspace, để nội dung kênh riêng tư không tới nhầm người.
4. Trả ACK kèm tin đã lưu để client gỡ bản ghi khỏi outbox.

Phía client giữ các tin chưa xác nhận trong **outbox lưu bằng IndexedDB**. Tin vẫn còn khi tải lại trang và được gửi lại với cùng `clientMessageId`. Khi kết nối lại, client gọi REST `GET /api/channels/:id/messages?after=<cursor>` để lấy bù các tin đã lỡ, rồi gộp theo `id`. Kết hợp ràng buộc `unique(author_id, client_message_id)` ở DB, cơ chế này cho ngữ nghĩa **ít nhất một lần ở vận chuyển, đúng một lần ở dữ liệu**.

### 4.2.3. Presence và typing

| Thành phần | Cài đặt |
| --- | --- |
| Đếm kết nối | `onlineUsers: Map<userId, {count}>` trong tiến trình; online khi count 0→1, offline khi 1→0 |
| Bền vững/đa node | Bảng `socket_presence(socket_id, user_id, instance_id, expires_at)`; TTL 45 s |
| Heartbeat | Mỗi 15 s: gia hạn TTL các socket còn sống, xóa bản ghi hết hạn, dọn phiên họp của node đã chết, gửi `online_users` cho từng socket |
| Phạm vi phát | `user_presence` chỉ tới các Workspace mà người dùng là thành viên; tôn trọng tùy chọn ẩn hoạt động `show_activity` |
| Typing | `typing {channelId, isTyping}` → kiểm quyền → `user_typing` tới người khác trong kênh; không lưu DB |

Danh sách `online_users` được tính từ bảng `socket_presence` (`expires_at > now()`) giao với tập thành viên cùng Workspace. Vì vậy client nối vào node A vẫn thấy người dùng đang nối vào node B. Khi một node bị dừng đột ngột, bản ghi của node đó hết hạn sau tối đa 45 giây và người dùng tương ứng chuyển sang offline.

### 4.2.4. Mở rộng ngang

Với `SOCKET_ADAPTER=postgres`, Socket.IO dùng `@socket.io/postgres-adapter`: lời gọi `io.to(room).emit(...)` được ghi vào kênh `LISTEN/NOTIFY` và các node khác phát lại cho socket cục bộ của chúng. Mỗi node ghi một *lease* trong `api_instances` (gia hạn 15 s, hết hạn 45 s). Kiểm thử `distributed.test.js` chạy hai tiến trình API thật và xác nhận tin, task và thông báo đi xuyên node.

## 4.3. Lõi hội nghị (SFU mediasoup)

### 4.3.1. Pool worker và phân phòng

`modules/meetings/media/room-manager.ts` quản lý tối đa 8 worker (`MEDIASOUP_WORKERS`, mặc định 2). Mỗi worker là một tiến trình C++. Khi tạo phòng, room manager chọn worker **đang giữ ít phòng nhất**. Khi một worker chết, các phòng trên worker đó được đóng, người tham gia nhận `media_failure` để vào lại, các phòng trên worker khác vẫn chạy bình thường, và lượt tham gia kế tiếp sẽ tạo worker thay thế. Kiểm thử `worker-recovery.test.js` kill một worker thật để xác nhận hành vi này.

Cấu hình router dùng Opus 48 kHz stereo và VP8 (`x-google-start-bitrate: 1000`). Mỗi `WebRtcTransport` bật UDP và TCP, ưu tiên UDP, băng thông ra khởi đầu 1 Mbps, và announce `MEDIASOUP_ANNOUNCED_IP`. Ở production, đây phải là IP công khai. Ở môi trường phát triển, phải dùng **IP LAN chứ không dùng 127.0.0.1** (lý do ở 5.4.2).

### 4.3.2. Vòng đời producer/consumer

- `produce`: kiểm giới hạn nguồn mỗi peer (`MEETING_MAX_SOURCES_PER_PEER`, mặc định 3: mic, webcam, màn hình) và chỉ nhận nguồn `mic|webcam|screen`. Sau đó phát `new_producer` tới những người khác trong phòng.
- `consume`: kiểm `router.canConsume`, tạo consumer ở trạng thái **paused**, và chỉ chạy `resume` khi client gửi `resume_consumer` sau khi đã gắn track. Cách này tránh mất khung khóa đầu tiên.
- `consumer_layer`: `setPreferredLayers({spatialLayer, temporalLayer: 2})` cho consumer simulcast.
- `pause_consumer` *(bổ sung trong đồ án)*: `consumer.pause()`. SFU ngừng chuyển tiếp luồng này, và khi `resume`, mediasoup tự xin khung khóa mới.
- Đóng: `producerclose`/`transportclose` dọn consumer, còn `peer_left` báo cho client gỡ ô hiển thị.

### 4.3.3. Phiên họp và điều hành

`modules/meetings/sessions.ts` lưu trạng thái phiên trong PostgreSQL để mọi node đều thấy:

- Mỗi kênh có tối đa một phiên hoạt động (partial unique index). Người vào đầu tiên trở thành host.
- `enterSession` khóa dòng phiên, kiểm giới hạn số người (`MEETING_MAX_USERS`) và số tab mỗi người, rồi kiểm phòng khóa/phòng chờ. Kết quả là `admitted` hoặc `waiting`. Người ở phòng chờ có socket nhưng chưa có peer SFU.
- `meeting_action` thực hiện `waiting`/`lock` (host, cohost), `admit`/`kick`/`mute` (host, cohost, không áp dụng lên host), `cohost`/`transfer`/`end` (chỉ host) và `hand` (mọi người).
- `media_instance_id` ghi node chủ của phòng. REST `GET /api/channels/:id/media-location` trả endpoint SFU của node đó, để client mở socket media đúng nơi (room affinity).

### 4.3.4. Vượt NAT

`media/ice.ts` cấp danh sách `iceServers` kèm mỗi transport. Nếu cấu hình `TURN_URLS` và `TURN_SHARED_SECRET`, server sinh thông tin xác thực tạm thời (hạn 1 giờ) theo cơ chế TURN REST đã trình bày ở 2.2.2. Phía client, `MediasoupClientService.watchTransport` theo dõi `connectionstatechange`:
- trạng thái `disconnected` kéo dài 5 s, hoặc `failed`: gọi `restart_ice` để lấy `iceParameters` mới và chạy `transport.restartIce()`, tối đa 2 lần;
- nếu sau 10 s vẫn chưa kết nối: báo người dùng tham gia lại.

## 4.4. Client hội nghị và lưới video động

### 4.4.1. Thu và phát media

- **Phòng chờ (lobby):** xem trước camera/micro, chọn thiết bị và chất lượng (640×360 / 960×540 / 1280×720). **Chỉ** nguồn đang bật mới được `produce`. Đã kiểm 4 tổ hợp mic/camera để chắc chắn nguồn tắt không bị phát.
- **Simulcast webcam:** ba encoding `q` (÷4, 150 kbps), `h` (÷2, 400 kbps), `f` (gốc, 1200 kbps).
- **Chia sẻ màn hình:** `getDisplayMedia({video: true})` được phát như nguồn `screen`, không simulcast. Khi người dùng dừng chia sẻ từ thanh của trình duyệt (`track.onended`), producer tự đóng.
- **Bật/tắt thiết bị:** cả micro và camera đều dùng `track.enabled` cùng `producer.pause()/resume()`. Track và producer được giữ nguyên nên bật lại gần như tức thì, không phải đàm phán lại transport. Nếu chưa có track (người dùng vào phòng với thiết bị tắt), lần bật đầu tiên mới gọi `getUserMedia` và `produce`.

### 4.4.2. Thu thập QoS

`webrtc/qos.ts` (`QosCollector`) chạy mỗi 2,5 s trên `getStats()` của hai transport:
- **RTT:** từ cặp candidate được chọn (`transport.selectedCandidatePairId` → `candidate-pair.state = succeeded`);
- **jitter:** lớn nhất trong các `inbound-rtp`;
- **bitrate gửi/nhận:** từ chênh lệch byte trên chênh lệch thời gian;
- **tỉ lệ mất gói:** theo cửa sổ `Δlost/(Δreceived+Δlost)`; nếu bộ đếm bị đặt lại thì bỏ cửa sổ đó.

Giao diện giữ 300 mẫu gần nhất (≈ 12,5 phút) và cho xuất CSV/JSON.

### 4.4.3. Lưới video động

Mục tiêu là trình duyệt chỉ giải mã và vẽ những gì người dùng thực sự nhìn thấy, ở độ phân giải vừa đủ.

**(a) Bố cục tối ưu.** `grid-layout.ts → bestGridLayout(n, W, H, gap)` thử mọi số cột c = 1..n. Với r = ⌈n/c⌉ hàng, bề rộng ô là `w = min((W − gap(c−1))/c, (H − gap(r−1))/r · 16/9)`, và chọn c cho w lớn nhất. Kích thước khung lấy từ `ResizeObserver`. Kết quả được áp vào CSS `grid-template-columns: repeat(c, w px)`.

**(b) Phân trang.** Mỗi trang có 4, 6 hoặc 9 ô tùy bề rộng (`pageSizeFor`). Chế độ *Tiêu điểm* có một ô lớn và dải 5 ô nhỏ. Ô ngoài trang hiện tại **không được render** (không có `<video>`). Âm thanh của những người này vẫn phát qua phần tử `<audio>` riêng, nên không ai bị "câm" khi chuyển trang.

**(c) Chọn lớp theo ô hiển thị.** `layerForTile(cssWidth, devicePixelRatio)` chọn lớp nhỏ nhất vẫn đủ phủ ô tính theo pixel thiết bị. Với nguồn 960 px: ô ≤ 264 px → lớp 0, ≤ 528 px → lớp 1, lớn hơn → lớp 2.

**(d) Đẩy "nhu cầu" xuống SFU.** `MeetingPage` tính nhu cầu cho từng người: `null` nếu ô không hiển thị, ngược lại là số lớp. Trang gộp nhu cầu thành một khóa chuỗi để effect chỉ chạy khi có thay đổi thật. `MeetingContext.setVideoDemand` so sánh với trạng thái đã áp dụng cho từng consumer và chỉ gửi phần chênh lệch:
- hiển thị → ẩn: `pause_consumer`;
- ẩn → hiển thị: `resume_consumer` rồi `consumer_layer`;
- đổi kích thước: `consumer_layer`.

Khi trang họp không được mở (người dùng chuyển sang chat trong lúc vẫn ở trong cuộc gọi), nhu cầu bị gỡ và hệ thống quay về chính sách mặc định theo số người (> 6 → lớp 0, > 2 → lớp 1).

Như vậy, downlink của mỗi client tỉ lệ với **số ô đang hiển thị và kích thước của chúng**, không còn tỉ lệ với tổng số người trong phòng. Mức tiết kiệm được đo ở 5.4.5.

## 4.5. Giao diện nhắn tin

- Bố cục ba cột: danh sách hội thoại (lọc tất cả, chưa đọc, nhóm, yêu thích) → khung tin nhắn → panel thông tin nhóm.
- Tiêu đề kênh hiển thị "N thành viên • M đang trực tuyến", hoặc "Đang kết nối lại…" / "Mất kết nối". Danh sách thành viên có chấm trạng thái theo `online_users`.
- Khung soạn thảo có bản nháp lưu IndexedDB theo kênh, đính kèm tệp có tiến độ tải lên, ghi âm tin nhắn thoại, sticker, xem trước liên kết. Tin trong outbox hiển thị trạng thái *Đang gửi… / Gửi lỗi* kèm *Thử gửi lại* và *Bỏ lần gửi*.
- Trả lời theo luồng (thread panel), nhắc tên, ghim/lưu, tìm kiếm trong kênh với đánh dấu kết quả.

## 4.6. Triển khai

`infra/docker-compose.prod.yml` gồm các dịch vụ:
- `postgres`;
- `api` (Node.js + mediasoup), publish trực tiếp dải cổng media TCP/UDP 40000–40099;
- `web` (Nginx phục vụ SPA, kết thúc TLS và reverse proxy `/api`, `/socket.io`).

Healthcheck `/ready` chỉ đạt khi PostgreSQL đã migrate đủ. TURN dùng coturn riêng ở chế độ `use-auth-secret`, cùng secret với API. Biến môi trường cho chế độ nhiều node (`SOCKET_ADAPTER=postgres`, `API_INSTANCE_ID`, `SFU_PUBLIC_URL`) đã có sẵn, nhưng kiến trúc đa node chưa được nghiệm thu trên hạ tầng thật (xem 5.6).
