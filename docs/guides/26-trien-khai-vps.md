# Triển khai nexo lên VPS có tên miền

Hướng dẫn này đưa toàn bộ hệ thống (Nginx HTTPS, API + SFU mediasoup, PostgreSQL, coturn) lên một VPS Ubuntu bằng `infra/docker-compose.prod.yml`. Sau khi xong, có thể mở ứng dụng bằng điện thoại qua 4G để thử nghiệm nhiều mạng và TURN thật.

## 1. Chuẩn bị

| Hạng mục | Yêu cầu |
| --- | --- |
| VPS | Ubuntu 22.04/24.04, tối thiểu 2 vCPU, 2 GB RAM, IP công khai |
| Tên miền | Bản ghi DNS `A` của tên miền (ví dụ `nexo.example.com`) trỏ về IP của VPS |
| Cổng mở | 80, 443/tcp (web); 40000–40099/udp+tcp (media); 3478/udp+tcp, 5349/tcp, 49160–49999/udp (TURN; mỗi người tham gia cần 2 cổng relay, phiên cũ giữ cổng tới 10 phút) |
| E-mail (tùy chọn) | `RESEND_API_KEY` hoặc SMTP để gửi OTP đăng ký; nếu chưa có, tạo tài khoản bằng `scripts/ops/create-user.mjs` |

Nếu nhà cung cấp có tường lửa riêng (security group), mở các cổng trên ở đó; trên máy:

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80,443/tcp && sudo ufw allow 40000:40099/udp && sudo ufw allow 40000:40099/tcp && sudo ufw allow 3478 && sudo ufw allow 5349/tcp && sudo ufw allow 49160:49999/udp && sudo ufw enable
```

Cài Docker Engine và plugin compose theo hướng dẫn chính thức `https://docs.docker.com/engine/install/ubuntu/`.

## 2. Đưa mã nguồn lên VPS

Repo để riêng tư, nên đóng gói thư mục làm việc ở máy phát triển rồi tải lên:

```bash
bash scripts/ops/pack-release.sh
scp release.tgz <user>@<ip>:~/
ssh <user>@<ip> 'mkdir -p ~/nexo && tar -xzf ~/release.tgz -C ~/nexo'
```

## 3. Cấu hình bí mật

Trên VPS, trong `~/nexo/infra`:

```bash
cp .env.prod.example .env.prod
```

Sửa `.env.prod`:

- `APP_DOMAIN` = tên miền; `MEDIASOUP_ANNOUNCED_IP` = IP công khai của VPS.
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `TURN_SHARED_SECRET`, `OPERATIONS_TOKEN`: sinh ngẫu nhiên bằng `openssl rand -hex 32`.
- `TURN_URLS=turn:<domain>:3478?transport=udp,turn:<domain>:3478?transport=tcp,turns:<domain>:5349?transport=tcp`.
- `SMTP_FROM` và `RESEND_API_KEY` hoặc các biến `SMTP_*` nếu có dịch vụ e-mail.
- Nếu VPS nằm sau NAT 1:1 (AWS, GCP…), đặt `TURN_EXTERNAL_IP_ARG=--external-ip=<ip-công-khai>/<ip-riêng>`.

Không commit `.env.prod`.

## 4. Chứng chỉ HTTPS

Nginx cần chứng chỉ trước khi khởi động. Lấy chứng chỉ Let's Encrypt lần đầu ở chế độ standalone (cổng 80 phải đang trống), lệnh này yêu cầu chấp nhận điều khoản của Let's Encrypt:

```bash
sudo docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --standalone -d <domain> -m <email> --agree-tos -n
```

Gia hạn định kỳ (cron hằng tuần) bằng webroot khi hệ thống đang chạy:

```bash
sudo docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/www/certbot:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot && docker compose -f ~/nexo/infra/docker-compose.prod.yml --env-file ~/nexo/infra/.env.prod exec web nginx -s reload
```

## 5. Dựng và khởi động

```bash
cd ~/nexo/infra
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api node dist/api/scripts/migrate.js
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile turn up -d
```

Kiểm tra:

```bash
curl -fsS https://<domain>/ready && docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

## 6. Tài khoản demo khi chưa có e-mail

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod cp ../scripts/ops/create-user.mjs api:/app/scripts/ops/create-user.mjs
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node scripts/ops/create-user.mjs demo1@<domain> "Demo 1"
```

Mật khẩu ngẫu nhiên được in ra một lần; lưu lại để đăng nhập.

## 7. Thử nghiệm nhiều mạng

1. Máy tính (Wi-Fi) và điện thoại (tắt Wi-Fi, dùng 4G) đăng nhập hai tài khoản khác nhau và vào cùng một kênh video.
2. Mở bảng QoS trong cuộc họp, để chạy 5 phút rồi xuất CSV/JSON trên từng thiết bị.
3. Ghi lại loại kết nối: trên máy tính mở `chrome://webrtc-internals` và xem *candidate pair* được chọn (host/srflx/relay).
4. Kiểm tra coturn có cấp phát relay không: `docker compose ... --profile turn logs coturn | grep -i allocation`.
