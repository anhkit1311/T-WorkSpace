# 7. Hướng dẫn Cài đặt, Vận hành và Kịch bản Báo cáo Đồ án

Cập nhật 01/10/2026: [bàn giao21](21-ban-giao-va-demo.md) là hướng dẫn hiện tại cho env,20migration, test, restore và demo. Dùng .env.example/infra/.env.prod.example đầy đủ; các đoạn dưới giữ bối cảnh hướng dẫn trước đây.

Tài liệu này cung cấp chỉ dẫn từng bước để cài đặt, khởi chạy hệ thống trên máy tính cá nhân hoặc máy chủ, kèm theo **Kịch bản thuyết trình demo mẫu** tối ưu khi bảo vệ trước Hội đồng chấm Đồ án tốt nghiệp.

---

## 7.1. Yêu cầu Môi trường

- **Hệ điều hành:** Windows 10/11, macOS, hoặc Linux (Ubuntu 22.04+).
- **Node.js:** Phiên bản22 (đã kiểm22.19.0; frontend unit dùng experimental strip types).
- **Docker & Docker Compose:** Dùng để chạy dịch vụ CSDL PostgreSQL.
- **Trình duyệt web:** Google Chrome, Microsoft Edge, Brave hoặc Mozilla Firefox phiên bản mới nhất (có hỗ trợ WebRTC & getUserMedia).

---

## 7.2. Cấu hình Môi trường (`.env`)

Tạo hoặc kiểm tra file `.env` tại thư mục gốc của dự án (`d:/DoAnTotNghiep/.env`):

```env
# Cổng và Domain
API_PORT=3001
WEB_ORIGIN=http://localhost:5173

# Xác thực bảo mật JWT
JWT_SECRET=replace-with-at-least-32-random-characters
ACCESS_TOKEN_TTL=15m

# Kết nối CSDL PostgreSQL (Docker)
DATABASE_URL=postgres://workspace:workspace@localhost:5432/realtime_workspace

# Gửi mã xác thực qua Resend hoặc SMTP
RESEND_API_KEY=replace-with-real-provider-key
SMTP_FROM="CollabSpace <no-reply@example.com>"

# Cấu hình Mediasoup SFU
# Khi test trên cùng 1 máy: dùng 127.0.0.1
# Khi test qua mạng Wi-Fi/LAN giữa 2 máy: nhập IP LAN (ví dụ: 192.168.1.15)
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
```

---

## 7.3. Các Bước Khởi chạy Hệ thống

### Bước 1: Khởi động CSDL PostgreSQL qua Docker

Mở Terminal và chạy:

```bash
docker compose -f infra/docker-compose.yml up -d
```

_Kiểm tra trạng thái:_ Container `postgres` sẽ chạy ở cổng `5432`.

### Bước 2: Cập nhật Schema CSDL

```bash
# Chạy migration tạo các bảng dữ liệu
npm run db:migrate

```

Cấu hình dịch vụ gửi email trước khi đăng ký tài khoản. Tài khoản đầu tiên có thể tự tạo nhóm làm việc; người tạo nhóm có vai trò `Owner`.

### Bước 3: Khởi chạy Máy chủ Backend API & Mediasoup SFU

Mở **Terminal 1**:

```bash
npm run dev:api
```

_Kết quả:_ API lắng nghe tại `http://localhost:3001`; Mediasoup Worker khởi tạo khi người dùng vào phòng họp.

### Bước 4: Khởi chạy Giao diện Frontend Web

Mở **Terminal 2**:

```bash
npm run dev:web
```

_Kết quả:_ Giao diện ứng dụng sẵn sàng tại `http://localhost:5173`.

---

## 7.4. Kịch bản Thuyết trình Demo Chuẩn khi Bảo vệ Đồ án

Khi trình bày trước Thầy Hướng dẫn (Thầy Phù Trần Tín) và Hội đồng chấm tốt nghiệp, sinh viên có thể thực hiện theo 4 kịch bản mạch lạc sau:

### Kịch bản 1: Đăng nhập & An toàn Thông tin (Auth & Security)

