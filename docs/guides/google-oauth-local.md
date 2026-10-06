# Sửa Google Sign-In: origin_mismatch

## Chẩn đoán ngày 04/10/2026

Ảnh báo `400: origin_mismatch` từ Google. Người dùng xác nhận mở web ở `http://localhost:5176`, trong khi `.env` trước sửa dùng `WEB_ORIGIN=http://localhost:5173`. Hai biến `GOOGLE_CLIENT_ID` và `VITE_GOOGLE_CLIENT_ID` đều có giá trị và trùng nhau. Đã đổi `WEB_ORIGIN` local thành `http://localhost:5176`; Vite lấy cổng từ giá trị đó và không tự đổi cổng. Chưa truy cập Google Cloud Console để kiểm danh sách origin; chưa xác nhận đăng nhập Google thành công.

Frontend dùng Google Identity Services `accounts.id.initialize` với callback credential ở `apps/web/src/features/auth/LoginPage.tsx`. API xác minh ID token với audience là `GOOGLE_CLIENT_ID` ở `services/api/src/modules/auth/google.ts`.

Kiểm tra bổ sung sau ảnh lỗi thứ hai: module LoginPage được Vite phục vụ ở cổng 5176 chứa client ID trùng `.env`, có SDK Google đúng URL. Preflight `OPTIONS /auth/google` với Origin `http://localhost:5176` trả 204 và `Access-Control-Allow-Origin: http://localhost:5176`. Cấu hình local đang khớp; chưa có bằng chứng cho danh sách origin trên Google Cloud. Đã đề nghị người dùng gửi phần Authorized JavaScript origins của đúng client đang dùng, che client secret.

## Cấu hình cần thực hiện trong Google Cloud

1. Mở [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), chọn đúng project và client có ID trùng `VITE_GOOGLE_CLIENT_ID` trong `.env` gốc.
2. Client cần có loại **Web application**.
3. Trong **Authorized JavaScript origins**, thêm:

   ```text
   http://localhost
   http://localhost:5176
   ```

4. Origin gồm giao thức, hostname và port; không thêm `/app`, `/auth/google`, query hoặc dấu `/` cuối. Nếu đang dùng địa chỉ khác, đăng ký đúng origin đó. `localhost` và `127.0.0.1` là hai hostname khác nhau; dùng thống nhất URL đã đăng ký. Production dùng origin HTTPS thực của web.
5. Lưu và đợi cấu hình có hiệu lực, đóng popup lỗi rồi thử lại từ trang web.

Theo [hướng dẫn Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), local cần khai báo cả localhost và localhost kèm port. Luồng credential callback hiện tại không yêu cầu thêm một redirect endpoint. [Google mô tả origin_mismatch](https://support.google.com/cloud/answer/15549257?hl=en) khi JavaScript origin chưa đăng ký cho client.

## Chạy và kiểm tra lại

Khởi động lại API để nạp `WEB_ORIGIN` mới; khởi động lại web nếu phiên dev đã dừng. Mở web tại `http://localhost:5176`. Vite đã bật `strictPort: true`: cổng bận sẽ báo lỗi thay vì tự chuyển sang cổng khác làm lệch OAuth origin. Không mở thêm nhiều phiên dev cho cùng web.

```powershell
npm run dev:api
# Terminal thứ hai:
npm run dev:web
```

`.env.example` vẫn dùng mặc định 5173 cho cài đặt mới. Khi dùng origin đó, cần đăng ký `http://localhost:5173` trong Google Cloud. Danh sách origin phải khớp địa chỉ thực của từng môi trường.

Nếu sửa client ID trong `.env`, giữ hai biến dưới đây cùng giá trị và khởi động lại API/web. Không đưa client secret vào biến `VITE_*`.

```dotenv
GOOGLE_CLIENT_ID=<Web application client ID>
VITE_GOOGLE_CLIENT_ID=<cùng Web application client ID>
```

Sau khi lưu cấu hình Google, tải lại trang, bấm Google Sign-In và hoàn tất bằng tài khoản của mình. Thành công là popup đóng, API chấp nhận credential và web vào workspace hoặc bước OTP theo chính sách hiện tại. Nếu vẫn lỗi, ghi origin thực trên thanh địa chỉ, đối chiếu client ID của project và gửi phần “chi tiết về lỗi” đã che dữ liệu cá nhân; không gửi token hoặc secret.

Thay đổi `strictPort` chỉ ngăn lệch cổng local. Việc cho phép origin trên Google Cloud vẫn cần chủ project thực hiện; không có thay đổi local nào thay thế bước này.
