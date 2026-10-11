# nexo — Rà soát UX/UI, hướng nâng cấp motion & prompt triển khai

> Ngày rà soát: 2026-10-04 · Phạm vi: `apps/web` (React 19 + Motion + GSAP + three.js)
> Nguồn chuẩn thiết kế: [design-system/realtime-workspace/MASTER.md](../design-system/realtime-workspace/MASTER.md)

## 0. Phương pháp và giới hạn (đọc trước)

| Nhãn | Nghĩa |
| ---- | ----- |
| **[Chạy thật]** | Đã mở trang landing/đăng nhập trong trình duyệt và đo trực tiếp (DOM, kích thước, ARIA). |
| **[Đọc code]** | Xác nhận bằng cách đọc mã nguồn và grep toàn bộ `apps/web/src`. Hành vi là hệ quả chắc chắn của code. |
| **[Rủi ro]** | Có dấu hiệu trong code nhưng cần chạy thật để chốt. |

**Giới hạn:** Docker/PostgreSQL/API không chạy trong phiên rà soát, nên **không đăng nhập được**. Các màn hình sau đăng nhập (Trang chủ, Nhóm, Chat, Họp, Công việc, Hồ sơ, Quản trị) được rà bằng đọc code + CSS, chưa xem trực quan. Nên chạy lại `npm run db:up && npm run dev:api` để xác minh các mục [Đọc code]/[Rủi ro] bằng mắt trước khi sửa hàng loạt.

Số liệu toàn cục (grep): `!important` **1.812** lần · `outline: none/0` **59** lần · `transition: all` **37** lần · `font-size` 9–11px **105** lần · `backdrop-filter` **108** lần (MASTER.md quy định tối đa 2 lớp blur chồng nhau) · chỉ **1** khối `prefers-reduced-motion` trong toàn bộ CSS.

---

## PHẦN 1 — LỖI UX/UI CẦN SỬA

### P0 — Lỗi thật, sửa ngay

| # | Lỗi | Bằng chứng | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|-----|------------|------|------|
| 1 | **Spinner của `<Button loading>` không quay.** Code gọi `animation: "spin 0.8s linear infinite"` nhưng **không có `@keyframes spin` ở bất kỳ file nào**. Mọi nút loading (tạo nhóm, gửi, lưu, rời nhóm…) chỉ hiện vòng tròn đứng yên → người dùng tưởng app treo. | `shared/ui/Primitives.tsx:74`, `features/auth/LoginPage.tsx:664`; grep `keyframes` không có `spin` | Đọc code | Đã sửa — keyframes chung, aria-busy, giữ chiều rộng nút. |
| 2 | **Nút "Gửi lại OTP" kẹt vĩnh viễn ở "Đang gửi…"** sau lần bấm đầu: `setResending(true)` nhưng `finally` lại gọi `setLoading(false)`, không có `setResending(false)` ở đâu cả. Không thể gửi lại OTP lần 2. | `features/auth/LoginPage.tsx:319` và `:329` | Đọc code | Đã sửa — finally reset resending; test thành công/lỗi/lần gửi thứ hai. SMTP/cooldown thật chưa kiểm. |
| 3 | **Hành động phá hủy không xác nhận:** (a) "Rời khỏi nhóm" trong menu header nhóm chạy thẳng, trong khi Trang chủ cùng thao tác có Modal xác nhận; (b) Họp: "Loại khỏi phiên", "Chuyển host", "Tắt nguồn mic" chạy ngay; (c) Công việc: "Lưu trữ nhiệm vụ", "Bỏ mục", "Gỡ tệp" không xác nhận/không hoàn tác. Chỉ "Kết thúc cho tất cả" có xác nhận → 3 kiểu xác nhận khác nhau (Modal / inline 2 bước / không có). | `WorkspaceShell.tsx:828-838` vs `WorkspaceHomePage.tsx:405-443`; `MeetingControls.tsx:199-236`; `TaskBoardPage.tsx:799-806, 846-855, 936-943` | Đọc code | Đã sửa — ConfirmDialog cho rời nhóm, điều hành họp, checklist/tệp/lưu trữ và hủy lịch; giữ modal Trang chủ hiện có theo khóa DOM. |
| 3b | **Chuyển host một chạm** là thao tác không thể tự đảo ngược. | `MeetingControls.tsx:217-224` | Đọc code | Đã sửa — xác nhận hậu quả, focus mặc định Hủy. |
| 4 | **Thanh điều khiển cuộc họp không dính (sticky) vào viewport.** Dock nằm trong dòng chảy trang (`margin: 20px auto 0`, không `position: sticky/fixed`) dưới: header + panel host + toolbar + lưới video cao tới 820px. Trên laptop 768px cao, muốn tắt mic phải cuộn xuống. Đây là lỗi UX nặng nhất của màn Họp. | `meeting-ui.css:579-593`, `MeetingPage.tsx:1503`; grep `sticky|fixed` trong 3 file CSS họp = 0 | Đọc code | Hoãn — sticky/đổi vị trí dock và panel vi phạm khóa bố cục; đề xuất cần duyệt. |
| 5 | **Menu hành động tin nhắn chỉ hiện khi `:hover`** (`display:none` → `display:flex`): (a) người dùng bàn phím không thể tới Trả lời/Sửa/Ghim/Xóa (display:none loại khỏi tab order, không có `:focus-within`); (b) bật/tắt `display` làm **chiều cao tin nhắn nhảy** mỗi lần rê chuột — vi phạm điều cấm "layout-shifting hover effects" của MASTER.md. | `chat-live.css:877-886`, `LiveChatPage.tsx:1700-1767` | Đọc code | Đã sửa — opacity/visibility, focus-within, keyboard; chiều cao đo được giữ 96,5px. |
| 6 | **Form đăng nhập: label không gắn với input.** `<label>` là anh em của `<div><input></div>`, không có `htmlFor`/lồng nhau; input không có `id`/`name`. Đo thực tế: `input.labels.length = 0` cho cả email và mật khẩu → screen reader đọc "ô nhập" không tên, bấm vào label không focus được, trình quản lý mật khẩu khó tự điền. Lỗi hợp lệ hiện nhưng không `aria-invalid`, không `aria-describedby`, không `role=alert`, và **focus không nhảy tới ô lỗi đầu tiên**. | `LoginPage.tsx:456, 479, 508, 732, 751, 767` | **Chạy thật** | Đã sửa — id/name/autocomplete/label, lỗi ARIA, focus ô lỗi và xóa lỗi khi gõ. |
| 7 | **Nút ẩn/hiện mật khẩu chỉ 16×16px**, "Quên mật khẩu?" cao 20px, link nav landing cao 22px (WCAG 2.2 tối thiểu 24×24, khuyến nghị 44). Rất khó bấm trên điện thoại. | Đo bằng `getBoundingClientRect` | **Chạy thật** | Đã sửa — vùng chạm 40px bằng pseudo-element, không đổi kích thước hiển thị. |
| 8 | **Toast biến mất sau cố định 3,6s** cho mọi loại (kể cả lỗi "Không thể thêm thành viên…"), không nút đóng, không tạm dừng khi rê chuột/focus, không `role=alert` cho lỗi, icon cảnh báo dùng chung icon "info". Người đọc chậm/screen reader sẽ bỏ lỡ lỗi (WCAG 2.2.1). | `AppContext.tsx:155-158`, `Primitives.tsx:274-301` | Đọc code | Đã sửa — thời lượng theo loại, tối đa 3, đóng/pause khi focus hoặc hover; giữ tắt lời chào đăng nhập. |
| 9 | **Focus ring navy `#263450` trên dock họp nền đen** (`rgba(0,0,0,.9)`) → độ tương phản ≈ 1,7:1, gần như vô hình. Vòng focus của workspace (`.editorial-workspace-shell …:focus-visible`, `!important`) luôn là navy bất kể nền; ngoài shell chỉ còn `:focus-visible` mặc định ở `styles.css:221`, và 59 chỗ `outline:none/0` (đa số kèm `!important`) khiến nhiều control không có ring riêng. | `editorial-workspace.css:934`, `meeting-ui.css` (`.meeting-dock-btn`) | Đọc code | Đã sửa — focus-visible toàn cục hai lớp navy/trắng; kiểm bằng bàn phím. |
| 10 | **Video nền tải từ host bên thứ ba** (`designerstephen.github.io`), không có `poster`, không có fallback tải được. Nếu host chết/chậm → mất toàn bộ khung cảnh thương hiệu; đồ án demo/bảo vệ phụ thuộc mạng ngoài. | `shared/motion/AmbientBackdrop.tsx:6` | Đọc code | Đã sửa một phần / Hoãn asset — preload metadata, dừng khi reduced motion/Save-Data/họp/ẩn tab; gradient sẵn có. Chủ dự án cần cung cấp WebM/MP4/poster có quyền sử dụng. |

