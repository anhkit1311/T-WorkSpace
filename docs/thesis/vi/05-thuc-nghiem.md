# Thực nghiệm và đánh giá

Chương này đánh giá hệ thống theo các yêu cầu ở mục 3.1.3. Trước hết chương mô tả môi trường thử nghiệm, các đại lượng đo và hệ thống chuẩn để so sánh (mục 5.1), sau đó trình bày kết quả kiểm thử chức năng và độ tin cậy (mục 5.2), độ trễ của lõi nhắn tin khi chịu tải (mục 5.3) và thực nghiệm chính so sánh SFU của hệ thống với hệ thống chuẩn Mesh (mục 5.4). Mục 5.5 so sánh hệ thống với các nền tảng hiện có, mục 5.6 đối chiếu với yêu cầu và mục 5.7 thảo luận các giới hạn của phép đo. Mọi con số đều lấy từ dữ liệu gốc lưu trong kho mã tại `docs/evidence/`; những giá trị được suy ra từ dữ liệu gốc (ví dụ tổng hay tỉ lệ) được ghi chú là *tính lại*.

## Thiết lập thực nghiệm

### Môi trường và quy mô thử nghiệm

Mọi thực nghiệm đều chạy trên một máy phát triển (Bảng 5.1). Hình 5.1 mô tả cách tổ chức thực nghiệm media: một chương trình điều phối (harness) viết bằng Node.js khởi chạy mỗi người tham gia thành **một tiến trình Chrome headless riêng** với camera và micro giả, cho vào phòng họp, rồi lấy mẫu thống kê WebRTC và mức dùng CPU qua Chrome DevTools Protocol. Tối đa mười trình duyệt chạy đồng thời trong thực nghiệm media, và tối đa 200 client Socket.IO trong thực nghiệm nhắn tin.

TABLE: Bảng 5.1. Môi trường thử nghiệm
| Thành phần | Giá trị |
| --- | --- |
| Phần cứng | AMD Ryzen 7 6800HS, 8 nhân / 16 luồng, 23,3 GiB RAM |
| Hệ điều hành | Windows 11 (x64) |
| Phần mềm | Node.js 22.19, PostgreSQL 17.11 (Docker), Google Chrome (headless), mediasoup 3 |
| Nguồn media | Camera giả của Chromium, yêu cầu 960×540 ở 30 fps (thực tế phát 20 fps), VP8 và Opus |
| Mạng | Mọi trình duyệt, API và SFU trên cùng một máy; media gửi tới địa chỉ LAN của máy qua UDP |
| Quy mô | Media: 2–10 trình duyệt mỗi phòng. Nhắn tin: 50, 100 và 200 socket trên hai tiến trình API |

FIG: fig-5-1-testbed.png | Hình 5.1. Môi trường thực nghiệm media | 16

Việc chạy mọi thứ trên một máy có một hệ quả được dùng xuyên suốt chương này: đường truyền không có độ trễ, mất gói hay giới hạn băng thông thật, nên RTT, jitter và tỉ lệ mất gói phản ánh **tải xử lý** chứ không phản ánh chất lượng mạng; và khi tổng nhu cầu CPU tiến gần năng lực của máy, mọi chỉ số đều xấu đi do tranh chấp tài nguyên. Mục 5.7 thảo luận giới hạn này.

### Các đại lượng đo

Các đại lượng media được đọc từ `getStats()` mỗi 2 giây, theo định nghĩa ở mục 2.2.4 và mục 4.4.2:

- **Uplink và downlink** (kbps): chênh lệch số byte (tải và header RTP) trên chênh lệch thời gian.
- **CPU client** (%): tổng thời gian CPU của mọi tiến trình thuộc một trình duyệt; 100% tương ứng một lõi.
- **RTT** (ms) của cặp candidate ICE đang được chọn; **jitter âm thanh và video** (ms); **tỉ lệ mất gói** (%) theo cửa sổ.
- **Tốc độ khung hình nhận**, **độ trễ jitter buffer**, **số lần đóng băng hình** và số **bộ mã hóa đang hoạt động** (số luồng video gửi đi có bitrate trên 1 kbps).
- **CPU máy chủ**: CPU của worker mediasoup và của tiến trình Node.js.

Mỗi mức N được đo trong 60 giây sau 30 giây khởi động để bộ ước lượng băng thông ổn định, tức 30 mẫu cho mỗi client. Mỗi mức media được lặp lại **ba lần**; các bảng ghi giá trị trung bình qua các lượt và, khi có nhiều lượt, độ lệch chuẩn mẫu giữa các lượt (± SD). Độ trễ tin nhắn được báo cáo bằng các phân vị p50, p95 và p99 (nearest-rank) trên toàn bộ mẫu.

### Hệ thống chuẩn để so sánh

