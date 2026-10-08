# Sơ đồ khối và thiết kế hệ thống

Chương này đi từ yêu cầu, trình bày sơ đồ khối của toàn hệ thống, rồi phân tích từng khối: khối gồm những thành phần nào, đảm nhận chức năng gì và phối hợp với các khối khác ra sao. Các mục cuối chương mô tả cơ sở dữ liệu, mô hình phân quyền và các giao thức thời gian thực kết nối các khối với nhau.

## Phân tích yêu cầu

### Tác nhân

Bảng 3.1 liệt kê các tác nhân của hệ thống. Vai trò trong workspace và vai trò trong phiên họp là độc lập: cùng một người có thể là thành viên của workspace và là host của một cuộc họp trong một kênh thuộc workspace đó.

TABLE: Bảng 3.1. Các tác nhân của hệ thống
| Tác nhân | Mô tả |
| --- | --- |
| Khách | Chưa đăng nhập; xem trang giới thiệu, đăng ký, đăng nhập và mở liên kết mời |
| Thành viên | Thuộc một hoặc nhiều workspace; nhắn tin và tham gia kênh thoại/video |
| Quản trị viên (admin) | Thành viên được giao quản lý kênh, thành viên và lời mời của workspace |
| Chủ sở hữu (owner) | Người tạo workspace; toàn quyền, đổi vai trò, chuyển giao quyền sở hữu, lưu trữ |
| Host / co-host | Vai trò trong một phiên họp; điều hành phòng |

### Yêu cầu chức năng

Bảng 3.2 liệt kê các yêu cầu chức năng theo nhóm. F1–F7 là các chức năng dành cho người dùng; F8 phục vụ việc đánh giá ở Chương 5.

TABLE: Bảng 3.2. Yêu cầu chức năng
| Mã | Nhóm | Yêu cầu |
| --- | --- | --- |
| F1 | Tài khoản | Đăng ký có xác thực OTP qua e-mail, đăng nhập bằng mật khẩu hoặc Google, làm mới phiên, đặt lại mật khẩu |
| F2 | Workspace | Tạo workspace; mời thành viên qua liên kết hoặc e-mail; vai trò owner/admin/member; lưu trữ và khôi phục |
| F3 | Kênh | Kênh văn bản, thoại và video; kênh riêng tư có danh sách thành viên; sắp xếp kênh |
| F4 | Nhắn tin | Gửi, sửa, xóa tin; trả lời theo luồng, nhắc tên, cảm xúc, ghim, lưu, tệp đính kèm, tìm kiếm |
| F5 | Trạng thái | Trạng thái trực tuyến/ngoại tuyến, đang gõ và số tin chưa đọc theo thời gian thực |
| F6 | Hội nghị | Tham gia và rời kênh video; bật/tắt micro, camera; chia sẻ màn hình; lưới video động |
| F7 | Điều hành họp | Phòng chờ, khóa phòng, cho vào, mời ra, tắt micro người khác, giơ tay, kết thúc cuộc họp |
| F8 | Đo kiểm | Hiển thị và xuất số liệu QoS của cuộc gọi (RTT, jitter, mất gói, bitrate) |

### Yêu cầu phi chức năng

Bảng 3.3 nêu các yêu cầu phi chức năng và cách kiểm chứng từng yêu cầu ở Chương 5.

TABLE: Bảng 3.3. Yêu cầu phi chức năng
| Nhóm | Yêu cầu | Cách kiểm chứng |
| --- | --- | --- |
| Độ trễ | Tin nhắn tới người nhận dưới 100 ms (phân vị 95) trong mạng nội bộ | Kiểm tra tải với 50/100/200 kết nối (mục 5.3) |
| Khả năng mở rộng media | Uplink và CPU của client không tăng theo số người tham gia | Thực nghiệm Mesh/SFU (mục 5.4) |
| Chất lượng media | Mất gói ≈ 0, jitter < 30 ms, RTT < 150 ms khi mạng tốt | Số liệu `getStats()` (mục 5.4) |
| Độ tin cậy | Không mất, không trùng tin khi mất xác nhận hoặc kết nối lại; tự phục hồi ICE | Kiểm thử tích hợp (mục 5.2) |
| Bảo mật | Băm mật khẩu, token ngắn hạn, kiểm quyền từng sự kiện, DTLS-SRTP | Kiểm thử phân quyền (mục 5.2) |
| Mở rộng ngang | Chạy nhiều tiến trình API; phân bổ cuộc họp theo worker/node | Kiểm thử tích hợp hai tiến trình (mục 5.2) |