### P1 — Ảnh hưởng rõ tới trải nghiệm

**Nhất quán & kiến trúc thông tin**

| # | Vấn đề | Chi tiết | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|------|
| 11 | Trùng lặp lối vào cùng một chức năng | Tạo nhóm: 3 nút ở Trang chủ (hero, đầu danh sách, empty state) + 1 ở Shell. Họp video: header nhóm, header chat, panel thông tin chat, card nhóm, dock. Ghim/tắt tiếng kênh: header chat **và** panel thông tin. Tìm kiếm: Ctrl+K, header chat, panel thông tin. | Đọc code | Hoãn — bỏ lối vào hoặc đổi thứ tự/khối vi phạm khóa giao diện. |
| 12 | Hai modal "Tạo nhóm" khác nhau | Trang chủ: có `AnimatePresence`, validate ≥2 ký tự, hiện lỗi inline, input kiểu editorial. Shell: không `AnimatePresence` (mất animation đóng), không hiện lỗi, input trần. | `WorkspaceHomePage.tsx:445-509` vs `WorkspaceShell.tsx:965-1011` | Đọc code | Đã sửa — component chung mỏng, validation >=2, lỗi inline, AnimatePresence; giữ nguyên hai cách trình bày đã chốt. |
| 13 | Modal không có animation thoát | `Modal` có `exit` nhưng nhiều nơi render có điều kiện không bọc `AnimatePresence` → đóng đột ngột. | `WorkspaceShell.tsx:965/1014/1054`, `WorkspaceHomePage.tsx:405`, `LiveChatPage.tsx:2238` | Đọc code | Đã sửa — bọc AnimatePresence các vị trí đã liệt kê; overlay đang thoát không chặn click/focus. |
| 14 | Card nhóm quá nhiều nút | Tối đa 5 nút mỗi card (Mở nhóm, Trao đổi, Họp video, Quản trị, Rời nhóm) + lưới kênh bên dưới; "Mở nhóm" và "Trao đổi" chồng chéo. Nhãn "SFU Video" là thuật ngữ kỹ thuật. | `WorkspaceHomePage.tsx:302-355, 389` | Đọc code | Hoãn — menu mới/bỏ nút/đổi nhãn bị khóa. |
| 15 | Số liệu "hư vinh" ở hero Trang chủ | 4 chip đếm nhóm/kênh/phòng/vai trò không dẫn tới hành động nào; trong khi việc cần làm nằm ngay bên dưới. | `WorkspaceHomePage.tsx:150-195` | Đọc code | Hoãn — bỏ/đổi chip nội dung bị khóa. |
| 16 | Thuật ngữ kỹ thuật lộ ra người dùng cuối | "WebRTC SFU" (badge phòng họp), "QoS Metrics", "Phiên 0a1b2c3d", "Mã tài khoản: <UUID>", "JWT & HttpOnly Session Cookie" trên form đăng nhập. | `MeetingPage.tsx:1316, 1572`, `MeetingControls.tsx:109`, `ProfilePage.tsx:461`, `LoginPage.tsx:831` | Đọc code/Chạy thật | Hoãn — nội dung chữ hiện tại được khóa. |
| 17 | Emoji/ký tự làm icon | "📎" trong tổng quan nhóm, "✓/✓✓" đọc/gửi trong chat (trái MASTER.md "Emojis as icons"). | `WorkspaceShell.tsx:1370`, `LiveChatPage.tsx:1687-1695` | Đọc code | Hoãn — icon đang hoạt động; khóa yêu cầu giữ nguyên. |

**Màn Họp**

| # | Vấn đề | Chi tiết | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|------|
| 18 | "Giơ tay" bị chôn trong `<details>` đóng sẵn | Hành động phổ biến trong cuộc họp nằm dưới "Người tham gia và điều hành" (chỉ tự mở khi ở phòng chờ). Dock không có giơ tay/phản ứng/cài đặt thiết bị. | `MeetingControls.tsx:114-126` | Đọc code | Đã sửa một phần — phím H và tooltip; đưa icon ra dock/tile cần duyệt. |
| 19 | Màn chia sẻ xếp chồng thay vì là sân khấu | Mỗi `.shared-screen` là khối riêng phía trên lưới; nhiều người chia sẻ → xếp dọc đẩy lưới video xuống. Không tự chuyển sang bố cục "tiêu điểm". | `MeetingPage.tsx:1328-1341`, `meeting-ui.css:550` | Đọc code | Hoãn — thay sân khấu/filmstrip đổi bố cục. |
| 20 | Panel "Người tham gia" nghèo nàn, tách khỏi panel điều hành | Panel phụ chỉ có tên + "Ghim"; trạng thái mic, giơ tay, vai trò, nút host nằm ở `<details>` khác dạng chuỗi chữ "Tên · Host · Chờ duyệt · Đang giơ tay · 2 tab" + tới 4 nút/dòng. | `MeetingPage.tsx:1426-1457`, `MeetingControls.tsx:175-241` | Đọc code | Hoãn — gộp danh sách/panel đổi thành phần và bố cục. |
| 21 | Chat trong họp: không badge tin mới khi panel đóng, không tự cuộn, không giờ | | `MeetingPage.tsx:1460-1495` | Đọc code | Đã sửa một phần — badge tin mới, chỉ theo cuộn khi gần đáy; thêm giờ cần duyệt nội dung. |
| 22 | Sảnh chờ: card phòng không cho biết đang có ai họp | Card chỉ hiện tên + badge vai trò nhóm (không liên quan khi chọn phòng) + dòng tĩnh "Có thể tham gia". Dùng `<h4>` bên trong `<button>`. | `MeetingPage.tsx:842-864` | Đọc code | Hoãn — API hiện không cung cấp occupancy của từng phòng; không bịa số người. |
| 23 | Không có phím tắt trong cuộc họp (M, V, S, H…) | grep `keydown` trong `MeetingPage.tsx` = 0. | Đọc code | Đã sửa — M/V/S/H/C/Esc có guard input/dialog/modifier/repeat; H/C/Esc kiểm thật, M/V/S chưa kiểm thiết bị. |
| 24 | Rời phòng một chạm; QoS card luôn chiếm chỗ | Nút đỏ "Rời phòng" cạnh nút mic; thẻ QoS dạng debug luôn hiển thị dưới dock. | `MeetingPage.tsx:1557-1604` | Đọc code | Đã sửa một phần — xác nhận host/chia sẻ khi rời; di chuyển QoS cần duyệt. |

**Màn Chat**

| # | Vấn đề | Chi tiết | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|------|
| 25 | Không có vạch "Tin nhắn mới" / nút "Xuống tin mới nhất" | grep `scrollToBottom|jump|atBottom|newMessage` = 0. | Đọc code | Hoãn — thêm vạch/nút nổi là thêm thành phần nhìn thấy. |
| 26 | Tin đang gửi hiện thành banner phía trên ô soạn, không phải bong bóng "đang gửi" trong luồng | Thiếu optimistic UI chuẩn. Typing indicator chỉ là chữ, không có dấu chấm động; vùng chiếm chỗ cố định. | `LiveChatPage.tsx:1778-1788, 1839-1888` | Đọc code | Hoãn — chuyển banner vào luồng/đổi typing thay bố cục và thành phần. |
| 27 | Trích dẫn trả lời sai khi tin gốc chỉ có tệp | `m.replyToContent || "Tin nhắn đã xóa"` → tin gốc là ảnh/tệp (content rỗng) bị hiển thị là "đã xóa". | `LiveChatPage.tsx:1553-1557` | Rủi ro | Đã sửa — phân biệt content rỗng với tin đã xóa; hiện Tệp đính kèm. |
| 28 | Banner tin ghim bấm vào không nhảy tới tin | Mở chế độ "Tin ghim" thay vì cuộn tới tin. Nút đính kèm/ghi âm/gửi chỉ có `title`, không có tooltip chạm. Không tải tin cũ theo cuộn (nút thủ công), không ảo hóa danh sách. | `LiveChatPage.tsx:1388-1408, 1466-1477, 1953-1982` | Đọc code | Đã sửa một phần — ghim mở context, IntersectionObserver tải cũ/giữ anchor và chống request cũ; tooltip mới/ảo hóa hoãn, lịch sử >50 tin chưa kiểm trực quan. |
| 29 | Nút kênh bị `disabled` khi `busy` → cả danh sách kênh mờ đi mỗi lần thao tác | | `LiveChatPage.tsx:1231` | Đọc code | Đã sửa — bỏ disabled toàn bộ kênh khi busy. |

