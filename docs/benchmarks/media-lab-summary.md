# Kết quả phòng thí nghiệm media — Mesh và SFU

Sinh tự động bởi `node experiments/media-lab/summarize.mjs` từ số liệu gốc trong `docs/evidence/media-lab/`.

**Môi trường:** AMD Ryzen 7 6800HS with Radeon Graphics         , 16 luồng, 23.26 GiB RAM, win32 x64, Node v22.19.0.
Trình duyệt: C:/Program Files/Google/Chrome/Application/chrome.exe. all clients and the SFU on one host; SFU announced on the LAN address. Thu: Chromium fake device, ideal 960x540@30 (delivers 20 fps), VP8/Opus, SwiftShader. Hiển thị video nhận: off (decode only).
Ô có dạng "trung bình ± độ lệch chuẩn" khi có từ 2 lượt; cột "Lượt" là số lượt thành công (/tổng nếu có lượt lỗi). Mỗi lượt, mỗi mức N: khởi động 20 s, đo 40 s, lấy mẫu `getStats()` mỗi 2 s, CPU mỗi trình duyệt qua CDP `SystemInfo.getProcessInfo`.

### Mesh P2P (`mesh-norender`)

Nguồn: [mesh-norender-2026-10-19-16-36-29.json](../evidence/media-lab/mesh-norender-2026-10-19-16-36-29.json), [mesh-norender-2026-10-19-16-51-42.json](../evidence/media-lab/mesh-norender-2026-10-19-16-51-42.json)

| N | Lượt | Uplink (kbps) | Downlink (kbps) | CPU client (%) | Encoder | RTT (ms) | Jitter video (ms) | Mất gói (%) | FPS nhận | Jitter buffer (ms) | CPU worker SFU (%) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | 530 | 531 | 27,5 | 1 | 0,9 | 0 | 0 | 19,9 | 11 | – |
| 4 | 1 | 1.589 | 1.589 | 75,2 | 3 | 0,8 | 0,2 | 0 | 20 | 9 | – |
| 5 | 1 | 1.376 | 1.340 | 159,6 | 3,4 | 183 | 132,6 | 0 | 18,2 | 38 | – |
| 6 | 2 | 500 ± 153 | 6 ± 5 | 213,8 ± 0,3 | 1,4 ± 0 | 9.022,6 ± 1.126,4 | 63,9 ± 51 | 5,79 ± 5,52 | – | 777 ± 278 | – |
| 8 | 0/1 | không hoàn thành: CDP timeout Runtime.evaluate |  |  |  |  |  |  |  |  |  |
| 10 | 0/1 | không hoàn thành: CDP timeout Runtime.evaluate |  |  |  |  |  |  |  |  |  |
| 12 | 0/1 | không hoàn thành: CDP timeout Runtime.evaluate |  |  |  |  |  |  |  |  |  |

### SFU + simulcast (`sfu-norender`)

Nguồn: [sfu-norender-2026-10-19-16-27-26.json](../evidence/media-lab/sfu-norender-2026-10-19-16-27-26.json)

| N | Lượt | Uplink (kbps) | Downlink (kbps) | CPU client (%) | Encoder | RTT (ms) | Jitter video (ms) | Mất gói (%) | FPS nhận | Jitter buffer (ms) | CPU worker SFU (%) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | 1.003 | 600 | 29 | 3 | 0,3 | 0,1 | 0 | 20 | 11 | 3,3 |
| 4 | 1 | 974 | 919 | 33,4 | 3 | 0,3 | 0,2 | 0 | 20,1 | 8 | 9,8 |
| 6 | 1 | 1.002 | 1.578 | 42,3 | 3 | 0,6 | 0,7 | 0 | 20 | 9 | 19,4 |
| 8 | 1 | 986 | 1.197 | 40,8 | 3 | 0,5 | 0,6 | 0 | 20 | 7 | 31,5 |
| 10 | 1 | 993 | 1.581 | 48,7 | 3 | 1,2 | 1,6 | 0 | 20 | 19 | 40,6 |
| 12 | 1 | 955 | 1.859 | 51,2 | 3 | 1,9 | 3,6 | 0 | 19,8 | 66 | 56,2 |
## Hình

![fig-5-uplink.svg](../thesis/figures/fig-5-uplink.svg)

![fig-5-downlink.svg](../thesis/figures/fig-5-downlink.svg)

![fig-5-cpu.svg](../thesis/figures/fig-5-cpu.svg)

![fig-5-rtt.svg](../thesis/figures/fig-5-rtt.svg)

![fig-5-fps.svg](../thesis/figures/fig-5-fps.svg)
