# Rà soát và nghiệm thu — 14/09/2026

## Kết luận

Dự án có nền tảng React/TypeScript, PostgreSQL, Socket.IO và mediasoup phù hợp phạm vi trong `01-phan-tich.md`. Bản trước có lỗi phân quyền và nhiều luồng dùng dữ liệu mô phỏng. Các sửa đổi dưới đây đã được thực hiện; chưa thể xem đây là bằng chứng nghiệm thu hoàn chỉnh hội nghị ba máy và kiểm thử tải.

## Các thay đổi

- Kiểm tra JWT và quyền thành viên trước khi vào kênh, gửi tin, typing hoặc thao tác SFU. Người bị loại khỏi nhóm bị ngắt socket để không tiếp tục nhận tin/media.
- Presence giới hạn trong workspace chung, kể cả tài khoản chưa thuộc nhóm nào.
- Token sai trả HTTP 401, UUID sai trả 400; cookie không hợp lệ không làm lỗi logout.
- Lịch sử chat lấy 50 tin mới nhất rồi hiển thị theo thứ tự thời gian; chỉ mục hỗ trợ truy vấn này.
- Tham gia nhóm demo chỉ dùng workspace demo đã định danh, không tự chọn nhóm riêng được tạo đầu tiên; không ghi đè owner/admin thành member.
- Chủ nhóm không bị loại/rời nhóm. Migration 003 khôi phục membership owner bị phiên bản cũ ghi đè.
- Nhóm mới có kênh văn bản và video. Slug không vượt giới hạn database khi tên dài.
- Màn hình chat thật ở `LiveChatPage.tsx`: chọn nhóm, tạo nhóm, xem/thêm/loại thành viên qua API, nhận tin realtime, xác nhận gửi, báo lỗi và trạng thái trống.
- Trang chủ và danh sách phòng họp lấy nhóm/kênh từ API. Loại bỏ vai trò tự chuyển trên trang chủ và quyền demo trong luồng họp.
- Thêm API cập nhật tên hiển thị và lịch sử tham gia hội nghị; bảng `meeting_participations` lưu vào/rời phòng.
- SFU dùng chung tác vụ tạo worker/router khi có người vào đồng thời; giới hạn hai transport đã tạo cho mỗi peer. Kiểm tra quyền sở hữu producer khi đóng.
- Sửa producer/consumer cleanup, dừng chia sẻ từ trình duyệt, camera preview kết thúc muộn, âm thanh bị phát trùng và dọn media khi mất kết nối.
- Refresh phiên được gộp để tránh xoay cookie hai lần trong React StrictMode; token mới được cập nhật lên socket mà không chủ động ngắt cuộc họp.
- Chat trong cuộc họp dùng socket và lưu DB. Cập nhật hồ sơ chỉ báo thành công sau khi API lưu xong.
- QoS không sinh số ngẫu nhiên; bitrate dựa trên chênh lệch byte/thời gian, packet loss là phần trăm từ bộ đếm inbound RTP. Biểu đồ không chèn dữ liệu mẫu khi chưa đo.
- Sửa CSS mobile để theme không ép thanh bên desktop; cải thiện nhãn form, focus và trạng thái lỗi của chat.
- Bỏ các tuyên bố chứng nhận/SLA và dữ liệu lịch sử họp không có bằng chứng trên các phần đã rà soát. Ghi hình thông báo chưa hỗ trợ thay vì báo đang ghi giả.

## Kiểm thử có thể chạy lại

Kết quả lượt kiểm tra mã nguồn cuối: TypeScript, lint, Prettier và production build đều qua; 8 bài unit/HTTP qua, 1 bài integration được bỏ qua theo cấu hình mặc định. Vite còn cảnh báo bundle JavaScript khoảng 734 kB trước gzip. Docker Desktop đã được mở lại nhưng lệnh khởi động container chưa hoàn tất tại thời điểm bàn giao; lượt integration cuối gặp `ECONNREFUSED`. Không ghi nhận lượt SFU ba client là đạt khi chưa có kết quả.

```sh
npm run db:up
npm run db:migrate
npm run typecheck
npm run lint
npm run build
npm test
npm run test:integration
npm run test:sfu
```

`npm test` chạy unit/HTTP và bỏ qua bài integration khi không bật `RUN_DB_TESTS`. Hai lệnh cuối dùng database cấu hình trong `.env`, tạo dữ liệu test có UUID riêng và dọn đúng các bản ghi đó. Cần Docker/PostgreSQL đang hoạt động. Không dùng database production để chạy test.

Các lượt kiểm thử trước gián đoạn đã xác minh: băm mật khẩu/token; HTTP lỗi; bảo vệ owner; lịch sử mới nhất; gửi/nhận giữa hai socket; từ chối tài khoản ngoài nhóm; cô lập presence; thu hồi thành viên; hai client SFU vào đồng thời, tạo transport và lưu thời điểm rời phòng. Bài test SFU sau đó được mở rộng thành ba client; cần lấy kết quả lượt chạy mới nhất, không suy diễn từ lần chạy hai client.

Giao diện desktop đã mở bằng trình duyệt và đọc được tin nhắn thật. Kiểm tra mobile phát hiện thanh bên ép nội dung; đã thêm `responsive-fixes.css`. Kết quả này không thay thế một lượt xác minh bố cục mobile sau sửa.

## Điều kiện còn thiếu trước khi bảo vệ

1. Thử ba trình duyệt/thiết bị có audio/video thật: nghe/nhìn lẫn nhau, mute, camera, chia sẻ màn hình, đổi người chia sẻ, mất mạng và tham gia lại. Test signaling không chứng minh RTP đã truyền thành công.
2. Đo tải chat và media với số người/thời lượng xác định; lưu CSV/JSON gốc, cấu hình máy và mạng, CPU/RAM, timestamp. Không dùng bảng số liệu mẫu làm thực nghiệm.
3. Chạy lại toàn bộ test sau cùng khi PostgreSQL/Docker sẵn sàng. Sau các gián đoạn, lượt cuối từng gặp `ECONNREFUSED` do dịch vụ DB dừng, không phải kết quả pass.
4. Kiểm tra LAN/Internet với HTTPS, địa chỉ mediasoup được công bố đúng và UDP/TCP thích hợp. Hiện cấu hình local dùng loopback.
5. Lập lịch họp, ghi hình, SSO, quên mật khẩu, file sharing và audit log nâng cao chưa được nghiệm thu; không trình bày các giao diện phác thảo như chức năng đã hoàn thiện.
6. Lịch sử chat hiện chỉ nạp 50 tin gần nhất; phân trang lịch sử cũ hơn chưa có giao diện. QoS chỉ giữ 60 mẫu gần nhất trong trình duyệt và chưa lưu số đo vào DB.
7. Bổ sung báo cáo theo mẫu của khoa: use case, ERD, sequence chat/SFU, mô hình phân quyền, mô tả giao thức, bảng test case, kết quả đo thật, hạn chế và hướng phát triển. Chưa có mẫu chấm điểm của khoa trong lần rà soát này.

## Triển khai và dữ liệu

Không xóa dữ liệu người dùng. Migration 002 thêm bảng/index/kênh họp thiếu; migration 003 sửa role đúng theo `workspaces.owner_id`. Không chỉnh migration 001 đã áp dụng. Thư mục hiện không có Git repository nên không có commit/diff Git để bàn giao.
