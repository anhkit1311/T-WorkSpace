# Sắp lại Nhóm làm việc theo chức năng và trang Họp dạng lịch tuần

Ngày: 23/10/2026. Trạng thái: chờ duyệt.

## Vì sao

Người dùng thấy phần Nhóm làm việc và Họp trực tuyến rối, khó tìm chức năng. Những gì đang gây rối (chụp từ app đang chạy):

- Phải qua 4 cột (menu chính → danh sách nhóm → tab của nhóm → danh sách kênh) mới tới nội dung.
- Lối vào trùng nhau: "Họp trực tuyến" ở menu và tab "Cuộc họp" trong nhóm mở cùng một trang; "Tin nhắn" và tab "Trao đổi" đều là chat.
- Trang họp gộp 4 việc cùng lúc: chọn phòng, lịch họp, lịch sử, kiểm tra camera.
- Bảng công việc gắn theo từng kênh và có một hàng bộ lọc dài.

Thành công nghĩa là: người dùng tìm thấy chức năng từ menu chính trong một lần bấm, không phải chọn nhóm trước.

## Quyết định của người dùng

- **Menu xếp theo chức năng (kiểu C).** Menu chính: Trang chủ, Tin nhắn, Họp, Công việc, Tài liệu, Khóa học, Tổng đài; dưới vạch ngăn là "Nhóm của tôi" rồi các mục quản trị/tài khoản như hiện nay. Mỗi trang gom dữ liệu của mọi nhóm; nhóm chỉ còn là bộ lọc.
- **Trang Họp dạng lịch tuần (kiểu B).**
- Mô tả chi tiết bên dưới (kể cả các điểm mình đoán) đã được người dùng xác nhận là đúng ý.

## Mục tiêu / không làm / tránh

Mục tiêu:
- Bỏ khái niệm "vào một nhóm rồi chọn tab". Không còn cột danh sách nhóm và hàng tab nhóm.
- Mỗi chức năng có đúng một lối vào trên menu.
- Trang Họp chỉ còn lịch và chi tiết; kiểm tra camera là một bước riêng trước khi vào phòng.

Không làm lần này:
- Phòng họp bên trong (lưới video, thanh điều khiển, bảng bên): đã làm lại ở d10b10a, giữ nguyên.
- Tổng đài và E-learning: giữ nguyên, chỉ đổi vị trí trên menu nếu cần.
- Không đổi mô hình dữ liệu: công việc vẫn thuộc một kênh, tệp vẫn là tệp đính kèm của kênh.

Tránh (làm vậy là hỏng dù chạy được):
- Mất chức năng đang có: mọi việc làm được ở giao diện cũ (quản lý kênh, ghim, thread, biên bản, điểm danh, bản ghi, lời mời, vai trò…) vẫn phải làm được ở giao diện mới.
- Link cũ (thông báo, email mời, `.ics`, tìm kiếm Ctrl K) dẫn vào trang trắng hoặc trang sai.
- Phải chọn nhóm trước mới làm được việc thường ngày.

## Menu và điều hướng

| Mục | Trang mở ra | Thay cho |
| --- | --- | --- |
| Tin nhắn | Chat gộp | "Tin nhắn" + tab "Trao đổi" |
| Họp | Lịch tuần | "Họp trực tuyến" + tab "Cuộc họp" |
| Công việc | Kanban gộp | tab "Công việc" |
| Tài liệu | Danh sách tệp gộp | tab "Tài liệu" |
| Nhóm của tôi | Quản lý nhóm | "Nhóm làm việc" + "Quản trị nhóm" (phần quản trị nhóm) |

- Thanh dưới trên điện thoại (`BOTTOM_BAR_ITEMS`): Trang chủ, Tin nhắn, Họp, Khóa học; phần còn lại ở "Thêm" như hiện nay.
- Link cũ có `?workspace=<id>` (và `channel`, `message`, `thread`, `task`, `schedule`) vẫn mở đúng chỗ: tham số `workspace` trở thành bộ lọc nhóm của trang đó, các tham số còn lại giữ nghĩa cũ. Trang `/app/workspace?workspace=<id>` chuyển sang Tin nhắn với kênh đầu của nhóm đó.
- Bộ lọc nhóm hoạt động riêng ở mỗi trang, không nhớ chung giữa các trang.

## Các trang

### Tin nhắn
- Cột trái: ô tìm, rồi kênh xếp theo từng nhóm (mỗi nhóm thu gọn/mở được, có số tin chưa đọc), dưới cùng là "Trò chuyện riêng" (1-1).
- Đầu kênh: tên kênh, nhãn tên nhóm, nút "Họp ngay" mở họp trong phòng của nhóm đó.
- Giữ mọi thứ chat đang có: thread, ghim, reaction, nhắc tên, tệp, tin nhắn thoại, tìm kiếm, thông tin kênh.
- Thêm/sửa kênh vẫn làm được từ đây cho người có quyền (nút "+" cạnh tên nhóm) và từ "Nhóm của tôi".

### Công việc
- Một bảng Kanban (Cần làm / Đang làm / Xong) mặc định hiện việc **giao cho tôi** ở mọi nhóm.
- Bộ lọc gọn: "Của tôi / Tất cả", "Nhóm", "Sắp hết hạn". Bộ lọc phụ (ưu tiên, đã lưu trữ…) đưa vào một menu "Lọc thêm".
- Mỗi thẻ ghi tên nhóm; tên kênh hiện làm nhãn phụ.
- "+ Việc mới": hộp thoại chọn nhóm (mặc định nhóm đang lọc), kênh mặc định là kênh đầu của nhóm và đổi được.
- Mở thẻ: chi tiết việc như hiện nay (checklist, bình luận, tệp, lịch sử).