Hướng dẫn của khoa yêu cầu lấy một hệ thống làm chuẩn để so sánh với hệ thống của mình. Với lõi media, hệ thống chuẩn là một hiện thực **Mesh ngang hàng toàn phần**, kiến trúc mà một ứng dụng WebRTC nhỏ sử dụng khi không có máy chủ media (mục 2.3.1). Hiện thực hệ thống chuẩn ngay trong cùng phòng thí nghiệm giúp phép so sánh công bằng: hai kiến trúc dùng cùng trình duyệt, cùng nguồn giả, cùng codec, cùng máy và cùng mã đo, chỉ khác nhau ở cấu trúc kết nối. Client Mesh mở một `RTCPeerConnection` cho mỗi cặp người tham gia qua một relay signaling tối giản và gửi một bản mã hóa với tối đa 1.200 kbps cho mỗi kết nối; client SFU chính là `MediasoupClientService` của nexo với ba lớp simulcast và chính sách chọn lớp mặc định. Mục 5.5 bổ sung phần so sánh định tính giữa nexo với các sản phẩm hiện có.

## Kiểm thử chức năng và độ tin cậy

Bảng 5.2 tóm tắt các bộ kiểm thử tự động. Các bộ kiểm thử tích hợp chạy trên cơ sở dữ liệu PostgreSQL thật và worker mediasoup thật.

TABLE: Bảng 5.2. Các bộ kiểm thử tự động
@TESTS_TABLE@

Các bài kiểm thử xác nhận những tính chất tin cậy yêu cầu ở mục 3.1.3:

- **Lũy đẳng khi gửi tin.** Sáu yêu cầu đồng thời với cùng `clientMessageId` chỉ tạo đúng một dòng; bỏ acknowledgement rồi gửi lại chỉ tạo đúng một lần phát `new_message`; phân trang bằng con trỏ `after` không bao giờ trả một tin hai lần.
- **Thu hồi quyền.** Sau khi quyền vào kênh riêng tư bị thu hồi, cả việc gửi lại lẫn việc lấy bù tin sau khi kết nối lại đều bị từ chối.
- **Quản trị.** Quyền được kiểm tra chéo trên REST, socket, tìm kiếm, tải tệp, lịch họp và media; lời mời sai e-mail, hết hạn, bị thu hồi hoặc được chấp nhận đồng thời đều được xử lý đúng; chuyển quyền sở hữu hoạt động và cơ sở dữ liệu từ chối xóa owner duy nhất.
- **Tìm kiếm.** Kiểm tra với tiếng Việt, các ký tự `%` và `_`, và việc mở một tin nằm ngoài 100 tin gần nhất; kế hoạch truy vấn trên 10.000 tin xác nhận index theo dòng thời gian hiện có là đủ ở quy mô này.
- **Cuộc họp.** Phòng chờ, khóa phòng, mời ra, kết thúc và giới hạn số người, số tab đều được kiểm thử; cả bốn tổ hợp micro/camera được kiểm tra để bảo đảm nguồn bị tắt không bao giờ được phát.
- **Chịu lỗi.** Với hai worker, dừng một worker không ảnh hưởng tới người tham gia trên worker còn lại, và lượt tham gia tiếp theo tạo worker thay thế.
- **Hai tiến trình API.** Với adapter PostgreSQL, tin nhắn, công việc và thông báo đi xuyên tiến trình, và việc thu hồi quyền có hiệu lực trên cả hai.
- **Migration và khôi phục.** 20 migration có checksum; hai trình chạy migration khởi động cùng lúc trên một cơ sở dữ liệu không xung đột; bản sao lưu được khôi phục sang cơ sở dữ liệu mới giữ nguyên schema và dữ liệu Unicode.

Các bài kiểm thử này xác nhận tính đúng của luồng điều khiển và phân quyền; chúng không đo chất lượng RTP, vốn là nội dung của mục 5.4.

## Độ trễ của lõi nhắn tin khi chịu tải

### Kịch bản

Hai tiến trình API dùng chung PostgreSQL qua adapter PostgreSQL (pool tám kết nối mỗi tiến trình); bốn workspace, mỗi workspace hai kênh văn bản được tạo sẵn. Mỗi mức (50, 100 và 200 socket) chạy 30 giây và lặp lại hai lần, với **tổng 4 tin mỗi giây** do bốn người gửi đồng thời. Trong mỗi lượt, acknowledgement bị cố ý bỏ sáu lần và tin được gửi lại với cùng mã định danh, và hai tin được gửi trong lúc một client đang ngoại tuyến để kiểm tra việc lấy bù tin. Phần lớn socket là người nhận, nên kịch bản mô phỏng một kênh đông người đọc chứ không phải 200 người cùng gõ liên tục.

### Kết quả