**Màn Công việc (Kanban)**

| # | Vấn đề | Chi tiết | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|------|
| 30 | Tạo nhiệm vụ xong **tự mở panel chi tiết** | Thêm 5 việc liên tiếp = 5 lần đóng panel. Không có quick-add liên tục, không chọn ưu tiên/người phụ trách ngay khi tạo. | `TaskBoardPage.tsx:178` | Đọc code | Đã sửa một phần — tạo liên tục, focus sau phiên đồng bộ, Toast Mở hoạt động; trường quick-add mới cần duyệt. |
| 31 | Kéo-thả không có phản hồi trực quan | Không highlight cột đích, không vạch chèn, không ghost, không hỗ trợ cảm ứng (HTML5 DnD). Cột đích luôn **thêm vào cuối** (`beforeTaskId=null`). Sắp xếp lại chỉ có "Đưa lên trên" (không có "xuống"). Mỗi card mang sẵn `<select>` + nút → ồn thị giác. | `TaskBoardPage.tsx:349-414` | Đọc code | Đã sửa một phần — midpoint/beforeTaskId, highlight/vạch chèn khi kéo; menu/handle cảm ứng cần duyệt, kéo bằng cảm ứng chưa triển khai. Select hiện có vẫn dùng được bằng chạm/bàn phím. |
| 32 | `busy` toàn cục khóa **mọi** card khi một card di chuyển | Gây nhấp nháy `disabled` toàn bảng. Không skeleton (chỉ dòng chữ "Đang tải công việc…" làm bảng nhảy layout). | `TaskBoardPage.tsx:186, 337` | Đọc code | Đã sửa một phần — busy theo card, không reset kênh sau mỗi thay đổi; skeleton mới cần duyệt. |
| 33 | Panel chi tiết: tạo "bẫy dirty" không giải thích | Sửa tiêu đề → "Thêm mục", "Gửi bình luận", "Gỡ tệp", checklist, "Lưu trữ" đều bị `disabled` mà không có thông báo lý do. Panel là một form dài 7 mục không chia nhóm/tab; nút "Tải lại nhiệm vụ" luôn hiện. | `TaskBoardPage.tsx:699-944` | Đọc code | Đã sửa một phần — title/aria-description giải thích dirty; chia panel thành tab cần duyệt. |
| 34 | Hạn quá hạn không nổi bật trên card; bộ lọc 5 `<select>` luôn mở, không có "xóa bộ lọc"/đếm bộ lọc đang bật | | `TaskBoardPage.tsx:276-336` | Đọc code | Hoãn — màu quá hạn/bố trí bộ lọc/nút mới bị khóa. |

**Hồ sơ, Thông báo, Tìm kiếm**

| # | Vấn đề | Chi tiết | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|------|
| 35 | Form hồ sơ **bị reset khi `user` đổi** | `useEffect(..., [user])` ghi đè mọi ô đang gõ nếu object `user` được cập nhật nền (refresh token, presence…). Chưa có chỉ báo "chưa lưu"/thanh lưu dính. | `ProfilePage.tsx:38-53` | Rủi ro | Đã sửa một phần — giữ draft dirty khi refresh user; thanh lưu/hoàn tác cần duyệt. |
| 36 | Lỗi ảnh đại diện/ảnh bìa/sở thích hiện dưới ô "Tên hiển thị" | Một state `error` dùng chung gắn vào `Field` của tên. | `ProfilePage.tsx:55-117, 225-229` | Đọc code | Đã sửa — lỗi đúng trường, ảnh có describedby/invalid riêng. |
| 37 | Đổi mật khẩu xong bị đăng xuất mà không giải thích | Gọi `logout()` → toast "Đã đăng xuất · Hẹn gặp lại" thay vì "Đã đổi mật khẩu, hãy đăng nhập lại". Ô mật khẩu không có ẩn/hiện, không thanh độ mạnh. | `ProfilePage.tsx:133-137` | Đọc code | Đã sửa một phần — thông báo lý do đăng xuất; thêm nút/strength cần duyệt. Chưa đổi mật khẩu thật. |
| 38 | Trang Thông báo dùng class `workspace-admin`; khối "Tùy chọn theo nhóm" nằm **trên** danh sách | Danh sách thông báo (nội dung chính) bị đẩy xuống dưới màn hình. Không nhóm theo ngày. | `NotificationsPage.tsx:119-178` | Đọc code | Hoãn bố cục — đảo thứ tự/nhóm ngày cần duyệt; notifications.css riêng đã tồn tại nên phần đó không áp dụng. |
| 39 | Search modal thiếu ARIA combobox | Điều hướng bằng ↑↓ nhưng không `role=listbox/option`, không `aria-activedescendant`; `aria-live` bọc cả thân → screen reader đọc lại toàn bộ khi gõ. Khi chưa gõ chỉ có "điều hướng nhanh", không có "gần đây". | `NotionSearchModal.tsx:487-637` | Đọc code | Đã sửa một phần — combobox/listbox/option, selected/active descendant, live region số kết quả; Gần đây cần duyệt. |

**Landing & Đăng nhập**

| # | Vấn đề | Chi tiết | Nhãn | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|------|
| 40 | Tiêu đề hero bị "mồ côi": ở 1440px dòng 2 chỉ có chữ "thực"; trên mobile "Bước vào không / gian". Thiếu `text-wrap: balance`. | | **Chạy thật** | Hoãn — text-wrap balance thay dòng chữ và kích thước tĩnh. |
| 41 | Đoạn mô tả hero (`#3d4e66`, 18px) đặt trực tiếp lên ảnh phong cảnh nhiều màu → độ tương phản không đều, vùng hoa hồng khó đọc. Trái quy tắc MASTER.md "không đặt chữ trực tiếp lên backdrop". | | **Chạy thật** | Hoãn — thêm scrim thay diện mạo; video nhiều vùng sáng tối cần nền đảm bảo contrast, chưa duyệt. |
| 42 | Landing/Login **không có URL riêng**: bấm "Bắt đầu ngay" vẫn ở `/`; nút Back của trình duyệt không quay lại landing; không chia sẻ/đánh dấu được trang đăng nhập. | `AppContext.tsx` chỉ route cho `/app/*` | **Chạy thật** | Đã sửa — /login, /register, popstate và Back về landing đã kiểm thật. |
| 43 | Landing dùng nút đen thuần `#000` + Playfair italic, workspace dùng navy `#263450` → hai ngôn ngữ thị giác (MASTER.md: "không dùng pure black" ngoài dock họp). `.editorial-pill-btn--lg { margin-top: 48px }` áp luôn cho CTA cuối trang. | `editorial.css:11, 212-217` | Đọc code | Không áp dụng thay màu — ngoại lệ giao diện đã chốt được ghi trong MASTER; giữ nút/margin hiện tại. |
| 44 | Nhãn 12px, lỗi 12px, chú thích 9–11px khắp nơi (105 chỗ) | Dưới ngưỡng dễ đọc, đặc biệt tiếng Việt có dấu. | `styles.css` (9–11px: dòng 454, 509, 1221, …) | Đọc code | Hoãn — thay cỡ chữ vi phạm khóa typography. |

### P2 — Nợ kỹ thuật làm giao diện khó sửa

