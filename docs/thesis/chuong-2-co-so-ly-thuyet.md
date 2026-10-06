# CHƯƠNG 2. CƠ SỞ LÝ THUYẾT

Chương này trình bày nền tảng kỹ thuật của hai lõi trong hệ thống: lõi thời gian thực cho tin nhắn và trạng thái (WebSocket/Socket.IO), và lõi truyền thông đa phương tiện (WebRTC với máy chủ định tuyến SFU). Phần cuối so sánh ba mô hình hội nghị Mesh, MCU, SFU, làm cơ sở cho lựa chọn kiến trúc ở Chương 3 và thực nghiệm ở Chương 5.

## 2.1. Ứng dụng Web thời gian thực

### 2.1.1. Giới hạn của mô hình yêu cầu – phản hồi

HTTP vốn là giao thức yêu cầu – phản hồi: máy chủ chỉ trả dữ liệu khi trình duyệt hỏi. Để hiện tin nhắn mới hoặc trạng thái "đang gõ" của người khác ngay khi nó xảy ra, các kỹ thuật cũ phải giả lập luồng đẩy:

| Kỹ thuật | Cách làm | Hạn chế |
| --- | --- | --- |
| Short polling | Client hỏi định kỳ (ví dụ mỗi 2 giây) | Trễ tối đa bằng chu kỳ hỏi; lãng phí yêu cầu rỗng |
| Long polling | Server giữ yêu cầu tới khi có dữ liệu rồi mới trả | Mỗi sự kiện tốn một vòng HTTP mới, header lặp lại |
| Server-Sent Events | Một luồng HTTP một chiều server → client | Không có kênh client → server trên cùng kết nối |
| **WebSocket** | Một kết nối TCP hai chiều, lâu dài | Cần quản lý trạng thái kết nối, reconnect, mở rộng ngang |

Hệ thống chọn WebSocket vì chat, typing và presence đều cần đẩy hai chiều với độ trễ thấp.

### 2.1.2. Giao thức WebSocket (RFC 6455)

