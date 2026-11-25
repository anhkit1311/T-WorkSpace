# Kịch bản demo báo cáo tiến độ

Tổng thời gian khoảng 25–30 phút. Tên nút trong tài liệu này lấy đúng từ giao diện (đã đối chiếu mã nguồn ngày 11/11/2026). Chạy thử trọn một lượt trước buổi báo cáo và đánh dấu `[x]` vào từng bước đã chạy được.

## 0. Chuẩn bị (tối hôm trước)

- [ ] `npm run callcenter:up` → `docker exec <asterisk> asterisk -rx "pjsip show registrations"` thấy trunk Pitel **Registered**
- [ ] `docker compose -f infra/docker-compose.yml --profile recording up -d ffmpeg`
- [ ] (Tùy chọn, khoảng 30 phút) `node scripts/callcenter/simulate-shift.mjs giaovu@demo.tworkspace.test gv.ha@demo.tworkspace.test gv.lan@demo.tworkspace.test` để có lịch sử cuộc gọi và KPI như một ca trực thật
- [ ] `npm run demo:seed` → **ghi lại mã chứng nhận** in ra cuối lệnh
- [ ] `npm run dev` → mở http://localhost:5173
- [ ] Kiểm `TRANSCRIBE_URL` và `SUMMARY_URL` có chạy không. Nếu không chạy, chỉ demo phần chép lời/tóm tắt có sẵn từ seed và nói rõ đó là dữ liệu mẫu
- [ ] Tài khoản quản trị có máy lẻ loại **Trình duyệt (WebRTC)** (hiện là 15203). Không có máy lẻ thì giám sát viên không nghe lén được cuộc gọi
- [ ] Gọi ra thử một lần: tạo phiếu có số di động của bạn → **Gọi lại** → điện thoại đổ chuông
- [ ] Chuẩn bị **tai nghe**: ba trình duyệt chạy trên cùng một máy sẽ dùng chung micro và loa, không có tai nghe thì dễ bị hú
- [ ] **Từ giờ đến lúc demo không khởi động lại container Asterisk và modem.** Mỗi lần khởi động lại, cổng NAT của trunk sẽ đổi và phải cấu hình lại `ASTERISK_TRUNK_PUBLIC_PORT`

> **Chiều gọi vào hotline chưa chạy** (11/11): gọi 02871067388 thì chuyên viên ảo của Pitel bắt máy, cuộc gọi không tới Asterisk. Pitel phải định tuyến số này về máy nhánh 119. Vì vậy mọi cuộc gọi vào trong buổi demo đều **gọi từ trình duyệt** (sinh viên → Tổng đài → Gọi ngay). Cuộc gọi này đi qua đúng ACD, hàng đợi, ghi âm và giám sát như cuộc gọi hotline, chỉ bỏ qua IVR. Số Pitel dùng để demo **gọi ra**.

### Thiết bị và tài khoản

Một laptop chạy ba phiên trình duyệt riêng (nếu có laptop thứ hai thì cho Máy C chạy trên đó):

| Vị trí     | Trình duyệt / thiết bị | Tài khoản                            | Vai trò                                                  |
| ---------- | ---------------------- | ------------------------------------ | -------------------------------------------------------- |
| Máy A      | Chrome                 | `gv.ha@demo.tworkspace.test`         | Tổng đài viên Phòng Tuyển sinh, đã xong CC-201           |
| Máy B      | Edge                   | `admin@tdtu.edu.vn`                  | Quản trị hệ thống, giám sát tổng đài (máy lẻ 15203)       |
| Máy C      | Chrome **ẩn danh**     | `sv01@…` (đổi sang `gv.lan@…`, `truongkhoa@…` khi cần) | Người gọi vào (sinh viên), giảng viên, lãnh đạo khoa |
| Điện thoại | SIM thật               | —                                    | Người **nhận** cuộc gọi ra                               |