Bảng 5.3 và Hình 5.2 trình bày độ trễ đo được. *ACK* là thời gian từ lúc phát tin tới khi nhận acknowledgement thành công; *nhận tin* là thời gian từ lúc phát tin tới khi từng người nhận nhận được `new_message`, có trọng số theo số người nhận.

TABLE: Bảng 5.3. Độ trễ tin nhắn tính bằng mili giây (hai lượt mỗi mức)
| Số socket | ACK p50 / p95 / p99 | Nhận tin p50 / p95 / p99 | Tin duy nhất / lượt nhận | Lỗi / trùng |
| --- | --- | --- | --- | --- |
| 50 | 24,99 / 39,88 / 53,79 | 25,01 / 32,23 / 47,02 | 244 / 3.052 | 0 / 0 |
| 100 | 23,69 / 46,09 / 56,81 | 23,78 / 34,87 / 48,07 | 244 / 6.096 | 0 / 0 |
| 200 | 25,23 / 48,58 / 140,26 | 25,38 / 45,93 / 137,86 | 244 / 12.196 | 0 / 0 |

FIG: fig-5-2-chat.png | Hình 5.2. Các phân vị độ trễ nhận tin ở mức 50, 100 và 200 socket | 15

Tổng cộng 732 tin tạo ra 21.344 lượt nhận, và số dòng trong cơ sở dữ liệu luôn bằng số tin duy nhất ở mọi lượt: **không có tin nào bị mất hay bị trùng**, dù 36 lần gửi phải lặp lại sau khi mất acknowledgement và sáu client đã kết nối lại. Mỗi lần kết nối lại lấy bù đủ hai tin bị lỡ qua REST trong 21,5–54,9 ms. Độ trễ trung vị gần như không đổi (23,7–25,4 ms) khi số socket tăng gấp bốn; phân vị 95 tăng từ 32 lên 46 ms, và chỉ phân vị 99 ở mức 200 socket tăng lên khoảng 140 ms.

Bảng 5.4 trình bày tài nguyên sử dụng. Mỗi tiến trình API dùng dưới 6% một lõi và dưới 120 MiB bộ nhớ. Số yêu cầu phải chờ kết nối cơ sở dữ liệu tăng theo số socket (13, 31 và 120) nhưng chỉ xuất hiện trong đợt kết nối dồn dập ban đầu và biến mất ở các mẫu sau. Vì vậy đợt kết nối ban đầu cùng các cập nhật trạng thái hiện diện đi kèm là điểm cần tối ưu đầu tiên trước khi tăng tải, thay vì chỉ đơn giản tăng kích thước pool.

TABLE: Bảng 5.4. Tài nguyên trong bài kiểm tra tải nhắn tin (giá trị lớn nhất quan sát được)
| Số socket | RSS mỗi API (MiB) | CPU mỗi API (% một lõi) | Số yêu cầu chờ pool lớn nhất | CPU / bộ nhớ PostgreSQL |
| --- | --- | --- | --- | --- |
| 50 | 98,8 | 5,60 | 13 | 5,1–5,2% / 107–112 MiB |
| 100 | 95,7 | 3,75 | 31 | 5,0–6,0% / 111–113 MiB |
| 200 | 115,2 | 4,66 | 120 | 4,8–5,6% / 112–113 MiB |

## So sánh Mesh và SFU

Đây là thực nghiệm chính của đồ án, nhằm kiểm chứng lựa chọn kiến trúc ở mục 2.3.4: khi số người tham gia N tăng, kiến trúc nào giữ được chất lượng cuộc gọi với chi phí chấp nhận được?

### Thiết kế thực nghiệm

Bảng 5.5 tóm tắt cấu hình của hai kiến trúc. Cả hai được đo theo cùng một quy trình: harness tạo người dùng và workspace thử nghiệm mới cho từng mức, khởi chạy N trình duyệt, chờ 30 giây, đo trong 60 giây rồi xóa dữ liệu thử nghiệm. Mỗi kiến trúc được đo ba lần ở mỗi mức; các lượt Mesh dừng ở N = 8 vì máy đã bão hòa từ N = 6, còn các lượt SFU đi tới N = 10. Hai cấu hình SFU bổ sung giúp tách riêng tác dụng của simulcast: chỉ một bản mã hóa thay vì ba lớp, và ép mọi consumer về lớp thấp nhất.

