# Triển khai hệ thống

Chương này mô tả cách hiện thực các khối đã thiết kế ở Chương 3. Theo hướng dẫn của khoa, chương không đưa toàn bộ mã nguồn vào báo cáo mà trình bày giải thuật bằng sơ đồ và chỉ trích những đoạn mã ngắn thể hiện ý tưởng then chốt. Các đoạn mã đã được rút gọn, và chú thích trong mã được viết thêm cho báo cáo.

## Tổ chức mã nguồn

Dự án là một monorepo npm workspaces viết hoàn toàn bằng TypeScript (Bảng 4.1). Mỗi chức năng (xác thực, workspace, chat, cuộc họp, công việc, tệp, hồ sơ) có route và service riêng ở máy chủ, cùng page, component và API client riêng ở trình duyệt. Hợp đồng sự kiện Socket.IO (`ClientToServerEvents`, `ServerToClientEvents`) nằm trong gói dùng chung, nhờ đó trình biên dịch kiểm tra cả hai phía của mọi sự kiện.

TABLE: Bảng 4.1. Cấu trúc mã nguồn
| Thư mục | Nội dung |
| --- | --- |
| `apps/web` | Client đơn trang React: provider và layout của ứng dụng, `features/<module>`, thành phần giao diện dùng chung |
| `services/api` | Máy chủ Node.js: `modules/<nghiệp vụ>`, hạ tầng (cơ sở dữ liệu, thời gian thực, e-mail), 20 migration SQL |
| `packages/shared` | Kiểu dữ liệu và hợp đồng sự kiện Socket.IO dùng chung cho client và máy chủ |
| `experiments` | Phòng thí nghiệm media Mesh/SFU và công cụ phân tích gói tin (Chương 5) |
| `scripts` | Benchmark WebSocket, kiểm chứng sao lưu/khôi phục, dữ liệu kiểm thử |
| `infra` | Tệp Docker Compose cho môi trường phát triển và triển khai, cấu hình Nginx |

Mã nguồn gồm khoảng 17.500 dòng TypeScript/TSX và 13.000 dòng CSS ở client, khoảng 7.000 dòng TypeScript ở máy chủ và 470 dòng ở gói dùng chung.

## Lõi thời gian thực

### Xác thực và kiểm quyền từng sự kiện

Máy chủ Socket.IO dùng chung HTTP server với REST API và có hai lớp middleware. Khi socket kết nối, access token trong handshake được xác minh và thông tin người dùng được nạp; kết nối không có token hợp lệ bị từ chối. Sau đó, trước **mọi** sự kiện, lớp middleware thứ hai thực hiện các bước kiểm tra trong Hình 4.1: giới hạn số sự kiện dồn dập trên mỗi socket, xác minh lại token, giới hạn 120 thao tác ghi mỗi phút cho mỗi người dùng, kiểm tra quyền **hiện tại** đối với kênh trong cơ sở dữ liệu (không dựa vào các phòng mà socket đã tham gia trước đó), và với signaling media, kiểm tra socket đang ở trong đúng cuộc họp và đã được cho vào. Nhờ vậy người đang ở phòng chờ hoặc đã bị mời ra không thể tạo transport, produce hay consume media.

FIG: fig-4-1-authz.png | Hình 4.1. Chuỗi kiểm quyền từng sự kiện của cổng Socket.IO | 14

Đoạn mã 4.1 trình bày phần cốt lõi của middleware này. Tên sự kiện quyết định những bước kiểm tra nào được áp dụng.

CODE: Đoạn mã 4.1. Middleware kiểm quyền từng sự kiện (services/api/src/infrastructure/realtime/socket.ts, rút gọn)
```ts
socket.use(async ([event, data, ack], next) => {
  try {
    if (++burstCount > 250) throw new Error("Too many operations");
    await verifyAccessToken(token);                   // token có thể đã hết hạn
    if (WRITE_EVENTS.includes(event))
      await limitActor(user.id, "realtime-write", 120, 60);
    if (["join_channel", "send_message", "typing"].includes(event))
      // quyền hiện tại đọc từ cơ sở dữ liệu, không dựa vào phòng đã join
      await requireChannelAccess(user.id, data?.channelId);
    if (MEDIA_EVENTS.includes(event)) {
      await requireChannelAccess(user.id, data?.roomId, true);
      if (event !== "join_meeting" && activeMeetingRoomId !== data.roomId)
        throw new Error("You have not joined this room");
      if (event !== "join_meeting")
        // không ở phòng chờ, không bị mời ra
        await requireAdmitted(user.id, data.roomId, socket.id);
    }
    next();
  } catch (error) { reply(ack, error); }
});
```