Mật khẩu là `SEED_ACADEMIC_PASSWORD` trong `.env`. Phòng Tuyển sinh có máy lẻ 15201–15299 và có tổng đài viên.

---

## 1. Mở đầu (1 phút, không thao tác)

Ba ý cần nói:

1. Đối tượng sử dụng: nội bộ TDTU, 6 vai trò, cây đơn vị khoa/phòng ban. Đề tài không làm một sản phẩm chung chung.
2. Phần lõi do em tự xây: ACD điều khiển Asterisk qua ARI, SFU mediasoup tự host, ghi hình phía máy chủ, AI chạy tự host nên dữ liệu không rời trường.
3. Ba dịch vụ liên thông với nhau, không phải ba ứng dụng rời (xem phần 4).

---

## 2. Tổng đài (khoảng 10 phút)

### 2.1 Trạng thái trực và khóa bắt buộc (luồng liên thông LT-4)

| Bước | Thao tác                                                                                                     | Kết quả mong đợi                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1    | Máy B (admin): **Tổng đài → Cấu hình** → Phòng Tuyển sinh → "Khóa bắt buộc trước khi trực" chọn **CC-201** | Hiện "Đã cập nhật khóa bắt buộc."                                                                  |
| 2    | Máy C đăng nhập `gv.lan` → Tổng đài → Bàn làm việc → bấm **Sẵn sàng**                                       | Bị chặn: "Hoàn thành khóa CC-201 — … trước khi nhận cuộc gọi."                                      |
| 3    | Máy A (`gv.ha`, đã hoàn thành CC-201) → bấm **Sẵn sàng**                                                    | Trạng thái chuyển xanh "Sẵn sàng"                                                                  |
| 4    | Máy B (admin): chỉ ra ô "Khóa bồi dưỡng khi điểm QA dưới …". Sau đó đặt "Khóa bắt buộc" về **Không yêu cầu** | Giải thích: tổng đài viên bị chấm QA thấp sẽ tự động được ghi danh vào khóa bồi dưỡng. Bỏ khóa bắt buộc để các tài khoản khác không bị chặn ở phần sau |
| 5    | Máy B bấm **Tạm nghỉ** ở trạng thái trực (góc trên bên phải)                                                  | Admin cũng là tổng đài viên. Phải ở trạng thái Tạm nghỉ mới được giám sát (mục 2.3)                    |
| 6    | Máy C đăng xuất `gv.lan` → đăng nhập `sv01`                                                                  |                                                                                                    |

> Câu nói: "E-learning dùng để đào tạo tổng đài viên. Chưa học xong khóa bắt buộc thì không được nhận cuộc gọi."

### 2.2 Cuộc gọi vào: sinh viên gọi phòng ban từ trình duyệt, ACD, softphone

| Bước | Thao tác                                                                                          | Kết quả mong đợi                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1    | Máy C (`sv01`) → menu **Tổng đài**                                                                | Trang "Liên hệ và hỗ trợ: gọi từ trình duyệt, không cần máy lẻ". Sinh viên không có máy lẻ vẫn gọi được |
| 2    | Chọn **Phòng Tuyển sinh** → **Gọi ngay** → cho phép micro                                          | Máy C hiện "Đang gọi…". Máy A đổ chuông (trạng thái "Đang đổ chuông")                              |
| 3    | Chỉ ra **Hồ sơ người gọi** trên Máy A                                                             | Hiện tên và MSSV của sv01, vì người gọi đã đăng nhập nên hệ thống biết là ai (không chỉ có số điện thoại) |
| 4    | Máy A nghe máy                                                                                    | "Đang đàm thoại", hai bên nói chuyện được, cuộc gọi bắt đầu được ghi âm                            |
| 5    | Bấm **Giữ máy** rồi **Tiếp tục**, bấm **Tắt micro / Bật micro**                                    | Máy C nghe nhạc chờ                                                                                 |
| 6    | Trong lúc gọi, gõ **Ghi chú**                                                                     |                                                                                                     |