TABLE: Bảng 5.5. Cấu hình của hai kiến trúc được so sánh
| Mục | Hệ thống chuẩn Mesh | SFU (nexo) |
| --- | --- | --- |
| Cấu trúc kết nối | Một RTCPeerConnection cho mỗi cặp, relay signaling tối giản | API thật và worker mediasoup thật; mã client của sản phẩm |
| Mã hóa video | Một bản mã hóa, tối đa 1.200 kbps mỗi kết nối | Simulcast q/h/f = 150/400/1.200 kbps |
| Lớp nhận | – | Chính sách mặc định: trên 6 camera → lớp 0, trên 2 → lớp 1, còn lại → lớp 2 |
| Nguồn | Camera giả 960×540, 20 fps, VP8; âm thanh Opus | Như Mesh |
| Hiển thị video nhận | Tắt (giải mã nhưng không vẽ) | Tắt |
| Các mức N | 2, 4, 6, 8 | 2, 4, 6, 8, 10 |
| Số lần lặp | 3 lượt × 60 s mỗi mức (khởi động 30 s) | 3 lượt × 60 s mỗi mức (khởi động 30 s) |

Video nhận được giải mã nhưng không được vẽ. Ở chế độ headless, trình duyệt vẽ video bằng phần mềm, tốn khoảng một lõi cho mỗi client và sẽ che lấp chi phí truyền tải và codec đang cần so sánh; chi phí vẽ là như nhau ở cả hai kiến trúc với cùng số ô, và trên thiết bị thật việc vẽ do GPU đảm nhận.

### Các sai lệch đo lường

Hai hiện tượng sẽ làm sai lệch phép so sánh nếu không được phát hiện và loại bỏ.

**SFU công bố địa chỉ loopback.** Khi SFU công bố `127.0.0.1`, trình duyệt không thu thập loopback candidate, việc kiểm tra kết nối UDP thất bại và ICE rơi xuống candidate TCP thụ động của mediasoup. RTP chạy trên TCP bị chặn đầu hàng đợi (head-of-line blocking), sinh ra NACK dày đặc và jitter cao dù không hề có mất gói thật. Vì vậy harness công bố địa chỉ LAN của máy, và mọi kết quả SFU dưới đây đều đi qua UDP (cặp candidate được chọn được ghi kèm mỗi mẫu). Cấu hình phát triển của ứng dụng cũng phải dùng địa chỉ LAN vì cùng lý do.

**Gói thăm dò băng thông.** mediasoup gửi gói đệm trên một luồng riêng (SSRC 1234) để dò băng thông còn trống trước khi nâng lớp cho consumer. Luồng này có "mất gói" và jitter khoảng 200 ms giả tạo, trong khi các luồng media thật không mất gói và jitter gần bằng không; thống kê consumer phía SFU cũng ghi nhận không mất gói và không có NACK. Số byte của luồng này vẫn được tính vào downlink vì chúng thật sự đi qua đường truyền, nhưng luồng này bị loại khỏi các chỉ số chất lượng. Nếu không hiệu chỉnh, SFU sẽ bị đánh giá oan là kém hơn Mesh.

### Kết quả: băng thông

Bảng 5.6 và Bảng 5.7 trình bày kết quả của hai kiến trúc, còn Hình 5.3 đến Hình 5.7 vẽ các chỉ số chính theo N với thanh sai số bằng một độ lệch chuẩn giữa các lượt.

MEDIATABLE: mesh-norender | Bảng 5.6. Kết quả của hệ thống chuẩn Mesh (trung bình ± độ lệch chuẩn giữa các lượt)

MEDIATABLE: sfu-norender | Bảng 5.7. Kết quả của SFU có simulcast (trung bình ± độ lệch chuẩn giữa các lượt)

FIG: fig-5-3-uplink.png | Hình 5.3. Uplink của mỗi client theo số người tham gia | 15

Hình 5.3 là kết quả chính. Uplink của Mesh tăng theo số kết nối: mỗi kết nối mang khoảng {{=mesh:2:upKbps}} kbps, nên một client tải lên {{mesh:2:upKbps}} kbps ở N = 2 và {{mesh:4:upKbps}} kbps ở N = 4 với ba bộ mã hóa, đúng bằng (N−1)·b trong Bảng 2.2. Uplink của SFU gần như phẳng: {{sfu:2:upKbps}} kbps ở N = 2 và {{sfu:10:upKbps}} kbps ở N = 10, luôn với ba bộ mã hóa (ba lớp simulcast). Ở N = 2, client SFU tải lên nhiều hơn client Mesh vì phải gửi ba lớp thay vì một; đây là chi phí cố định của simulcast, cái giá để uplink không phụ thuộc N. Từ số liệu Mesh, hai kết nối ở N = 3 sẽ cần khoảng @MESH_N3@ kbps (*tính lại* bằng ngoại suy tuyến tính, không đo), nên điểm hòa vốn nằm quanh N = 3; từ N = 4, SFU tải lên ít hơn Mesh @UP_SAVING_4@% (*tính lại*).

Giá trị Mesh ở N = 6 và 8 không phản ánh nhu cầu lý thuyết (năm và bảy luồng, khoảng @MESH_N6_THEORY@ và @MESH_N8_THEORY@ kbps, *tính lại*): số bộ mã hóa thật sự đang phát giảm xuống trung bình {{=mesh:6:encoders}} và {{=mesh:8:encoders}} vì các kết nối bị nghẽn, và chênh lệch giữa các lượt rất lớn. Đây là trạng thái quá tải chứ không phải trạng thái ổn định.

