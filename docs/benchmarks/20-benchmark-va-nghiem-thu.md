# Benchmark và nghiệm thu — 01/10/2026

## Chat nhiều kết nối

Raw từng ACK, receipt, reconnect, tài nguyên: [chat-load-2026-10-01.json](../evidence/chat-load-2026-10-01.json). Tổng hợp lại bằng `node scripts/benchmarks/summarize-chat-load.mjs`: [summary](../evidence/chat-load-summary-2026-10-01.json).

Điều kiện: Windows, Node22.19.0, PostgreSQL17.11 trong Docker, Ryzen7 6800HS/16logical cores/~23,26GiB RAM. Hai API child process riêng, PostgreSQL adapter, pool8/node, 4workspace ×2textchannel, WebSocket loopback. Mỗi mức chạy30giây ×2lần, **4 tin/giây tổng**, 4 lần gửi song song; thêm2tin lúc một client offline. 122tin duy nhất/lượt, 6lần chủ động bỏ ACK rồi gửi lại cùngID. Nhiều client kết nối chủ yếu nhận broadcast; đây không phải200 người đồng thời gửi liên tục.

Phân vị nearest-rank từ từng mẫu, gộp2lượt/mức, đơn vịms:

| Socket | ACK p50/p95/p99      | Receipt p50/p95/p99  | Tin/receipt | Lỗi/trùng |
| -----: | -------------------- | -------------------- | ----------- | --------- |
|     50 | 24,99 /39,88 /53,79  | 25,01 /32,23 /47,02  | 244 /3.052  | 0 /0      |
|    100 | 23,69 /46,09 /56,81  | 23,78 /34,87 /48,07  | 244 /6.096  | 0 /0      |
|    200 | 25,23 /48,58 /140,26 | 25,38 /45,93 /137,86 | 244 /12.196 | 0 /0      |

ACK tính từ lúc client emit đến phản hồi thành công; mẫu bỏ ACK gồm lần gửi đầu và retry. Receipt tính từ emit đầu đến client nhận new_message, tất cả tiến trình benchmark dùng cùng đồng hồ performance. Phân vị receipt cân theo số người nhận. DB count bằng số tin duy nhất ở mọi lượt. Tổng732tin/21.344receipt,36retry mấtACK,6reconnect; mỗi reconnect RESTafter lấy đủ2tin thiếu. Reconnect+backfill21,54–54,85ms, chưa mô phỏng mất mạng dài hoặc mobileWAN.

| Socket | Max RSS/API MiB | Max CPU/API % một core | Max pool waiting quan sát | DB snapshot CPU/RAM        |
| -----: | --------------: | ---------------------: | ------------------------: | -------------------------- |
|     50 |           98,84 |                   5,60 |                        13 | 5,10–5,23% /107,1–112,4MiB |
|    100 |           95,75 |                   3,75 |                        31 | 4,95–5,95% /110,5–112,6MiB |
|    200 |          115,17 |                   4,66 |                       120 | 4,78–5,63% /111,7–113,3MiB |

API CPU là chênh process.cpuUsage/độ dài cửa sổ5s,100%=một core, không chia16core. RSS lấy riêng2API, không cộng Vite/browser/loadgenerator. Pool waiting cao ở đợt kết nối ban đầu, hết ở mẫu cuối: cần nghiên cứu burst/presence trước tăng tải; không tăng pool mù theo số socket. DB Docker chỉ snapshot giữa lượt, chung với devDB; NetIO/BlockIO là bộ đếm container cộng dồn, không gọi là băng thông riêng benchmark. Không có SFUworker/RTP trong ca chat (worker0), nên bảng không dùng để kết luận tài nguyên media.

Chạy lại trên DB development/test đã migrate, tránh lúc HMR/test khác tạo tải:

```bash
npm run benchmark:chat
node scripts/benchmarks/summarize-chat-load.mjs
```