### Ca sử dụng chính

Hình 3.1 trình bày các ca sử dụng chính theo từng tác nhân. Thành viên làm việc trong workspace và kênh; owner và admin quản lý workspace; host và co-host điều hành cuộc họp.

FIG: fig-3-1-usecases.png | Hình 3.1. Các ca sử dụng chính của hệ thống | 15.5

## Sơ đồ khối hệ thống

### Tổng quan

Hình 3.2 là sơ đồ khối của hệ thống, gồm ba khối chính (client, máy chủ ứng dụng và signaling, máy chủ media SFU) và hai khối hỗ trợ (khối dữ liệu và khối vượt NAT).

FIG: fig-3-2-block-diagram.png | Hình 3.2. Sơ đồ khối hệ thống | 16

- **Khối client** là ứng dụng đơn trang React chạy trong trình duyệt. Khối này mở một kết nối Socket.IO cho nhắn tin và trạng thái hiện diện, dùng REST cho dữ liệu tải theo yêu cầu, và mở hai transport WebRTC (gửi và nhận) khi người dùng vào kênh video.
- **Khối máy chủ ứng dụng và signaling** là một tiến trình Node.js cung cấp REST API và cổng Socket.IO. Mọi yêu cầu và mọi sự kiện đều qua bước xác thực và phân quyền trước khi tới các dịch vụ chat, họp hay công việc. Room manager trong khối này điều khiển các worker media.
- **Khối media SFU** là nhóm worker C++ của mediasoup. Mỗi cuộc họp là một router đặt trên một worker; media đi thẳng giữa trình duyệt và worker.
- **Khối dữ liệu** là PostgreSQL. Ngoài dữ liệu nghiệp vụ, khối này lưu trạng thái hiện diện có TTL và chuyển tiếp sự kiện Socket.IO giữa các tiến trình ứng dụng.
- **Khối vượt NAT** là máy chủ coturn cung cấp STUN/TURN, dùng khi không thể có đường UDP trực tiếp giữa trình duyệt và SFU.

### Tách luồng điều khiển và luồng dữ liệu

Quyết định thiết kế quan trọng nhất là tách luồng điều khiển khỏi luồng media (Bảng 3.4). Tin nhắn, trạng thái hiện diện và signaling là các thông điệp nhỏ, đi qua tiến trình Node.js; còn gói âm thanh và hình ảnh có kích thước lớn, không bao giờ đi qua Node.js mà truyền thẳng giữa trình duyệt và worker C++. Nhờ vậy tiến trình Node.js chỉ phải xử lý thông điệp nhỏ, và Chương 5 cho thấy CPU của tiến trình này chỉ khoảng 1% một lõi hoặc ít hơn trong khi các worker chuyển tiếp media cho mười người.

TABLE: Bảng 3.4. Tách luồng điều khiển, luồng media và luồng dữ liệu
| Luồng | Giao thức | Đường đi |
| --- | --- | --- |
| Điều khiển (tin nhắn, presence, signaling) | WebSocket bảo mật (Socket.IO) | Trình duyệt ↔ API Node.js |
| Media | SRTP/SRTCP trên UDP (dự phòng ICE-TCP, TURN) | Trình duyệt ↔ worker mediasoup |
| Dữ liệu bền vững | SQL | API Node.js ↔ PostgreSQL |

## Phân tích từng khối

### Khối client

Khối client gồm năm thành phần:

1. **Giao diện** cho trang chủ, workspace, kênh, chat, cuộc họp, công việc, thông báo, hồ sơ và quản trị. Bố cục gồm thanh điều hướng, danh sách kênh và vùng nội dung; trên điện thoại, các cột thu lại thành ngăn kéo.
2. **Trạng thái ứng dụng và định tuyến.** Workspace, kênh và cuộc họp hiện tại được mã hóa trên URL, nên tải lại trang, bấm quay lại/tiến tới hay chia sẻ liên kết đều khôi phục đúng ngữ cảnh.
3. **Client thời gian thực.** Một kết nối `socket.io-client` duy nhất, xác thực bằng access token ngắn hạn. Thành phần này nhận tin nhắn, trạng thái hiện diện và sự kiện cuộc họp, đồng thời gửi các yêu cầu signaling có acknowledgement.
4. **Outbox và bản nháp bền vững.** Tin chưa được xác nhận và bản nháp được lưu trong IndexedDB, nên vẫn còn sau khi tải lại trang và có thể gửi lại với cùng mã định danh.
5. **Media client.** `mediasoup-client` dựng các transport WebRTC từ tham số do máy chủ gửi, phát micro, camera (ba lớp simulcast) và màn hình, nhận các track từ xa, thu thập số liệu QoS và quyết định lớp cần thiết cho từng ô video đang hiển thị.