> Câu nói: "Hotline 02871067388 đã đăng ký với nhà mạng và gọi ra được (mục 2.5). Chiều gọi vào đang chờ Pitel định tuyến về tổng đài của em. Cuộc gọi từ trình duyệt đi qua cùng một ACD, chỉ không qua IVR."

### 2.3 Giám sát: nghe lén, nhắc bài, tham gia

Làm ngay khi cuộc gọi ở 2.2 vẫn đang diễn ra. Mỗi lần giám sát chỉ chọn được một chế độ. Muốn đổi chế độ thì gác máy giám sát rồi bấm nút khác.

| Bước | Thao tác                                                                 | Kết quả mong đợi                                                        |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1    | Máy B (admin, đang **Tạm nghỉ**): **Tổng đài → Giám sát**                 | Thấy ô gv.ha màu đỏ "Đang đàm thoại", có các nút **Nghe / Nhắc / Tham gia** |
| 2    | Bấm **Nghe** → softphone của admin đổ chuông → nghe máy                   | Admin nghe cả hai bên, hai bên không nghe thấy admin                    |
| 3    | Admin gác máy giám sát → bấm **Nhắc** → nghe máy                          | Chỉ gv.ha nghe thấy admin nhắc bài, sv01 không nghe                     |
| 4    | Admin gác máy → bấm **Tham gia** → nghe máy                               | Thành cuộc gọi ba bên                                                   |

### 2.4 Kết thúc cuộc gọi, ghi nhận, phiếu

| Bước | Thao tác                                                                     | Kết quả mong đợi                                         |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | Gác máy                                                                      | Trạng thái "Hoàn tất cuộc gọi" (wrap-up)                 |
| 2    | Chọn **Kết quả cuộc gọi**, ví dụ "Tư vấn thông tin", và gõ **Ghi chú sau cuộc gọi** |                                                          |
| 3    | Bấm **Tạo phiếu**, chọn mức ưu tiên và người xử lý                           | Phiếu xuất hiện ở tab **Phiếu yêu cầu**, nguồn "Từ cuộc gọi" |

### 2.5 Hàng đợi, cuộc gọi nhỡ và gọi ra qua số Pitel

| Bước | Thao tác                                                                                               | Kết quả mong đợi                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1    | Máy A bấm **Tạm nghỉ**, chọn lý do                                                                     | Phòng Tuyển sinh không còn ai Sẵn sàng                                                                 |
| 2    | Máy C (`sv01`) gọi lại Phòng Tuyển sinh                                                                | Máy B, màn Giám sát: "Đang chờ 1", "Chờ lâu nhất" đếm giây, mục **Hàng đợi** có tên sv01               |
| 3    | Máy C gác máy khi đang chờ                                                                             | Tab **Phiếu yêu cầu** có phiếu nguồn "Cuộc gọi nhỡ" (kiểm tra kỹ bước này khi chạy thử)                |
| 4    | Tab **Phiếu yêu cầu** → **Tạo phiếu yêu cầu**, ô **Số điện thoại liên hệ** điền số di động thật của bạn → **Tạo phiếu** |                                                                              |
| 5    | Mở phiếu vừa tạo → bấm **Gọi lại 09…**                                                                 | Gọi ra qua trunk Pitel, điện thoại thật đổ chuông → nghe máy                                           |
| 6    | Máy B, màn Giám sát                                                                                    | Ô gv.ha hiện "Đang đàm thoại · Gọi ra 09…"                                                             |
| 7    | Máy B bấm **Tham gia** → nghe máy                                                                      | Cuộc gọi ba bên với **điện thoại thật bên ngoài**: chứng minh trunk, gọi ra và giám sát cùng hoạt động |

