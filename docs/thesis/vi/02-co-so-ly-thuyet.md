# Cơ sở lý thuyết

Chương này chỉ tóm tắt phần lý thuyết mà đồ án trực tiếp sử dụng: giao tiếp thời gian thực trên web cho nhắn tin và trạng thái hiện diện, WebRTC cho truyền thông đa phương tiện, và ba mô hình hội nghị đa điểm. Phần so sánh cuối chương là cơ sở cho lựa chọn kiến trúc ở Chương 3 và cho thực nghiệm ở Chương 5.

## Giao tiếp thời gian thực trên web

### Từ mô hình yêu cầu – phản hồi đến WebSocket

HTTP là giao thức yêu cầu – phản hồi: máy chủ chỉ trả dữ liệu khi trình duyệt hỏi. Để hiển thị tin nhắn mới hay trạng thái "đang gõ" ngay khi nó xảy ra, các kỹ thuật cũ phải giả lập luồng đẩy từ máy chủ, và mỗi kỹ thuật đều có hạn chế riêng (Bảng 2.1).

TABLE: Bảng 2.1. Các kỹ thuật đẩy dữ liệu từ máy chủ tới client
| Kỹ thuật | Cách làm | Hạn chế |
| --- | --- | --- |
| Short polling | Client hỏi định kỳ, ví dụ mỗi 2 giây | Trễ tối đa bằng một chu kỳ hỏi; nhiều yêu cầu rỗng |
| Long polling | Máy chủ giữ yêu cầu tới khi có dữ liệu | Mỗi sự kiện tốn một vòng HTTP mới kèm đầy đủ header |
| Server-Sent Events | Luồng HTTP một chiều từ máy chủ tới client | Không có chiều client → máy chủ trên cùng kết nối |
| **WebSocket** | Một kết nối TCP hai chiều, tồn tại lâu dài | Phải tự quản lý trạng thái kết nối, kết nối lại và mở rộng ngang |

WebSocket [@rfc6455] bắt đầu bằng một yêu cầu `Upgrade` của HTTP/1.1. Client gửi một khóa ngẫu nhiên `Sec-WebSocket-Key`; máy chủ chứng minh mình hiểu giao thức bằng cách trả về giá trị băm SHA-1 (mã hóa base64) của khóa này ghép với một GUID cố định, kèm mã `101 Switching Protocols`. Sau bắt tay, kết nối TCP không còn chạy HTTP mà truyền các khung (frame) WebSocket. Mỗi khung có phần đầu 2–14 byte (bit FIN, opcode, bit mask và độ dài tải); khung từ client phải được che bằng khóa 32 bit để bảo vệ các proxy trung gian, còn các khung ping/pong dùng để phát hiện kết nối "chết". Vì header chỉ gửi một lần, WebSocket rất phù hợp cho chat, typing và presence, vốn đều cần trao đổi hai chiều với độ trễ thấp. Vì vậy hệ thống dùng WebSocket cho mọi tương tác thời gian thực.

### Socket.IO

Socket.IO [@socketio] là thư viện xây dựng trên WebSocket, bổ sung những gì một ứng dụng cần:

- **Sự kiện có tên và xác nhận (acknowledgement).** Máy chủ có thể trả kết quả cho đúng yêu cầu đã phát ra sự kiện, thông qua một hàm callback truyền vào `socket.emit()`. Hệ thống dùng acknowledgement cho mọi thao tác ghi (gửi tin, signaling WebRTC) để client biết chắc thao tác đã thành công hay chưa.
- **Phòng (room).** Máy chủ gom các socket vào phòng, ví dụ theo người dùng (`user:<id>`) hay theo cuộc họp (`meeting:<id>`), rồi phát sự kiện tới cả phòng. Đây là cơ chế đưa tin nhắn tới đúng người nhận.
- **Middleware.** Mỗi kết nối phải mang access token, và middleware có thể kiểm tra mọi sự kiện trước khi tới bộ xử lý.
- **Tự kết nối lại và adapter.** Khi chạy nhiều tiến trình máy chủ, adapter chuyển tiếp lời gọi `io.to(room).emit(...)` sang các tiến trình khác, nhờ đó client nối vào tiến trình A vẫn nhận được sự kiện sinh ra ở tiến trình B.

