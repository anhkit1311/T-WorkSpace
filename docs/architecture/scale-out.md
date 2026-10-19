# Mở rộng quy mô: tổng đài VoIP, họp video, e-learning

Tài liệu này mô tả hệ thống chạy ở quy mô một máy chủ hiện nay, những gì đã được làm để chạy nhiều
instance, và thiết kế bước tiếp theo (Kamailio) khi tổng đài cần nhiều máy Asterisk.

## 1. Hiện trạng đã triển khai

| Thành phần | Cách mở rộng | Trạng thái |
|---|---|---|
| API (Node.js, 4 lớp) | Nhiều instance sau Nginx; không giữ phiên trong bộ nhớ (JWT + refresh cookie) | Có |
| Socket.IO | `@socket.io/postgres-adapter`: sự kiện phát qua PostgreSQL NOTIFY tới mọi instance | Có |
| ACD (hàng đợi cuộc gọi) | Một **leader** giữ `pg_try_advisory_lock`; heartbeat 15 s, mất kết nối thì nhường và instance khác tiếp quản sau ≤ 30 s | Có (Q4) |
| Việc xử lý media (HLS, phụ đề) | Hàng đợi `media_jobs` trong PostgreSQL, lấy việc bằng `FOR UPDATE SKIP LOCKED`, thử lại 3 lần với backoff, tự lấy lại việc của worker chết | Có (Q3) |
| Tệp media | `MEDIA_STORAGE=s3`: playlist, segment, phụ đề, PDF được chép lên S3/MinIO; instance không có tệp cục bộ đọc từ bucket | Có (Q2) |
| Giám sát | `/metrics` (Prometheus) + Grafana dashboard + cảnh báo (ACD không có leader, người gọi chờ > 2 phút, không ai sẵn sàng, job media lỗi, lỗi 5xx) | Có (Q5) |
| Sao lưu | `npm run backup:db` (pg_dump custom, kiểm tra đọc được, giữ 14 ngày) + `npm run verify:restore` | Có (Q5) |
| CI | GitHub Actions: typecheck, lint, migrate, toàn bộ test kể cả test có CSDL, test SFU, build | Có (Q6) |

### Số đo tải (máy phát triển, Asterisk 22 trong Docker)

`npm run benchmark:calls -- --calls 60 --concurrency 30 --hold 6` (Asterisk tự sinh cuộc gọi Local
vào 9000 → IVR → bấm phím → hàng đợi ACD):

| Chỉ số | Giá trị |
|---|---|
| Cuộc gọi được ghi nhận | 60/60, không lỗi |
| Thiết lập (originate → ACD ghi cuộc gọi) | p50 304 ms, p95 521 ms |
| IVR → vào hàng đợi | p50 1708 ms (gồm lời chào IVR), p95 1750 ms |

Tầng SIP/RTP (đăng ký, xác thực, RTP thật) được đo bằng SIPp với kịch bản
`scripts/benchmarks/sipp/uac-hotline.xml`; tầng HTTP bằng k6 (`scripts/benchmarks/k6-api.js`).

## 2. Giới hạn của một máy Asterisk

- Một Asterisk 22 xử lý vài trăm cuộc gọi G.711 đồng thời (không chuyển mã). Ghi âm, IVR, mixing
  bridge làm con số này giảm.
- ARI app `nexo` nối vào **một** Asterisk; ACD là leader duy nhất nên hàng đợi nhất quán.
- Dải RTP hiện mở 10000–10099 (50 cuộc gọi có media qua NAT Docker); trên máy thật mở rộng dải
  này là bước đầu tiên.

## 3. Thiết kế nhiều Asterisk với Kamailio

```
             SIP trunk (nhà mạng)          Softphone / WebRTC (WSS)
                      \                       /
                   ┌───────────────────────────────┐
                   │ Kamailio (SIP proxy, stateless│  dispatcher: chọn Asterisk
                   │ cho đăng ký + định tuyến)     │  theo tải / sức khỏe (OPTIONS)
                   └──────┬───────────────┬────────┘
                          │               │
                   ┌──────▼─────┐  ┌──────▼─────┐      rtpengine: neo media qua NAT,
                   │ Asterisk A │  │ Asterisk B │      chuyển đổi SRTP/WebRTC ↔ RTP
                   └──────┬─────┘  └──────┬─────┘
                          │ ARI (ws)      │ ARI (ws)
                   ┌──────▼───────────────▼────────┐
                   │ API: ACD leader (một hàng đợi │
                   │ chung trong bộ nhớ + PostgreSQL)│
                   └───────────────────────────────┘
```

- **Kamailio** nhận mọi REGISTER và INVITE. Module `dispatcher` phân phối cuộc gọi tới các Asterisk
  (thuật toán theo tải `ds_select_dst(1, "10")` hoặc hash Call-ID); `usrloc` giữ vị trí máy lẻ để
  Asterisk gọi tới tổng đài viên qua Kamailio thay vì trực tiếp.
- **rtpengine** đi kèm Kamailio để xử lý WebRTC (DTLS-SRTP) và NAT; Asterisk khi đó chỉ nhận RTP
  thường, giảm tải mã hóa.
- **ACD**: AriPbx hiện mở một kết nối ARI; bản nhiều máy giữ một map `asteriskId → AriPbx` và
  ghi `asteriskId` vào từng cuộc gọi. Hàng đợi vẫn là một (leader duy nhất) nên thứ tự phục vụ và
  phân phối công bằng không đổi; lệnh bridge/play gửi tới đúng Asterisk đang giữ kênh.
- Gọi giữa hai Asterisk (người gọi ở A, tổng đài viên đăng ký ở B): ACD gọi tổng đài viên **qua
  Kamailio** từ chính Asterisk A, nên media vẫn đi một đường, không cần IAX trunk giữa các máy.
- Máy lẻ động (`PUT /asterisk/config/dynamic`) đổi thành bảng `subscriber` của Kamailio (xác thực
  tại proxy), Asterisk tin cậy Kamailio theo IP.

## 4. Họp video ở quy mô lớn

- Mỗi phòng nằm trên một router mediasoup của một worker; một instance chạy `MEDIA_WORKERS` worker.
- Nhiều máy chủ media: phòng được gán cho một máy (lưu trong `meeting_sessions`), Nginx định tuyến
  socket của phòng về máy đó. Phòng rất lớn dùng `pipeToRouter` để chia người xem sang router khác.
- TURN (coturn) cho mạng chặn UDP.
- Người gọi điện thoại vào phòng họp (quay 7000 + mã) là một peer phía máy chủ: FFmpeg chuyển
  G.711 ↔ Opus giữa Asterisk ExternalMedia và PlainTransport của mediasoup.

## 5. Thứ tự triển khai khi tải tăng

1. Mở rộng dải RTP, tách PostgreSQL ra máy riêng, bật `MEDIA_STORAGE=s3`.
2. Chạy 2+ instance API sau Nginx (đã sẵn: adapter Socket.IO, ACD leader, hàng đợi media).
3. Thêm Kamailio + rtpengine trước Asterisk hiện có (một Asterisk), chuyển WebRTC sang rtpengine.
4. Thêm Asterisk thứ hai sau dispatcher, mở rộng AriPbx nhiều kết nối như mục 3.
