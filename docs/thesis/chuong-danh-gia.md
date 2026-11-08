# Chương đánh giá: kết quả đo và đối chiếu với đặc tả

Bản nháp cho chương đánh giá của báo cáo. Số liệu lấy nguyên từ hai lượt đo: 2026-10-19 (API, chat, Mesh/SFU) và 2026-11-02/03 (tổng đài sau khi mở trần cấu hình, chất lượng thoại, ca trực mô phỏng, họp qua TURN). Lệnh chạy và dữ liệu gốc ở [docs/benchmarks/README.md](../benchmarks/README.md). Mục 5 là quy trình lặp lại các phép đo trên hạ tầng thật (VPS, trunk Pitel, mạng 4G) khi có điều kiện.

## 1. Tiêu chí đánh giá

Đặc tả đặt hai nhóm tiêu chí:

- **Tiêu chí hoàn thành**: gọi nội bộ, gọi vào và gọi ra qua đầu số; IVR, hộp thư thoại, ghi âm, giám sát; họp và e-learning đủ nghiệp vụ chính; 2 luồng liên thông; **đánh giá chất lượng thoại bằng Wireshark và độ chịu tải bằng SIPp**.
- **KPI tổng đài** (mục tiêu gợi ý): ASA ≤ 20 giây, tỉ lệ bỏ máy ≤ 5%, service level (nhận trong 20 giây) ≥ 80%. AHT và thời gian xử lý ticket chỉ theo dõi, không đặt trần.

Ngoài ra đề tài tự đặt thêm tiêu chí cho phần họp (so sánh Mesh và SFU, họp qua mạng chặn UDP) và cho API.

## 2. Môi trường đo

Các lượt đo chạy trên **một máy** (Ryzen 7 6800HS, 24 GB RAM, Docker Desktop/WSL2). Bên tạo tải và bên chịu tải dùng chung CPU, mạng là loopback hoặc Docker bridge. Vì vậy:

- Số liệu tải cho biết chi phí xử lý và giới hạn cấu hình của hệ thống.
- Điều kiện mạng xấu (độ trễ, jitter, mất gói) được **giả lập** bằng `tc netem` (chất lượng thoại) và bằng chính sách ICE `relay` (họp qua TURN). Đây chưa phải số đo qua mạng di động và trunk Pitel thật (mục 5).
- Ca trực tổng đài dùng **ACD và PostgreSQL thật**, nhưng Asterisk được thay bằng một PBX giả lập trong script (người gọi, tổng đài viên là kịch bản), chạy theo thời gian thực.

## 3. Kết quả đã đo

| Thực nghiệm | Kết quả | Nguồn |
| --- | --- | --- |
| HTTP API (k6, 50 VU, 4 đường đọc chính) | 16.228 request, 153 req/s, p95 8,2 ms, 0% lỗi | benchmarks §1 |
| Chat Socket.IO (2 instance API) | 200 socket: nhận tin p95 48 ms, p99 144 ms; 0 tin mất, 0 tin trùng | benchmarks §2 |
| ACD qua ARI (kênh Local), 20–200 cuộc đồng thời | 100% cuộc được ghi nhận và vào hàng đợi ở mọi mức. Setup p95 330 ms (20 cuộc) → 2,8 s (200 cuộc); IVR→hàng đợi p50 1,7 s tới 150 cuộc, 3,3 s ở 200 cuộc | benchmarks §3a |
| SIPp vào hotline, 10–200 cuộc đồng thời | 1.220/1.220 cuộc thành công, INVITE→200 OK p50 12 ms ở mọi mức; Asterisk tối đa khoảng 60% một lõi, 147 MiB | benchmarks §3b |
| Chất lượng thoại (pcap + E-model), 10 cuộc | MOS 4,39 (LAN), 4,38 (Wi-Fi), 4,29–4,32 (4G), 3,94–4,00 (4G yếu), 2,91–3,06 (quá tải) | benchmarks §3c |
| KPI ca trực mô phỏng (28 cuộc, 3 tổng đài viên) | Ca thường: ASA 9,8 s, bỏ máy 3,6%, SL 20 s 88,5%, AHT 84,4 s. Ca cao điểm: ASA 32,1 s, bỏ máy 3,6%, SL 60% | benchmarks §3d |
| Mesh và SFU (Chrome headless) | Mesh sập ở 6 người (CPU mỗi client khoảng 214%, RTT khoảng 9 s). SFU ổn định đến 12 người: mất gói 0%, khoảng 20 fps, uplink giữ khoảng 1 Mbps, worker 56% một lõi | benchmarks §4 |
| Họp qua TURN (ICE `relay`) | 3 và 6 người qua TURN/UDP và TURN/TCP: có hình/tiếng, mất gói 0%, khoảng 20 fps, RTT 2,6–16,9 ms | benchmarks §4b |
| Luật nghiệp vụ của ACD (BR-02 đến BR-09) | Kiểm bằng test tự động với đồng hồ giả: chọn người rảnh lâu nhất, đổ chuông không nhận thì về đầu hàng đợi và người đó sang Không sẵn sàng, hết giờ hoàn tất thì tự Sẵn sàng, softphone mất đăng ký 30 s thì Ngoại tuyến, chờ quá thời gian tối đa thì vào hộp thư thoại, thông báo ghi âm đúng một lần | `services/api/test/callcenter-acd.test.js` |
| Cách tính KPI | ASA, AHT, tỉ lệ bỏ máy, service level, số cuộc hẹn gọi lại tính đúng trên bộ cuộc gọi mẫu | `callcenter-acd.test.js` (CC-9 KPI), `callcenter-tickets.test.js` |