Việc thu hồi quyền có hiệu lực ngay: máy chủ phát `access_revoked` tới phòng `user:<id>` và ngắt mọi socket của người dùng đó.

### Lưu tin nhắn đúng một lần

Hình 4.2 là lưu đồ xử lý `send_message`. Máy chủ kiểm tra nội dung (tối đa 4.000 ký tự) và tệp đính kèm, mở giao dịch, khóa dòng workspace và kênh ở chế độ chia sẻ, rồi kiểm tra lại quyền ghi ngay trong giao dịch, để việc thu hồi quyền xảy ra đồng thời không thể chen vào giữa bước kiểm tra và bước chèn tin. Tiếp theo máy chủ lấy một advisory lock trong phạm vi giao dịch theo bộ (tác giả, kênh, clientMessageId) và tìm tin đã có cùng mã định danh. Có ba khả năng: chưa có tin nào, khi đó tin được chèn, nhắc tên và thông báo được tạo, và `new_message` được phát sau khi commit; đã có tin cùng mã với cùng dấu vân tay nội dung, nghĩa là client đang gửi lại sau khi mất acknowledgement, khi đó tin đã lưu được trả về mà **không** phát lại; hoặc đã có tin cùng mã nhưng nội dung khác, khi đó máy chủ báo xung đột.

FIG: fig-4-2-send-message.png | Hình 4.2. Lưu đồ gửi tin nhắn lũy đẳng ở máy chủ | 14

Đoạn mã 4.2 trình bày bước chống trùng trong giao dịch. Dấu vân tay nội dung (`payloadHash`) là giá trị băm SHA-256 của nội dung, tin được trả lời, tệp đính kèm, tin gốc của luồng và danh sách người được nhắc tên, được tính trước khi giao dịch bắt đầu.