FIG: fig-5-4-downlink.png | Hình 5.4. Downlink của mỗi client theo số người tham gia | 15

Hình 5.4 trình bày downlink. Với Mesh, mỗi luồng nhận tốn khoảng {{=mesh:2:downKbps}} kbps và tổng downlink tăng theo N−1. Với SFU, downlink đi theo chính sách chọn lớp chứ không theo N: một luồng ở lớp 2 tốn {{=sfu:2:downKbps}} kbps ở N = 2; ở N = 4 và 6, các consumer chuyển sang lớp 1 và mỗi luồng tốn khoảng @SFU_PER_STREAM_L1@ kbps (*tính lại*); khi có hơn sáu camera, các consumer chuyển sang lớp 0, nên downlink ở N = 8 ({{=sfu:8:downKbps}} kbps cho bảy luồng) thấp hơn ở N = 6, và ở N = 10 chín luồng tốn {{=sfu:10:downKbps}} kbps. Như vậy downlink của client SFU luôn bị chặn trên dù phòng đông lên, đúng với mục đích của simulcast và chính sách chọn lớp.

### Kết quả: CPU

FIG: fig-5-5-cpu.png | Hình 5.5. CPU trình duyệt của mỗi client theo số người tham gia | 15

Hình 5.5 so sánh CPU của một trình duyệt. Với Mesh, CPU tăng từ {{mesh:2:cpu}}% lên {{mesh:4:cpu}}% một lõi khi N tăng từ 2 lên 4, tức khoảng @MESH_CPU_RATIO@ lần (*tính lại*), phù hợp với việc số bộ mã hóa và giải mã của mỗi client tăng từ một lên ba. Ở N = 6, một trình duyệt Mesh dùng trung bình {{=mesh:6:cpu}}%, tức hơn hai lõi, vượt xa mức một thiết bị người dùng thông thường có thể dành cho một cuộc gọi. Với SFU, CPU tăng chậm từ {{sfu:2:cpu}}% ở N = 2 lên {{sfu:10:cpu}}% ở N = 10, vì số bộ mã hóa cố định và chỉ số bộ giải mã tăng; ở N = 4, client SFU dùng ít hơn client Mesh @CPU_SAVING_4@% CPU (*tính lại*).

Bảng 5.8 cho thấy phần chi phí được chuyển sang máy chủ. Worker mediasoup dùng {{=sfu:2:workerCpu}}% một lõi ở N = 2 và {{=sfu:10:workerCpu}}% ở N = 10; mức này tăng nhanh hơn tuyến tính vì số luồng cần chuyển tiếp tăng theo N(N−1). Tiến trình Node.js, nơi chạy signaling và API, chỉ dùng từ {{=sfu:2:nodeCpu}}% đến {{=sfu:10:nodeCpu}}% một lõi với {{=sfu:2:rss}}–{{=sfu:10:rss}} MiB bộ nhớ, xác nhận việc tách luồng điều khiển và luồng media ở mục 3.2.2: Node.js không bao giờ chạm vào gói media.

SERVERTABLE: sfu-norender | Bảng 5.8. Chi phí phía máy chủ của SFU (trung bình giữa các lượt)

Cộng CPU của mọi trình duyệt cho tổng tải của thực nghiệm (*tính lại* bằng N × CPU trung bình mỗi client): @TOTAL_CPU@. Mesh ở N = 6 và 8 dùng phần lớn 16 luồng phần cứng của máy; vì vậy một phần sự sụp đổ của Mesh là do chính máy thử nghiệm, điểm này được thảo luận ở mục 5.7.

### Kết quả: độ trễ và chất lượng

FIG: fig-5-6-rtt.png | Hình 5.6. Thời gian khứ hồi theo số người tham gia (thang logarit) | 15

FIG: fig-5-7-fps.png | Hình 5.7. Tốc độ khung hình nhận theo số người tham gia | 15

