# nexo — sửa UX theo khóa giao diện

Ngày thực hiện: 04–05/10/2026, Asia/Saigon. Nhánh: `fix/ui-ux-audit-2026-10`.

## Phạm vi và nguyên tắc

Giữ bản navy + glass đã chốt: bố cục, thứ tự khối, font Playfair/Inter, bo góc, pill, nền video/Three.js, topbar/dock, chữ và icon đang hoạt động. Không áp dụng các đề xuất tái thiết kế trong audit khi chúng xung đột với khóa giao diện. Không cài thư viện mới. Không sửa nguồn backend hoặc shared package trong đợt này; các thay đổi đang có tại những thư mục đó là công việc có sẵn.

Bản gốc để đối chiếu là **working tree khi bắt đầu**, không phải HEAD Git. Working tree vốn có nhiều thay đổi chưa commit. Bản sao được giữ ở `backups/ui-audit-locked-20261004/baseline/`; [bản vá riêng](own-changes.patch) chỉ ghi chênh lệch của đợt sửa này. Bản vá dùng với bản gốc đó, không áp trực tiếp lên HEAD.

## Đã sửa

| Khu vực | Sửa hành vi / trạng thái |
|---|---|
| Primitive dùng chung | Spinner có keyframes; loading giữ chiều rộng và aria-busy; Field nối label/control/lỗi; focus ring hai lớp; mở rộng vùng chạm mà không đổi hộp nhìn thấy. |
| Modal và panel | ConfirmDialog dùng Modal, focus mặc định Hủy; focus trap không tranh với dialog lồng; đóng trả body scroll ngay, overlay đang thoát inert và không chặn thao tác. Bổ sung AnimatePresence tại các điểm audit liệt kê. |
| Toast | 4s/5s/8s theo loại; tối đa 3; đóng bằng bàn phím; tạm dừng khi hover/focus; phản hồi có action Mở nhiệm vụ. Không hiện lại banner chào mừng đăng nhập đã được yêu cầu bỏ trước đó. |
| Xác thực | Gửi lại OTP reset pending bằng finally; name/autocomplete/ARIA/lỗi và focus; Google disabled dùng class thật. Chuyển 42 inline style literal sang 14 class cùng tiền tố, giữ cascade và kích thước. /login, /register và Back hoạt động. |
| Nhóm | Wrapper CreateWorkspaceModal dùng chung nhưng giữ nguyên hai form đã chốt; validate >=2 ký tự, lỗi inline/focus. Rời nhóm có xác nhận. |
| Chat | Thanh hành động không làm tăng chiều cao khi hover/focus; kênh không bị khóa bởi busy; trích dẫn tệp rỗng không bị gọi là tin đã xóa; ghim mở context của tin; tự tải cũ gần đầu và giữ anchor; chống request cũ sau đổi kênh/unmount. Lưu scrollTop theo tài khoản/kênh. |
| Công việc | Tạo liên tục không ép mở chi tiết, Toast Mở làm việc thật. Tách refresh bảng khỏi refresh kênh để ô nhập không bị tháo khỏi DOM; đợi đồng bộ xong rồi trả focus. Busy theo card, vị trí thả theo midpoint/beforeTaskId và rollback theo task. Xác nhận các thao tác gỡ/lưu trữ; lý do disabled khi dirty có title/ARIA. |
| Họp | M/V/S/H/C/Esc có guard khi gõ, modifier, dialog, repeat. Xác nhận rời khi host/chia sẻ; xác nhận quản trị và hủy lịch. Chat họp chỉ theo cuộn khi gần đáy, có badge tin mới lúc đóng. Lỗi thiết bị/loa có phản hồi. |
| Hồ sơ | Refresh nền không ghi đè draft dirty; đổi tài khoản mới reset. Lỗi ảnh/sở thích đúng nơi, lỗi mật khẩu có association/focus. Đổi mật khẩu thành công dùng lý do đăng xuất riêng. |
| Tìm kiếm | Combobox/listbox/option, active descendant/selected; live region chỉ đọc số kết quả; điều hướng ↑↓/Esc; bỏ animation chiều cao bộ lọc. |
| Nền/CSS | Giảm chuyển động cho CSS/video/Three.js, pause video khi ẩn hoặc họp; metadata preload. Bỏ font import trùng; transition all ở các component đã chạm được giới hạn transform/opacity. Catch chính có lỗi, catch advisory có lý do im lặng. |