| # | Vấn đề | Chi tiết | Trạng thái (khóa giao diện 04–05/10) |
|---|--------|----------|------|
| 45 | **1.812 `!important`** (`chat-live.css` 861, `editorial-workspace.css` 424, `search-enhancements.css` 354, `workspace-home.css` 99). Mọi chỉnh sửa mới đều phải "thắng" bằng `!important` → vòng xoáy cascade. Nguyên nhân: 3 hệ CSS chồng nhau (`styles.css` legacy → `editorial-workspace.css` → từng feature). | Hoãn — không chuyển cascade/module trên CSS chưa được coverage; 1812 -> 1817 important (5 thêm cho trạng thái/focus/reduced motion). |
| 46 | **CSS chết khả năng cao**: `styles.css` dòng 769–1397 là "Public landing · Notion style" (`.landing-*` có 10 định nghĩa, 0 chỗ dùng trong `.tsx`); còn block "Authentication (Notion minimalist)". Cần xác minh bằng Chrome Coverage/PurgeCSS. | Hoãn — chưa có Chrome Coverage/PurgeCSS chứng minh CSS chết; giữ nguyên. |
| 47 | **Font nạp 3 lần**: `<link>` trong `index.html` (kèm Plus Jakarta Sans, có vẻ không dùng) + `@import` trong `editorial.css:1` + `editorial-workspace.css:6` (`@import` chặn render). MASTER.md ghi "nạp một lần". | Đã sửa — bỏ 3 import trùng, giữ index.html; Plus Jakarta Sans còn được --font-ui sử dụng. |
| 48 | **Token lệch tài liệu**: MASTER.md ghi `--editorial-text-muted = #3E4E66`, code `rgba(15,23,42,.55)`; `--editorial-surface-card` doc `rgba(246,248,252,.64)` vs code `rgba(255,255,255,.94)`. Cần chốt một nguồn thật. | Không áp dụng đổi token — hai scope public/workspace khác nhau; MASTER ghi rõ scope và ngoại lệ. |
| 49 | **`transition: all`** 37 chỗ (nhiều chỗ kèm `!important`) → animate cả thuộc tính đắt (layout/paint) và gây giật khi `:hover` đổi nhiều thứ. | Đã sửa một phần — 37 -> 19 transition all, chỉ chuyển transform/opacity ở component đã chạm. |
| 50 | **108 `backdrop-filter`** trên nền gồm video + WebGL canvas chạy liên tục → tốn GPU trên máy yếu; vi phạm giới hạn "≤2 lớp blur". | Hoãn — nền đặc/mobile/reduced transparency thay glass; 107 -> 108 khai báo blur (Toast mới khi tương tác), chưa chứng minh tất cả đường chồng <=2. |
| 51 | **`prefers-reduced-motion`**: `MotionConfig reducedMotion="user"` chỉ lo Motion (`main.tsx:14`) và GSAP reveal; **toàn bộ CSS animation** (`pulseDot`, `suspenseShimmer`, `speaking-pulse`, `revealUp`, `chat-record-pulse`, `wsPulse`, `search-spin`) và transition `transform` khi hover vẫn chạy. Đã thấy console cảnh báo "Reduced Motion enabled" khi chạy thử. | Đã sửa — CSS, video, Three.js theo reduced motion; đã đo media query bật, video paused, canvas đơn. |
| 52 | Tab trong workspace **unmount** khi chuyển (`activeTab === "chat" && <ChatPage/>`) → mất vị trí cuộn, bản nháp phụ thuộc `useDraft`. Danh sách chat không ảo hóa. N+1 request ở Trang chủ (mỗi nhóm một lần `getChannelsApi`). | Đã sửa một phần — cache scrollTop theo user/kênh, cleanup và draft giữ qua đổi tab nhanh; ảo hóa/N+1 hoãn vì dữ liệu tổng quan đang cần và API chưa gộp. |
| 53 | `.catch(() => {})` nuốt lỗi ở 15 chỗ (AppShell, SocketContext, chat, họp, thông báo, search…) → UI im lặng khi API lỗi. | Đã sửa — lỗi chính có phản hồi; read receipt/badge/cache tùy chọn có chú thích và retry phù hợp. |
| 54 | ~28 inline style trong `LoginPage.tsx` (kể cả lớp `opacity-50 pointer-events-none` kiểu Tailwind **không tồn tại** → trạng thái disabled của nút Google không có tác dụng). | Đã sửa — 42 inline style literal thành 14 class editorial; disabled Google là class thật/inert; đối chiếu form không lệch. |

---

## PHẦN 2 — HƯỚNG NÂNG CẤP ANIMATION · MOTION · NÚT CHỨC NĂNG NHỎ

### 2.1 Hiện trạng motion (đã có)

- **Motion (v13)**: cross-fade màn (`App.tsx`), view transition (`tokens.ts`), modal, popover tài khoản, pill dock `layoutId`, chấm chuông, toast.
- **GSAP**: reveal so le các khối trang (`ViewReveal`), hero chữ từng từ + parallax cuộn + nâng camera three.js (landing).
- **three.js**: hạt bụi + sương, đổi "mood" theo màn, tạm dừng khi đang họp.
- **Khoảng trống**: Chat, Công việc, Họp, Thông báo, Hồ sơ **gần như không có motion**; nút nhỏ (reaction, ghim, bật/tắt, đính kèm, gửi) chỉ đổi màu; không có motion cho trạng thái (đang gửi → đã gửi, lỗi, thành công).

### 2.2 Nguyên tắc (giữ "Calm, 60 fps" của MASTER.md, nâng nhẹ từ 5 → 6/10)

1. **Motion để giải thích, không để trang trí**: mỗi chuyển động phải trả lời "cái gì vừa thay đổi / ở đâu / vì sao".
2. Chỉ animate `transform` + `opacity` (+ `clip-path`/`filter` có kiểm soát). Cấm animate `width/height/top/left/box-shadow` trên danh sách dài.
3. Ngân sách thời gian: micro 90–160ms · overlay 180–240ms · chuyển trang 220–320ms · kể chuyện (landing) 600–1100ms. Thoát nhanh hơn vào ~35%.
4. Một bộ **token** duy nhất cho Motion, GSAP **và CSS** (biến `--ease-*`, `--dur-*`, spring preset) để không lệch.
5. **Reduced motion là tính năng hạng nhất**: bản giảm = đổi opacity/màu tức thời, không dịch chuyển, không parallax, không WebGL động.
6. Mọi motion có **tương đương không-chuyển-động** (đổi màu/biểu tượng/văn bản trạng thái) — không dùng motion làm kênh thông tin duy nhất.

### 2.3 Lộ trình theo lớp

**Lớp A — Nền tảng (làm trước, mở khóa mọi thứ sau)**
- Mở rộng `shared/motion/tokens.ts`: `SPRING = { snappy, gentle, bouncy }`, `EASE = { out, inOut, emphasized }`, `DURATION` (micro/overlay/page/story); xuất song song thành CSS variables trong `:root`.
- Hook `useMotionSafe()` + `<Motion.Presence>` helper, `data-motion="reduced"` trên `<html>`; thêm khối CSS `@media (prefers-reduced-motion: reduce)` toàn cục: tắt mọi `animation`/`transition` trừ opacity/color, ẩn hạt động.
- Sửa `@keyframes spin` (đang thiếu) và gom tất cả `@keyframes` về `shared/motion/keyframes.css`.
- Đổi `transition: all` → danh sách thuộc tính cụ thể (dùng `--transition-interactive`).

**Lớp B — Nút chức năng nhỏ (micro-interaction) — hiệu quả nhìn thấy cao nhất**

| Thành phần | Nâng cấp |
|-----------|----------|
| `Button` (mọi biến thể) | Press `scale .97` (spring snappy), **spinner quay thật** + giữ nguyên chiều rộng khi loading, kết thúc loading → **dấu ✓ morph 600ms** rồi trả nhãn (tùy chọn `successFlash`). |
| `IconButton` | Hover nâng nhẹ + nền tròn mờ dần vào; press co; **tooltip** (có phím tắt `<kbd>`) hiện sau 400ms hover/focus, tương thích chạm. |
| Nút bật/tắt (ghim kênh, tắt tiếng, đánh dấu, ghim tin) | Icon **morph** (sao rỗng → đầy, chuông → chuông gạch) + "pop" 1.0→1.18→1.0; `aria-pressed` giữ nguyên. Thay chữ "Bật/Tắt" giả-switch bằng **Switch thật** (`role="switch"`) có thumb trượt spring. |
| Reaction chip | Chip mới **bật ra** từ nút thêm; số đếm **cuộn dọc** (odometer) khi đổi; nút `+` xoay 45° khi mở picker; picker mở **theo gốc nút** (scale từ điểm neo) với 6 emoji so le 20ms. |
| Nút Gửi (chat) | Máy bay giấy **bay ra** + tin nhắn **trượt vào** luồng ở trạng thái "đang gửi" (mờ) → "đã gửi" (✓ vẽ nét SVG `pathLength`) → "đã xem" (✓✓ đổi màu). Lỗi: **rung ngang nhẹ** 1 lần + nút "Thử gửi lại" xuất hiện. |
| Nút Mic/Camera (dock họp) | Vòng **mức âm** quanh nút mic theo `useAudioActivity`; tắt → đường gạch **vẽ chéo** qua icon; nền chuyển đỏ mờ dần; "tay giơ" nảy 2 lần. |
| Nút Sao chép liên kết | Icon liên kết → ✓ + nhãn "Đã sao chép" 1,5s rồi trả. |
| Chuông thông báo | Có tin mới: chấm **ping** (vòng lan tỏa 1 lần, không lặp), chuông lắc nhẹ 400ms; số đếm tick khi tăng. |
| Dock điều hướng trái | Giữ pill `layoutId`; thêm tooltip nhãn khi dock thu gọn, icon nhấc 2px khi hover, badge tick/pop khi thay đổi. |
| Tab/segmented (ws-tabs, bộ lọc kênh, Lưới/Tiêu điểm, Đăng nhập/Tạo tài khoản) | Một **thanh nền trượt dùng chung `layoutId`**; nội dung tab chuyển **theo hướng** (sang phải/trái tùy chỉ số). |
| Input/Field | Nhãn nổi nhẹ khi focus; vòng focus **mở rộng** bằng `box-shadow` (chỉ khi cần) hoặc `outline` animate; lỗi: rung ≤4px một lần + icon cảnh báo; thanh **độ mạnh mật khẩu** chạy mượt; ô OTP: từng ô điền bật nhẹ. |
| Checkbox/toggle hồ sơ | Dấu ✓ vẽ nét (stroke-dashoffset); nhóm toggle chuyển sang Switch thống nhất. |
| Toast | Thanh **đếm ngược** (pause khi hover/focus), vuốt để đóng, xếp chồng có tối đa 3 + "+N", icon theo loại (lỗi dùng `role=alert`, tồn tại lâu hơn). |
| Số liệu (hero Trang chủ, QoS) | Đếm tăng (count-up) 600ms khi dữ liệu về lần đầu; QoS đổi màu theo ngưỡng với chuyển mượt. |
| Skeleton → nội dung | Shimmer dùng chung; khi dữ liệu về **cross-fade** thay vì bật cái ập vào (giữ chiều cao để không nhảy layout). |

