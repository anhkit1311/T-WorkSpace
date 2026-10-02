# Phiên họp và media

Migration 018: meeting_sessions, attendees theo user, connections theo socket/instance; participation lịch sử gắn session_id. Lịch hẹn truyền scheduleId khi join, server xác minh cùng phòng và chưa hủy. Host là người vào đầu tiên của phiên; vai trò workspace không tự cấp quyền host trong phiên của người khác.

## Chính sách

- Phòng chờ mặc định tắt; host/co-host bật/tắt và duyệt. Người chờ chưa có SFU peer/transport, không xin/phát thiết bị qua join. Khi được duyệt, UI yêu cầu người dùng bấm vào họp với lựa chọn lobby.
- Lock chặn người mới; người đã vào/đang chờ vẫn có thể reconnect theo trạng thái phiên. Kick áp dụng tất cả tab của user, khóa vào lại **cùng phiên**, đóng producer/consumer/transport và kết thúc participation; phiên mới được tham gia lại.
- Host bổ nhiệm/bỏ co-host, chuyển host, kết thúc cho tất cả. Co-host duyệt/khóa/phòng chờ/kick/mute, không điều khiển host hoặc tự kết thúc phiên.
- Mute đóng nguồn mic ở SFU và tắt track tại client. Người dùng tự bật lại; không có event bật mic/camera hộ người khác.
- Host rời kết nối cuối: co-host hiện diện tiếp quản, sau đó người admitted vào sớm nhất. Không còn admitted thì kết thúc, bao gồm đóng phòng chờ. Rời một trong hai tab giữ host ở tab còn lại.
- Giới hạn mặc định20 user tính cả phòng chờ,2 tab/user,3 nguồn/peer và2 transport/peer; kiểm trong transaction/guard pending. Roster đếm user, hiển thị số tab; không đếm theo số video nhận được.
- Mỗi media event kiểm JWT, current channel_access, connection và admitted/session chưa kết thúc. Kiểm lại sau SFU join để chặn race kick/end trong lúc tạo router.

## Socket contract

| Event | Payload | ACK/quyền |
|---|---|---|
| join_meeting | roomId, scheduleId? | success,waiting?,sessionId,routerRtpCapabilities/existingProducers nếu admitted |
| meeting_state | roomId | state hoặc null; người có quyền phòng |
| meeting_action | roomId,action,targetUserId?,enabled? | success/error; quyền theo chính sách ở trên |
| restart_ice | roomId,transportId | iceParameters; chỉ transport của admitted socket |
| consumer_layer | roomId,consumerId,spatialLayer0..2 | chỉ consumer của admitted socket, chỉ áp dụng simulcast |
| meeting_state_changed | roomId | invalidation, fetch lại roster |
| meeting_closed | roomId,reason | client dừng tracks/transport, không tự phát lại |
| meeting_mute | roomId | chỉ target user, mic off |

ACK frontend tối đa10s. Action: hand/lock/waiting (enabled boolean), admit/kick/mute (target UUID), cohost (target+enabled), transfer(target), end(host). Retry thay đổi trạng thái idempotent, thao tác cuối phiên phải đọc lại state.

## Recovery và TURN

Client phát hiện transport disconnected/failed, chờ5s với disconnected rồi restart ICE, tối đa2 lần/transport/phiên; timeout10s, nếu không hồi phục đóng thiết bị và cho tham gia lại thủ công. DTLS failed server đóng peer. Không tự xin quyền thiết bị hoặc tự join vô hạn. SFU có guard nguồn đang tạo và số transport đang tạo để chặn thao tác đồng thời.

TURN_URLS dùng turn/turns phân tách dấu phẩy, TURN_SHARED_SECRET chỉ ở backend; server tạo username TTL1h và HMAC-SHA1 tương thích coturn use-auth-secret. Credentials truyền trong transport options cho user đã xác thực. Cần coturn thực tế, TLS/firewall và kiểm tra mạng hạn chế; hiện chưa kiểm chứng relay/NAT khác mạng.

Webcam VP8 dùng3 lớp simulcast (150/400/1200kbps, scale4/2/1); screen dùng một luồng để giữ chữ. Consumer layer theo số webcam nhận (<=2: cao,3–6: trung bình,>6: thấp); SFU congestion control vẫn quản lý băng thông. Đây là cấu hình đã triển khai, chưa chứng minh cải thiện chất lượng trên mạng thực hoặc SVC.

## QoS

RTT ms: maximum selected candidate pair được transport.selectedCandidatePairId tham chiếu, không chọn mọi pair succeeded. Bitrate kbps: delta bytes RTP/timestamp từng stream, send/receive riêng và tổng. Loss%: delta packetsLost/(delta packetsReceived+delta packetsLost) từ inbound RTP; mẫu đầu/reset counter trả null. Jitter ms: maximum inbound jitter. Counter history chỉ giữ stream còn trong mẫu; UI history giữ tối đa300. JSON chứa selected pair IDs và hai hướng; CSV đang xuất các metric tổng. Test pure `qos.test.js` có pair succeeded sai, interval loss, reset và split direction.

## Kết quả và giới hạn

`npm run test:sfu`:5 suites PostgreSQL/chat/governance/task/session qua,0 skip; session test duyệt phòng chờ, không tạo transport khi chờ, giới hạn tab/user, chuyển host, kick chặn transport cũ/rejoin, end cleanup, ICE restart trả tham số mới. Browser join cảmic/cam tắt thấy Host và roster1 dù không có producer. Đây là signaling/cleanup; **không** là đo RTP hay TURN. Đo nhiều thiết bị/đa mạng vẫn cần môi trường ngoài.

SFU hiện room affinity trong tiến trình; adapter chat ở giai đoạn6 phải tách biệt routing phòng mediasoup. Không dùng adapter để giả định router/transport đã đồng bộ liên máy.