Trạng thái từng mục: [audit Phần 1](../ui-ux-audit-2026-10-04.md). Token scope và ngoại lệ: [MASTER](../../design-system/realtime-workspace/MASTER.md).

## Ảnh và đối chiếu tĩnh

[Bảng 90 ảnh trước/sau của 15 màn](screenshots.md) tại 375/768/1440px, viewport cao 900px. Có thêm 12 ảnh trạng thái lỗi, xác nhận, focus và 1024px. Landing, auth, home, nhóm, chat, Kanban/chi tiết, lobby/call, quản trị, hồ sơ, thông báo và tìm kiếm đều đã được xem trong trình duyệt. Quản trị được kiểm tra qua các primitive dùng chung; không thay bố cục riêng.

[Số đo đối chiếu](comparison.json) gồm hộp, màu, font, cỡ chữ và radius của các heading/control được chọn. [Số đo thô](raw-dom-metrics.json) giữ cả lần chụp đầu và lần đối chiếu lại. Đây không phải phép so sánh mọi pixel hay mọi phần tử DOM.

**Không khẳng định ảnh sau trùng pixel tuyệt đối.** Các sai khác trong bằng chứng:

| Sai khác | Giải thích / giới hạn |
|---|---|
| Nền phong cảnh giữa ảnh trước/sau | Video có thời gian phát khác nhau. Bản sửa pause theo reduced motion thật của máy, bản gốc vẫn phát video. URL, lớp nền và màu CSS được giữ. Không khóa timestamp video bằng cách sửa DOM. |
| Ngày, mã phiên, số/tên nhiệm vụ | Fixture dùng dữ liệu thật; tạo nhiệm vụ và vào họp làm thay đổi dữ liệu. Các cặp matched chụp lại cùng bộ dữ liệu ở phần lớn màn. Không đổi chuỗi UI của sản phẩm. |
| Trang chủ, 768/1440: một nút ghost lệch y khoảng 3px | 13/14 control không lệch; nút này khác thời điểm focus/hover/motion khi chụp. Chưa cô lập hết sai số tương tác này; không coi là chứng minh pixel-identical. Không sửa padding/vị trí tĩnh của card/nút. |
| Tổng quan nhóm, 375: các section dưới lệch y 21.8125px | Hai lần chụp có nhiệm vụ mới với tiêu đề dài xuống thêm một dòng. Kích thước/màu/font/radius control không đổi; 768/1440 cùng bộ đo không lệch. |
| Chat, 375: nút điều hướng ngoài màn hình lệch x khoảng 1.18px | Drawer ẩn đang ở khung transform khác khi chụp; phần này ngoài viewport. Các control nhìn thấy được đo không lệch. |
| Trong cuộc họp: các khối dưới panel điều hành lệch | Một ảnh chụp trước khi thông tin host/người tham gia tải xong hoặc panel mở, ảnh sau có thông tin/panel mở; độ lệch theo breakpoint được giữ trong comparison.json. Không đổi dock/QoS/khung video. Chưa có cặp ảnh call cùng trạng thái hoàn toàn. |
| Focus ring, Toast, lỗi inline, highlight khi kéo và xác nhận mới | Đây là trạng thái tương tác được phép bổ sung. Không có ảnh “trước lỗi” khi trạng thái đó chưa tồn tại. Ảnh lỗi tạo nhóm có ở cả ba kích thước; ảnh workspace/Home đóng dialog có cặp trước/sau. |

