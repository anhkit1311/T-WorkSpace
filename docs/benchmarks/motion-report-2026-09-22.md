# Báo cáo tối ưu chuyển động — 2026-09-22

## Phạm vi và vấn đề ban đầu

Rà soát mã nguồn phát hiện các chuyển động gây layout hoặc paint liên tục: đóng/mở sidebar bằng `grid-template-columns` và `width`, skeleton chạy `background-position`, trạng thái chờ chạy `box-shadow`, thanh âm lượng chạy `height`, nhiều khai báo `transition: all`, và lớp blur phủ lên video trực tiếp.

Không có trace hợp lệ được lưu trước khi sửa, nên báo cáo không dựng số liệu “trước” từ ước lượng. Đây là baseline định tính từ mã nguồn. Dữ liệu bên dưới chỉ là phép đo sau tối ưu.

## Thay đổi

- Chuyển các hiệu ứng lặp sang `transform` và `opacity`.
- Cập nhật sidebar tức thời để tránh reflow toàn bộ app shell trong từng khung hình.
- Giới hạn transition vào đúng thuộc tính; bỏ nội suy shadow.
- Bỏ blur trên lớp phủ video và trên thiết bị cảm ứng/màn hình nhỏ.
- Rút thời lượng phản hồi về 120–220 ms và bỏ animation vào trang bị lặp.
- Toast dùng tween ngắn và chỉ chạy layout theo vị trí.
- Tôn trọng `prefers-reduced-motion`; phản hồi trạng thái vẫn giữ qua màu, nội dung và focus.
- Dùng bộ đo production tạm thời để thu dữ liệu, sau đó loại khỏi bundle khi hoàn tất rà soát.

## Phương pháp

- Build production bằng Vite, chạy qua preview tại localhost.
- Desktop: 1440 × 900. Mobile: 390 × 844.
- Chrome/Chromium 153 trên Windows 10 64-bit, DPR 1.
- Đo khoảng cách giữa các `requestAnimationFrame`, p95/max frame time, số khung vượt 19,17 ms, số khung 60 Hz bị lỡ ước tính và Long Tasks.
- Máy thử bật `prefers-reduced-motion`. Bài card vẫn chủ động chạy transform/opacity đại diện; chuyển trang của sản phẩm dùng nhánh giảm chuyển động.

## Kết quả sau tối ưu

| Thiết bị | Kịch bản            | FPS quan sát | Frame TB / p95 / max   | Khung vượt ngân sách | Khung lỡ ước tính | Long task |
| -------- | ------------------- | -----------: | ---------------------- | -------------------: | ----------------: | --------: |
| Desktop  | Card xuất hiện      |       190,00 | 5,26 / 5,10 / 40,10 ms |                    1 |                 2 |         0 |
| Desktop  | Cuộn mượt           |       197,51 | 5,06 / 5,10 / 15,00 ms |                    0 |                 0 |         0 |
| Desktop  | Landing → đăng nhập |       195,00 | 5,13 / 5,10 / 15,00 ms |                    0 |                 0 |         0 |
| Mobile   | Card xuất hiện      |       194,98 | 5,13 / 5,10 / 14,90 ms |                    0 |                 0 |         0 |
| Mobile   | Cuộn mượt           |       199,15 | 5,02 / 5,10 / 9,90 ms  |                    0 |                 0 |         0 |
| Mobile   | Landing → đăng nhập |       200,00 | 5,00 / 5,10 / 5,20 ms  |                    0 |                 0 |         0 |

Máy thử phát `requestAnimationFrame` gần 200 Hz. Vì vậy, frame time và số khung vượt ngân sách 60 Hz là chỉ số chính. Desktop có một spike 40,1 ms khi chạy card, nhưng p95 là 5,1 ms và không có long task. Mobile không có khung vượt ngân sách trong ba kịch bản và không bị tràn ngang.

## Giới hạn nghiệm thu

- Chưa có số đo trước thay đổi để lập chênh lệch định lượng trung thực.
- Chưa đo thực nghiệm chuyển động trong chat đã xác thực và cuộc họp nhiều camera thật ở lần chạy này.
- Kết quả xác nhận mục tiêu 60 FPS trên môi trường đã nêu; không phải cam kết cho mọi thiết bị.

Dữ liệu gốc: `docs/benchmarks/motion-results-2026-09-22.json`.

## Điều chỉnh nhịp chậm hơn

Theo yêu cầu tiếp theo, chuyển trang được tăng lên 460 ms; các khối chính của landing, đăng nhập và trang chủ dùng nhịp 520–680 ms với easing `cubic-bezier(0.16, 1, 0.3, 1)`. Nút và điều khiển thường xuyên vẫn giữ phản hồi nhanh.

Lượt warm cache mới không ghi nhận frame vượt ngân sách 60 Hz hay long task trên desktop 1440 × 900 và mobile 390 × 844. Lượt cold load desktop có một frame 49,9 ms và một long task khi khởi tạo; p95 vẫn là 5,1 ms. Dữ liệu gốc của lần chỉnh này nằm tại `docs/benchmarks/motion-results-2026-09-22-slow.json`.

## Hoàn thiện chuyển cảnh

Chuyển màn hình nay có cả pha thoát và pha vào chồng nhẹ bằng `AnimatePresence`. Landing reveal từng section khi đi vào vùng nhìn; hero và các thẻ trang chủ dùng stagger; đăng nhập crossfade khi đổi đăng nhập, đăng ký và OTP.

Lượt đo lặp trên desktop và lượt mobile không ghi nhận frame vượt ngân sách 60 Hz, frame lỡ hoặc long task. Lượt desktop đầu tiên có một frame 20 ms; lượt lặp có max 10 ms hoặc thấp hơn ở các luồng cuộn và đổi sang đăng nhập. Dữ liệu gốc nằm tại `docs/benchmarks/motion-results-2026-09-22-polished.json`.
