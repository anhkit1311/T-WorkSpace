# Triển khai lên VPS (HTTPS, TURN, tổng đài)

Hướng dẫn đưa T-WorkSpace lên một VPS Linux có IP công khai và tên miền, dùng `infra/docker-compose.prod.yml`. Làm xong, hội đồng có thể mở web qua HTTPS, họp từ mạng 4G (qua TURN), và gọi hotline từ điện thoại thật qua SIP trunk Pitel.

## 1. Chuẩn bị

| Hạng mục | Yêu cầu tối thiểu cho demo |
| --- | --- |
| VPS | 4 vCPU, 8 GB RAM, 80 GB SSD, Ubuntu 22.04/24.04, **IP công khai riêng** (không NAT chung) |
| Tên miền | Một bản ghi A, ví dụ `tws.example.vn` → IP VPS |
| Phần mềm | Docker Engine + Compose plugin, `certbot` |
| SIP trunk | Tài khoản Pitel (username, password, server, đầu số), và danh sách IP SIP của Pitel để mở tường lửa |

Mediasoup và Asterisk gửi RTP thẳng tới trình duyệt/điện thoại nên VPS phải nhận được UDP từ Internet. Không chạy sau Cloudflare proxy (chỉ DNS).

## 2. Tường lửa

| Cổng | Giao thức | Dùng cho | Mở cho |
| --- | --- | --- | --- |
| 80, 443 | TCP | Web, API, Socket.IO, SIP over WSS (`/ws`) | Mọi nơi |
| 40000–40099 | UDP + TCP | RTP của phòng họp (mediasoup) | Mọi nơi |
| 3478 | UDP + TCP | TURN | Mọi nơi |
| 5349 | TCP | TURN over TLS (mạng chặn UDP) | Mọi nơi |
| 49160–49999 | UDP | Cổng relay của TURN | Mọi nơi |
| 10000–10099 | UDP | RTP của tổng đài (Asterisk) | Mọi nơi (trình duyệt) |
| 5070 | UDP | SIP trunk | **Chỉ IP của Pitel** |
| 5060 | UDP | Máy bàn SIP trong LAN | **Đóng** trên VPS (chỉ dùng trong mạng trường) |

Ví dụ với `ufw`:

```bash
sudo ufw allow 80,443/tcp
sudo ufw allow 40000:40099/udp && sudo ufw allow 40000:40099/tcp
sudo ufw allow 3478 && sudo ufw allow 5349/tcp && sudo ufw allow 49160:49999/udp
sudo ufw allow 10000:10099/udp
sudo ufw allow from <IP-Pitel> to any port 5070 proto udp
sudo ufw enable
```

## 3. Chứng chỉ HTTPS

Lần đầu Nginx chưa có chứng chỉ, nên xin bằng chế độ standalone khi cổng 80 còn trống:

```bash
sudo certbot certonly --standalone -d tws.example.vn --agree-tos -m admin@example.vn
sudo mkdir -p /var/www/certbot
```

Gia hạn về sau đi qua thư mục webroot mà Nginx phục vụ (`/.well-known/acme-challenge/`):

```bash
sudo certbot renew --webroot -w /var/www/certbot --deploy-hook "docker compose -f /opt/tws/infra/docker-compose.prod.yml --env-file /opt/tws/infra/.env.prod restart web"
```

## 4. Cấu hình

```bash
git clone <repo> /opt/tws && cd /opt/tws
cp infra/.env.prod.example infra/.env.prod
```

Sửa `infra/.env.prod`:

- `APP_DOMAIN`: tên miền.
- `MEDIASOUP_ANNOUNCED_IP`, `ASTERISK_EXTERNAL_IP`: IP công khai của VPS.
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `ASTERISK_ARI_PASSWORD`, `ASTERISK_SPIKE_SIP_PASSWORD`, `TURN_SHARED_SECRET`: mỗi biến một chuỗi ngẫu nhiên riêng, ví dụ `openssl rand -base64 36`.
- `TURN_URLS=turn:tws.example.vn:3478?transport=udp,turn:tws.example.vn:3478?transport=tcp,turns:tws.example.vn:5349?transport=tcp`
- `ASTERISK_TRUNK_USERNAME/PASSWORD/SERVER/NUMBER`: thông tin trunk Pitel.
- Email: `RESEND_API_KEY` hoặc `SMTP_*`, và `SMTP_FROM`.
- Tùy chọn: `TRANSCRIBE_URL` (Whisper) và `SUMMARY_URL` (mô hình ngôn ngữ, ví dụ Ollama `http://<máy-GPU>:11434/v1/chat/completions`). Dùng máy chủ tự host nếu không muốn bản ghi rời khỏi trường.

## 5. Khởi chạy

```bash
cd /opt/tws/infra
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile turn up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node dist/api/scripts/migrate.js
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node -e "fetch('http://127.0.0.1:3001/ready').then(r=>r.text()).then(console.log)"
```

Tạo quản trị hệ thống đầu tiên rồi đăng nhập qua `https://tws.example.vn`. Image không chứa thư mục `scripts/`, nên chép script vào container trước (script đọc `../../dist/api`, đúng với `/app/scripts/ops`):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -u root api mkdir -p /app/scripts/ops
docker compose -f docker-compose.prod.yml --env-file .env.prod cp ../scripts/ops/create-user.mjs api:/app/scripts/ops/create-user.mjs
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin
```

Sao lưu hằng ngày bằng cron: `scripts/ops/backup-db.sh` (giữ 14 ngày).

## 6. Kiểm tra sau triển khai

| Kiểm tra | Cách làm | Đạt khi |
| --- | --- | --- |
| HTTPS | Mở trang, xem ổ khóa; `curl -I https://tws.example.vn` | 200, có `Strict-Transport-Security` |
| Schema | `GET /ready` | `ok` |
| Họp qua 4G | Một người dùng Wi-Fi, một người dùng 4G, cùng vào phòng; trong `chrome://webrtc-internals` xem cặp ICE được chọn | Có hình và tiếng; ở mạng chặn UDP, candidate được chọn là `relay` |
| TURN | Trang Trickle ICE (webrtc.github.io) với thông tin TURN tạm do API cấp | Có candidate `relay` |
| Trunk | `docker compose exec asterisk asterisk -rx "pjsip show registrations"` | `Registered` |
| Gọi vào | Gọi đầu số hotline từ điện thoại | Nghe IVR, tổng đài viên Sẵn sàng đổ chuông |
| Gọi ra | Máy lẻ có quyền "Gọi ra ngoài" gọi một số di động | Hai bên nghe rõ |
| Softphone | Màn hình Tổng đài, trạng thái đăng ký | Đã đăng ký qua `wss://…/ws` |

Đo chất lượng thoại và tải theo [chương đánh giá](../thesis/chuong-danh-gia.md), mục 5.

## 7. Sự cố thường gặp

- **Họp có kết nối nhưng không có hình/tiếng**: sai `MEDIASOUP_ANNOUNCED_IP`, hoặc chưa mở 40000–40099/udp.
- **Gọi hotline một chiều (chỉ một bên nghe)**: sai `ASTERISK_EXTERNAL_IP`, hoặc chưa mở 10000–10099/udp.
- **Trunk không đăng ký**: 5070/udp bị chặn, hoặc sai thông tin trunk; xem `docker compose logs asterisk`.
- **Không xin được chứng chỉ**: bản ghi A chưa trỏ đúng, hoặc cổng 80 đang bị chiếm.