Trong bộ control được đo, Landing, login/register/quên mật khẩu, Kanban/chi tiết, lobby, quản trị, hồ sơ, thông báo và tìm kiếm không có chênh lệch >0.02px hoặc màu/font/radius khác ở cả ba kích thước. Không dùng kết quả này để suy ra mọi pixel đều giống.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
|---|---|
| Baseline | Typecheck/lint/build qua, 9 test frontend qua. Không thấy lỗi gate có sẵn. |
| Sau sửa | `npm run typecheck`, `npm run lint`, `npm run test --workspace @doan/web`, `npm run build --workspace @doan/web` qua. 14/14 test, không skip. |
| Test mới | Duration Toast; phím tắt không chặn nhập/modifier/dialog/repeat; midpoint Kanban; profile dirty/reset tài khoản; OTP pending success/failure/chạy lần hai. Test helpers không thay thế test API/thiết bị thật. |
| Auth | Đăng nhập fixture qua form/API bình thường; URL /login và /register, Back về landing; submit sai focus email, password autocomplete/current-password và lỗi có association. |
| Chat | Focus tin hiện thanh hành động; chiều cao article giữ 96.5px trước/sau focus. Chuyển Tổng quan/Chat nhanh 3 chu kỳ, draft giữ sau khi kênh tải; vẫn 1 canvas, không overflow document. Tin fixture được gửi qua UI. |
| Công việc | Tạo nhiều nhiệm vụ liên tục, không tự mở panel; ô nhập nhận focus sau refresh. Focus Toast >4.5s không tự mất, đóng bằng Enter, Mở mở đúng chi tiết. |
| Nhóm | Submit tên một ký tự hiện lỗi và focus aria-invalid. Esc đóng; sau exit dialog/inert về 0, body overflow trở về giá trị cũ. Không tạo nhóm người dùng thật. |
| Họp | Vào phòng fixture với mic/camera tắt trước khi join. H giơ tay có trạng thái thật; C mở chat; gõ hc không kích hoạt shortcut; Esc đóng panel. Rời host focus Hủy, Esc không rời, xác nhận rời về lobby. |
| Search / hồ sơ | ArrowDown cập nhật active option, Esc trả focus; tên hồ sơ một ký tự báo lỗi/focus. Khôi phục tên fixture trong form, không lưu thay đổi hồ sơ thật. |
| Responsive | 15 màn tại 375/768/1440 được xem/chụp; login, chat, tasks kiểm thêm 1024px. Không tuyên bố mọi trạng thái ở mọi breakpoint đã kiểm. |
| Reduced motion | Media query của môi trường thực sự bật; video paused, canvas đơn; CSS có nhánh tĩnh. Không đổi cài đặt hệ điều hành để chạy kiểm tra. |
| Cleanup / console | Sau reload main 5176: không có lỗi console mới trong lần kiểm cuối. Modal đóng sạch, một canvas. Không đo số lượng listener/ScrollTrigger toàn bộ; WebGL context-loss và Save-Data chỉ rà source. |

### Chưa kiểm chứng trực tiếp

- OTP gửi mail thật/cooldown 60s và reset mật khẩu hoàn chỉnh; thay mật khẩu thật cần chủ tài khoản thao tác.
- M/V/S với phần cứng, screen sharing, chất lượng media, nhiều người, mute/kick/transfer host và mạng mất kết nối.
- Lịch sử chat >50 tin, attachment/reaction/pin với tập dữ liệu lớn; cache scrollTop chưa giữ các trang tin cũ trong RAM sau unmount.
- Kéo thả bằng cảm ứng **chưa triển khai**. Select/nút sắp xếp hiện có vẫn là cách thao tác bằng chạm/bàn phím. Hàm vị trí thả có unit test, chưa có phiên browser drag đầy đủ ở mọi breakpoint.
- Browser zoom 200%, slow-network, Save-Data, prefers-reduced-transparency, Chrome Coverage và chứng minh tối đa hai lớp blur trên mọi đường render.
- Không có đo FPS/main-thread/loading time theo thiết bị; không tuyên bố đạt 60fps.