### Đồng bộ trạng thái hiện diện

Presence trả lời câu hỏi "ai đang trực tuyến" trên một tập kết nối luôn biến động, với ba khó khăn. Thứ nhất, một người có thể có nhiều kết nối (nhiều tab, nhiều thiết bị), nên người đó chỉ ngoại tuyến khi kết nối cuối cùng đóng. Thứ hai, kết nối có thể chết mà không báo trước (mất mạng, tiến trình máy chủ bị dừng), nên mỗi bản ghi presence cần một thời gian sống (TTL) được gia hạn bằng heartbeat. Thứ ba, thay đổi trạng thái chỉ nên gửi tới những người cùng workspace với người đó, để số thông điệp tỉ lệ với số người liên quan chứ không phải với toàn hệ thống. Trạng thái đang gõ là ngắn hạn: client gửi `typing: true` khi bắt đầu gõ và `false` sau vài giây không gõ; máy chủ chỉ chuyển tiếp mà không lưu lại.

## Công nghệ WebRTC

WebRTC [@webrtc] là tập API trình duyệt và giao thức IETF cho phép truyền âm thanh, hình ảnh và dữ liệu giữa các điểm cuối mà không cần cài plug-in. Các API chính gồm `getUserMedia()`/`getDisplayMedia()` để thu camera, micro và màn hình; `RTCPeerConnection` để thiết lập phiên; `RTCRtpSender`/`RTCRtpReceiver` để cấu hình mã hóa; và `getStats()` để lấy thống kê theo chuẩn [@webrtcstats], đây cũng là nguồn số liệu QoS ở Chương 5. WebRTC chủ động không định nghĩa signaling: ứng dụng phải tự trao đổi mô tả phiên. Trong hệ thống này, signaling đi qua Socket.IO.

### Thương lượng phiên bằng SDP

Một phiên WebRTC được mô tả bằng SDP [@rfc8866] và thương lượng theo mô hình offer/answer [@rfc3264] như quy định trong JSEP [@rfc8829]. Bản mô tả liệt kê một m-section cho mỗi track, các codec và payload type tương ứng (`a=rtpmap`), thông tin xác thực và candidate của ICE, vân tay chứng chỉ DTLS, cùng các tùy chọn như `a=group:BUNDLE` (mọi track dùng chung một transport), `a=rtcp-mux` (RTP và RTCP dùng chung cổng) và `a=simulcast` (nhiều bản mã hóa của cùng một track). Với SFU mediasoup, trình duyệt không thương lượng với một trình duyệt khác: thư viện `mediasoup-client` tự sinh SDP cục bộ từ các tham số mà máy chủ gửi qua signaling (tham số ICE, candidate, tham số DTLS và tham số RTP), còn máy chủ không bao giờ phải phân tích văn bản SDP.

### Vượt NAT: ICE, STUN và TURN

Phần lớn thiết bị nằm sau NAT và không có địa chỉ công khai. ICE [@rfc8445] giải quyết vấn đề này qua ba bước (Hình 2.1). Đầu tiên, mỗi điểm cuối thu thập **candidate**: địa chỉ *host* của chính card mạng, địa chỉ *server-reflexive* biết được nhờ hỏi máy chủ STUN [@rfc8489], và địa chỉ *relay* được cấp phát trên máy chủ TURN [@rfc8656]. Tiếp theo, hai bên ghép candidate thành từng cặp và kiểm tra kết nối (gửi STUN Binding request) theo thứ tự ưu tiên; candidate host có ưu tiên cao nhất và relay thấp nhất, nên ICE luôn ưu tiên đường trực tiếp. Cuối cùng, bên điều khiển đề cử một cặp đã thành công và media đi trên cặp đó. TURN chuyển tiếp toàn bộ media nên tốn băng thông máy chủ, chỉ được dùng khi không thể đi trực tiếp (NAT đối xứng, UDP bị chặn).