Hình 5.6 và Hình 5.7 trình bày độ trễ và tốc độ khung hình. Với SFU, RTT nằm trong khoảng {{=sfu:2:rtt}} đến {{=sfu:10:rtt}} ms, jitter video tối đa {{=sfu:10:videoJitter}} ms, jitter âm thanh tối đa @SFU_MAX_AJIT@ ms, tỉ lệ mất gói {{=sfu:10:loss}}% và không có NACK ở mọi mức; từ N = 4 trở lên, tốc độ khung hình nhận luôn đạt {{=sfu:4:fps}} fps, bằng tốc độ của nguồn phát. Ngoại lệ là N = 2 với trung bình {{sfu:2:fps}} fps: ở mọi lượt, ít nhất một trong hai người nhận có một phần thời gian đo (7 đến 20 trong 30 mẫu) dưới 18 fps, thấp nhất 5 fps, và downlink cũng thấp và dao động hơn tương ứng. Nhiều khả năng đây là lúc bộ ước lượng băng thông vẫn đang tăng dần tới lớp độ phân giải đầy đủ, lớp mà chính sách chọn khi chỉ có một camera từ xa và cần bitrate lớn nhất; hiện tượng này không xảy ra ở các mức N lớn hơn, nơi dùng lớp thấp hơn. Giữ phòng một camera ở lớp 1 cho tới khi ước lượng băng thông đủ lớn sẽ loại bỏ được hiện tượng này. Không có lần đóng băng hình nào trong cửa sổ đo của các lượt SFU; vài lần đóng băng ghi nhận lúc phòng đang đầy dần tương ứng với các lần chuyển lớp khi phòng vượt quá sáu camera.

Mesh đạt chất lượng tương đương ở N = 2 và 4 (RTT khoảng 1 ms, không mất gói, 20 fps) nhưng **sập ở N = 6**: RTT tăng lên {{mesh:6:rtt}} ms, jitter buffer giữ {{mesh:6:jitterBuffer}} ms dữ liệu, tốc độ khung hình nhận giảm còn {{mesh:6:fps}} fps, jitter âm thanh lên tới {{=mesh:6:audioJitter}} ms, mỗi client gặp @MESH_FREEZE_6@ lần đóng băng hình mỗi phút, và trình duyệt báo chất lượng gửi bị giới hạn bởi băng thông hoặc CPU trong @MESH_LIMITED_6@% số mẫu. Ở N = 8, một trong ba lượt thậm chí không thể hoàn thành vì các trình duyệt ngừng phản hồi harness, và các lượt hoàn thành có RTT lên tới vài giây. Khung hình đầu tiên xuất hiện sau {{=mesh:2:firstFrame}} ms ở N = 2 và {{=mesh:8:firstFrame}} ms ở N = 8 với Mesh, so với {{=sfu:2:firstFrame}}–{{=sfu:10:firstFrame}} ms với SFU; với SFU, thời gian này bao gồm cả việc mọi người lần lượt tham gia qua API.

### Tác dụng của simulcast và chọn lớp

Bảng 5.9 và Hình 5.8 tách riêng đóng góp của simulcast và của chính sách chọn lớp. Với **một bản mã hóa**, client SFU chỉ tải lên {{=sfu-nosimulcast-norender:2:upKbps}} kbps ở N = 2, ngang client Mesh, nhưng mọi người nhận đều nhận luồng độ phân giải đầy đủ, nên downlink tăng tuyến tính tới {{=sfu-nosimulcast-norender:8:downKbps}} kbps ở N = 8, gấp @SINGLE_VS_SIM_8@ lần downlink của cấu hình simulcast ở cùng N (*tính lại*), và CPU client tăng lên {{=sfu-nosimulcast-norender:8:cpu}}% vì mọi luồng đều được giải mã ở độ phân giải đầy đủ. Như vậy simulcast đánh đổi một chi phí uplink cố định để có downlink và chi phí giải mã bị chặn trên. **Ép mọi consumer về lớp 0** làm downlink ở N = 6 giảm từ {{=sfu:6:downKbps}} kbps (lớp 1 theo chính sách mặc định) xuống {{=sfu-layer0-norender:6:downKbps}} kbps, tức giảm @L0_SAVING_6@% (*tính lại*); ở N = 10, chính sách mặc định vốn đã chọn lớp 0 nên hai cấu hình cho downlink gần như nhau ({{=sfu:10:downKbps}} và {{=sfu-layer0-norender:10:downKbps}} kbps). Lưới video theo nhu cầu ở mục 4.4.3 tinh chỉnh chính sách này theo từng ô trong giao diện thật: tạm dừng các ô ngoài trang và chỉ yêu cầu lớp lớn cho các ô lớn.

VARIANTTABLE: Bảng 5.9. Các biến thể SFU: simulcast với chính sách mặc định, một bản mã hóa, và ép lớp 0 (trung bình giữa các lượt)

FIG: fig-5-8-layers.png | Hình 5.8. Downlink của mỗi client với ba cấu hình SFU ở N = 6 và N = 10 (cấu hình một bản mã hóa chỉ đo tới N = 8) | 14

### Thảo luận