1. Mở trình duyệt `http://localhost:5173`, giới thiệu màn hình Đăng nhập hiện đại.
2. Đăng ký và xác thực tài khoản qua email thật, sau đó đăng nhập.
3. Nhấn **F12 (DevTools)**:
   - Chỉ ra `accessToken` được lưu trữ an toàn trong bộ nhớ ứng dụng.
   - Chỉ ra `refreshToken` được lưu trữ trong Cookie `HttpOnly` với cờ `SameSite=Lax`, ngăn chặn hoàn toàn tấn công XSS trộm phiên.

### Kịch bản 2: Không gian làm việc cộng tác thời gian thực (Real-time Core)

1. Mở song song 2 trình duyệt:
   - Trình duyệt 1: Tài khoản `Võ Anh Kiệt`.
   - Trình duyệt 2 (Tab Ẩn danh): Đăng ký tài khoản mới `Nguyễn Văn A`.
2. Cả hai cùng truy cập mục **Tin nhắn (Chat)**, chọn kênh `#tong-quan`.
3. Trình duyệt 2 gõ phím -> Trình duyệt 1 hiển thị chỉ báo thời gian thực: _"Nguyễn Văn A đang nhập..."_.
4. Gửi tin nhắn -> Tin nhắn xuất hiện tức thì ở cả hai bên không cần tải lại trang.
5. F5 tải lại trang -> Toàn bộ lịch sử tin nhắn vẫn nguyên vẹn nhờ lưu trữ bền vững trong PostgreSQL.

### Kịch bản 3: Hội nghị truyền hình đa điểm WebRTC SFU (Video Conference)

1. Cả 2 trình duyệt cùng chuyển sang menu **Hội nghị (Meetings)**.
2. Giới thiệu màn hình **Sảnh chờ (Lobby)**: Xem trước camera, kiểm tra âm lượng micro, chọn mã phòng họp `phong-hop-chinh`.
3. Bấm **Tham gia ngay**:
   - Trình duyệt bật camera và kết nối tới Mediasoup SFU Server.
   - Hình ảnh và âm thanh của 2 bên lập tức hiển thị trên lưới video động (`video-grid`).
4. Thử nghiệm các thao tác điều khiển:
   - Bấm **Tắt/bật Micro** -> Biểu tượng đổi trạng thái và âm thanh dừng ngay lập tức.
   - Bấm **Tắt/bật Camera** -> Hiển thị avatar đại diện khi tắt camera.
   - Bấm **Chia sẻ màn hình** -> Cửa sổ máy tính hiển thị nổi bật trên sân khấu lớn với độ nét cao 1080p.

### Kịch bản 4: Đo kiểm chất lượng mạng QoS thời gian thực & Xuất dữ liệu

1. Nhấn vào **Huy hiệu QoS** trên thanh tiêu đề phòng họp (ví dụ: `RTT: 22ms · 960 kbps · Loss: 0% 📊 Chi tiết`).
2. Giới thiệu trước Hội đồng:
   - **Biểu đồ sóng thời gian thực (SVG Sparkline):** Đường biến thiên RTT và Bitrate theo từng giây.
   - Giải thích cơ chế tiết kiệm đến **80% băng thông upload** nhờ mô hình SFU so với Full Mesh.
3. Bấm nút **"Xuất dữ liệu CSV"**:
   - File `webrtc-qos-phong-hop-chinh-xxxx.csv` tự động tải về máy tính.
   - Mở file CSV để chứng minh số liệu đo kiểm thực tế: từng dòng gồm Timestamp, RTT (ms), Bitrate (kbps), Jitter (ms), Packet Loss (%).

---

## 7.5. Lệnh Kiểm tra Chất lượng Mã nguồn trước khi Đóng gói

```bash
# 1. Kiểm tra kiểu TypeScript toàn bộ monorepo (shared, api, web)
npm run typecheck

# 2. Chạy bộ kiểm thử tự động
npm test

# 3. Quét lỗi chuẩn mã nguồn ESLint
npm run lint

# 4. Định dạng mã nguồn chuẩn Prettier
npm run format

# 5. Build bản phân phối Production hoàn chỉnh
npm run build
```
