# Chương đánh giá: kết quả đo và đối chiếu với đặc tả

Bản nháp cho chương đánh giá của báo cáo. Số liệu ở mục 3 lấy nguyên từ lượt đo ngày 2026-10-19 ([docs/benchmarks/README.md](../benchmarks/README.md), có lệnh chạy và dữ liệu gốc). Mục 5 là quy trình cho các phép đo chỉ làm được trên hạ tầng thật (VPS, trunk Pitel, mạng 4G). Kết quả của mục 5 chưa có; điền vào bảng 4 sau khi đo.

## 1. Tiêu chí đánh giá

Đặc tả đặt hai nhóm tiêu chí:

- **Tiêu chí hoàn thành**: gọi nội bộ, gọi vào và gọi ra qua đầu số; IVR, hộp thư thoại, ghi âm, giám sát; họp và e-learning đủ nghiệp vụ chính; 2 luồng liên thông; **đánh giá chất lượng thoại bằng Wireshark và độ chịu tải bằng SIPp**.
- **KPI tổng đài** (mục tiêu gợi ý): ASA ≤ 20 giây, tỉ lệ bỏ máy ≤ 5%, service level (nhận trong 20 giây) ≥ 80%. AHT và thời gian xử lý ticket chỉ theo dõi, không đặt trần.

Ngoài ra đề tài tự đặt thêm tiêu chí cho phần họp (so sánh Mesh và SFU) và cho API.

## 2. Môi trường đo

Lượt đo hiện có chạy trên **một máy** (Ryzen 7 6800HS, 24 GB RAM, Docker Desktop/WSL2). Bên tạo tải và bên chịu tải dùng chung CPU, mạng là loopback hoặc Docker bridge. Vì vậy:

- Số liệu cho biết chi phí xử lý và giới hạn cấu hình của hệ thống.
- Số liệu **không** cho biết chất lượng qua mạng thật (độ trễ, jitter, mất gói giữa các mạng). Phần đó đo ở mục 5.

## 3. Kết quả đã đo

| Thực nghiệm | Kết quả | Nguồn |
| --- | --- | --- |
| HTTP API (k6, 50 VU, 4 đường đọc chính) | 16.228 request, 153 req/s, p95 8,2 ms, 0% lỗi | benchmarks §1 |
| Chat Socket.IO (2 instance API) | 200 socket: nhận tin p95 48 ms, p99 144 ms; 0 tin mất, 0 tin trùng | benchmarks §2 |
| ACD qua ARI (kênh Local) | Đến 50 cuộc đồng thời: 100% được ghi nhận và vào hàng đợi, setup p95 775 ms. Từ 100 cuộc: ARI bị từ chối do `sessionlimit = 100` của Asterisk | benchmarks §3a |
| SIPp vào hotline | Đến 50 cuộc đồng thời: 100% thành công, INVITE→200 OK p50 12 ms, Asterisk khoảng 31% một lõi. Từ cuộc thứ 51: `488` vì hết cổng RTP (10000–10099) | benchmarks §3b |
| Mesh và SFU (Chrome headless) | Mesh sập ở 6 người (CPU mỗi client khoảng 214%, RTT khoảng 9 s). SFU ổn định đến 12 người: mất gói 0%, khoảng 20 fps, uplink giữ khoảng 1 Mbps, worker 56% một lõi | benchmarks §4 |
| Luật nghiệp vụ của ACD (BR-02 đến BR-09) | Kiểm bằng test tự động với đồng hồ giả: chọn người rảnh lâu nhất, đổ chuông không nhận thì về đầu hàng đợi và người đó sang Không sẵn sàng, hết giờ hoàn tất thì tự Sẵn sàng, softphone mất đăng ký 30 s thì Ngoại tuyến, chờ quá thời gian tối đa thì vào hộp thư thoại, thông báo ghi âm đúng một lần | `services/api/test/callcenter-acd.test.js` |
| Cách tính KPI | ASA, AHT, tỉ lệ bỏ máy, service level tính đúng trên bộ cuộc gọi mẫu | `callcenter-acd.test.js` (CC-9 KPI), `callcenter-tickets.test.js` |

Nhận xét:

1. **Trần tải của tổng đài là do cấu hình, không phải do CPU.** Cả hai trần (100 phiên ARI, 50 luồng RTP) đều nằm trong tệp cấu hình Asterisk/Docker. Ở mức trần, Asterisk mới dùng khoảng 31% một lõi và PostgreSQL khoảng 5%. Một trường có vài chục tổng đài viên cần dưới 50 cuộc đồng thời, nên cấu hình hiện tại đủ dùng. Muốn hơn thì mở rộng dải RTP và `sessionlimit` rồi đo lại (mục 5.2).
2. **SFU là lựa chọn đúng cho phòng họp từ 5 người trở lên.** Mesh tăng uplink và CPU gần tuyến tính theo số người. SFU giữ uplink cố định, chi phí dồn sang máy chủ.
3. **API và chat dư năng lực** so với quy mô một khoa: p95 dưới 50 ms ở 200 kết nối đồng thời.

## 4. Đối chiếu với đặc tả