## Số liệu kỹ thuật

| Chỉ số | Trước | Sau |
|---|---:|---:|
| Test frontend | 9 | 14 |
| `transition: all` | 37 | 19 |
| Font CSS @import | 3 | 0 |
| `!important` | 1812 | 1817 |
| Khai báo backdrop-filter | 107 | 108 |
| Build frontend | 6.08s | 4.35s |
| Entry + AppShell gzip | 30.54kB | 35.09kB |
| WorkspaceShell gzip | 38.23kB | 40.71kB |
| Login gzip | 5.40kB | 5.37kB |
| Profile gzip | 4.20kB | 4.59kB |
| Three.js gzip | 128.40kB | 128.40kB |

Thời gian build là hai lần chạy trên máy này, chịu cache/tải hệ thống; không phải benchmark trải nghiệm người dùng. Toast dùng chung chuyển phần mã từ AppShell sang entry: entry riêng tăng 13.81→26.26kB gzip, AppShell giảm 16.73→8.83kB. So sánh tổng hai chunk tránh diễn giải sai là mã bị nhân đôi. Thêm 5 important override dành cho trạng thái/focus/reduced motion; chưa refactor cascade lớn. Audit gốc ghi 108 blur, baseline đếm thực tế được 107, sau thêm Toast state là 108. Font Plus Jakarta Sans giữ vì token legacy `--font-ui` vẫn dùng.

## Đề xuất cần chủ dự án duyệt

Các mục sau **không áp dụng** vì thay diện mạo tĩnh, thứ tự, chữ, icon hoặc thêm khối. Ảnh minh họa là khu vực hiện tại cần quyết định, không phải bản thiết kế đã triển khai.

| Đề xuất | Minh họa hiện tại | Quyết định cần duyệt |
|---|---|---|
| Dock sticky, đưa Giơ tay ra dock, chuyển QoS/host sang panel phụ, ưu tiên màn chia sẻ/filmstrip | [Họp](locked-meeting-call-after-1440.png) | Đổi bố cục họp và vị trí thao tác. |
| Gộp action tin vào ⋯, unread separator, nút xuống tin mới, pending bubble, typing dots, icon dấu gửi | [Chat](locked-chat-after-1440.png) | Thay/thêm thành phần và icon; giữ bản hiện tại đến khi duyệt. |
| Quick-add assignee/priority, handle cảm ứng, menu card, skeleton, tab panel, filter thu gọn/highlight quá hạn | [Kanban](locked-tasks-matched-after-1440.png), [chi tiết](locked-task-detail-matched-after-1440.png) | Bố cục/nội dung/control mới. |
| Thanh chưa lưu, Switch, nút hiện mật khẩu/strength meter | [Hồ sơ](locked-profile-after-1440.png) | Thành phần mới hoặc thay control đang hoạt động. |
| Danh sách thông báo trước tùy chọn, nhóm ngày; Search gần đây | [Thông báo](locked-notifications-after-1440.png), [Search](locked-search-after-1440.png) | Thứ tự và nội dung mới. |
| Giảm lối vào/chip nhóm, đổi thuật ngữ/UUID, text-wrap balance, scrim hero, chuẩn hóa font nhỏ/margin/CTA | [Trang chủ](locked-home-after-1440.png), [landing](locked-landing-matched-after-1440.png) | Đổi chữ, màu, tỷ lệ hoặc khối; khóa hiện tại ưu tiên. |
| Nền đặc trên mobile/reduced transparency, dọn CSS dead hoặc giảm !important quy mô lớn | [Chat mobile](locked-chat-after-375.png) | Thay glass hoặc cần Coverage đủ trạng thái trước refactor. |

### Dữ liệu/tài sản cần chủ dự án quyết định

