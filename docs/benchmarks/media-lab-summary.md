# Kết quả phòng thí nghiệm media — Mesh và SFU

Sinh tự động bởi `node experiments/media-lab/summarize.mjs` từ số liệu gốc trong `docs/evidence/media-lab/`.

**Môi trường:** AMD Ryzen 7 6800HS with Radeon Graphics         , 16 luồng, 23.26 GiB RAM, win32 x64, Node v22.19.0.
Trình duyệt: C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe. all clients and the SFU on one host; SFU announced on the LAN address. Thu: Chromium fake device, ideal 960x540@30 (delivers 20 fps), VP8/Opus, SwiftShader. Hiển thị video nhận: off (decode only).
Mỗi mức N: khởi động 30 s, đo 60 s, lấy mẫu `getStats()` mỗi 2 s, CPU mỗi trình duyệt qua CDP `SystemInfo.getProcessInfo`.

### Mesh P2P (`mesh-norender`)

Nguồn: [mesh-norender-2026-10-03-12-06-25.json](../evidence/media-lab/mesh-norender-2026-10-03-12-06-25.json)

| N | Uplink TB (kbps) | Downlink TB (kbps) | CPU client TB (%) | Encoder hoạt động | RTT (ms) | Jitter video (ms) | Mất gói (%) | FPS nhận | Jitter buffer (ms) | CPU worker SFU (%) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 525 | 525 | 29 | 1 | 1 | 0 | 0 | 20 | 17 | – |
| 4 | 1.579 | 1.579 | 85 | 3 | 1 | 0,9 | 0 | 20 | 8 | – |
| 6 | 1.505 | 804 | 221 | 2,3 | 1.292,7 | 799 | 0,63 | 4,2 | 2.653 | – |
| 8 | 1.587 | 676 | 162 | 1,7 | 4.830,7 | 363,7 | 0,13 | 11,3 | 1.289 | – |

### SFU + simulcast (`sfu-norender`)

Nguồn: [sfu-norender-2026-10-03-12-14-24.json](../evidence/media-lab/sfu-norender-2026-10-03-12-14-24.json)

| N | Uplink TB (kbps) | Downlink TB (kbps) | CPU client TB (%) | Encoder hoạt động | RTT (ms) | Jitter video (ms) | Mất gói (%) | FPS nhận | Jitter buffer (ms) | CPU worker SFU (%) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1.007 | 594 | 26 | 3 | 0,3 | 0 | 0 | 19,4 | 12 | 2,7 |
| 4 | 984 | 934 | 30 | 3 | 0,2 | 0 | 0 | 20 | 8 | 6,6 |
| 6 | 999 | 1.561 | 33 | 3 | 0,4 | 0 | 0 | 20 | 8 | 12,3 |

## Hình

![fig-5-uplink.svg](../thesis/figures/fig-5-uplink.svg)

![fig-5-downlink.svg](../thesis/figures/fig-5-downlink.svg)

![fig-5-cpu.svg](../thesis/figures/fig-5-cpu.svg)

![fig-5-rtt.svg](../thesis/figures/fig-5-rtt.svg)

![fig-5-fps.svg](../thesis/figures/fig-5-fps.svg)