| Tiêu chí | Mục tiêu | Kết quả | Trạng thái |
| --- | --- | --- | --- |
| Độ chịu tải SIP (SIPp) | Đặc tả không ghi con số; đề tài đặt mục tiêu 50 cuộc đồng thời | 50 cuộc, 100% thành công | Đạt (local) |
| Chất lượng thoại (Wireshark) | MOS ≥ 4,0 (mức "tốt" của G.711) | Chưa đo | Cần đo trên VPS + Pitel (5.1) |
| ASA | ≤ 20 s | Hệ thống tính đúng; chưa có số liệu ca trực thật | Cần đo (5.3) |
| Tỉ lệ bỏ máy | ≤ 5% | Như trên | Cần đo (5.3) |
| Service level 20 s | ≥ 80% | Như trên | Cần đo (5.3) |
| Họp qua nhiều mạng | Có hình/tiếng qua Wi-Fi, 4G và mạng chặn UDP | Chưa đo (chỉ đo local) | Cần đo (5.4) |
| Luật nghiệp vụ của ACD | BR-02 đến BR-09 | Test tự động qua | Đạt |

## 5. Quy trình đo trên hạ tầng thật

Triển khai trước theo [docs/deploy/trien-khai-vps.md](../deploy/trien-khai-vps.md).

### 5.1 Chất lượng thoại bằng Wireshark

1. Trên VPS: `sudo tcpdump -i any -w call.pcap udp portrange 10000-10099 or udp port 5070`.
2. Gọi hotline từ điện thoại thật, nói chuyện 60 s với tổng đài viên dùng softphone trên web. Lặp 10 cuộc: 5 cuộc từ 4G, 5 cuộc từ mạng cố định.
3. Mở `call.pcap` trong Wireshark: **Telephony → VoIP Calls** để thấy luồng SIP; **Telephony → RTP → RTP Streams → Analyze** lấy cho mỗi chiều: số gói mất (%), jitter trung bình và tối đa (ms), độ trễ (delta) tối đa.
4. Tính MOS theo E-model rút gọn (ITU-T G.107), với G.711 (Ie = 0):
   - Độ trễ một chiều d (ms) ≈ RTT/2 + bộ đệm jitter (ước 2 × jitter trung bình).
   - Id = 0,024·d + 0,11·(d − 177,3)·[d > 177,3]
   - Ie_eff = 95·Ppl / (Ppl + Bpl), với Ppl là % mất gói, Bpl = 25,1 (có che mất gói) hoặc 4,3 (không có).
   - R = 93,2 − Id − Ie_eff; MOS = 1 + 0,035·R + 7·10⁻⁶·R·(R − 60)·(100 − R).
5. Ghi bảng: cuộc, mạng, mất gói, jitter, độ trễ, R, MOS. Kết luận theo mục tiêu MOS ≥ 4,0.

### 5.2 Đường tải SIPp tới điểm bão hòa

1. Mở rộng dải RTP: `rtp.conf` (`rtpend=20000`) và phần publish cổng của Asterisk trong compose (`10000-20000:10000-20000/udp`). Tăng `sessionlimit` trong `http.conf` (ví dụ 500).
2. Chạy `node scripts/benchmarks/sipp/run-sipp.mjs --levels 50,100,150,200,300`.
3. Vẽ hai đường theo số cuộc đồng thời: tỉ lệ thành công và CPU Asterisk. Điểm bão hòa là mức đầu tiên mà tỉ lệ thành công dưới 99%, hoặc INVITE→200 p95 vượt 1 s.

### 5.3 KPI của một ca trực mô phỏng

1. Hai tổng đài viên Sẵn sàng trên web; một người đóng vai giám sát.
2. Trong 30 phút, 3–4 người gọi hotline từ điện thoại theo kịch bản. Có cuộc cố ý gác máy khi chờ, có cuộc bấm `*` để hẹn gọi lại.
3. Mở **Tổng đài → KPI** cho khung giờ đó, xuất `.xlsx`. Ghi ASA, AHT, tỉ lệ bỏ máy, service level và so với mục tiêu ở mục 1. Cuộc "Hẹn gọi lại" không tính là bỏ máy.

### 5.4 Họp qua nhiều mạng

1. Ba người vào cùng phòng: một qua Wi-Fi trường, một qua 4G, một ở mạng chặn UDP (ví dụ mạng công ty, hoặc chặn UDP bằng tường lửa của máy).
2. Họp 10 phút, rồi chủ phòng xuất số liệu QoS (CSV/JSON) trong phòng họp.
3. Báo cáo theo từng người: RTT, jitter, mất gói, băng thông, số lần tự hạ chất lượng; loại ICE candidate được chọn (`host`/`srflx`/`relay`, xem `chrome://webrtc-internals`). Người ở mạng chặn UDP phải đi qua `relay` (TURN).

## 6. Giới hạn

- Lượt đo tải chạy trên một máy, nên trộn chi phí của bên tạo tải vào kết quả.
- Media lab giới hạn 12 người vì mỗi người là một tiến trình Chrome trên cùng máy. Muốn đo 20–50 camera cần nhiều máy client.
- KPI của mục 5.3 là ca mô phỏng ngắn, chưa phải số liệu vận hành thật.