### 3.1 Độ chịu tải tổng đài

Lượt đo 2026-10-19 dừng ở 50 cuộc vì hai giới hạn cấu hình: `sessionlimit = 100` của máy chủ HTTP Asterisk (dùng chung cho ARI) và dải RTP 10000–10099 (khoảng 50 cuộc). Sau khi đặt `sessionlimit = 500` và dải RTP 10000–10499:

| Đồng thời | ACD: ghi nhận / vào hàng đợi | ACD: setup p95 (ms) | ACD: IVR→hàng đợi p50 (ms) | ACD: CPU Asterisk p50 | SIPp: thành công | SIPp: INVITE→200 p50 / p95 (ms) | SIPp: CPU Asterisk đỉnh |
| ---: | --- | ---: | ---: | ---: | --- | --- | ---: |
| 20 / 25 | 40/40 · 40/40 | 330 | 1.693 | 66% | 50/50 | 12 / 16 | 18,7% |
| 50 | 100/100 · 100/100 | 766 | 1.678 | 164% | 100/100 | 12 / 12 | 28,5% |
| 100 | 200/200 · 200/200 | 1.721 | 1.701 | 338% | 200/200 | 12 / 12 | 38,8% |
| 150 | 300/300 · 300/300 | 2.237 | 1.733 | 467% | 300/300 | 12 / 28 | 56,1% |
| 200 | 400/400 · 400/400 | 2.815 | 3.252 | 823% | 400/400 | 12 / 12 | 60,4% |

(Hàng đầu: ACD đo ở 20 cuộc, SIPp ở 25 cuộc. CPU tính theo % một lõi.)

- **Không còn lỗi do cấu hình** tới 200 cuộc đồng thời ở cả hai tầng.
- **Điểm bão hòa nằm ở tầng điều khiển (ARI/ACD), khoảng 150–200 cuộc**: ở 200 kênh Local, hàng đợi sự kiện Stasis của ứng dụng ARI chạm ngưỡng 500 tác vụ, IVR→hàng đợi tăng gấp đôi (1,7 s → 3,3 s) và setup p95 lên 2,8 s. Theo tiêu chí ở mục 5.2 (INVITE→200 p95 vượt 1 s hoặc thành công < 99%), tầng SIP/RTP chưa bão hòa tới 200 cuộc.
- Tầng SIP/RTP rất nhẹ: 200 cuộc G.711 chỉ dùng khoảng 60% một lõi. Trần tiếp theo là dải cổng RTP (khoảng 250 cuộc), mở rộng được bằng cấu hình.
- PostgreSQL không phải nút cổ chai (≤ 24% một lõi ở mọi mức).

### 3.2 Chất lượng thoại (MOS)