> Giải thích thêm (không demo): khi gọi vào hotline mà phải chờ, người gọi bằng số điện thoại thật được đề nghị bấm `*` để hẹn gọi lại. Hệ thống tạo phiếu "Khách hẹn gọi lại" ưu tiên cao, và cuộc gọi đó không bị tính là bỏ máy trong KPI. Tính năng này đã có test tự động. Hôm nay chưa demo được vì chiều gọi vào hotline chưa thông, còn người gọi từ trình duyệt không có số để gọi lại nên không được đề nghị.

### 2.6 Lịch sử, ghi âm, AI, chấm chất lượng

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                               |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1    | Tab **Lịch sử cuộc gọi** → mở một cuộc của gv.ha có ghi âm                                   | Nghe được ghi âm (link ký HMAC, hết hạn sau 60 giây)          |
| 2    | Mở **Lời thoại**                                                                              | Có bản chép lời và "Tóm tắt (AI, cần kiểm tra lại)"           |
| 3    | Bấm **Áp dụng vào ghi nhận**                                                                  | Mã kết quả và ghi chú được điền sẵn                            |
| 4    | Tab **Chất lượng** → **Chấm điểm cuộc gọi** → chấm điểm thấp hơn ngưỡng                      | Phiếu chấm có badge **"Đã gán bồi dưỡng"**                     |
| 5    | Bấm **Dùng ghi âm làm bài học** → chọn khóa, chương → **Tạo bài học**                       | "Đã tạo bài học từ ghi âm", chuyển sang trang khóa học (bài nháp) |
| 6    | Xem **KPI**: ASA, AHT, tỉ lệ bỏ máy, cuộc gọi theo giờ                                       |                                                                |
| 7    | (Nếu còn thời gian) **Hộp thư thoại** và tab **Cấu hình**: Đường dây nóng & IVR, giờ hành chính, chiến lược phân phối (Rảnh lâu nhất / Xoay vòng) | |

---

## 3. Họp trực tuyến (khoảng 8 phút)

### 3.1 Lịch họp và lời mời

| Bước | Thao tác                                                                                                                 | Kết quả mong đợi                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1    | Máy A đổi sang `giaovu` → menu **Họp**                                                                                   | Lịch tuần: xanh lá là đang diễn ra, xanh dương sắp tới, xám đã qua. Có 5 lịch họp mẫu của nhóm "Giáo vụ Khoa CNTT" |
| 2    | Tạo **Lịch họp** mới: tên, giờ bắt đầu, "Người được mời" → **Mời cả đơn vị** hoặc chọn vài người. Trong **Cấu hình phòng** bật **Phòng chờ**, **tự động ghi hình**, **Tắt mic khi vào** | |
| 3    | Máy C (`gv.lan`)                                                                                                         | Hiện toast mời họp và chuông thông báo có nút "Xem"                    |
| 4    | Ở cột chi tiết, bấm **Tải lịch .ics**                                                                                    | Tải được file mở bằng Outlook/Google Calendar                          |

### 3.2 Vào phòng, điều hành

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                           |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | Máy A: **Vào** → màn **Kiểm tra trước khi vào**                                               | Xem trước camera, thanh đo micro, chọn Micro / Camera / Loa |
| 2    | Máy C (người ngoài danh sách mời) xin vào                                                     | Máy C thấy "Chủ trì sẽ duyệt". Máy A thấy **Phòng chờ** → cho vào |
| 3    | Chia sẻ màn hình, đổi **Chế độ xem** (lưới / tiêu điểm / người nói), ghim một người          |                                                            |
| 4    | Máy C giơ tay. Máy A tắt micro máy C, đặt máy C làm đồng chủ trì, khóa phòng (**Bảo mật phòng**) | Có biểu tượng "Đang giơ tay", có toast thông báo          |
| 5    | Mở bảng **Kết nối**                                                                          | Độ trễ (RTT), Băng thông, Mất gói, Jitter                  |
| 6    | **Tắt Wi-Fi máy C khoảng 5 giây rồi bật lại**. Chỉ làm được khi Máy C là laptop thứ hai kết nối qua IP LAN; nếu cả ba phiên chạy trên một máy (localhost) thì tắt Wi-Fi không cắt kết nối, nên bỏ bước này và chỉ giải thích (đã có test e2e) | Máy C tự vào lại phòng, không cần bấm gì                  |
| 7    | Mở **Chat cuộc họp** (phím C), gửi một tin                                                   |                                                            |