### Tài liệu
- Danh sách tệp của mọi nhóm, mới nhất trước; tìm theo tên; lọc theo nhóm; mỗi dòng có tên tệp, nhãn nhóm, người gửi, ngày.
- Tệp gửi trong chat cũng hiện ở đây (đúng như tab Tài liệu hiện nay).
- "Tải lên": chọn nhóm và kênh rồi tải, tệp xuất hiện như một tin nhắn đính kèm trong kênh đó.

### Nhóm của tôi
- Danh sách nhóm: tên, số người, vai trò của tôi; nút "Tạo nhóm", "Nhập mã mời".
- "Quản lý" mở trang quản lý nhóm: thành viên, vai trò, kênh (thêm/sửa/xếp), lời mời, chuyển chủ nhóm, rời/xoá nhóm. Đây là nơi duy nhất làm các việc này (gộp phần quản trị nhóm đang có).
- Không phải nơi làm việc hằng ngày; không có chat/công việc/tài liệu ở đây.

### Họp (lịch tuần)
- Thanh trên: "‹ Tuần dd–dd/mm ›", "Hôm nay", bộ lọc nhóm, "Họp ngay", "+ Lên lịch".
- Lịch: cột thứ 2 → chủ nhật, cột giờ 7h–21h. Màu: đang diễn ra xanh lá, sắp tới xanh dương nhạt, đã qua xám.
- Cuộc họp mở nhanh (không qua lịch) vẫn hiện trên lịch đúng giờ đã họp, lấy từ lịch sử họp.
- Bấm một cuộc họp → cột phải hiện chi tiết:
  - Sắp tới / đang diễn ra: tên, nhóm, giờ, ai đang ở trong (nếu đang họp), chương trình họp; nút **Vào**, **Sửa**, **Huỷ**, **tải .ics** (Sửa/Huỷ theo quyền như hiện nay).
  - Đã qua: bản ghi, biên bản và việc cần làm, điểm danh (chỉ chủ trì và đồng chủ trì).
- "Họp ngay": hộp nhỏ chọn nhóm (mặc định nhóm dùng gần nhất) → màn hình kiểm tra camera.
- "+ Lên lịch": dùng lại form lên lịch hiện có, thêm ô chọn nhóm.
- Điện thoại: lịch tuần đổi thành danh sách theo ngày; bấm một cuộc họp mở chi tiết toàn màn hình.
- Số liệu chất lượng mạng (QoS) chỉ xem trong phòng, không đưa ra trang này.

### Màn hình kiểm tra trước khi vào
- Màn hình riêng sau khi bấm Vào/Họp ngay: xem trước camera, đo mức micro, chọn micro/camera/loa và chất lượng video, tắt/bật camera và micro, tên cuộc họp và nhóm, số người đang ở trong, nút "Vào phòng", nút quay lại.
- Dùng lại phần kiểm tra thiết bị đang có trên trang họp.

## Máy chủ

Đã có sẵn và dùng lại:
- `GET /api/meetings/schedules` (lịch của mọi nhóm), `GET /api/meetings/history`, các API biên bản, điểm danh, bản ghi.
- `GET /api/workspaces/:id/files`, `GET|POST /api/channels/:id/tasks`, `GET|PATCH /api/tasks/:id`.

Cần thêm (đọc thuần, theo quyền thành viên kênh như API hiện có):
- `GET /api/tasks` : việc ở mọi kênh người dùng xem được, có tham số lọc `assignee=me|all`, `workspace`, `due=soon`, `archived`; mỗi việc kèm tên nhóm và tên kênh.
- `GET /api/files` : tệp ở mọi nhóm của người dùng, phân trang `before`/`limit` như API theo nhóm, có `workspace` và `q` (tên tệp); mỗi tệp kèm tên nhóm.
- `GET /api/meetings/calendar?from&to` : lịch họp (kể cả đã qua, không tính lịch đã huỷ) và các phiên họp đã diễn ra hoặc đang diễn ra trong khoảng ngày đó, ở các phòng người dùng xem được, kèm tên nhóm. `GET /api/meetings/schedules` hiện chỉ trả lịch sắp tới, còn `/api/meetings/history` không có mã phiên, nên chưa đủ để vẽ lịch tuần và mở bản ghi/biên bản/điểm danh của cuộc họp đã qua.

## Quyết định nhỏ do người viết thiết kế chốt (người dùng chưa nói)

- Giao diện cũ (cột danh sách nhóm, hàng tab nhóm, trang họp cũ) bị xoá hẳn, không có nút chuyển về kiểu cũ.
- Nhóm có nhiều phòng họp: "Họp ngay" chọn nhóm xong thì hỏi tiếp phòng; nhóm chỉ có một phòng thì vào thẳng.
- Kết quả tìm kiếm Ctrl K và thông báo đi theo quy tắc chuyển link cũ ở trên, không cần sửa riêng.

## Phần để người làm tự quyết

- Cách chia component, tên file, CSS; thứ tự làm các trang.
- Chi tiết hiển thị lịch (độ cao giờ, cuộc họp trùng giờ, cuộc họp qua đêm).
- Có giữ lại component cũ để dùng tiếp (chat, Kanban, chi tiết việc, biên bản, điểm danh, bản ghi) hay không: nên dùng lại tối đa.
- Bộ test: thêm/sửa unit test cho phần logic mới (gom việc, gom tệp, chuyển link cũ, xếp lịch) và cập nhật 4 bài E2E cho đường đi mới.