### Khối máy chủ ứng dụng và signaling

Khối máy chủ chạy trên Node.js, gồm:

1. **Xác thực**: đăng ký có OTP qua e-mail, đăng nhập bằng mật khẩu được băm scrypt có salt [@rfc7914], đăng nhập Google, access token JWT [@rfc7519] ngắn hạn (15 phút) và refresh token xoay vòng lưu trong cookie HttpOnly.
2. **REST API** cho dữ liệu tải theo yêu cầu: workspace, lịch sử kênh, tệp, tìm kiếm, thông báo, công việc và quản trị.
3. **Cổng Socket.IO** với hai lớp middleware: kiểm tra token khi kết nối, và giới hạn tần suất cùng kiểm quyền trước mỗi sự kiện.
4. **Các dịch vụ nghiệp vụ**: chat (tin nhắn, luồng trả lời, nhắc tên, thông báo), workspace và lời mời, phiên họp và điều hành, công việc.
5. **Room manager**, quản lý nhóm worker mediasoup, đặt mỗi cuộc họp lên một worker và thay mặt client tạo transport, producer và consumer.

### Khối media SFU

Khối SFU là một nhóm worker mediasoup (mặc định hai, tối đa tám). Mỗi cuộc họp là một router nằm trên đúng một worker, được chọn là worker đang giữ ít phòng nhất. Router chứa một transport gửi và một transport nhận cho mỗi người tham gia, các producer mà người tham gia phát lên và các consumer mang track của người khác xuống. Worker chuyển tiếp gói RTP mà không giải mã, chọn lớp simulcast cho từng consumer, gửi lại gói bị mất khi nhận NACK và yêu cầu khung khóa khi consumer bắt đầu hoặc đổi lớp. Nếu một worker chết, chỉ các cuộc họp trên worker đó bị đóng; người tham gia được yêu cầu vào lại và một worker thay thế được tạo.

### Khối dữ liệu

PostgreSQL lưu toàn bộ dữ liệu nghiệp vụ (mục 3.4) và còn đóng hai vai trò hạ tầng. Thứ nhất, adapter PostgreSQL của Socket.IO dùng cơ chế `LISTEN/NOTIFY` [@postgres] để chuyển tiếp sự kiện giữa các tiến trình API. Thứ hai, bảng `socket_presence` lưu một dòng cho mỗi socket còn sống kèm thời điểm hết hạn được gia hạn bằng heartbeat, nhờ đó trạng thái hiện diện nhất quán giữa các tiến trình và các dòng của một tiến trình bị dừng đột ngột sẽ tự hết hạn.

### Khối vượt NAT

Máy chủ coturn cung cấp STUN và TURN. API sinh thông tin xác thực TURN có thời hạn cho mỗi transport, nhờ đó client có thể chuyển sang đường chuyển tiếp khi UDP bị chặn hoặc NAT là loại đối xứng. Bản thân SFU công bố địa chỉ công khai (hoặc địa chỉ LAN) và chấp nhận cả UDP lẫn TCP.

## Thiết kế cơ sở dữ liệu

Cơ sở dữ liệu PostgreSQL gồm 36 bảng và view, được tạo bởi 20 migration có đánh số phiên bản. Bảng 3.5 nhóm các bảng theo nghiệp vụ, còn Hình 3.3 trình bày các thực thể cốt lõi của phần nhắn tin và hội nghị.

TABLE: Bảng 3.5. Các bảng dữ liệu theo nhóm nghiệp vụ
| Nhóm | Bảng chính | Ghi chú |
| --- | --- | --- |
| Định danh | `users`, `refresh_sessions`, `email_otps`, `password_resets` | Mật khẩu băm có salt; refresh token và mã OTP chỉ lưu dạng băm |
| Tổ chức | `workspaces`, `memberships`, `channels`, `channel_memberships`, `workspace_invitations`, `audit_events` | Đúng một owner (unique index và constraint trigger); token mời lưu dạng SHA-256 |
| Giao tiếp | `messages`, `message_attachments`, `message_reactions`, `message_mentions`, `message_pins`, `message_bookmarks`, `thread_reads`, `notifications` | Mã tin do client sinh là duy nhất theo tác giả, chống tin trùng |
| Hội nghị | `meeting_sessions`, `meeting_attendees`, `meeting_connections`, `meeting_schedules` | Mỗi kênh tối đa một phiên họp đang hoạt động (partial unique index) |
| Vận hành | `socket_presence`, `api_instances`, `request_rate_limits`, `schema_migrations` | TTL presence, lease của tiến trình, giới hạn tần suất |
| Mở rộng | `tasks` và các bảng liên quan | Bảng công việc Kanban (không phải trọng tâm đồ án) |