FIG: fig-2-1-ice.png | Hình 2.1. Các loại candidate ICE và đường kết nối giữa trình duyệt và SFU | 15

Máy chủ media có địa chỉ công khai cố định như mediasoup chạy ở chế độ **ICE-Lite**: máy chủ chỉ công bố host candidate của mình và trả lời các gói kiểm tra, còn trình duyệt điều khiển quá trình. Máy chủ lắng nghe cả UDP và TCP, nên media vẫn đi được qua ICE-TCP khi UDP bị chặn. Để không phải phát một mật khẩu TURN cố định, hệ thống dùng thông tin xác thực TURN có thời hạn [@turnrest]: tên người dùng là `<thời điểm hết hạn>:<userId>` và mật khẩu là `base64(HMAC-SHA1(secret, username))`; máy chủ TURN (coturn) kiểm tra lại bằng cùng secret dùng chung.

### Bảo mật: DTLS-SRTP

WebRTC bắt buộc mã hóa. Sau khi ICE tìm được đường đi, hai bên chạy bắt tay DTLS (TLS trên UDP) và so chứng chỉ của bên kia với vân tay đã nhận qua signaling; vì signaling chạy trên WebSocket bảo mật nên vân tay không thể bị giả mạo. Khóa sinh ra từ DTLS [@rfc5764] được SRTP [@rfc3711] dùng để mã hóa và xác thực từng gói RTP và RTCP. Với kiến trúc SFU, việc mã hóa này là theo từng chặng (client ↔ SFU): SFU giải mã gói để đọc header RTP rồi mã hóa lại cho từng người nhận.

### RTP, RTCP và các đại lượng QoS

RTP [@rfc3550] mang dữ liệu media. Header cố định 12 byte của nó chứa payload type, **số thứ tự** 16 bit (để phát hiện mất và đảo thứ tự gói), **nhãn thời gian** 32 bit theo đồng hồ của codec và **SSRC** 32 bit định danh luồng. RTCP là kênh điều khiển đi kèm: các báo cáo Sender Report và Receiver Report mang số gói, số gói mất tích lũy, số thứ tự lớn nhất và jitter; các gói phản hồi mang NACK (yêu cầu gửi lại), PLI (yêu cầu khung khóa mới) và phản hồi phục vụ điều khiển tắc nghẽn. Các đại lượng QoS dùng trong đồ án gồm:

- **Jitter** là độ biến thiên thời gian truyền của gói. Với `D(i−1,i) = (Rᵢ − Rᵢ₋₁) − (Sᵢ − Sᵢ₋₁)`, trong đó R là thời điểm nhận và S là nhãn thời gian RTP, ước lượng được làm trơn theo `Jᵢ = Jᵢ₋₁ + (|D(i−1,i)| − Jᵢ₋₁)/16`.
- **Thời gian khứ hồi (RTT)**, đo từ báo cáo RTCP hoặc, trong trình duyệt, từ các gói kiểm tra STUN trên cặp candidate ICE đang được chọn.
- **Tỉ lệ mất gói** trong một cửa sổ đo: `Δlost / (Δreceived + Δlost)`.
- **Độ trễ jitter buffer** là thời gian trung bình một khung hình nằm trong bộ đệm nhận trước khi được giải mã, thành phần chính của độ trễ đầu-cuối mà người dùng cảm nhận.

### Điều khiển tắc nghẽn, simulcast và codec