`BENCH_TIERS=50,100,200`, `BENCH_SECONDS=30`, `BENCH_REPEATS=2`; script giới hạn giá trị và chỉ dọn fixturesUUID vừa tạo. Muốn nghiên cứu soak/saturation cần chạy dài hơn, tăng tốc gửi bằng kịch bản riêng và lặp mạng thật;6lượt ngắn chưa xác định giới hạn tối đa/production capacity.

## Media: phần đã kiểm và phần chưa đo

Đã kiểm signaling/session/ICE restart/quyền, lobby cả4tổ hợp thiết bị không publish nguồn bị tắt, workerpool2worker, kill một worker thật, peer worker khác còn và join mới tạo worker thay thế. Worker resource API trả dữ liệu thật; **không suy diễn thành RTP3/6/10client**.

Chưa có bộ thiết bị đa mạng/public HTTPS/TURN để đo RTP thật. Không điền số liệu giả. Quy trình chạy lại:

1. Ghi Node/mediasoup/browser/CPU/RAM/SFUIP/codec/resolution/encodings/TURN/mạng từng client; HTTPS trừ localhost, mở UDP/TCP dải MEDIASOUP_MIN_PORT–MAX_PORT và port coturn.
2. Chạy3,6,10client theo phần cứng,5phút/lượt ×3lượt. Audio/video trước, thêm screen, mute, tắt nguồn và vào lại. Bật giơ tay/phòng chờ/khóa/kick/end và ghi lỗi.
3. Một số client ở mạng khác; kiểm selected candidate pair và relay khi mạng yêu cầuTURN. Cấu hình impairment tại router/testnetwork dành riêng (loss/delay/bandwidth), ghi thông số thật.
4. Xuất QoS CSV/JSON mỗi<=10phút (UI giữ300mẫu ×2,5s≈12,5phút), đo worker resource/API/DB riêng mỗi5s bằng protected metrics và Docker. Lưu tất cả raw cùngrunID, không đặt credentials trong file.
5. RTT dùng `transport.selectedCandidatePairId`→succeeded pair, lớn nhất2transport, ms; jitter lớn nhất inboundRTP, ms; bitrate RTP uplink/downlink từdelta bytes/time, kbps; interval loss=deltaLost/(deltaReceived+deltaLost), reset counter bỏ cửa sổ đó. Mẫu đầu/không đủ dữ liệu lànull, không coi0là đường truyền hoàn hảo.
6. Tổng hợp p50/p95/p99 theo từng client/run, lỗi/reconnect và tài nguyên; so sánh cùng điều kiện trước/sau simulcast/layer. Không so loopback vớiWAN rồi quy kết cải tiến.

| Ca cần chạy                 | Client | Mạng              | Raw RTP/QoS hiện có |
| --------------------------- | -----: | ----------------- | ------------------- |
| Audio/video                 |      3 | LAN +mạng ngoài   | Chưa có             |
| Tăng số người               |      6 | LAN +mạng ngoài   | Chưa có             |
| Tải mục tiêu theo phần cứng |     10 | LAN +mạng ngoài   | Chưa có             |
| Screen/impairment/TURN      |   3–10 | Testnetwork/relay | Chưa có             |

## Kiểm thử và restore

`npm run test:sfu`:9test qua,0skip, bao gồm twoAPIprocess, fileDB/S3mock, quyền/private/invite/owner, chatretry/thread/search, taskversion và meetingcrash/workerfailure. `npm test`:frontend5qua, API15qua/8DBsuite skip có chủ đích; chạy riêng test:sfu cho8suiteDB/SFU. Typecheck/lint/build có gate riêng.

`npm run verify:restore`:20migration,2runner đồng thời cùngDB, backup custom QA→restore DBQA mới, so Unicode/schema. Raw [restore-2026-10-01.json](../evidence/restore-2026-10-01.json). Bản sao chỉ dữ liệuQA; chưa xác minh backup production/S3cloud/emaildelivery/CIremote.