**Lớp C — Chuyển cảnh & bố cục**
- **Modal/menu/popover**: bọc toàn bộ bằng `AnimatePresence`; trên mobile modal thành **bottom sheet** kéo-để-đóng; menu thả xuống có `transform-origin` đúng nút gọi.
- **Chuyển trang**: thử `document.startViewTransition` (có fallback Motion) cho nhóm → shell; card nhóm → header nhóm dùng **shared element** (avatar + tên).
- **Danh sách**: tin nhắn mới trượt vào từ đáy (chỉ khi đang ở cuối); xóa tin co lại (`height: auto`→0 qua `layout` + `exit`); Kanban dùng `layout` + `Reorder`/dnd-kit: **ghost** bám con trỏ, **vạch chèn** màu navy, cột đích sáng nhẹ, card "đáp" bằng spring; hỗ trợ cảm ứng + bàn phím (Space/mũi tên).
- **Panel trượt** (chi tiết nhiệm vụ, thread, thông tin kênh): trượt từ phải 260ms + scrim mờ; đóng bằng Esc/vuốt.
- **Họp**: tile vào/ra bằng `layout` (FLIP) khi lưới đổi cột; viền "đang nói" chuyển mượt (`opacity`, không đổi `box-shadow` liên tục); chuyển Lưới ↔ Tiêu điểm là **một animation layout**; dock tự ẩn sau 3s không hoạt động khi toàn màn hình, hiện lại khi di chuột.

**Lớp D — Landing & điểm nhấn (theo hướng bạn đã lưu tham khảo: scroll-driven + kinetic typography + WebGL)**
- Chia landing thành **chương** có chỉ mục "01 / 02 / 03" (đồng bộ số lớn mờ ở nền): `ScrollTrigger` **pin + scrub** cho phần "Không gian chuyên biệt" (3 thẻ SFU / Chat / Task lần lượt chiếm sân khấu, mockup UI thật thay cho khối navy + icon trống).
- Tiêu đề từng **dòng** (split theo dòng, không theo từ) với mask reveal; số liệu benchmark đếm tăng khi vào khung nhìn; `text-wrap: balance` cho mọi tiêu đề.
- Con trỏ: nút CTA **từ tính** (magnetic, ≤8px) chỉ trên thiết bị có `pointer: fine`.
- three.js: giữ "mood", thêm **phản hồi theo hành động** (`ambientBridge.pulse()` khi gửi tin/vào họp thành công); tự giảm số hạt theo FPS đo được; tạm dừng khi tab ẩn **hoặc** khi che bởi modal toàn màn.
- *Tùy chọn*: Lottie (qua `@lottiefiles/dotlottie-react`, tải lười) **chỉ** cho empty-state và màn "thành công"; **không** cần WebGPU.

**Lớp E — Hiệu năng & an toàn**
- Ngân sách: không long task >50ms khi chạy animation; kiểm bằng Chrome Performance + `PerformanceObserver`.
- Giảm `backdrop-filter` xuống ≤2 lớp chồng; bỏ `will-change` vĩnh viễn, chỉ gắn khi đang animate.
- Video nền: tự host trong `public/`, nén WebM+MP4, có `poster`, tôn trọng `Save-Data`/`prefers-reduced-data`.
- Test: Vitest/node:test cho token & hook, Playwright (nếu có) chụp trạng thái reduced-motion.

### 2.4 Thứ tự ưu tiên đề xuất

1. Lớp A + sửa spinner/keyframes (nửa buổi) → mọi nút loading lập tức "sống".
2. Lớp B (nút nhỏ) cho `Button`, `IconButton`, toggle, reaction, gửi tin, dock họp.
3. Lớp C: Modal/AnimatePresence, panel trượt, Kanban DnD, tile họp.
4. Lớp D: landing chương + kinetic typography.
5. Lớp E song song, chạy kiểm hiệu năng sau mỗi lớp.

---

## PHẦN 3 — PROMPT CHI TIẾT

> Cách dùng: mở phiên Claude Code ở thư mục `D:\DoAnTotNghiep`, dán **nguyên khối** prompt. Nên chạy **Prompt 1 trước, Prompt 2 sau** (Prompt 2 dựa vào các primitive đã sửa ở Prompt 1: spinner, Switch, Modal, Toast). Working tree hiện có ~40 file chưa commit → cả hai prompt đều bắt đầu bằng việc tạo nhánh mới để không đụng vào thay đổi đang có.

### PROMPT 1 — Sửa lỗi UX/UI

````text
Bạn là kỹ sư frontend senior (React 19 + TypeScript + Vite) làm việc trên đồ án "nexo" — nền tảng cộng tác thời gian thực. Nhiệm vụ: SỬA các lỗi UX/UI đã được rà soát trong file docs/ui-ux-audit-2026-10-04.md (Phần 1). Đọc file đó trước, rồi đọc design-system/realtime-workspace/MASTER.md — đây là luật thiết kế bắt buộc.