1. Cung cấp WebM/MP4 và poster phong cảnh **có quyền sử dụng**, khớp video đang dùng. TODO ở AmbientBackdrop; chưa tải/copy video ngoài. URL cũ giữ tạm, gradient cũ là fallback. Thêm poster khác sẽ thay ảnh tĩnh nên cần duyệt.
2. API card phòng hiện chưa cung cấp số người/phiên đang hoạt động theo phòng. Muốn “đang họp · N người” cần endpoint/contract riêng; chưa sửa backend hoặc bịa số.
3. Tổng quan đang cần dữ liệu từng nhóm; chưa có API aggregate nên chưa bỏ N+1. Có thể ưu tiên contract aggregate ở một đợt riêng.

## Animation, cleanup và mở rộng

- Motion sở hữu transform/opacity modal, toast, panel theo cấu trúc sẵn có. CSS chỉ xoay spinner và trạng thái hover/focus; không điều khiển cùng transform của wrapper Motion.
- GSAP/Three.js giữ scene/scroll ownership có sẵn. Video và scene dừng khi họp; scene lazy-load, dispose trong effect cleanup. Reduced motion đổi scene theo nhánh tĩnh, video pause.
- Toast dùng timer còn lại, pause hover/focus, clear khi unmount. Modal dùng useIsPresent để trả scroll/focus trước khi exit kết thúc; dialog lồng sở hữu Tab/Esc.
- Chat lưu scrollTop theo user/channel trong cache tối đa 100 key; request generation/olderRequest/frame được dọn. Không lưu nội dung tin vào cache này. IndexedDB draft hành vi cũ giữ nguyên.
- Khi thêm animation, dùng wrapper riêng nếu khác owner; ưu tiên transform/opacity, không thêm animation history toàn luồng, không đổi class/DOM layout đã khóa.

## Git và bảo toàn công việc có sẵn

Các commit chỉ stage hunk của đợt này; không stash/reset/revert working tree. Trước mỗi commit nguồn đã chạy root typecheck. Một số file thay đổi chồng sâu với công việc chưa commit trước đó, nên phần sửa ở LiveChatPage, MeetingControls, MeetingPage, TaskBoardPage và WorkspaceShell được giữ **trong working tree** và bản vá bằng chứng thay vì commit cả file rồi gộp nhầm công việc của chủ dự án. Các sửa đó đang chạy và được kiểm tra như bảng trên; chưa phải toàn bộ code đã nằm trong commit.

| Commit | Nội dung |
|---|---|
| `9d9dba0` | fix(ui): harden shared interaction states and accessibility |
| `d4725a5` | fix(auth): preserve form layout and recover pending states |
| `bba36b2` | fix(ui): preserve drafts and improve contextual feedback |

Commit tài liệu bằng chứng được tạo sau ba commit nguồn trên; xem `git log -4 --oneline`. File audit có sẵn chưa tracked được giữ trong working tree với cột trạng thái mới, không đưa cả phần tài liệu có sẵn vào commit của đợt này. MASTER chỉ stage phần ghi chú bổ sung; các thay đổi có sẵn ở đó vẫn giữ nguyên. Source/backend/shared có sẵn chưa commit được giữ nguyên.

## Chạy dự án

Từ `D:\DoAnTotNghiep`, dùng Node/npm hiện có:

```powershell
npm run db:up
npm run dev:api
npm run dev:web
```

Port web theo WEB_ORIGIN trong `.env` (phiên kiểm tra là http://localhost:5176), API3001. Không đổi port OAuth trong đợt sửa. Kiểm tra gate:

```powershell
npm run typecheck
npm run lint
npm run test --workspace @doan/web
npm run build --workspace @doan/web
```

Đã đăng xuất và dọn chính xác tài khoản/nhóm fixture cùng dữ liệu thử thuộc fixture. Server web/API/Docker do người dùng chạy được giữ nguyên. Server baseline tạm 5177 đã dừng, viewport đã trả mặc định và tab kiểm thử đã đóng.