### 3.3 Sau cuộc họp

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                         |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | Kết thúc phiên vừa họp → mở **Điểm danh**                                                     | Giờ vào, giờ rời, thời gian có mặt, xuất .xlsx có MSSV   |
| 2    | Mở cuộc "Họp rút kinh nghiệm ca trực tổng đài" (đã qua, có sẵn từ seed) → **Bản ghi cuộc họp** | Xem lại video, bản chép lời, "Tóm tắt (AI, cần kiểm tra lại)" |
| 3    | Bấm **Thêm vào việc cần làm** cho một việc                                                    | Việc xuất hiện ở bảng Kanban "Công việc"                 |
| 4    | Mở **Biên bản cuộc họp**: chương trình (agenda), ghi chú chung, gửi tóm tắt vào kênh nhóm    |                                                          |

---

## 4. E-learning và luồng liên thông (khoảng 6 phút)

### 4.1 Giảng viên quản lý khóa

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                                     |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | `gv.ha` hoặc `giaovu` → **Khóa học** → mở **CC-201 "Kỹ năng xử lý tình huống tổng đài"**    | Có chương, bài và đủ 4 loại bài: tài liệu, kiểm tra, lớp live, video |
| 2    | Mở **ngân hàng câu hỏi**                                                                      | Các loại câu: một lựa chọn, nhiều lựa chọn, đúng/sai                 |
| 3    | Tab **Học viên**: **Gán học viên** (theo đơn vị / lớp / danh sách email), duyệt yêu cầu ghi danh, xuất tiến độ .xlsx |                                                                      |
| 4    | Mở bài "Lớp live: Xử lý tình huống khó"                                                      | Đã chốt điểm danh, tính có mặt từ 70% thời lượng                     |

### 4.2 Sinh viên học

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                                   |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1    | Máy C (`sv01`) → Khóa học → ghi danh                                                          | Khóa "cần duyệt" thì hiện "Đang chờ giảng viên duyệt"              |
| 2    | Mở bài video, tua đến cuối                                                                    | Không được tính hoàn thành, phải xem đủ 90%. Mở lại thì phát tiếp chỗ đang xem |
| 3    | Làm bài "Kiểm tra tình huống"                                                                 | Câu hỏi ngẫu nhiên, đồng hồ đếm giờ trên máy chủ, chấm tự động     |
| 4    | Mở trình duyệt thường (không đăng nhập) vào `/verify/<mã>`                                    | Trang "Chứng nhận hoàn thành khóa học" của gv.ha                    |

### 4.3 Luồng LT1: E-learning → Tổng đài → Họp video

Đây là điểm nên nhấn mạnh nhất để chứng minh ba dịch vụ là một hệ thống.

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                         |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | Máy A (`gv.ha`) bấm **Sẵn sàng** ở Tổng đài                                                   |                                                          |
| 2    | Máy C (`sv01`) đang xem bài học → bấm **Cần hỗ trợ** → **Gọi ngay từ trình duyệt**            | Máy A đổ chuông, cuộc gọi đi qua ACD như cuộc gọi thường. Cuộc gọi tới đơn vị phụ trách khóa học: nếu đơn vị đó chưa có tổng đài viên thì Máy A không đổ chuông, khi chạy thử phải kiểm tra |
| 3    | Máy A trong cuộc gọi bấm **Mời họp video**                                                    | "Đã mời người gọi vào họp video". sv01 nhận lời mời, phòng họp mở ở tab mới |
| 4    | (Hoặc) sv01 bấm **Gửi yêu cầu hỗ trợ** → xem ở **Tổng đài → Hỗ trợ của tôi**                  | Phiếu sang phòng ban; khi xử lý xong sv01 đánh giá mức hài lòng |

