# Triển khai production

1. Chuẩn bị máy Linux có Docker Compose, domain A/AAAA trỏ đến host, mở TCP 80/443 và TCP/UDP 40000–40099. `MEDIASOUP_ANNOUNCED_IP` phải là IP public của host mà trình duyệt truy cập được; nếu NAT, chuyển tiếp dải cổng media về máy này.
2. Cấp chứng chỉ Let's Encrypt cho domain trước khi khởi động Nginx. Có thể dùng Certbot `certonly --standalone` khi cổng 80 đang trống. Đặt `TLS_CERTS_DIR` trỏ đến thư mục chứa `live/<domain>/fullchain.pem`, `privkey.pem` cùng symlink `archive`; `ACME_WEBROOT_DIR` là thư mục thử thách ACME trên host. Gia hạn chứng chỉ bằng Certbot của host và `docker compose ... exec web nginx -s reload`.
3. Sao chép `infra/.env.prod.example` thành tệp bí mật ngoài Git, điền domain, mật khẩu PostgreSQL ngẫu nhiên (chỉ dùng ký tự an toàn cho URL), JWT secret tối thiểu 32 ký tự, IP media, `SMTP_FROM` và một trong `RESEND_API_KEY` hoặc `SMTP_HOST`. Xác thực domain gửi bằng SPF, DKIM, DMARC tại nhà cung cấp email.

   Với Google, tạo OAuth client loại **Web application** trong Google Cloud Console, thêm `https://<domain>` vào **Authorized JavaScript origins**, rồi đặt client ID vào `GOOGLE_CLIENT_ID`. Docker Compose tự truyền cùng giá trị này vào bản build web qua `VITE_GOOGLE_CLIENT_ID`. Luồng đăng nhập hiện dùng ID Token nên không cần client secret; chỉ khai báo `GOOGLE_CLIENT_SECRET` nếu sau này bật luồng authorization code phía server. Khi chạy local, đặt cùng Web client ID vào `GOOGLE_CLIENT_ID` và `VITE_GOOGLE_CLIENT_ID` trong `.env`, đồng thời thêm `http://localhost:5173` vào danh sách origin được phép.

4. Tại thư mục dự án:

   ```sh
   docker compose -f infra/docker-compose.prod.yml --env-file /path/to/secrets.env build
   docker compose -f infra/docker-compose.prod.yml --env-file /path/to/secrets.env up -d postgres
   docker compose -f infra/docker-compose.prod.yml --env-file /path/to/secrets.env run --rm api node dist/api/scripts/migrate.js
   docker compose -f infra/docker-compose.prod.yml --env-file /path/to/secrets.env up -d api web
   ```

5. Kiểm tra `https://<domain>/health`, đăng ký bằng email thật và nhận OTP, đăng nhập, xác nhận vai trò theo nhóm, nhắn tin, rồi thử cuộc gọi từ ít nhất hai mạng/thiết bị khác nhau. Kiểm tra cổng UDP khi media không kết nối. `docker compose ... logs api web` giúp đọc lỗi mà không tiết lộ OTP.

API và PostgreSQL chỉ nằm trong mạng Docker nội bộ; Nginx công khai80/443 và dải media40000–40099 được publish trực tiếp. Compose này triển khai một API/SFU; healthcheck `/ready` yêu cầu DB đã migrate020 và web chờAPIhealthy. `/health` chỉ liveness. Sao lưuDB/objectstorage/chứng chỉ riêng trước nâng cấp.

Các cấu hình mới (pool/worker/TURN/quota/storage/metrics) có trong `infra/.env.prod.example` và được truyền qua Compose. OPERATIONS_TOKEN là bí mật server, không dùng JWT người dùng; không đưa AWS/TURN/JWT vàoVITE_*. FILE_STORAGE_PROVIDER=db giữ tệpbytea cũ; bậtS3 theo [17](17-backend-va-van-hanh.md) khi đã có bucketprivate và kiểm chứngcloud.

NhiềuAPI: cấu hình deployment/loadbalancer riêng, SOCKET_ADAPTER=postgres, prefix/DB giống nhau, API_INSTANCE_ID khác nhau và SFU_PUBLIC_URLHTTPS cho từngnode truy cập được từclient. VITE_SFU_URL có thể chọnnodekhởi tạo; frontend media-location định tuyến roomhiệncó tớiowner, trong khi chatsocket giữAPIendpoint. WebSocket không cầnsticky; nếu dùngHTTPpolling cầnsticky. Mộtroom vẫn trênmộtworker/node, không chia sẻmediasouptransport bằngadapter. Lease45s/heartbeat15s xử lýnodechết; chưa nghiệmthuTLS/routing đaendpoint ngoàiLAN.

Xem [bàn giao21](21-ban-giao-va-demo.md) để chạy gate và các điều kiện cònchưa kiểm. Chưa triển khai máy chủproduction hoặc nghiệmthuRTP/TURN/email thật trong phiên phát triển này.