10 cuộc gọi SIPp vào hotline, mỗi cuộc 30 s, bắt gói bằng `tcpdump` trong container Asterisk, phân tích bằng `experiments/packet-capture/voice-quality.mjs`. SIPp gửi trả nguyên từng gói RTP (`-rtp_echo`), nên mỗi gói cho một mẫu độ trễ vòng. Mạng của người gọi được giả lập bằng `tc netem`. MOS tính theo E-model rút gọn (ITU-T G.107, G.711, Ie = 0, Bpl = 25,1 vì softphone WebRTC có che mất gói), độ trễ tính bảo thủ: d = RTT + 20 ms khung + bộ đệm jitter max(20 ms, 2 × jitter).

| Cuộc | Mạng giả lập | Mất gói | Jitter TB / max (ms) | RTT TB (ms) | d (ms) | R | MOS |
| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | LAN, không suy hao | 0% | 0,09 / 1,48 | 0,15 | 40 | 92,2 | 4,39 |
| 2 | LAN, không suy hao | 0% | 0,08 / 1,41 | 0,14 | 40 | 92,2 | 4,39 |
| 3 | Wi-Fi: 20 ± 5 ms | 0% | 5,32 / 7,71 | 20,3 | 60 | 91,8 | 4,38 |
| 4 | Wi-Fi: 20 ± 5 ms | 0% | 5,46 / 8,04 | 20,1 | 60 | 91,8 | 4,38 |
| 5 | 4G: 60 ± 15 ms, 0,5% mất | 0,33% | 14,05 / 21,49 | 60,2 | 108 | 89,4 | 4,32 |
| 6 | 4G: 60 ± 15 ms, 0,5% mất | 0,67% | 13,91 / 18,94 | 60,4 | 108 | 88,1 | 4,29 |
| 7 | 4G yếu: 120 ± 30 ms, 2% mất | 2,32% | 29,84 / 43,41 | 120,3 | 200 | 77,9 | 3,94 |
| 8 | 4G yếu: 120 ± 30 ms, 2% mất | 2,11% | 27,19 / 39,54 | 119,7 | 194 | 79,3 | 4,00 |
| 9 | Quá tải: 200 ± 40 ms, 5% mất | 5,40% | 37,01 / 53,35 | 201,0 | 295 | 56,4 | 2,91 |
| 10 | Quá tải: 200 ± 40 ms, 5% mất | 4,42% | 37,15 / 56,75 | 199,2 | 293 | 59,1 | 3,06 |

Nhận xét:

1. **Bản thân hệ thống không làm giảm chất lượng thoại**: qua Asterisk trên LAN, RTT 0,15 ms, jitter < 0,1 ms, không mất gói, MOS 4,39 (trần của G.711 là 4,41).
2. **Đạt MOS ≥ 4,0** với Wi-Fi và 4G thông thường (4,29–4,38). Ở 4G yếu (2% mất gói), MOS nằm đúng ngưỡng (3,94–4,00); khi mạng quá tải (5% mất, 200 ms), MOS khoảng 3, mức "khá". Chất lượng lúc này do mạng của người gọi quyết định, không phải do tổng đài.
3. **Che mất gói là yếu tố quyết định**: tính với Bpl = 4,3 (không PLC), chỉ 0,5% mất gói đã đưa MOS xuống 3,94–4,16 (bảng đầy đủ ở benchmarks §3c).

### 3.3 KPI ca trực mô phỏng

`scripts/callcenter/simulate-shift.mjs` chạy một ca trực theo thời gian thực: ACD (`AcdService`) và repository PostgreSQL là mã thật của hệ thống, chỉ Asterisk được thay bằng PBX giả lập. Ba tổng đài viên phòng Tuyển sinh (`giaovu`, `gv.ha`, `gv.lan`) ở trạng thái Sẵn sàng. Người gọi vào hotline, bấm phím 1, chờ; tổng đài viên nhấc máy sau 3–9 s đổ chuông, đàm thoại, rồi chọn mã kết quả và ghi chú. KPI lấy bằng cùng hàm `kpiSummary` mà trang **Tổng đài → KPI** dùng, CDR xuất bằng cùng dịch vụ xuất Excel/CSV.