FIG: fig-3-3-erd.png | Hình 3.3. Các thực thể cốt lõi của cơ sở dữ liệu | 16

View `channel_access` ghép `memberships` với `channels` (cùng `channel_memberships` đối với kênh riêng tư) và trả về, cho mỗi cặp người dùng – kênh, vai trò cùng quyền ghi (workspace và kênh chưa bị lưu trữ). Mọi phép kiểm tra quyền đọc/ghi (REST, socket, tìm kiếm, tải tệp và media) đều dùng chung view này, nên chính sách truy cập chỉ được định nghĩa ở một nơi duy nhất.

## Thiết kế phân quyền

Bảng 3.6 và Bảng 3.7 định nghĩa quyền của hai cấp vai trò đã giới thiệu ở mục 2.5.

TABLE: Bảng 3.6. Quyền ở cấp workspace
| Thao tác | Owner | Admin | Member | Ghi chú |
| --- | --- | --- | --- | --- |
| Đọc và gửi tin trong kênh công khai | ✓ | ✓ | ✓ | Workspace và kênh chưa bị lưu trữ |
| Đọc và gửi tin trong kênh riêng tư | ✓* | ✓* | ✓* | *Phải là thành viên kênh, kể cả owner |
| Tạo, sửa và sắp xếp kênh | ✓ | ✓ | – | |
| Mời và thu hồi lời mời | ✓ | ✓ | – | Token có hạn 7 ngày, chỉ lưu dạng băm |
| Đổi vai trò, chuyển quyền sở hữu, lưu trữ | ✓ | – | – | Giao dịch có khóa workspace |
| Tham gia kênh video | ✓ | ✓ | ✓ | Giới hạn số người, số tab và số nguồn mỗi phiên |

TABLE: Bảng 3.7. Quyền ở cấp phiên họp
| Thao tác | Host | Co-host | Member |
| --- | --- | --- | --- |
| Bật phòng chờ, khóa phòng | ✓ | ✓ | – |
| Cho vào, mời ra, tắt micro người khác | ✓ | ✓ | – |
| Chỉ định co-host, kết thúc phiên | ✓ | – | – |
| Giơ tay, bật/tắt thiết bị của mình | ✓ | ✓ | ✓ |

Khi một người dùng bị thu hồi quyền, máy chủ phát sự kiện `access_revoked`, ngắt mọi socket của người đó trên mọi tiến trình và đóng tài nguyên họp của họ. Client sau đó kết nối lại và tải dữ liệu theo quyền mới.

## Thiết kế giao thức thời gian thực

### Danh mục sự kiện

Hợp đồng sự kiện Socket.IO được định nghĩa một lần bằng kiểu TypeScript trong một gói dùng chung cho cả client và máy chủ, nên việc đổi tên sự kiện hay đổi kiểu dữ liệu sẽ bị trình biên dịch báo lỗi ở cả hai phía. Bảng 3.8 tóm tắt các sự kiện.

TABLE: Bảng 3.8. Danh mục sự kiện Socket.IO
| Nhóm | Client → máy chủ (có acknowledgement) | Máy chủ → client |
| --- | --- | --- |
| Kênh | `join_channel`, `leave_channel`, `mark_channel_read` | `channel_read` |
| Tin nhắn | `send_message`, `edit_message`, `delete_message`, `react_message` | `new_message`, `message_changed` |
| Trạng thái | `typing` | `user_typing`, `user_presence`, `online_users` |
| Cuộc họp | `join_meeting`, `leave_meeting`, `meeting_state`, `meeting_action` | `meeting_state_changed`, `meeting_closed`, `meeting_mute` |
| Signaling SFU | `create_webrtc_transport`, `connect_webrtc_transport`, `produce`, `consume`, `resume_consumer`, `pause_consumer`, `consumer_layer`, `close_producer`, `restart_ice` | `new_producer`, `producer_closed`, `peer_left` |

### Luồng gửi tin nhắn