Băng thông mạng không cố định nên bên gửi phải ước lượng liên tục. Chrome dùng Google Congestion Control (GCC) [@gcc], coi độ trễ hàng đợi tăng là dấu hiệu sắp tắc nghẽn để giảm bitrate, độ phân giải hoặc tốc độ khung; trình duyệt báo lý do trong `qualityLimitationReason` (`bandwidth` hoặc `cpu`). Để phục vụ nhiều người nhận có băng thông khác nhau, bên gửi có thể dùng **simulcast**: mã hóa cùng một video thành nhiều bản ở các độ phân giải khác nhau, mỗi bản là một luồng RTP riêng, để SFU chuyển tiếp bản phù hợp cho từng người nhận; cái giá là bên gửi tốn thêm bộ mã hóa và uplink. Hệ thống dùng simulcast VP8 [@rfc6386] ba lớp *q/h/f* (một phần tư, một nửa và toàn bộ độ phân giải, tối đa 150/400/1200 kbps) và Opus [@rfc6716] cho âm thanh.

## Các mô hình hội nghị đa điểm

Xét một phòng có N người tham gia, mỗi người gửi một luồng video có bitrate b. Hình 2.2 minh họa ba mô hình cổ điển.

FIG: fig-2-2-topologies.png | Hình 2.2. Ba mô hình Mesh, MCU và SFU với một phòng bốn người | 16

### Mesh

Mỗi cặp người tham gia có một kết nối ngang hàng riêng, tổng cộng N(N−1)/2 kết nối. Mỗi client phải mã hóa video N−1 lần (mỗi kết nối một bộ mã hóa vì mỗi kết nối có điều khiển tắc nghẽn riêng), tải lên N−1 luồng và giải mã N−1 luồng. Mô hình này không cần máy chủ media và có độ trễ thấp nhất, nhưng uplink và CPU của mọi client tăng tuyến tính theo N. Vì uplink thường là phần yếu nhất của mạng gia đình và mạng di động, Mesh chỉ dùng được cho phòng rất nhỏ.

### MCU

Mỗi client gửi một luồng tới Multipoint Control Unit; MCU giải mã tất cả, trộn thành một khung hình và một luồng âm thanh tổng hợp, rồi mã hóa lại cho từng người. Client chỉ gửi và nhận một luồng, nhưng máy chủ tốn rất nhiều CPU cho giải mã, trộn và mã hóa, làm tăng độ trễ xử lý, áp đặt một bố cục cố định và làm giảm chất lượng do mã hóa lại.

### SFU

Mỗi client gửi một luồng (hoặc một nhóm simulcast) tới Selective Forwarding Unit. SFU không giải mã media: nó chỉ đọc header RTP và chuyển tiếp mỗi gói tới đúng những người nhận cần nó, đồng thời xử lý phản hồi RTCP cho từng người nhận. Uplink của client không phụ thuộc N, CPU máy chủ thấp vì chỉ làm việc ở mức gói tin, và mỗi người nhận có thể nhận một lớp chất lượng khác nhau. Downlink của client vẫn tăng theo N−1, nhưng có thể giảm bằng cách chọn lớp thấp hơn hoặc tạm dừng các luồng không hiển thị [@lastn].

### So sánh định lượng

Bảng 2.2 so sánh chi phí của các mô hình đối với mỗi client và đối với máy chủ.

TABLE: Bảng 2.2. Chi phí của các mô hình hội nghị với N người tham gia
| Đại lượng (mỗi client) | Mesh | MCU | SFU | SFU + simulcast |
| --- | --- | --- | --- | --- |
| Số bộ mã hóa video | N−1 | 1 | 1 | 3 (cố định) |
| Uplink | (N−1)·b | b | b | b_q + b_h + b_f |
| Downlink | (N−1)·b | b_mix | (N−1)·b | tổng các lớp được chọn |
| Số luồng giải mã | N−1 | 1 | N−1 | N−1 hoặc số ô hiển thị |
| CPU máy chủ | không có | rất cao | thấp | thấp |
| Độ trễ thêm | không có | giải mã + trộn + mã hóa | một chặng chuyển tiếp | một chặng chuyển tiếp |