CODE: Đoạn mã 4.2. Chống trùng trong giao dịch gửi tin (services/api/src/modules/workspaces/service.ts, rút gọn)
```ts
const result = await withTransaction(async (client) => {
  // Giữ quyền thành viên hiện tại cho tới khi lệnh chèn được commit
  const access = await client.query(`SELECT m.user_id FROM memberships m ...
       AND EXISTS (SELECT 1 FROM channel_access a WHERE ... AND a.can_write)
       FOR SHARE OF m`, [channelId, userId]);
  if (!access.rowCount) throw new HttpError(403, "FORBIDDEN", "...");
  if (options.clientMessageId) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${userId}:${channelId}:${options.clientMessageId}`]);
    const previous = await client.query(
      `SELECT ..., client_payload_hash AS "payloadHash" FROM messages
       WHERE channel_id=$1 AND author_id=$2 AND client_message_id=$3`,
       [channelId, userId, options.clientMessageId]);
    if (previous.rowCount) {
      if (previous.rows[0].payloadHash !== payloadHash)
        throw new HttpError(409, "DELIVERY_CONFLICT", "...");
      // gửi lại do mất ACK: trả tin đã lưu, không phát lại
      deduplicated = true;
      return previous;
    }
  }
  return client.query(
    `INSERT INTO messages (..., client_message_id, client_payload_hash) ...`);
});
```

Tin mới được phát tới các phòng `user:<id>` của những người **hiện đang** có quyền đọc kênh, xác định qua view `channel_access`, chứ không phát tới phòng chung của cả workspace; nhờ vậy nội dung kênh riêng tư không bao giờ tới tay thành viên không thuộc kênh. Ở client, các tin chưa được xác nhận nằm trong outbox IndexedDB, vẫn còn sau khi tải lại trang và được gửi lại với cùng `clientMessageId`. Sau khi kết nối lại, client gọi `GET /api/channels/:id/messages?after=<cursor>` để lấy bù các tin đã lỡ rồi gộp theo mã định danh. Kết hợp với ràng buộc duy nhất trên (tác giả, clientMessageId), cơ chế này cho ngữ nghĩa *ít nhất một lần* trên đường truyền và *đúng một lần* trong cơ sở dữ liệu.

### Trạng thái hiện diện và đang gõ

Trạng thái hiện diện được hiện thực bằng một bộ đếm kết nối trong bộ nhớ cho mỗi người dùng và bảng `socket_presence` để nhất quán giữa các tiến trình (Bảng 4.2). Hình 4.3 trình bày heartbeat chạy mỗi 15 giây trên từng tiến trình API.

TABLE: Bảng 4.2. Hiện thực trạng thái hiện diện và đang gõ
| Thành phần | Hiện thực |
| --- | --- |
| Đếm kết nối | Map từ người dùng tới số socket; trực tuyến khi số đếm tăng từ 0 lên 1, ngoại tuyến khi giảm từ 1 về 0 |
| Trạng thái giữa các tiến trình | `socket_presence(socket_id, user_id, instance_id, expires_at)` với TTL 45 giây |
| Heartbeat | Mỗi 15 s: gia hạn TTL của các socket còn sống, xóa dòng hết hạn, dọn cuộc họp của tiến trình đã chết, gửi `online_users` cho từng socket |
| Phạm vi phát | `user_presence` chỉ tới các workspace mà người dùng là thành viên; tôn trọng tùy chọn "hiển thị hoạt động" |
| Đang gõ | `typing {channelId, isTyping}` → kiểm quyền → `user_typing` tới các thành viên khác của kênh; không lưu lại |

FIG: fig-4-3-presence.png | Hình 4.3. Heartbeat trạng thái hiện diện chạy trên từng tiến trình API mỗi 15 giây | 12

Vì danh sách trực tuyến được tính từ các dòng có `expires_at` ở tương lai, người dùng nối vào tiến trình A vẫn thấy được người dùng nối vào tiến trình B; khi một tiến trình bị dừng đột ngột, các dòng của nó hết hạn sau tối đa 45 giây và người dùng tương ứng chuyển sang ngoại tuyến.

### Phân phối sự kiện giữa nhiều tiến trình

Với `SOCKET_ADAPTER=postgres`, Socket.IO dùng adapter PostgreSQL: lời gọi `io.to(room).emit(...)` được phát qua `LISTEN/NOTIFY` và các tiến trình khác phát lại cho socket cục bộ của chúng. Mỗi tiến trình giữ một dòng lease trong `api_instances`, gia hạn mỗi 15 giây và hết hạn sau 45 giây. Bài kiểm thử tích hợp `distributed.test.js` khởi chạy hai tiến trình API thật và xác nhận tin nhắn, cập nhật công việc và thông báo đều đi xuyên tiến trình.

## Lõi hội nghị

### Nhóm worker và phân bổ phòng

Room manager giữ một nhóm worker mediasoup (`MEDIASOUP_WORKERS`, mặc định hai, tối đa tám). Khi một cuộc họp bắt đầu, room manager đặt router của nó lên worker đang giữ ít phòng nhất (Đoạn mã 4.3). Nếu một worker chết, các phòng trên worker đó bị đóng, người tham gia nhận `media_failure` và được yêu cầu vào lại, các phòng trên worker khác không bị ảnh hưởng, và lượt tham gia tiếp theo sẽ tạo worker thay thế; bài kiểm thử `worker-recovery.test.js` dừng một worker thật để xác nhận hành vi này.

CODE: Đoạn mã 4.3. Chọn worker ít tải nhất (services/api/src/modules/meetings/media/room-manager.ts)
```ts
const worker = [...this.workers].sort(
  (a, b) =>
    (this.allocations.get(a.pid) ?? 0) - (this.allocations.get(b.pid) ?? 0),
)[0];
if (!worker) throw new Error("Media worker unavailable");
this.allocations.set(worker.pid, (this.allocations.get(worker.pid) ?? 0) + 1);
return worker;
```

Router dùng Opus 48 kHz stereo và VP8 với bitrate khởi đầu 1 Mbps. Mỗi WebRTC transport bật cả UDP và TCP, ưu tiên UDP và công bố `MEDIASOUP_ANNOUNCED_IP`; giá trị này phải là địa chỉ công khai khi triển khai thật và là địa chỉ LAN (không phải `127.0.0.1`) trong môi trường phát triển, vì lý do được giải thích ở mục 5.4.2.

### Vòng đời producer và consumer

- `produce` kiểm tra giới hạn số nguồn của mỗi người tham gia (mặc định ba: micro, camera và màn hình), chỉ chấp nhận ba loại này và phát `new_producer` tới những người khác.
- `consume` kiểm tra `router.canConsume`, tạo consumer ở trạng thái **tạm dừng** và chỉ tiếp tục sau khi client gửi `resume_consumer`, tức là khi track đã được gắn vào giao diện, để không mất khung khóa đầu tiên.
- `consumer_layer` đặt lớp không gian ưu tiên cho consumer simulcast, còn `pause_consumer` dừng chuyển tiếp luồng không hiển thị. Khi consumer được tiếp tục, mediasoup tự yêu cầu một khung khóa mới.
- Việc đóng producer hoặc transport sẽ đóng các consumer phụ thuộc, và `peer_left` báo cho client gỡ ô video tương ứng.

### Phiên họp và điều hành

Trạng thái phiên họp được lưu trong PostgreSQL để mọi tiến trình thấy cùng một phiên. Mỗi kênh có tối đa một phiên đang hoạt động (ràng buộc bằng partial unique index), và người vào đầu tiên trở thành host. Khi tham gia, máy chủ khóa dòng phiên, kiểm tra giới hạn số người và số tab mỗi người, rồi kiểm tra cờ khóa phòng và phòng chờ; kết quả là *được cho vào* hoặc *đang chờ*. Người đang chờ có socket nhưng chưa có peer trên SFU. Sự kiện `meeting_action` hiện thực bật phòng chờ và khóa phòng (host và co-host), cho vào, mời ra và tắt micro (host và co-host, không áp dụng lên host), chỉ định co-host, chuyển quyền host và kết thúc (chỉ host), và giơ tay (mọi người). Dòng phiên họp còn ghi lại instance media sở hữu cuộc họp, và `GET /api/channels/:id/media-location` trả về địa chỉ SFU của instance đó.

### Vượt NAT và phục hồi ICE

Kèm mỗi transport, máy chủ trả về danh sách máy chủ ICE. Nếu có cấu hình TURN, máy chủ sinh thông tin xác thực có thời hạn như mô tả ở mục 2.2.2 (Đoạn mã 4.4).

CODE: Đoạn mã 4.4. Thông tin xác thực TURN có thời hạn (services/api/src/modules/meetings/media/ice.ts)
```ts
// có hiệu lực một giờ
const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
return [{
  urls,                                       // lấy từ TURN_URLS
  username,
  credential: createHmac("sha1", process.env.TURN_SHARED_SECRET)
    .update(username)
    .digest("base64"),
}];
```

Ở client, mỗi transport được theo dõi trạng thái kết nối (Hình 4.4). Nếu transport ở trạng thái *disconnected* liên tục 5 giây, hoặc chuyển sang *failed*, client xin máy chủ tham số ICE mới và gọi `transport.restartIce()`, tối đa hai lần. Nếu 10 giây sau khi khởi động lại mà transport vẫn chưa kết nối, người dùng được thông báo tham gia lại.

FIG: fig-4-4-ice-recovery.png | Hình 4.4. Sơ đồ trạng thái phục hồi ICE ở client | 14

## Client hội nghị và lưới video động

### Thu và phát media

Phòng chờ trước khi vào cho phép người dùng xem trước camera và micro, chọn thiết bị và chất lượng thu (640×360, 960×540 hoặc 1280×720). Chỉ những nguồn đang bật mới được phát; cả bốn tổ hợp micro/camera đều đã được kiểm tra để bảo đảm nguồn bị tắt không bao giờ bị gửi đi. Camera được phát với ba bản mã hóa simulcast *q* (một phần tư độ phân giải, 150 kbps), *h* (một nửa, 400 kbps) và *f* (đầy đủ, 1.200 kbps). Chia sẻ màn hình dùng `getDisplayMedia()` và được phát thành một nguồn riêng không simulcast, tự đóng khi người dùng dừng chia sẻ từ thanh công cụ của trình duyệt. Tắt tiếng dùng `track.enabled` kết hợp `producer.pause()`, nên bật lại có hiệu lực ngay mà không phải thương lượng lại transport.

### Thu thập số liệu QoS

Bộ thu QoS đọc `getStats()` của cả hai transport mỗi 2,5 giây. RTT lấy từ cặp candidate đang được chọn; jitter là giá trị lớn nhất trong các luồng RTP nhận; bitrate được tính từ chênh lệch số byte trên chênh lệch thời gian; còn tỉ lệ mất gói được tính theo cửa sổ từ chênh lệch bộ đếm số gói nhận và số gói mất (Đoạn mã 4.5). Giao diện giữ 300 mẫu gần nhất (khoảng 12,5 phút) và cho phép xuất ra CSV hoặc JSON.

CODE: Đoạn mã 4.5. Tính tỉ lệ mất gói theo cửa sổ (apps/web/src/features/meetings/webrtc/qos.ts, rút gọn)
```ts
if (old && sample.timestamp > old.timestamp &&
    counter.received >= old.received && counter.lost >= old.lost) {
  deltaPackets += counter.received - old.received;  // bộ đếm có thể bị đặt
  deltaLost += Math.max(0, counter.lost - old.lost); // lại: bỏ qua cửa sổ đó
  hasLoss = true;
}
...
packetLoss: hasLoss && deltaPackets + deltaLost > 0
  ? (100 * deltaLost) / (deltaPackets + deltaLost)
  : null,                                    // không có dữ liệu ≠ "mất 0%"