| Chỉ số | Mục tiêu | Ca thường | Ca cao điểm |
| --- | --- | ---: | ---: |
| Cuộc vào hàng đợi | – | 28 | 28 |
| Đã nghe | – | 25 | 24 |
| Hẹn gọi lại (phím `*`) | – | 2 | 3 |
| Bỏ máy | – | 1 | 1 |
| ASA | ≤ 20 s | 9,8 s | 32,1 s |
| AHT (đàm thoại + hoàn tất) | theo dõi | 84,4 s | 130,8 s |
| Tỉ lệ bỏ máy | ≤ 5% | 3,6% | 3,6% |
| Service level 20 s | ≥ 80% | 88,5% | 60,0% |

- **Ca thường** (19 cuộc rải đều trong khoảng 25 phút, cộng 3 đợt 3 cuộc gọi cùng lúc): 25/28 cuộc được nghe, 23 cuộc trong vòng 20 s; 2 cuộc phải chờ 26 s và 51 s vì đến lúc cả ba người đang bận. ASA 9,8 s, tỉ lệ bỏ máy 3,6% (1/28) và service level 88,5% (23/26) đều đạt mục tiêu.
- **Ca cao điểm** (2 đợt gọi dồn với cuộc gọi dài 150–200 s, và một tổng đài viên để chuông reo hết 20 s): cả ba tổng đài viên bận liền khoảng 3 phút, các cuộc đến sau phải chờ 40–184 s. ASA và service level không đạt; tỉ lệ bỏ máy vẫn đạt. Kết quả cho thấy với 3 tổng đài viên, phòng ban cần thêm người trực ở khung giờ cao điểm. Đây đúng là thông tin mà trang KPI theo giờ cung cấp cho giám sát viên.
- **Cuộc "Hẹn gọi lại" tách khỏi bỏ máy**: người gọi bấm `*` khi chờ được ghi kết quả `callback` và có phiếu ưu tiên cao để gọi lại. Các cuộc này nằm trong số cuộc vào hàng đợi, nhưng không tính là bỏ máy và không tính vào mẫu số service level. Báo cáo KPI có thêm trường `callback` và thẻ "Hẹn gọi lại".
- Mọi cuộc đã nghe đều có mã kết quả và ghi chú trong CDR xuất ra.

## 4. Đối chiếu với đặc tả

| Tiêu chí | Mục tiêu | Kết quả | Trạng thái |
| --- | --- | --- | --- |
| Độ chịu tải SIP (SIPp) | Đặc tả không ghi con số; đề tài đặt mục tiêu 50 cuộc đồng thời | 200 cuộc đồng thời, 100% thành công; bão hòa tầng ARI/ACD ở 150–200 cuộc | Đạt (vượt mục tiêu, local) |
| Chất lượng thoại (bắt gói) | MOS ≥ 4,0 (mức "tốt" của G.711) | 4,39 (LAN), 4,38 (Wi-Fi), 4,29–4,32 (4G); 3,94–4,00 ở 4G yếu | Đạt với mạng thông thường (giả lập) |
| ASA | ≤ 20 s | Ca thường: 9,8 s; ca cao điểm: 32,1 s | Đạt (ca thường, mô phỏng) |
| Tỉ lệ bỏ máy | ≤ 5% | Ca thường: 3,6%; ca cao điểm: 3,6% | Đạt (mô phỏng) |
| Service level 20 s | ≥ 80% | Ca thường: 88,5%; ca cao điểm: 60% | Đạt (ca thường, mô phỏng) |
| Họp qua nhiều mạng | Có hình/tiếng qua Wi-Fi, 4G và mạng chặn UDP | Qua TURN/UDP và TURN/TCP (chặn UDP): 3 và 6 người, 0% mất gói, khoảng 20 fps | Đạt (TURN local) |
| Luật nghiệp vụ của ACD | BR-02 đến BR-09 | Test tự động qua | Đạt |

## 5. Quy trình đo trên hạ tầng thật

Các phép đo ở mục 3 dùng mạng giả lập. Khi có VPS (triển khai theo [docs/deploy/trien-khai-vps.md](../deploy/trien-khai-vps.md)), có thể lặp lại với cùng công cụ để có số liệu thật.

### 5.1 Chất lượng thoại