Với N = 6 và b = 1,2 Mbps, mỗi client Mesh phải tải lên 5 × 1,2 = 6 Mbps với năm bộ mã hóa, trong khi client SFU có simulcast chỉ tải lên tối đa 0,15 + 0,4 + 1,2 ≈ 1,75 Mbps với ba bộ mã hóa, bất kể N. Các nghiên cứu về SFU mã nguồn mở [@andre2018] cũng ghi nhận cùng xu hướng định tính này. Vì vậy đồ án chọn **SFU**: uplink và CPU của client không đổi khi N tăng, máy chủ không phải giải mã media, và simulcast kết hợp với chọn lớp theo nhu cầu giúp kiểm soát cả downlink. Chương 5 kiểm chứng lựa chọn này bằng thực nghiệm so với một hiện thực Mesh trên cùng phần cứng.

## Thư viện SFU mediasoup

mediasoup [@mediasoup] là thư viện SFU cho Node.js; phần lõi xử lý media viết bằng C++ và chạy trong các tiến trình worker riêng, còn API điều khiển viết bằng JavaScript/TypeScript. Các khái niệm chính được liệt kê ở Bảng 2.3.

TABLE: Bảng 2.3. Các khái niệm chính của mediasoup
| Khái niệm | Vai trò |
| --- | --- |
| Worker | Tiến trình C++ dùng một lõi CPU; ứng dụng tạo một nhóm worker |
| Router | Một "phòng" media với tập codec chung; chuyển gói từ producer tới consumer |
| WebRtcTransport | Điểm cuối ICE-Lite/DTLS/SRTP cho một client (thường có một transport gửi và một transport nhận) |
| Producer | Một track do client gửi lên (micro, camera hoặc màn hình) |
| Consumer | Một track SFU gửi xuống một client; có thể tạm dừng, tiếp tục và chuyển giữa các lớp simulcast |

Luồng signaling tối thiểu gồm: lấy RTP capabilities của router, tạo hai transport, kết nối chúng bằng tham số DTLS của client, produce các track cục bộ và consume các track của người khác. Consumer được tạo ở trạng thái **tạm dừng** và chỉ tiếp tục khi client đã sẵn sàng, để không mất khung khóa đầu tiên. mediasoup còn gửi các gói thăm dò trên một luồng riêng (SSRC 1234) để tìm băng thông còn trống trước khi nâng lớp cho consumer; các gói này phải được loại khỏi chỉ số chất lượng phía client (mục 5.4.2).

## Kiểm soát truy cập theo vai trò

Kiểm soát truy cập theo vai trò (RBAC) [@sandhu1996] gán quyền cho vai trò thay vì cho từng người dùng. Hệ thống dùng hai cấp vai trò. Ở **cấp workspace**, *owner* duy nhất có toàn quyền và có thể chuyển giao quyền sở hữu, *admin* quản lý thành viên, kênh và lời mời, còn *member* dùng các kênh mình được phép thấy; kênh riêng tư có thêm danh sách thành viên kênh. Ở **cấp phiên họp**, *host* và *co-host* điều hành phòng (phòng chờ, khóa phòng, cho vào, mời ra, tắt micro), và chỉ host mới được chỉ định co-host hoặc kết thúc cuộc họp. Mọi sự kiện socket có ghi dữ liệu và mọi lời gọi signaling media đều được kiểm tra theo vai trò hiện tại trước khi tới bộ xử lý.

## Tóm tắt chương

WebSocket và Socket.IO cung cấp kênh hai chiều có xác nhận, có phòng và mở rộng ngang được nhờ adapter; đây là nền tảng cho chat, typing, presence và signaling. WebRTC đảm nhận việc thu, mã hóa, truyền media an toàn và cung cấp thống kê chuẩn; ICE/STUN/TURN giải quyết NAT, còn RTP/RTCP mang media và phản hồi chất lượng. Trong ba mô hình hội nghị, SFU cân bằng tốt nhất giữa tải client, tải máy chủ và độ trễ, và với simulcast có thể kiểm soát cả uplink lẫn downlink. Các kết luận này định hướng thiết kế ở Chương 3.