## Bối cảnh & ràng buộc
- Monorepo npm workspaces; chỉ sửa apps/web (không đổi services/api, packages/shared trừ khi bắt buộc và phải nói rõ).
- Giao diện LIGHT-ONLY, accent duy nhất là navy (--primary #263450), không dùng đen thuần ngoài dock họp, không emoji làm icon, không window.confirm/alert, không "UI giả" (control nào hiện ra phải làm việc thật hoặc bị gỡ).
- Dùng primitive trong apps/web/src/shared/ui/Primitives.tsx (Button, IconButton, Modal, Field, Badge, Avatar, Toast). Muốn thêm primitive (Switch, ConfirmDialog, Tooltip…) thì đặt cùng chỗ và dùng lại ở mọi nơi.
- Chỉ animate transform/opacity. Không thêm thư viện mới nếu không thật cần (nếu cần, nêu lý do + kích thước bundle).
- Chuỗi giao diện tiếng Việt, giữ giọng văn hiện có; tránh thuật ngữ kỹ thuật với người dùng cuối.
- Working tree đang có nhiều file chưa commit. Việc ĐẦU TIÊN: `git checkout -b fix/ui-ux-audit-2026-10` (không stash/reset/revert thay đổi sẵn có). Commit nhỏ theo từng nhóm sửa, thông điệp tiếng Anh dạng conventional commits, mỗi commit phải qua typecheck.

## Cách làm việc
1. Với MỖI mục, trước khi sửa hãy xác nhận lỗi còn tồn tại (đọc code ở file:dòng ghi trong audit; các dòng có thể đã lệch). Nếu mục đã hết lỗi hoặc audit sai, ghi "không áp dụng" kèm lý do — không sửa bừa.
2. Sửa tận gốc (primitive/CSS dùng chung) thay vì vá từng chỗ, khi cùng một lỗi lặp lại nhiều nơi.
3. Mỗi mục sửa xong: chạy `npm run typecheck` và `npm run test --workspace @doan/web`; với thay đổi nhìn thấy được, chạy `npm run dev:web`, kiểm tra ở 375 / 768 / 1024 / 1440px, kiểm tra bằng bàn phím (Tab/Shift+Tab/Enter/Space/Esc) và bật `prefers-reduced-motion`. Nếu cần đăng nhập: `npm run db:up && npm run dev:api` (cần Docker) rồi dùng tài khoản test từ seed/fixture của dự án; không in mật khẩu ra chat.
4. Không giả vờ đã kiểm tra những gì chưa chạy. Cuối mỗi giai đoạn báo cáo: đã sửa gì, kiểm chứng bằng cách nào, còn lại gì.

## GIAI ĐOẠN 1 — P0 (làm trọn trước khi sang giai đoạn sau)
1. Spinner Button: thêm @keyframes spin dùng chung (gom vào một file keyframes), áp cho Button loading + OTP RotateCw; giữ nguyên chiều rộng nút khi loading (không giật layout); aria-busy="true" khi loading. Tiêu chí: mọi nút loading quay mượt; không còn `animation: "spin ..."` inline thiếu keyframes.
2. LoginPage resend OTP: sửa finally để reset đúng state (setResending(false)); thêm test hoặc ít nhất kịch bản kiểm thủ công; xác nhận gửi lại lần 2 hoạt động sau cooldown.
3. Form auth (LoginPage + đổi mật khẩu ở ProfilePage + mọi Field): gắn label–input (htmlFor/id hoặc lồng), thêm name + autocomplete đúng, aria-invalid + aria-describedby cho lỗi, role="alert" cho lỗi, focus nhảy tới ô lỗi đầu tiên khi submit sai, xóa lỗi khi người dùng gõ lại. Primitive `Field` phải tự sinh id và truyền cho control con (không bắt từng nơi tự nối). Thay các `opacity-50 pointer-events-none` (class Tailwind không tồn tại) bằng class thật; chuyển inline style của LoginPage sang CSS.
4. Hệ xác nhận hành động phá hủy: tạo `ConfirmDialog` (dựa trên Modal, hỗ trợ loading, tone danger, mô tả hậu quả cụ thể, nút xác nhận có nhãn động từ rõ ràng, focus mặc định vào "Hủy"). Áp dụng cho: Rời nhóm (WorkspaceShell), Loại khỏi phiên / Chuyển host / Tắt nguồn mic (MeetingControls — mute có thể chỉ cần toast hoàn tác), Lưu trữ nhiệm vụ / Gỡ tệp / Bỏ mục (TaskBoard — ưu tiên "Hoàn tác" 6 giây thay vì hộp thoại cho thao tác nhẹ như bỏ checklist), Hủy lịch họp (thống nhất cách xác nhận). Gỡ 3 kiểu xác nhận khác nhau, dùng 1 kiểu.
5. Dock họp: đặt thanh điều khiển luôn trong tầm nhìn (position: sticky; bottom với safe-area-inset-bottom, hoặc bố cục khung cao 100dvh: header gọn / sân khấu co giãn / dock cố định đáy). Chuyển panel host/QoS thành panel phụ hoặc Popover, không chiếm chiều dọc. Đưa "Giơ tay" ra dock (và hiển thị biểu tượng tay giơ trên tile). Thêm phím tắt: M (mic), V (camera), S (chia sẻ), H (giơ tay), C (chat), Esc đóng panel — chỉ kích hoạt khi không đang gõ trong input; hiển thị phím tắt trong tooltip. Nút "Rời phòng": xác nhận khi đang chia sẻ màn hình hoặc là host.
6. Menu hành động tin nhắn (chat): luôn tồn tại trong DOM, ẩn bằng opacity/visibility + pointer-events (KHÔNG display:none), hiện khi :hover và :focus-within, và có phím tắt/menu "⋯" cho bàn phím + cảm ứng. Không được làm chiều cao tin nhắn thay đổi khi hover. Gom các hành động phụ (Chủ đề, Ghim, Đánh dấu) vào menu "⋯" để thanh hành động còn Trả lời / Biểu cảm / Sửa / ⋯.
7. Toast: thời lượng theo mức độ (success 4s, info 5s, warning/error ≥8s hoặc đến khi đóng), có nút đóng, tạm dừng khi hover/focus, lỗi dùng role="alert", icon đúng loại, tối đa 3 toast hiển thị, không che ô soạn tin/dock họp (đặt vị trí theo màn hình). Dọn timer khi unmount.
8. Focus & kích thước chạm: định nghĩa :focus-visible TOÀN CỤC (không phụ thuộc .editorial-workspace-shell) dùng hai lớp ring (navy + viền trắng) để thấy được trên cả nền sáng lẫn dock đen; loại bỏ `outline:none` không có thay thế. Nâng mọi control tương tác lên vùng chạm ≥ 40×40 (có thể dùng ::after mở rộng vùng bấm): ẩn/hiện mật khẩu, "Quên mật khẩu?", link nav landing, nút trong header chat.
9. Video nền: tự host trong apps/web/public (WebM + MP4, có poster ảnh tĩnh, preload="metadata"), thêm fallback gradient khi video lỗi, không autoplay khi prefers-reduced-motion / Save-Data. Nếu chưa có file video, tạo TODO rõ ràng + giữ URL cũ làm fallback tạm — KHÔNG tự tải file từ nguồn ngoài mà không hỏi tôi.

## GIAI ĐOẠN 2 — P1
10. Thống nhất tạo nhóm: một component CreateWorkspaceModal dùng ở cả Trang chủ và Shell, có AnimatePresence, validate ≥2 ký tự, lỗi inline, loading đúng. Bọc AnimatePresence cho mọi Modal render có điều kiện (liệt kê trong audit mục 13).
11. Giảm trùng lặp lối vào: mỗi chức năng một vị trí chính + tối đa một lối tắt có chủ đích. Card nhóm ở Trang chủ: nút chính "Mở nhóm", các lối khác vào menu "⋯"; bỏ 4 chip số liệu hư vinh hoặc biến chúng thành lối tắt hành động (vd. "3 việc quá hạn" → mở bảng đã lọc). Đổi nhãn "SFU Video" → "Phòng họp"; bỏ "WebRTC SFU", "QoS Metrics" khỏi giao diện người dùng cuối (đưa vào panel "Chi tiết kết nối" thu gọn), ẩn mã phiên/UUID sau "Sao chép mã".
12. Họp: gộp panel "Người tham gia" và điều hành thành MỘT danh sách (avatar, tên, vai trò, trạng thái mic, tay giơ) với menu "⋯" theo hàng cho hành động host; chia sẻ màn hình trở thành sân khấu chính (tự chuyển bố cục Tiêu điểm, tile người dự thành filmstrip); badge tin chat mới trên nút Chat ở dock; tự cuộn + hiển thị giờ trong chat họp; card phòng ở sảnh hiện "đang họp · N người" nếu dữ liệu có sẵn (nếu API chưa có thì ghi chú, không bịa); phím tắt/aria cho pager.
13. Chat: vạch "Tin nhắn mới" + nút nổi "Xuống tin mới nhất" (có đếm); bong bóng "đang gửi/lỗi" ngay trong luồng (thay banner trên ô soạn); typing indicator có 3 chấm động; sửa trích dẫn trả lời khi tin gốc chỉ có tệp (hiển thị "Tệp đính kèm", không phải "đã xóa"); banner ghim bấm → cuộn tới tin; tải tin cũ khi cuộn lên đỉnh (IntersectionObserver) giữ vị trí cuộn; bỏ `disabled={busy}` trên danh sách kênh; thay ✓/✓✓ bằng icon.
14. Công việc: tạo xong KHÔNG tự mở panel (hiện toast "Đã tạo — Mở" + giữ focus ở ô nhập để thêm tiếp); form tạo nhanh cho phép chọn ưu tiên/người phụ trách tùy chọn; kéo-thả có phản hồi (highlight cột, vạch chèn, vị trí thả thật — truyền beforeTaskId đúng), hỗ trợ cảm ứng; bỏ `<select>` + nút "Đưa lên trên" khỏi mặt card, chuyển vào menu "⋯"; busy theo từng card; skeleton cho bảng; panel chi tiết chia nhóm/tab (Chi tiết · Checklist · Tệp · Bình luận · Hoạt động), thay trạng thái disabled "mồ côi" bằng thông báo lý do ("Lưu thay đổi trước khi thêm checklist") hoặc lưu từng phần; highlight quá hạn; thanh bộ lọc thu gọn + "Xóa bộ lọc" + đếm bộ lọc đang bật.
15. Hồ sơ: không reset form khi `user` đổi nếu form đang dirty (so sánh theo user.id/updatedAt); thanh "Chưa lưu thay đổi" dính + nút Lưu/Hoàn tác; lỗi gắn đúng field (ảnh, sở thích); đổi mật khẩu thành công → toast "Đã đổi mật khẩu — vui lòng đăng nhập lại" thay vì thông báo đăng xuất chung; thêm ẩn/hiện + thanh độ mạnh cho mật khẩu mới; thay checkbox bằng Switch.
16. Thông báo: đưa danh sách lên trước, "Tùy chọn theo nhóm" thành popover/cột phụ; nhóm theo ngày; không dùng class workspace-admin (tạo notifications.css riêng nếu cần).
17. Search modal (Ctrl/⌘+K): ARIA combobox/listbox (role, aria-activedescendant, aria-selected), live region chỉ cho "N kết quả"; mục "Gần đây" khi chưa gõ.
18. Landing/Login: text-wrap: balance cho mọi tiêu đề; đặt đoạn mô tả hero trên nền kính/scrim đủ tương phản ≥4.5:1; URL thật cho landing/login (vd. /login, /register) với pushState + popstate và Back hoạt động; thống nhất màu nút (navy) hoặc ghi rõ ngoại lệ trong MASTER.md; bỏ margin-top cứng ở .editorial-pill-btn--lg.
19. Cỡ chữ: không còn chữ <12px cho nội dung đọc được (giữ ≥11px chỉ cho huy hiệu số); lỗi/nhãn form ≥13px.

## GIAI ĐOẠN 3 — P2 (nợ kỹ thuật; làm có kiểm soát, không cố "dọn sạch" trong một lượt)
20. CSS: (a) đo CSS chết bằng Chrome Coverage/PurgeCSS cho styles.css (khối .landing-* và Auth Notion), xóa phần chứng minh là không dùng; (b) KHÔNG xóa hàng loạt !important. Thay vào đó: khi chạm vào một component ở giai đoạn trên, di chuyển style của nó sang CSS module/lớp @layer rõ ràng và bỏ !important cho riêng component đó. Báo cáo số !important trước/sau (grep). (c) thay `transition: all` bằng danh sách thuộc tính cụ thể; (d) font chỉ nạp MỘT lần (index.html), xóa @import trùng và font không dùng (Plus Jakarta Sans nếu xác nhận không dùng).
21. Đồng bộ MASTER.md với token thật trong code (hoặc ngược lại) cho --editorial-text-muted, --editorial-surface-card; ghi rõ ngoại lệ landing.
22. backdrop-filter: kiểm kê, đảm bảo ≤2 lớp chồng; trên mobile/`prefers-reduced-transparency` dùng nền đặc.
23. Thay `.catch(() => {})` bằng xử lý có chủ đích (log + trạng thái lỗi nhìn thấy được hoặc chú thích vì sao im lặng là đúng). Trang chủ: gộp N+1 getChannelsApi hoặc tải lười theo card.
24. Giữ vị trí cuộn/trạng thái khi chuyển tab trong workspace (không unmount ChatPage khi chuyển Tổng quan↔Chat), hoặc lưu scrollTop theo kênh.

## Kiểm thử & nghiệm thu
- `npm run typecheck`, `npm run lint`, `npm run test --workspace @doan/web`, `npm run build --workspace @doan/web` phải qua.
- Thêm test (node:test như apps/web/test/*.test.js) cho: logic thời lượng toast, hook phím tắt (không kích hoạt khi đang gõ), hàm tính vị trí thả Kanban, reset form hồ sơ chỉ khi không dirty.
- Kiểm bàn phím toàn bộ luồng: đăng nhập → tạo nhóm → gửi tin → thao tác tin (bằng phím) → tạo việc → vào họp → bật/tắt mic bằng M → rời họp.
- Chụp ảnh trước/sau cho từng màn sửa (375/768/1440) và đặt vào docs/ui-review-2026-10-04/ ; cập nhật bảng trong docs/ui-ux-audit-2026-10-04.md thêm cột "Trạng thái" (Đã sửa / Không áp dụng / Hoãn + lý do).
- Báo cáo cuối: danh sách commit, mục đã/chưa sửa, rủi ro còn lại, mục cần tôi quyết định (đặc biệt: nguồn video nền, API cho "đang họp N người").
````

### PROMPT 2 — Nâng cấp animation · motion · nút chức năng nhỏ

````text
Bạn là kỹ sư frontend/motion-design senior (React 19, Motion v13 "motion/react", GSAP 3.15 + ScrollTrigger, three.js) làm việc trên đồ án "nexo". Nhiệm vụ: NÂNG CẤP animation, motion và các nút chức năng nhỏ theo docs/ui-ux-audit-2026-10-04.md (Phần 2). Đọc file đó và design-system/realtime-workspace/MASTER.md (mục Motion) trước. Giả định các sửa lỗi của "Prompt 1" (spinner, Switch, ConfirmDialog, Toast, focus ring toàn cục) đã có; nếu chưa, hãy kiểm tra và nói rõ, rồi tự tạo phần tối thiểu cần thiết.

## Mục tiêu
Giao diện cảm giác "sống", phản hồi tức thì và có chủ đích, nhưng vẫn "Calm, 60 fps" (nâng dial Motion từ 5 lên ~6/10, không hơn). Mỗi chuyển động phải giải thích một thay đổi trạng thái; không có chuyển động trang trí vô nghĩa.

## Ràng buộc
- Giữ Motion cho presence/layout/gesture; GSAP cho timeline/ScrollTrigger/WebGL uniforms. Không thêm thư viện lớn mới. Nếu thực sự cần dnd (Kanban) dùng @dnd-kit hoặc Reorder của motion — nêu lý do + kích thước. Lottie (tùy chọn, dotLottie, lazy-load) chỉ cho empty/success, mặc định KHÔNG dùng; không dùng WebGPU.
- Chỉ animate transform/opacity (+clip-path/filter có kiểm soát). Cấm animate width/height/top/left/margin/box-shadow trên danh sách dài (thay bằng `layout` của Motion hoặc scaleY/clip-path).
- Light-only, navy accent, không đen thuần (trừ dock họp); tuân thủ MASTER.md.
- Tuân thủ `prefers-reduced-motion`: bản giảm = đổi opacity/màu tức thời, không dịch chuyển/parallax/WebGL động. Thông tin KHÔNG được chỉ truyền bằng chuyển động (luôn có thay đổi màu/icon/văn bản tương đương).
- Hành vi KHÔNG đổi: không sửa logic nghiệp vụ/API/socket; chỉ lớp trình bày + hook motion.
- Việc đầu tiên: `git checkout -b feat/motion-upgrade-2026-10` (working tree có file chưa commit — không stash/reset/revert). Commit nhỏ, conventional commits, mỗi commit qua typecheck.

## GIAI ĐOẠN A — Nền tảng (làm trước)
1. Mở rộng apps/web/src/shared/motion/tokens.ts: SPRING {snappy, gentle, bouncy}, EASE {out, inOut, emphasized}, DURATION {micro 0.12, overlay 0.22, page 0.3, story 0.9}; xuất tương ứng thành CSS variables (--ease-out, --dur-micro…) ở :root thông qua một file shared/motion/motion.css, để CSS thuần và JS dùng chung một nguồn.
2. Hook `useMotionSafe()` (trả về preset đầy đủ hoặc preset giảm), và `data-motion="reduced"` trên <html> đồng bộ với media query + (tùy chọn) công tắc trong Hồ sơ. Khối CSS toàn cục @media (prefers-reduced-motion: reduce): tắt animation/transition trừ opacity/color, dừng shimmer/pulse, ẩn hạt WebGL động. Đảm bảo MotionConfig và GSAP (gsap.matchMedia) cùng tuân thủ.
3. Gom mọi @keyframes về shared/motion/keyframes.css (spin, shimmer, pulse, ping, shake, check-draw); đổi toàn bộ `transition: all` thành danh sách thuộc tính cụ thể.
4. Công cụ đo: thêm tiện ích dev-only `?motion-debug=1` hiển thị FPS + số layer blur; ghi lại baseline trước khi sửa (Chrome Performance: scripting/rendering/painting, long tasks) để so sánh sau.

## GIAI ĐOẠN B — Nút chức năng nhỏ (micro-interaction)
Triển khai trong primitive dùng chung trước, rồi áp dụng khắp nơi:
5. Button: press scale .97 (spring snappy), hover nâng nhẹ ≤1px + đổi sắc; loading = spinner quay + giữ nguyên chiều rộng + sau thành công tùy chọn `successFlash` (✓ vẽ nét 600ms rồi trả nhãn).
6. IconButton + Tooltip: tooltip (hiện sau 400ms hover/focus, ngay khi focus bàn phím, có <kbd> phím tắt nếu có), nền tròn mờ dần vào khi hover, press co; chạm: nhấn giữ hiện nhãn.
7. Toggle: icon morph (sao rỗng↔đầy, chuông↔chuông gạch) + pop 1→1.18→1; `Switch` thật (role="switch", thumb trượt spring, hỗ trợ Space) thay các "Bật/Tắt" giả-switch và checkbox cài đặt (Hồ sơ, Thông báo, info panel chat).
8. Reaction: chip mới bật ra từ nút `+`; số đếm cuộn dọc (odometer) khi tăng/giảm; picker mở theo gốc nút với emoji so le 20ms; nút `+` xoay 45° khi mở.
9. Nút gửi chat + vòng đời tin nhắn: gửi → máy bay giấy bay ra, tin trượt vào luồng ở trạng thái "đang gửi" (mờ 60%) → "đã gửi" (✓ vẽ nét) → "đã xem" (✓✓ đổi màu); lỗi → rung ngang ≤4px một lần + "Thử gửi lại". Không dùng ký tự ✓ làm icon.
10. Dock họp: mic có vòng mức âm (từ useAudioActivity, cập nhật bằng transform/opacity, throttle rAF); tắt mic → đường gạch vẽ chéo; "giơ tay" nảy 2 lần; số người/badge chat tick khi đổi; tile có chỉ báo chất lượng mạng (3 thanh) đổi màu mượt.
11. Chuông thông báo: chấm "ping" một lần (không lặp vô hạn), chuông lắc 400ms khi có tin mới, số đếm tick; dock trái: tooltip nhãn, icon nhấc 2px khi hover, badge pop.
12. Tab/segmented: một thanh nền trượt dùng `layoutId` cho ws-tabs, bộ lọc kênh chat, Lưới/Tiêu điểm, Đăng nhập/Tạo tài khoản; nội dung tab chuyển theo hướng (dựa chỉ số tab cũ/mới), có chống nháy ở lần render đầu.
13. Field: nhãn/ring focus mượt; lỗi rung ≤4px một lần + icon cảnh báo (kèm aria đã sửa ở Prompt 1); thanh độ mạnh mật khẩu; OTP: từng ô điền bật nhẹ, dán 6 số tự phân ô.
14. Toast: thanh đếm ngược (dừng khi hover/focus), vuốt để đóng, xếp chồng tối đa 3 + "+N", vào/ra theo trục phù hợp vị trí (mobile từ dưới/trên).
15. Số liệu: count-up 600ms lần đầu (Trang chủ, QoS), đổi màu theo ngưỡng mượt; skeleton dùng chung shimmer → cross-fade sang nội dung, giữ chiều cao tránh nhảy layout.
Tiêu chí nghiệm thu giai đoạn B: mọi control tương tác có đủ 5 trạng thái nhìn thấy (rest/hover/focus-visible/active/disabled) + loading nếu bất đồng bộ; không còn nút nào chỉ đổi màu khi bật/tắt; bật reduced-motion thì còn đổi màu/icon nhưng không dịch chuyển.

## GIAI ĐOẠN C — Chuyển cảnh & bố cục
16. Presence toàn diện: mọi Modal/menu/popover/panel bọc AnimatePresence; menu có transform-origin đúng nút gọi; Modal trên ≤640px thành bottom sheet kéo-để-đóng (drag gesture, ngưỡng 100px/vận tốc), khóa cuộn nền, trả focus.
17. Panel trượt (chi tiết nhiệm vụ, thread, thông tin kênh, panel họp): trượt từ phải 260ms (ease out, thoát 160ms) + scrim; đóng bằng Esc/vuốt.
18. Chuyển trang & shared element: thử `document.startViewTransition` với fallback Motion; card nhóm → header nhóm chia sẻ avatar+tên qua layoutId/view-transition-name (chỉ khi chuyển Trang chủ → Shell). Không làm vỡ lazy Suspense hiện có (ViewReveal vẫn hoạt động).
19. Danh sách: tin nhắn mới trượt vào từ đáy CHỈ khi người dùng đang ở cuối; xóa tin co lại bằng `layout` + `exit`; thông báo/nhiệm vụ mới so le. Kanban: ghost bám con trỏ, vạch chèn navy, cột đích sáng nhẹ, card "đáp" bằng spring, hỗ trợ cảm ứng + bàn phím (Space nhấc, mũi tên di chuyển, Space thả, Esc hủy; có thông báo aria-live).
20. Họp: tile vào/ra + đổi cột bằng `layout` (FLIP); viền "đang nói" chuyển bằng opacity (không đổi box-shadow liên tục); Lưới↔Tiêu điểm là một animation layout; dock tự ẩn sau 3s không thao tác khi toàn màn hình, hiện lại khi di chuột/focus; có thể tắt.

## GIAI ĐOẠN D — Landing & điểm nhấn
21. Landing chia "chương" 01/02/03 với số lớn mờ ở nền; phần "Không gian chuyên biệt" dùng ScrollTrigger pin + scrub (3 thẻ SFU / Chat / Task lần lượt lên sân khấu; thay khối navy + icon trống bằng mockup UI thật dựng bằng HTML/CSS hoặc ảnh chụp thật của app). Trên mobile/touch hoặc reduced-motion: bố cục xếp dọc, reveal đơn giản.
22. Kinetic typography: tách tiêu đề theo DÒNG (không theo từ — tiếng Việt có dấu, tránh vỡ chữ), mask reveal; text-wrap: balance; số benchmark đếm tăng khi vào khung nhìn; CTA từ tính (≤8px) chỉ khi `pointer: fine` và không reduced-motion.
23. three.js: thêm `ambientBridge.pulse()` khi sự kiện thành công (gửi tin, vào họp, tạo nhóm); tự giảm số hạt theo FPS đo được (dưới 50 fps liên tục 2s → giảm 50%); tạm dừng khi tab ẩn, khi modal toàn màn che, hoặc khi nền không còn nhìn thấy; chuyển mood mượt (đã có) — kiểm tra không rò rỉ listener/geometry khi chuyển màn.

## GIAI ĐOẠN E — Hiệu năng & chất lượng (chạy song song, chốt cuối)
24. Giảm backdrop-filter xuống ≤2 lớp chồng; gỡ will-change vĩnh viễn (chỉ gắn khi đang animate); thêm `content-visibility: auto` cho danh sách dài nơi hợp lý.
25. So sánh trước/sau bằng Chrome Performance: không long task >50ms trong animation, FPS ≥55 trên máy trung bình (throttle CPU 4x), CLS = 0 do motion, bundle tăng ≤ 25 KB gzip (báo cáo số thực).
26. Test: node:test cho tokens/hook useMotionSafe, tiện ích count-up, hàm tính hướng chuyển tab; kiểm tay ở 375/768/1024/1440, bàn phím, reduced-motion bật/tắt, và thiết bị cảm ứng (resize_window mobile preset).

## Nghiệm thu & báo cáo
- `npm run typecheck`, `npm run lint`, `npm run test --workspace @doan/web`, `npm run build --workspace @doan/web` qua.
- Quay/chụp ghi hình ngắn (GIF hoặc ảnh chuỗi) cho: Button loading→success, Switch, reaction, gửi tin, dock họp, Kanban kéo-thả, bottom sheet, landing chương; đặt trong docs/ui-review-2026-10-04/motion/.
- Cập nhật MASTER.md mục Motion (token mới, quy tắc reduced-motion, danh sách pattern được phép) và nâng dial Motion lên 6/10.
- Báo cáo cuối: bảng "thành phần → motion đã thêm → thay thế trạng thái không-chuyển-động", số đo hiệu năng trước/sau, các chỗ cố ý KHÔNG thêm motion và lý do, mục cần tôi quyết định.
````

---

## Phụ lục — Danh sách kiểm nhanh các lỗi đã xác minh bằng chạy thật

- [x] Inputs đăng nhập: `labels.length = 0`, không `id/name`, không `aria-invalid` sau khi submit sai (focus không nhảy tới ô lỗi).
- [x] Nút ẩn/hiện mật khẩu 16×16px; "Quên mật khẩu?" cao 20px; link nav landing cao 22px.
- [x] Tiêu đề hero 1440px: dòng thứ 2 chỉ có "thực"; mobile "Bước vào không / gian".
- [x] Đăng nhập không đổi URL (`/`), landing ↔ login không có lịch sử trình duyệt.
- [x] Console cảnh báo "Reduced Motion enabled…" khi chạy thử (CSS animation vẫn không được xử lý ngoài Motion).
