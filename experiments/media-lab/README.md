# Phòng thí nghiệm media: Mesh và SFU

Mỗi người tham gia là **một tiến trình Chromium headless riêng** (Edge/Chrome), dùng camera và micro giả. Chế độ SFU chạy API thật cùng mediasoup ngay trong tiến trình harness, và client dùng lại `MediasoupClientService` của ứng dụng. Chế độ Mesh mở một `RTCPeerConnection` cho mỗi cặp người tham gia, qua một relay signaling tối giản.

## Chạy

Cần PostgreSQL đã migrate (`npm run db:up && npm run db:migrate`) và Edge hoặc Chrome đã cài.

```bash
npm run lab -- --mode=sfu --clients=2,4,6 --seconds=60 --warmup=30 --render=0
```

```bash
npm run lab -- --mode=mesh --clients=2,4,6 --seconds=60 --warmup=30 --render=0
```

```bash
node experiments/media-lab/summarize.mjs
```

| Tham số | Ý nghĩa |
| --- | --- |
| `--mode=sfu\|mesh` | Kiến trúc |
| `--clients=2,4,6` | Các mức N (1–12), chạy lần lượt |
| `--warmup=30` / `--seconds=60` | Thời gian chờ bộ ước lượng băng thông ổn định / thời gian đo |
| `--render=0` | Giải mã nhưng không vẽ video nhận (xem mục 3 bên dưới) |
| `--simulcast=0` | SFU: phát camera bằng một encoding duy nhất |
| `--layer=0\|1\|2` | SFU: ép mọi consumer dùng một lớp; mặc định là chính sách của ứng dụng |
| `--announcedIp=<ip>` | Ghi đè IP SFU announce (mặc định: IP LAN của máy) |
| `--diag` | In số liệu producer/consumer phía SFU và raw `inbound-rtp` phía client |
| `--chrome=<path>` | Đường dẫn trình duyệt |

Số liệu gốc được ghi vào `docs/evidence/media-lab/<label>-<thời điểm>.json` **sau từng mức**. Mức nào không hoàn thành (ví dụ máy quá tải) được ghi lại với trường `failed` chứ không bị bỏ qua. Fixture (người dùng/Workspace `lab-*@example.test`) được tạo cho từng mức và xóa đúng theo id khi chạy xong.

## Số liệu thu

- **Client (`getStats()` mỗi 2 s):** uplink/downlink (byte payload + header RTP), số encoder video đang phát, RTT của cặp ICE, jitter audio/video, tỉ lệ mất gói theo cửa sổ, FPS nhận, độ trễ jitter buffer, số NACK, giao thức của candidate (UDP/TCP), `qualityLimitationReason`.
- **CPU trình duyệt:** tổng `cpuTime` mọi tiến trình của một instance qua CDP `SystemInfo.getProcessInfo`; 100% tương ứng một lõi.
- **Server:** CPU của worker mediasoup (`getResourceUsage`: utime + stime), CPU và RSS của tiến trình Node.

## Ba sai lệch đo lường đã gặp và cách xử lý

1. **Camera giả bị "ended" ngay trong headless.** Bộ sinh khung hình giả chạy trên GPU process, mà GPU process lỗi ở chế độ headless trên máy thử. Xử lý: chạy với `--use-angle=swiftshader --enable-unsafe-swiftshader`.
2. **SFU announce `127.0.0.1` khiến media chạy trên TCP.** Trình duyệt không thu thập loopback candidate, nên kiểm tra kết nối UDP tới 127.0.0.1 thất bại và ICE rơi xuống candidate TCP thụ động của mediasoup. Khi đó RTP qua TCP bị head-of-line blocking, xuất hiện NACK dày và jitter cao. Xử lý: harness announce IP LAN. Ở môi trường dev của ứng dụng cũng nên đặt `MEDIASOUP_ANNOUNCED_IP` là IP LAN.
3. **Luồng probation của mediasoup bị tính nhầm là video.** mediasoup gửi padding trên SSRC 1234 (`mid=probator`) để thăm dò băng thông. Luồng này có "mất gói" và jitter lớn giả tạo (khoảng 200 ms), trong khi luồng media thật có loss = 0 và jitter ≈ 0. Ngay tại SFU, consumer stats cũng xác nhận 0 mất gói và 0 NACK. Xử lý: vẫn tính byte của probator vào downlink nhưng loại khỏi các chỉ số chất lượng.

Ngoài ra, **render video bằng SwiftShader tốn khoảng 94% CPU mỗi client** (CPU 2 client Mesh: 120% khi có render, 26% khi `--render=0`). Chi phí hiển thị này giống nhau giữa Mesh và SFU với cùng số ô, và trên máy thật do GPU đảm nhiệm. Vì vậy thực nghiệm chính dùng `--render=0` để đo đúng chi phí của tầng truyền tải và codec.

## Giới hạn

Mọi client và SFU chạy trên **cùng một máy** (16 luồng). Khi tổng CPU chạm giới hạn của máy, mọi chỉ số đều xấu đi vì tranh chấp tài nguyên chứ không phải vì mạng. Vì vậy cần đọc kết quả ở các mức N lớn kèm cột CPU. Đường truyền là nội bộ trong máy (không có mất gói hay độ trễ thật), nên các chỉ số RTT, jitter, loss phản ánh tải xử lý chứ không phản ánh chất lượng mạng. Đo trên mạng thật cần nhiều máy và có thể kết hợp TURN; xem `../packet-capture/README.md`.