1. **Mesh sụp đổ trong khoảng N = 4 đến N = 6, trong khi SFU không có dấu hiệu suy giảm tới N = 10.** Kết quả này khớp với Bảng 2.2: chi phí của Mesh tăng tuyến tính theo N−1 ở cả uplink, downlink và CPU, còn SFU giữ uplink không đổi và để chính sách chọn lớp kiểm soát downlink.
2. **SFU không rẻ hơn ở mọi N.** Ở N = 2, simulcast tốn nhiều uplink hơn một kết nối Mesh. Dùng một bản mã hóa, hoặc truyền ngang hàng cho cuộc gọi hai người, sẽ là lựa chọn tốt hơn trong trường hợp này; hệ thống chưa hiện thực việc tự động chuyển chế độ.
3. **Uplink SFU đo được (khoảng 1,0 Mbps) thấp hơn con số 1,75 Mbps trong ví dụ ở mục 2.3.4.** Con số đó là tổng bitrate tối đa của ba lớp. Với nội dung giả đơn giản ở 960×540 và 20 fps, bộ mã hóa không dùng hết ngân sách; camera thật sẽ đẩy uplink lên gần mức trần hơn. Điều quan trọng là uplink **không** phụ thuộc vào N.
4. **Chi phí được chuyển sang máy chủ.** Băng thông ra của SFU bằng tổng downlink của mọi client (khoảng @SFU_EGRESS_10@ Mbps ở N = 10, *tính lại*), và CPU của worker tăng nhanh hơn tuyến tính theo N. Máy chủ SFU phải được cấp đủ băng thông này, một chi phí mà Mesh không có.

## So sánh với các hệ thống hiện có

Ngoài hệ thống chuẩn Mesh đã đo, Bảng 5.10 đặt nexo cạnh một số nền tảng phổ biến. Mô hình kênh lâu dài tích hợp thoại và video là cách làm của Discord và Slack [@discord], [@slack]; các sản phẩm chuyên về họp như Jitsi Meet [@jitsi] tập trung vào bản thân cuộc họp. Giống Jitsi Videobridge và các máy chủ media của Discord, nexo dùng bộ định tuyến chọn lọc, kiến trúc mà các nghiên cứu về SFU mã nguồn mở [@andre2018] và kết quả ở trên cho thấy là lựa chọn mở rộng được cho cuộc gọi nhiều bên. Cơ chế Last N của Jitsi [@lastn] chỉ chuyển tiếp luồng của những người nói gần đây nhất; còn nexo xác định các luồng cần chuyển tiếp và lớp của chúng dựa trên những ô thực sự đang hiển thị, một chính sách bổ trợ có thể kết hợp với hoạt động nói trong hướng phát triển.

TABLE: Bảng 5.10. So sánh định tính với các nền tảng hiện có
| Tính năng | nexo | Discord | Slack | Jitsi Meet |
| --- | --- | --- | --- | --- |
| Workspace với kênh văn bản lâu dài | ✓ | ✓ | ✓ | – |
| Gọi video ngay trong workspace | ✓ (kênh video) | ✓ (kênh thoại/video) | ✓ (huddle) | – (cuộc họp riêng) |
| Kiến trúc media | SFU (mediasoup) | SFU (máy chủ riêng) | Không công bố | SFU (Jitsi Videobridge) |
| Tự triển khai, có mã nguồn | ✓ | – | – | ✓ |
| Phòng chờ và quyền điều hành của host | ✓ | Một phần | Một phần | ✓ |
| Bảng công việc liên kết với tin nhắn | ✓ | – | Qua tích hợp | – |

Phép so sánh này mang tính định tính: các nền tảng thương mại chạy trên hạ tầng toàn cầu không thể tái tạo trên một máy, nên đồ án không đưa ra so sánh hiệu năng với chúng.

## Đối chiếu với yêu cầu

Bảng 5.11 đối chiếu các yêu cầu phi chức năng ở Bảng 3.3 với kết quả đo.