Luồng ngược lại đã demo ở 2.1 và 2.6: khóa bắt buộc, khóa bồi dưỡng theo điểm QA, ghi âm thành bài học.

---

## 5. Quản trị và báo cáo (khoảng 2 phút)

| Bước | Thao tác                                                                                     | Kết quả mong đợi                                               |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1    | `truongkhoa` → **Báo cáo đơn vị**, chọn khoảng ngày                                          | Theo từng khoa: cuộc gọi vào / nghe / bỏ / hẹn lại, giờ họp, ghi danh và hoàn thành. Chỉ có số đếm |
| 2    | `admin` → **Quản trị hệ thống** → khoa, bộ môn, giảng viên, phân quyền                        |                                                                |
| 3    | **Nhật ký hoạt động**                                                                         | Thấy các lượt nghe ghi âm / mở bản ghi vừa làm trong buổi demo |
| 4    | Nhấn mạnh: quản trị hệ thống **không tự nghe** ghi âm của phòng ban mình không có vai trò     |                                                                |

## 6. Số liệu đo (1–2 phút)

Mở `docs/benchmarks/README.md`: SIPp tới 200 cuộc gọi đồng thời, MOS theo E-model, KPI ca trực mô phỏng, Mesh và SFU, chat 50/100/200 socket không lỗi, không trùng.

---

## Nói trước những phần chưa xong

- Hotline đã đăng ký và gọi ra được, nhưng **chiều gọi vào chưa thông**: Pitel đang cho chuyên viên ảo của họ bắt máy, cần họ định tuyến số về máy nhánh 119. Máy đang chạy sau NAT nhà mạng (chưa có VPS), nên trunk đang dùng cấu hình tạm.
- Chưa đo Wireshark/SIPp với trunk thật. Chưa thử RTP qua nhiều mạng với TURN thật. Chưa triển khai VPS production.
- E-learning chưa có bài tự luận chấm tay. Họp chưa có làm mờ/thay nền.
- Dữ liệu seed là dữ liệu mẫu: bản ghi hình là ảnh thử của FFmpeg, ghi âm là lời nhắc của Asterisk, chép lời và tóm tắt là văn bản soạn sẵn. Phần ghi hình/chép lời trực tiếp trong buổi (mục 3.3) mới là dữ liệu thật.

## Phương án dự phòng

| Sự cố                                           | Cách xử lý                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pitel định tuyến xong trước buổi demo           | Ở 2.2 gọi thật vào 02871067388 → nghe IVR → bấm 1. Ở 2.5 có thể demo thêm bấm `*` để hẹn gọi lại            |
| Gọi ra không được (trunk Unregistered)          | `docker exec infra-asterisk-1 asterisk -rx "pjsip show registrations"`. Nếu cổng NAT đổi, sửa `ASTERISK_TRUNK_PUBLIC_PORT` rồi chạy `core restart now` (không khởi động lại container). Không kịp sửa thì bỏ bước 5–7 ở 2.5 |
| Gọi từ trình duyệt không đổ chuông Máy A        | Kiểm tra gv.ha đang Sẵn sàng và softphone đã đăng ký (Bàn làm việc). Dự phòng: Zoiper máy lẻ 1001 gọi 9000    |
| Giám sát báo "Hãy chuyển sang Tạm nghỉ"         | Admin bấm Tạm nghỉ rồi bấm lại                                                                               |
| Không có máy lẻ cho admin                       | Bỏ 2.3 và bước 7 ở 2.5, chỉ cho xem wallboard                                                                |
| AI/Whisper không chạy          | Chỉ dùng cuộc gọi và cuộc họp có sẵn từ seed, nói rõ đó là dữ liệu mẫu                       |
| Mạng phòng báo cáo chặn UDP    | Chạy cả hai trình duyệt trên cùng một máy (localhost)                                         |