1. Trên VPS: `sudo tcpdump -i any -w call.pcap udp portrange 10000-10499 or udp port 5070`.
2. Gọi hotline từ điện thoại thật, nói chuyện 60 s với tổng đài viên dùng softphone trên web. Lặp 10 cuộc: 5 cuộc từ 4G, 5 cuộc từ mạng cố định.
3. Xuất trường RTP: `tshark -r call.pcap -d udp.port==10000-10499,rtp -Y rtp -T fields -E header=y -E separator=, -e frame.time_epoch -e frame.len -e ip.src -e udp.srcport -e ip.dst -e udp.dstport -e stun.type -e dtls.record.content_type -e rtp.ssrc -e rtp.seq -e rtp.timestamp -e rtp.p_type -e rtcp.pt -e rtcp.rc > call.csv`, rồi lấy mất gói và jitter theo từng chiều bằng `node experiments/packet-capture/analyze.mjs call.csv`, hoặc trong Wireshark (**Telephony → RTP → RTP Streams → Analyze**).
4. Tính MOS bằng hàm `eModel` của `experiments/packet-capture/voice-quality.mjs` (công thức ở mục 3.2), với d ≈ RTT/2 + 20 ms + bộ đệm jitter (RTT lấy từ RTCP hoặc `pjsip show channelstats`).

### 5.2 Đường tải SIPp tới điểm bão hòa

1. Mở rộng tiếp dải RTP nếu cần (`rtp.conf` và phần publish cổng trong compose). Trên Linux có thể dùng dải lớn (10000–20000); trên Docker Desktop for Windows nên giữ vài trăm cổng.
2. Chạy `node scripts/benchmarks/sipp/run-sipp.mjs --levels 50,100,150,200,250` và `node scripts/benchmarks/callcenter-load.mjs` ở các mức tương ứng.
3. Điểm bão hòa là mức đầu tiên mà tỉ lệ thành công dưới 99%, hoặc INVITE→200 p95 vượt 1 s, hoặc IVR→hàng đợi tăng gấp đôi.

### 5.3 KPI của một ca trực thật

1. Hai tổng đài viên Sẵn sàng trên web; một người đóng vai giám sát.
2. Trong 30 phút, 3–4 người gọi hotline từ điện thoại theo kịch bản. Có cuộc cố ý gác máy khi chờ, có cuộc bấm `*` để hẹn gọi lại.
3. Mở **Tổng đài → KPI** cho khung giờ đó, xuất `.xlsx`, rồi so với mục 3.3.

### 5.4 Họp qua nhiều mạng

1. Ba người vào cùng phòng: một qua Wi-Fi trường, một qua 4G, một ở mạng chặn UDP. Bật `--profile turn` (coturn) trên VPS.
2. Họp 10 phút, rồi chủ phòng xuất số liệu QoS (CSV/JSON) trong phòng họp.
3. Báo cáo theo từng người: RTT, jitter, mất gói, băng thông, số lần tự hạ chất lượng; loại ICE candidate được chọn (`chrome://webrtc-internals`). Người ở mạng chặn UDP phải đi qua `relay` (TURN), như lượt đo TURN/TCP ở mục 3.

## 6. Giới hạn

- Lượt đo tải chạy trên một máy, nên trộn chi phí của bên tạo tải vào kết quả. Ở mức 200 cuộc, Asterisk dùng khoảng 8 lõi một phần vì mỗi cuộc thử là hai kênh Local, cộng phát IVR và nhạc chờ.
- Mạng xấu trong phép đo thoại là giả lập (`netem`, mất gói ngẫu nhiên), độ trễ tính bảo thủ (cả vòng như một chiều). Chưa đo qua trunk Pitel.
- Ca trực mô phỏng dùng ACD và cơ sở dữ liệu thật, nhưng người gọi và tổng đài viên là kịch bản, PBX là giả lập. Ca chạy lúc 0 giờ nên biểu đồ theo giờ chỉ có một cột. Chưa phải số liệu vận hành thật.
- TURN chạy trong Docker trên cùng máy với trình duyệt và SFU. RTT qua mạng thật sẽ cộng thêm độ trễ tới máy chủ TURN.
- Media lab giới hạn 12 người vì mỗi người là một tiến trình Chrome trên cùng máy. Muốn đo 20–50 camera cần nhiều máy client.