**Bắt tay.** Kết nối bắt đầu bằng một yêu cầu HTTP/1.1 có `Upgrade: websocket` và `Sec-WebSocket-Key` (16 byte ngẫu nhiên, mã hóa base64). Máy chủ ghép khóa này với chuỗi GUID cố định `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, băm SHA-1, mã hóa base64, rồi trả về trong `Sec-WebSocket-Accept` cùng mã `101 Switching Protocols`. Từ đó, kết nối TCP không còn chạy HTTP nữa mà chuyển sang khung (frame) WebSocket.

**Khung dữ liệu.** Mỗi khung gồm bit `FIN` (khung cuối của một thông điệp), `opcode` (0x1 văn bản, 0x2 nhị phân, 0x8 đóng, 0x9 ping, 0xA pong), bit `MASK`, độ dài tải (7, 7+16 hoặc 7+64 bit) và phần tải. Khung từ client bắt buộc bị che (mask) bằng khóa 32 bit để chống tấn công đầu độc bộ nhớ đệm của proxy trung gian. Ping/pong dùng để phát hiện kết nối "chết" mà TCP chưa kịp báo.

**Ưu điểm so với polling:** header chỉ gửi một lần lúc bắt tay. Mỗi khung sau đó chỉ tốn 2–14 byte phụ, và server đẩy được dữ liệu bất cứ lúc nào.

### 2.1.3. Socket.IO

Socket.IO là thư viện xây trên Engine.IO, bổ sung những gì WebSocket thuần chưa có:

- **Lớp vận chuyển dự phòng.** Engine.IO có thể bắt đầu bằng HTTP long-polling rồi nâng cấp lên WebSocket. Client của hệ thống chỉ định thẳng `transports: ["websocket"]` để bỏ bước polling.
- **Sự kiện có tên và xác nhận (acknowledgement).** `socket.emit("send_message", data, callback)` cho phép server trả kết quả cho đúng yêu cầu. Hệ thống dùng ack cho mọi thao tác ghi (gửi tin, signaling WebRTC) để client biết chắc thao tác đã thành công.
- **Phòng (room).** Server gom các socket vào phòng theo kênh (`channel:<id>`), theo người dùng (`user:<id>`) và theo cuộc họp (`meeting:<id>`), rồi phát sự kiện tới đúng phòng. Đây chính là cơ chế phân phối tin nhắn theo Channel.
- **Middleware xác thực.** Mỗi kết nối phải mang access token (JWT). Middleware kiểm tra token và quyền truy cập trước khi bất kỳ sự kiện nào được xử lý.
- **Tự kết nối lại** với backoff, và **adapter** để mở rộng ngang. Khi chạy nhiều tiến trình API, adapter PostgreSQL (LISTEN/NOTIFY) chuyển tiếp lời gọi `io.to(room).emit` sang các node khác, nhờ đó client ở node A vẫn nhận được tin từ node B.

### 2.1.4. Đồng bộ trạng thái hiện diện (Presence)

Presence là bài toán "ai đang trực tuyến" trên một tập kết nối luôn biến động. Khó khăn nằm ở ba điểm:

1. **Một người dùng có nhiều kết nối** (nhiều tab, nhiều thiết bị). Người dùng chỉ được coi là offline khi kết nối cuối cùng đóng. Hệ thống đếm số kết nối theo người dùng.
2. **Kết nối chết không báo trước** (mất mạng, tiến trình server bị kill). Mỗi bản ghi presence có hạn sống (TTL), được gia hạn bằng heartbeat. Bản ghi hết hạn được dọn và phát sự kiện offline.
3. **Quy mô phát sóng.** Mỗi thay đổi trạng thái chỉ phát tới các workspace mà người dùng là thành viên, không phát toàn cục. Nhờ vậy số thông điệp tỉ lệ với số người liên quan chứ không phải với toàn bộ hệ thống.

Typing là trạng thái ngắn hạn: client gửi `typing: true` khi bắt đầu gõ, rồi tự gửi `false` sau vài giây không gõ. Server không lưu trạng thái này mà chỉ chuyển tiếp.

## 2.2. Công nghệ WebRTC

WebRTC (Web Real-Time Communication) là tập API trình duyệt cùng các giao thức IETF cho phép truyền âm thanh, hình ảnh và dữ liệu trực tiếp giữa các điểm cuối, không cần cài plugin. Các API chính:

- `getUserMedia()` / `getDisplayMedia()`: thu camera, micro, màn hình thành `MediaStreamTrack`.
- `RTCPeerConnection`: thiết lập và duy trì một phiên truyền (ICE, DTLS, SRTP, điều khiển tắc nghẽn).
- `RTCRtpSender` / `RTCRtpReceiver`: gửi và nhận từng track, cấu hình encoding (bitrate, simulcast).
- `getStats()`: thống kê theo chuẩn W3C (`outbound-rtp`, `inbound-rtp`, `candidate-pair`…). Đây là nguồn số liệu QoS của Chương 5.

WebRTC **không định nghĩa signaling**. Việc trao đổi SDP và candidate do ứng dụng tự lo, và trong hệ thống này chúng đi qua Socket.IO.

### 2.2.1. SDP và mô hình Offer/Answer (RFC 8866, RFC 3264, JSEP RFC 8829)

SDP (Session Description Protocol) là văn bản mô tả phiên. Một bên tạo **offer**, bên kia trả **answer**; mỗi bên áp dụng mô tả của mình (`setLocalDescription`) và của đối phương (`setRemoteDescription`). Các thành phần quan trọng:

| Dòng SDP | Ý nghĩa |
| --- | --- |
| `m=audio 9 UDP/TLS/RTP/SAVPF 111` | Một "m-section" (một track); danh sách payload type |
| `a=rtpmap:111 opus/48000/2`, `a=rtpmap:96 VP8/90000` | Ánh xạ payload type → codec, tần số đồng hồ |
| `a=fmtp:...` | Tham số codec |
| `a=mid:0`, `a=group:BUNDLE 0 1` | Định danh m-section; gộp mọi track lên **một** transport |
| `a=rtcp-mux` | RTP và RTCP dùng chung một cổng |
| `a=ice-ufrag`, `a=ice-pwd`, `a=candidate:` | Thông tin ICE |
| `a=fingerprint:sha-256 ...`, `a=setup:actpass` | Vân tay chứng chỉ DTLS, vai trò client/server DTLS |
| `a=rid:q send`, `a=simulcast:send q;h;f` | Khai báo các lớp simulcast |
| `a=extmap:... transport-wide-cc` | Phần mở rộng header RTP cho điều khiển tắc nghẽn |

Với SFU mediasoup, trình duyệt không trao đổi SDP với một trình duyệt khác. Thư viện `mediasoup-client` tự sinh SDP cục bộ từ tham số do server gửi qua signaling (`iceParameters`, `iceCandidates`, `dtlsParameters`, `rtpParameters`). Server không phải phân tích văn bản SDP.

### 2.2.2. ICE, STUN, TURN – vượt NAT và tường lửa

Hầu hết thiết bị nằm sau NAT, không có địa chỉ công khai. **ICE** (Interactive Connectivity Establishment, RFC 8445) giải quyết bằng ba bước:

1. **Thu thập candidate** (địa chỉ có thể nhận gói):
   - *host*: địa chỉ của chính card mạng;
   - *server-reflexive (srflx)*: địa chỉ công khai mà NAT gán, biết được nhờ hỏi **STUN** server;
   - *relay*: địa chỉ cấp phát trên **TURN** server, dùng khi không có đường trực tiếp.
2. **Kiểm tra kết nối.** Ghép candidate hai bên thành các cặp, sắp theo độ ưu tiên, rồi gửi STUN Binding Request trên từng cặp. Độ ưu tiên của một candidate được tính theo công thức:
   `priority = 2^24 · type_pref + 2^8 · local_pref + (256 − component_id)`,
   trong đó host > srflx > relay. Nhờ vậy ICE luôn ưu tiên đường trực tiếp.
3. **Chọn cặp (nomination).** Bên điều khiển đề cử một cặp đã thành công, và media đi trên cặp đó.

**STUN** (RFC 8489) là giao thức hỏi – đáp nhẹ, giúp client biết địa chỉ công khai của mình. Nó cũng là định dạng của các gói kiểm tra kết nối trong ICE. **TURN** (RFC 8656) là máy chủ chuyển tiếp: client xin một *allocation*, được cấp địa chỉ relay, khai báo *permission* cho từng peer, rồi gửi dữ liệu qua `Send`/`ChannelData`. TURN tiêu tốn băng thông của server nên chỉ dùng khi NAT đối xứng hoặc tường lửa chặn UDP.

**ICE-Lite.** mediasoup là máy chủ có địa chỉ công khai cố định nên chạy chế độ ICE-Lite: server chỉ khai báo host candidate (địa chỉ đã *announce*) và trả lời kiểm tra kết nối, còn trình duyệt giữ vai trò điều khiển. Server mở cả UDP lẫn TCP (`enableUdp`, `enableTcp`, `preferUdp`), nên khi UDP bị chặn, media vẫn đi được qua ICE-TCP.

**Thông tin xác thực TURN tạm thời.** Hệ thống không cấp mật khẩu TURN cố định cho client. Theo cơ chế *TURN REST API* (coturn `use-auth-secret`), server tạo `username = <thời điểm hết hạn>:<userId>` và `credential = base64(HMAC-SHA1(secret, username))`, có hiệu lực một giờ. coturn tự kiểm tra lại HMAC với cùng secret.

> Lưu ý thực nghiệm (xem 5.4.2): trình duyệt không thu thập loopback candidate. Nếu SFU announce `127.0.0.1`, kiểm tra ICE qua UDP sẽ thất bại và kết nối rơi xuống ICE-TCP. Trong môi trường phát triển, phải announce địa chỉ LAN để media đi qua UDP.

### 2.2.3. Bảo mật: DTLS-SRTP

WebRTC bắt buộc mã hóa. Sau khi ICE xác lập đường đi, hai bên chạy **DTLS** (TLS trên UDP) và so vân tay chứng chỉ với dòng `a=fingerprint` đã nhận qua signaling. Signaling chạy trên WSS nên vân tay không bị giả mạo. Khóa sinh ra từ DTLS được dùng cho **SRTP** (RFC 3711, cơ chế khóa theo RFC 5764), giúp mã hóa và xác thực từng gói RTP/RTCP. Với kiến trúc SFU, mã hóa này là *từng chặng* (client ↔ SFU): SFU giải mã SRTP để đọc header RTP rồi mã hóa lại cho từng người nhận.

### 2.2.4. RTP và RTCP (RFC 3550)

**RTP** mang dữ liệu media. Header cố định 12 byte gồm:

| Trường | Bit | Vai trò |
| --- | --- | --- |
| V, P, X, CC | 2, 1, 1, 4 | Phiên bản (=2), padding, có header mở rộng, số CSRC |
| M | 1 | Đánh dấu (với video: gói cuối của một khung hình) |
| PT | 7 | Payload type, ánh xạ qua `a=rtpmap` |
| Sequence number | 16 | Tăng 1 mỗi gói, dùng để phát hiện mất và đảo thứ tự gói |
| Timestamp | 32 | Thời điểm lấy mẫu theo đồng hồ codec (Opus 48 kHz, video 90 kHz) |
| SSRC | 32 | Định danh nguồn đồng bộ của luồng |

**RTCP** là kênh điều khiển đi kèm, gồm các loại:

| Loại | PT | Nội dung |
| --- | --- | --- |
| SR – Sender Report | 200 | Mốc NTP ↔ timestamp RTP, số gói/byte đã gửi |
| RR – Receiver Report | 201 | Tỉ lệ mất (fraction lost), tổng mất, số thứ tự cao nhất, **jitter**, LSR/DLSR |
| SDES / BYE | 202 / 203 | Mô tả nguồn (CNAME) / rời phiên |
| RTPFB | 205 | **Generic NACK** (xin gửi lại gói), **transport-cc** (phản hồi thời điểm nhận từng gói) |
| PSFB | 206 | **PLI**/**FIR** (xin khung khóa), **REMB** (ước lượng băng thông) |

**Các đại lượng QoS** dùng ở Chương 5:

- **Jitter** (độ biến thiên thời gian đến). Với `D(i−1,i) = (R_i − R_{i−1}) − (S_i − S_{i−1})`, trong đó R là thời điểm nhận và S là timestamp RTP quy ra giây, ước lượng được làm trơn theo công thức `J_i = J_{i−1} + (|D(i−1,i)| − J_{i−1}) / 16`.
- **RTT** (thời gian khứ hồi). Bên gửi tính `RTT = A − LSR − DLSR`, với A là thời điểm nhận RR, LSR là mốc của SR gần nhất, DLSR là thời gian bên nhận giữ lại trước khi gửi RR. Trình duyệt cũng đo RTT trên cặp ICE bằng STUN (`candidate-pair.currentRoundTripTime`).
- **Tỉ lệ mất gói** trong một cửa sổ đo: `Δlost / (Δreceived + Δlost)`.
- **Độ trễ jitter buffer**: thời gian trung bình một khung nằm trong bộ đệm trước khi giải mã (`jitterBufferDelay / jitterBufferEmittedCount`). Đây là thành phần chính của độ trễ đầu-cuối mà người dùng cảm nhận.

### 2.2.5. Điều khiển tắc nghẽn và thích ứng chất lượng

Mạng không có băng thông cố định, nên bên gửi phải ước lượng liên tục. Chrome dùng **GCC** (Google Congestion Control) dựa trên phản hồi transport-cc: độ trễ hàng đợi tăng là dấu hiệu sắp nghẽn, khi đó encoder giảm bitrate, độ phân giải hoặc tốc độ khung (`qualityLimitationReason = "bandwidth"`). Khi CPU không theo kịp, lý do giới hạn là `"cpu"`. Trong thực nghiệm, bitrate thấp lúc đầu phiên phản ánh pha khởi động của bộ ước lượng này. Vì vậy mỗi lượt đo có thời gian khởi động (warm-up) trước khi lấy mẫu.

Để phục vụ nhiều người nhận có băng thông khác nhau, có hai kỹ thuật:

- **Simulcast**: bên gửi mã hóa *cùng lúc* nhiều phiên bản độc lập (ví dụ 1/4, 1/2 và đầy đủ độ phân giải), mỗi phiên bản có SSRC/RID riêng. SFU chọn chuyển tiếp phiên bản phù hợp cho từng người nhận. Đổi lại, bên gửi tốn thêm encoder và uplink.
- **SVC** (Scalable Video Coding): một luồng duy nhất gồm nhiều lớp phụ thuộc nhau. SFU bỏ bớt lớp trên để hạ chất lượng.

Hệ thống dùng VP8 simulcast 3 lớp `q/h/f` (150/400/1200 kbps), kèm *temporal layer* để SFU có thể giảm tốc độ khung. Client cho SFU biết lớp mong muốn qua sự kiện `consumer_layer` và tạm dừng luồng không hiển thị qua `pause_consumer` (Chương 4).

### 2.2.6. Codec

- **Opus** (RFC 6716): codec âm thanh 6–510 kbps, 48 kHz, khung 20 ms, có FEC trong băng, phù hợp cho cả giọng nói lẫn nhạc.
- **VP8** (RFC 6386): codec video không bản quyền, được mọi trình duyệt hỗ trợ trong WebRTC và hỗ trợ simulcast tốt. Khung khóa (keyframe) lớn hơn nhiều so với khung dự đoán, nên khi người nhận mới vào hoặc SFU đổi lớp, SFU phải xin khung khóa (PLI/FIR).

## 2.3. Các mô hình máy chủ hội nghị đa điểm

Xét một phòng có N người tham gia, mỗi người gửi một luồng video có bitrate b.

### 2.3.1. Mesh (P2P toàn phần)

Mỗi cặp người tham gia có một `RTCPeerConnection` riêng, tổng cộng N(N−1)/2 kết nối. Mỗi client phải **mã hóa N−1 lần** (mỗi kết nối một encoder, vì điều khiển tắc nghẽn độc lập), **gửi N−1 luồng** và **nhận, giải mã N−1 luồng**.

- Ưu điểm: không cần máy chủ media, độ trễ thấp nhất (một chặng), mã hóa đầu-cuối thực sự.
- Nhược điểm: uplink và CPU của client tăng tuyến tính theo N. Uplink thường là phía yếu nhất của mạng gia đình và di động, nên Mesh thực tế chỉ dùng được cho khoảng 4 người.

### 2.3.2. MCU (Multipoint Control Unit)

Mỗi client gửi một luồng lên máy chủ. Máy chủ **giải mã tất cả, trộn** (ghép hình, trộn tiếng) **rồi mã hóa lại** một luồng tổng hợp cho từng người.

- Ưu điểm: client chỉ gửi một và nhận một luồng, nên phù hợp với thiết bị yếu và hệ thống SIP/H.323 cũ.
- Nhược điểm: máy chủ tốn CPU rất lớn (giải mã N + trộn + mã hóa đến N lần), thêm độ trễ xử lý, bố cục cố định do máy chủ quyết định, và chất lượng giảm do mã hóa lại.

### 2.3.3. SFU (Selective Forwarding Unit)

Mỗi client gửi một luồng (hoặc một nhóm simulcast) lên SFU. SFU **không giải mã**, chỉ đọc header RTP và *chọn lọc* chuyển tiếp gói tới những người cần, đồng thời xử lý RTCP (NACK, PLI, ước lượng băng thông cho từng người nhận).

- Ưu điểm: uplink của client không đổi theo N. CPU máy chủ thấp vì chỉ làm việc ở mức gói tin. Mỗi người nhận có thể được phục vụ một lớp chất lượng khác nhau, và client tự quyết định bố cục.
- Nhược điểm: downlink của client vẫn tăng theo N−1 (giảm được bằng cách chọn lớp thấp hoặc tạm dừng luồng không hiển thị), băng thông ra của máy chủ ≈ N(N−1)·b', và mã hóa chỉ là từng chặng.

### 2.3.4. So sánh định lượng

| Đại lượng (mỗi client) | Mesh | MCU | SFU | SFU + simulcast |
| --- | --- | --- | --- | --- |
| Số encoder video | N−1 | 1 | 1 | 3 (cố định) |
| Uplink | (N−1)·b | b | b | b_q + b_h + b_f |
| Downlink | (N−1)·b | b_mix | (N−1)·b | Σ lớp được chọn |
| Số luồng giải mã | N−1 | 1 | N−1 | N−1 (hoặc số tile hiển thị) |
| CPU máy chủ | 0 | Rất cao | Thấp | Thấp |
| Băng thông ra máy chủ | 0 | N·b_mix | N(N−1)·b | Σ lớp được chọn |
| Độ trễ thêm | 0 | Giải mã + trộn + mã hóa | Một chặng chuyển tiếp | Một chặng chuyển tiếp |

Ví dụ với N = 6 và b = 1,2 Mbps, mỗi client trong Mesh phải gửi 5 × 1,2 = 6 Mbps và chạy 5 encoder. Với SFU simulcast, uplink chỉ khoảng 1,75 Mbps (0,15 + 0,4 + 1,2) với 3 encoder, bất kể N.

**Lựa chọn của đề tài: SFU (mediasoup).** Lý do là uplink và CPU client không tăng theo N, máy chủ không giải mã nên chi phí CPU thấp, và việc kết hợp simulcast với chọn lớp theo kích thước ô hiển thị giúp kiểm soát được cả downlink. Chương 5 kiểm chứng định lượng lựa chọn này bằng thực nghiệm Mesh và SFU trên cùng phần cứng.

## 2.4. mediasoup

mediasoup là thư viện SFU cho Node.js. Lõi xử lý media viết bằng C++ và chạy trong các tiến trình con riêng, còn API điều khiển viết bằng JavaScript/TypeScript. Các khái niệm chính:

| Thành phần | Vai trò |
| --- | --- |
| **Worker** | Tiến trình C++ chạy trên một lõi CPU; hệ thống tạo một pool worker và phân phòng theo tải |
| **Router** | Một "phòng" media, chứa danh sách codec chung; chuyển tiếp gói giữa producer và consumer |
| **WebRtcTransport** | Điểm cuối ICE-Lite/DTLS/SRTP cho một client (thường 2 transport: gửi và nhận) |
| **Producer** | Một track client gửi lên (mic, webcam, màn hình) |
| **Consumer** | Một track SFU gửi xuống một client; có thể pause/resume, chọn lớp simulcast (`setPreferredLayers`) |

Luồng signaling tối thiểu: `join` (lấy RTP capabilities của router) → `create_webrtc_transport` ×2 → `connect_webrtc_transport` (gửi DTLS parameters) → `produce` → `consume` (consumer được tạo ở trạng thái **paused**) → `resume_consumer` (chỉ resume sau khi client đã sẵn sàng nhận, tránh mất khung khóa đầu tiên).

mediasoup còn gửi các gói **probation** (SSRC 1234, `mid=probator`) để thăm dò băng thông còn trống trước khi chuyển một consumer lên lớp cao hơn. Khi đo QoS phía client, phải loại luồng này ra khỏi chỉ số jitter và mất gói (xem 5.4.3).

## 2.5. Kiểm soát truy cập theo vai trò (RBAC)

RBAC gán quyền cho **vai trò** thay vì cho từng người dùng. Hệ thống có hai tầng vai trò:

- **Tầng không gian (Workspace):** `owner` (duy nhất, toàn quyền, chuyển giao được), `admin` (quản lý thành viên, kênh, lời mời), `member` (dùng các kênh được phép). Kênh riêng tư (private channel) bổ sung danh sách thành viên kênh.
- **Tầng phiên họp:** `host`, `cohost`, `member`. Host và cohost điều hành phòng: phòng chờ, khóa phòng, cho vào, mời ra, tắt micro người khác, kết thúc.

Mọi sự kiện socket ghi dữ liệu và mọi lời gọi signaling media đều đi qua một middleware kiểm tra quyền truy cập kênh và trạng thái đã được cho vào phòng (admitted), trước khi tới bộ xử lý.

## 2.6. Tóm tắt chương

- WebSocket/Socket.IO cung cấp kênh hai chiều có xác nhận, có phòng và mở rộng ngang được bằng adapter. Đây là nền tảng cho chat, typing, presence và signaling.
- WebRTC lo phần thu, mã hóa, vận chuyển an toàn và thống kê media. ICE/STUN/TURN giải quyết NAT, RTP/RTCP mang dữ liệu và phản hồi chất lượng.
- Trong ba mô hình hội nghị, SFU cân bằng tốt nhất giữa tải client, tải máy chủ và độ trễ. Kết hợp với simulcast và chọn lớp theo ô hiển thị, SFU kiểm soát được cả uplink lẫn downlink.