```

### Lưới video động và chọn lớp theo nhu cầu

Mục tiêu của lưới video là trình duyệt chỉ giải mã và vẽ những gì người dùng thực sự nhìn thấy, ở độ phân giải vừa đủ. Hình 4.5 tóm tắt giải thuật.

FIG: fig-4-5-grid.png | Hình 4.5. Lưới video theo nhu cầu: từ bố cục ô tới yêu cầu gửi SFU | 15

1. **Bố cục tối ưu.** Với n ô trong khung có bề rộng W và chiều cao H, giải thuật thử mọi số cột c từ 1 tới n, tính số hàng r = ⌈n/c⌉ và bề rộng ô w = min((W − gap·(c−1))/c, (H − gap·(r−1))/r · 16/9), rồi giữ giá trị c cho w lớn nhất (Đoạn mã 4.6).
2. **Phân trang.** Mỗi trang chứa 4, 6 hoặc 9 ô tùy bề rộng màn hình. Ô nằm ngoài trang hiện tại không được render, nhưng âm thanh của những người đó vẫn phát qua các phần tử audio riêng.
3. **Chọn lớp cho từng ô.** Hệ thống chọn lớp simulcast nhỏ nhất mà bề rộng vẫn đủ phủ ô tính theo điểm ảnh thiết bị: với nguồn rộng 960 điểm ảnh, ô tới 264 px dùng lớp 0, tới 528 px dùng lớp 1, lớn hơn dùng lớp 2 (Đoạn mã 4.7).
4. **Đẩy nhu cầu xuống SFU.** Với mỗi người tham gia, trang họp tính nhu cầu: `null` nếu ô không hiển thị, ngược lại là số lớp. Provider của cuộc họp so sánh với nhu cầu đã áp dụng cho từng consumer và chỉ gửi phần thay đổi: `pause_consumer` khi ô biến mất, `resume_consumer` rồi `consumer_layer` khi ô xuất hiện lại, và `consumer_layer` khi ô đổi kích thước. Khi trang họp không mở (người dùng chuyển sang chat nhưng vẫn ở trong cuộc gọi), nhu cầu được gỡ và hệ thống dùng chính sách mặc định theo số camera (trên sáu → lớp 0, trên hai → lớp 1, còn lại → lớp 2).

CODE: Đoạn mã 4.6. Chọn số cột cho ô 16:9 lớn nhất (apps/web/src/features/meetings/grid-layout.ts)
```ts
for (let columns = 1; columns <= tiles; columns++) {
  const rows = Math.ceil(tiles / columns);
  const byWidth = (width - gap * (columns - 1)) / columns;
  const byHeight = ((height - gap * (rows - 1)) / rows) * aspect;
  const tileWidth = Math.max(0, Math.min(byWidth, byHeight));
  if (tileWidth > best.tileWidth)
    best = { columns, rows, tileWidth, tileHeight: tileWidth / aspect };
}
```

CODE: Đoạn mã 4.7. Chọn lớp simulcast cho một ô video (apps/web/src/features/meetings/grid-layout.ts)
```ts
export function layerForTile(
  cssWidth: number, devicePixelRatio = 1, sourceWidth = 960) {
  if (cssWidth <= 0) return null;          // không render: tạm dừng consumer
  const needed = cssWidth * devicePixelRatio;
  if (needed <= (sourceWidth / 4) * 1.1) return 0; // lớp q
  if (needed <= (sourceWidth / 2) * 1.1) return 1; // lớp h
  return 2;                                        // lớp f
}
```

Nhờ vậy, downlink của một client tỉ lệ với số lượng và kích thước các ô **đang hiển thị** chứ không còn tỉ lệ với tổng số người trong phòng. Mục 5.4.6 đo tác dụng của việc chọn lớp.

## Giao diện người dùng

Client được hiện thực thành một ứng dụng đơn trang co giãn theo màn hình, giao diện tiếng Việt. Hình 4.6 là trang chủ, ưu tiên hiển thị công việc của người dùng: việc được giao, lịch họp sắp tới và thông báo, kèm lối tắt tạo nhóm mới hoặc mở phòng họp.

FIG: ui-home.png | Hình 4.6. Trang chủ với công việc được giao, lịch họp sắp tới và thông báo | 14

Hình 4.7 là một workspace với danh sách kênh và một kênh văn bản đang mở. Phần đầu trang hiển thị số thành viên và số người đang trực tuyến, các thẻ chuyển giữa tổng quan, công việc, trao đổi, cuộc họp và tài liệu của workspace, còn khung soạn tin hỗ trợ biểu tượng cảm xúc, tệp đính kèm và tin nhắn thoại.

FIG: ui-chat.png | Hình 4.7. Workspace với danh sách kênh và một kênh văn bản | 14

Hình 4.8 là một kênh video. Bảng điều hành cung cấp cho host các thao tác bật phòng chờ, khóa phòng, "kết thúc cho tất cả" và giơ tay, còn lưới video có thể chuyển giữa chế độ lưới và chế độ tiêu điểm.

FIG: ui-meeting.png | Hình 4.8. Kênh video với bảng điều hành và nút chuyển bố cục | 14

Hình 4.9 là trang quản trị, nơi owner và admin chỉnh sửa thông tin workspace, quản lý thành viên, lời mời và kênh, lưu trữ workspace và xem nhật ký hoạt động.

FIG: ui-admin.png | Hình 4.9. Trang quản trị workspace | 14

Bố cục tự điều chỉnh cho máy tính bảng và điện thoại; Hình 4.10 là giao diện chat và cuộc họp ở bề rộng 375 điểm ảnh.

FIG: ui-mobile.png | Hình 4.10. Giao diện chat (trái) và cuộc họp (phải) trên màn hình điện thoại rộng 375 điểm ảnh | 11

## Triển khai

Mô hình triển khai thật, trình bày ở Hình 4.11, dùng Docker Compose với ba dịch vụ: `postgres`; `api` chạy Node.js và mediasoup, công bố trực tiếp dải cổng media 40000–40099 qua UDP và TCP; và `web` là máy chủ Nginx phục vụ client, kết thúc TLS và chuyển tiếp `/api`, `/socket.io` tới API. Một máy chủ coturn riêng cung cấp STUN/TURN với cùng secret dùng chung như API. Kiểm tra sức khỏe `/ready` chỉ đạt khi PostgreSQL truy cập được và mọi migration đã được áp dụng. Các biến môi trường cho chế độ nhiều tiến trình (`SOCKET_ADAPTER=postgres`, `API_INSTANCE_ID`, `SFU_PUBLIC_URL`) đã có sẵn, nhưng mô hình nhiều node chưa được nghiệm thu trên hạ tầng thật (mục 5.7).

FIG: fig-4-11-deploy.png | Hình 4.11. Mô hình triển khai bằng Docker Compose | 15

## Tóm tắt chương

Máy chủ kiểm quyền mọi sự kiện Socket.IO theo trạng thái hiện tại của cơ sở dữ liệu, lưu mỗi tin nhắn đúng một lần nhờ advisory lock và ràng buộc duy nhất, và giữ trạng thái hiện diện nhất quán giữa các tiến trình bằng một bảng có TTL. Lõi hội nghị đặt mỗi cuộc họp lên worker mediasoup ít tải nhất, khởi tạo consumer ở trạng thái tạm dừng, tự phục hồi ICE và cấp thông tin xác thực TURN có thời hạn. Client phát video simulcast và chỉ yêu cầu SFU gửi những lớp mà các ô đang hiển thị cần đến. Chương 5 đánh giá các cơ chế này.