Mục tiêu của giao thức nhắn tin là một tin không bao giờ bị mất và không bao giờ được lưu hai lần, kể cả khi mất acknowledgement hay rớt kết nối. Hình 3.4 trình bày luồng xử lý. Client gán một `clientMessageId` và giữ tin trong outbox cho tới khi nhận được acknowledgement. Máy chủ kiểm tra quyền hiện tại, khóa theo cặp (tác giả, clientMessageId), rồi hoặc chèn tin mới và phát cho người nhận, hoặc, nếu cùng mã định danh đã được lưu với cùng nội dung, trả lại tin đã lưu mà không phát lại. Khi mất acknowledgement, client gửi lại với cùng mã; sau khi kết nối lại, client lấy bù các tin đã lỡ qua REST với con trỏ `after`.

FIG: fig-3-4-seq-message.png | Hình 3.4. Sơ đồ tuần tự gửi tin nhắn tin cậy | 16

### Tham gia kênh video

Hình 3.5 trình bày cách một client tham gia kênh video. Máy chủ kiểm tra quyền, giới hạn của phiên và phòng chờ, đặt cuộc họp lên một worker và trả về RTP capabilities của router. Client nạp thiết bị mediasoup, tạo transport gửi và transport nhận, phát các track của mình (camera dưới dạng ba lớp simulcast) và consume các producer của người khác. Consumer được tạo ở trạng thái tạm dừng và chỉ tiếp tục khi client đã sẵn sàng. Sau đó client liên tục báo cho SFU lớp cần thiết của từng ô video, hoặc tạm dừng các ô không hiển thị.

FIG: fig-3-5-seq-join.png | Hình 3.5. Sơ đồ tuần tự tham gia kênh video | 16

## Thiết kế mở rộng ngang

Nhắn tin và media được mở rộng theo hai cách khác nhau, như minh họa ở Hình 3.6. Với nhắn tin và trạng thái hiện diện, nhiều tiến trình API dùng chung PostgreSQL; adapter PostgreSQL chuyển tiếp sự kiện giữa các tiến trình, còn bảng `socket_presence` có TTL và heartbeat cho một cái nhìn nhất quán về việc ai đang trực tuyến. Mỗi tiến trình còn gia hạn một lease trong `api_instances`, để các tiến trình khác phát hiện tiến trình đã chết và dọn các cuộc họp của nó. Media không thể chia sẻ theo cách đó vì transport và router nằm bên trong một tiến trình worker. Do vậy một cuộc họp chỉ nằm trên **một** node và worker (room affinity): dòng phiên họp ghi lại instance media sở hữu cuộc họp, và client hỏi API vị trí media trước khi mở socket media.

FIG: fig-3-6-scaling.png | Hình 3.6. Mở rộng ngang: nhắn tin dùng chung, media theo room affinity | 15

## Thiết kế giao diện

Giao diện theo bố cục ba cột: thanh điều hướng (trang chủ, nhóm, cuộc họp, công việc, thông báo, cài đặt), danh sách workspace và kênh, và vùng nội dung cho chat hoặc cuộc họp, kèm một panel thông tin có thể đóng mở. Lưới video tính số cột cho ô 16:9 lớn nhất, chia trang (4, 6 hoặc 9 ô mỗi trang tùy bề rộng) và có chế độ tiêu điểm với một ô lớn. Ô nằm ngoài trang hiện tại không được render và luồng video tương ứng bị tạm dừng tại SFU. Trạng thái kết nối luôn hiển thị: tiêu đề kênh cho biết số thành viên đang trực tuyến hoặc trạng thái "đang kết nối lại", còn tin chưa gửi được hiển thị kèm thao tác *gửi lại* và *bỏ*. Ảnh chụp giao diện đã hiện thực được trình bày ở mục 4.5.

## Tóm tắt chương

Hệ thống được tổ chức thành ba khối chính (client, máy chủ ứng dụng/signaling và SFU) và hai khối hỗ trợ (PostgreSQL và coturn). Luồng điều khiển và luồng media được tách riêng để Node.js chỉ xử lý thông điệp nhỏ. Một view duy nhất định nghĩa quyền truy cập kênh; giao thức nhắn tin kết hợp mã định danh do client sinh, outbox và ràng buộc duy nhất để tránh mất và trùng tin; còn mỗi cuộc họp được gắn với một worker trong khi phần nhắn tin dùng chung giữa các tiến trình. Chương 4 trình bày cách hiện thực các khối này.