TABLE: Bảng 5.11. Đối chiếu các yêu cầu phi chức năng
| Yêu cầu | Kết quả đo | Đánh giá |
| --- | --- | --- |
| Tin nhắn tới người nhận dưới 100 ms (p95) trong mạng nội bộ | p95 nhận tin 32,2 / 34,9 / 45,9 ms ở 50 / 100 / 200 socket; p95 ACK tối đa 48,6 ms; p99 ở 200 socket khoảng 140 ms | **Đạt** theo tiêu chí p95 trên một máy; phần đuôi p99 ở 200 socket vượt 100 ms |
| Uplink và CPU client không tăng theo N (SFU) | Uplink {{=sfu:2:upKbps}} → {{=sfu:10:upKbps}} kbps khi N = 2 → 10; CPU {{=sfu:2:cpu}}% → {{=sfu:10:cpu}}% | **Đạt về uplink**; CPU tăng chậm theo số luồng giải mã, thấp hơn nhiều so với mức tăng tuyến tính của Mesh |
| Mất gói ≈ 0, jitter < 30 ms, RTT < 150 ms khi mạng tốt | SFU: mất gói 0%, jitter video ≤ {{=sfu:10:videoJitter}} ms, jitter âm thanh ≤ @SFU_MAX_AJIT@ ms, RTT ≤ {{=sfu:10:rtt}} ms tới N = 10 | **Đạt** trên đường truyền nội bộ; chưa đo trên mạng thật |
| Không mất, không trùng tin khi mất ACK hoặc kết nối lại; phục hồi ICE | 0 mất, 0 trùng trên 732 tin với 36 lần gửi lại và 6 lần kết nối lại; restart ICE đã hiện thực và kiểm thử ở mức signaling | **Đạt** trong các kịch bản đã kiểm thử |
| Băm mật khẩu, token ngắn hạn, kiểm quyền từng sự kiện, DTLS-SRTP | Kiểm thử phân quyền chéo đều đạt; DTLS-SRTP là bắt buộc trong WebRTC | **Đạt** với phân quyền; chưa có bắt gói để chứng minh DTLS-SRTP trên đường truyền |
| Nhiều tiến trình API; phân bổ cuộc họp theo worker | Hai tiến trình API và một worker bị dừng trong kiểm thử tích hợp | **Đạt** với nhiều tiến trình và worker trên một máy; SFU nhiều node chưa được nghiệm thu |

## Giới hạn của phép đo

Các giới hạn sau xác định phạm vi những gì có thể kết luận từ chương này.

1. **Một máy.** Mọi trình duyệt, API, PostgreSQL và SFU dùng chung 16 luồng phần cứng. Khi tổng nhu cầu CPU tiến gần năng lực của máy, mọi chỉ số đều xấu đi do tranh chấp. Mesh ở N = 6 và 8 rơi vào trạng thái này, nên một phần sự sụp đổ của nó đến từ máy thử; trên thiết bị thật, mỗi người có CPU riêng, và điểm gãy của Mesh do uplink hoặc CPU của thiết bị yếu nhất quyết định, có thể nằm ở một giá trị N khác. Kết luận vững chắc là xu hướng (Mesh tăng tuyến tính, uplink SFU phẳng), chứ không phải vị trí chính xác của điểm gãy.
2. **Mạng nội bộ.** Không có mất gói, độ trễ hay giới hạn băng thông thật, nên RTT, jitter và tỉ lệ mất gói phản ánh tải xử lý chứ không phản ánh chất lượng mạng. Chưa thực hiện thử nghiệm trên nhiều mạng, qua TURN hay với suy giảm mạng có kiểm soát.
3. **Media giả và không vẽ video.** Camera giả tạo nội dung đơn giản nên bitrate thấp hơn camera thật, và chi phí vẽ video đã bị loại khỏi phép đo. CPU thực tế sẽ cao hơn một lượng xấp xỉ nhau ở cả hai kiến trúc.
4. **Ba lượt mỗi mức.** Độ lệch chuẩn dựa trên ba lượt mỗi mức (hai lượt với Mesh ở N = 8, nơi một lượt không thể hoàn thành), đủ để thấy xu hướng nhưng chưa đủ để có khoảng tin cậy hẹp.
5. **Chưa bắt gói tin.** Công cụ phân tích và quy trình bắt gói đã có trong kho mã nhưng chưa thực hiện lần bắt gói nào, nên chưa có bằng chứng ở mức gói tin cho STUN, DTLS và RTP/RTCP.
6. **Tải nhắn tin ở mức vừa phải.** Bài kiểm tra nhắn tin dùng 4 tin mỗi giây; chưa mô phỏng chạy dài hạn, tải bão hòa, mất mạng kéo dài hay mạng di động.
7. **Hạ tầng chưa được nghiệm thu.** CI từ xa, sao lưu trên môi trường thật, S3 và e-mail trên đám mây, HTTPS công khai và máy chủ TURN thật nằm ngoài môi trường thử nghiệm, nên hệ thống chưa được khẳng định là sẵn sàng cho môi trường sản xuất.

## Tóm tắt chương

Các bài kiểm thử tự động xác nhận tính đúng của cơ chế lũy đẳng khi gửi tin, phân quyền, quản trị, khả năng chịu lỗi worker, hoạt động nhiều tiến trình, migration và khôi phục dữ liệu. Lõi nhắn tin giữ độ trễ nhận tin ở phân vị 95 dưới 46 ms với 200 socket và không làm mất hay trùng tin nào. Trong thực nghiệm chính, SFU giữ uplink của client ở khoảng 1 Mbps và CPU client ở mức thấp từ N = 2 tới N = 10, không mất gói và ổn định ở 20 fps từ N = 4 trở lên, trong khi hệ thống chuẩn Mesh tăng tuyến tính và sập ở N = 6 trên cùng máy. Các kết quả này thu được trên một máy qua mạng nội bộ; mở rộng phép đo sang mạng thật là hạng mục chính của hướng phát triển.
