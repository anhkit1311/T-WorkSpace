# Dịch vụ call center, video conferencing, e-learning cho TDTU

[Triển khai lên VPS](docs/deploy/trien-khai-vps.md) · [Kết quả đo](docs/benchmarks/README.md) · [Chương đánh giá](docs/thesis/chuong-danh-gia.md) · [Đặc tả](docs/thesis/Đặc%20tả%20đề%20tài%20đồ%20án.docx)

Đồ án: **Xây dựng các dịch vụ call center, video conferencing, e-learning cho doanh nghiệp**. Doanh nghiệp áp dụng là Đại học Tôn Đức Thắng (TDTU), dùng nội bộ.

Kiến trúc modular monolith: React/TypeScript + Node.js/Socket.IO + PostgreSQL; mediasoup (SFU) cho họp và lớp live; Asterisk 22 điều khiển qua ARI cho tổng đài. Cập nhật **23/10/2026**.

## Ba dịch vụ

| Dịch vụ | Trạng thái |
| --- | --- |
| Họp trực tuyến | Chạy được đủ luồng (chi tiết bên dưới); đang tập trung hoàn thiện |
| E-learning | Chạy được đủ luồng có backend (chi tiết bên dưới); đang tập trung hoàn thiện |
| Call center (VoIP) | Đã có ACD, IVR, softphone trình duyệt, ghi âm, phiếu, giám sát, chấm chất lượng, chép lời và tóm tắt cuộc gọi bằng AI, hẹn gọi lại khi đang chờ (`infra/asterisk`, schema `025`, `037`–`039`, `046`, `055`, `056`). SIP trunk Pitel đã đăng ký (đầu số hotline); còn thử cuộc gọi thật vào/ra, đo Wireshark và SIPp |

### Họp trực tuyến

- Trang "Họp" là lịch tuần (thứ 2 → chủ nhật, 7h–21h, giờ Việt Nam) của mọi nhóm: lịch họp và cả cuộc họp mở nhanh đã diễn ra; xanh lá đang diễn ra, xanh dương sắp tới, xám đã qua. Bấm một cuộc họp mở cột chi tiết: vào phòng, sửa, hủy, tải `.ics`; cuộc họp đã qua có bản ghi, biên bản và điểm danh. "Họp ngay" chọn nhóm (nhớ nhóm dùng gần nhất) rồi vào bước kiểm tra. Điện thoại xem danh sách theo ngày.
- Màn hình kiểm tra trước khi vào (riêng cho từng phòng): xem trước camera, đo mức micro, chọn micro/camera/loa và chất lượng video (360p–720p), ai đang trong phòng, nút "Vào phòng".
- SFU mediasoup: simulcast, chọn lớp video theo ô đang hiển thị hoặc người đang nói, bố cục lưới / tiêu điểm / người nói, ghim, phân trang lưới, chia sẻ màn hình, chat trong phòng.
- Điều hành: phòng chờ, cho vào, mời ra, khóa phòng, tắt micro người khác, giơ tay, đồng chủ trì, chuyển chủ trì, kết thúc phiên.
- Ổn định: tự vào lại phòng khi mất mạng (rớt socket hoặc lỗi ICE), khởi động lại ICE, tạm dừng nhận video khi tab bị ẩn.
- Chất lượng mạng (QoS): RTT, băng thông, mất gói, jitter, tự hạ chất lượng khi mạng yếu; xuất CSV/JSON.
- Biên bản: chương trình họp, ghi chú chung (phát hiện sửa trùng), việc cần làm đưa sang Kanban, gửi tóm tắt vào kênh nhóm.
- Lời mời và nhắc họp (NV-MT1): tạo, sửa, hủy lịch họp gửi thông báo (toast realtime) và email cho thành viên phòng; 15 phút trước giờ họp hệ thống nhắc một lần, đổi giờ bắt đầu thì nhắc lại (`048_meeting_reminders`). Lời mời và lời nhắc cũng vào chuông thông báo, bấm "Xem" mở thẳng phòng họp (`051_system_notifications`).
- Mời theo danh sách: lịch họp có thể chỉ mời một số người, cả một nhóm/lớp khác hoặc cả một đơn vị (tối đa 500 người); người ngoài nhóm được thêm vào nhóm của phòng. Cấu hình phòng theo lịch: bật phòng chờ (người được mời vào thẳng, người khác chờ duyệt), tự ghi hình khi chủ trì vào, tắt micro khi vào lần đầu (`052_meeting_room_settings`).
- Điểm danh từ máy chủ: giờ vào, giờ rời, thời gian có mặt (gộp nhiều tab/kết nối lại), xuất CSV có MSSV; chỉ chủ trì và đồng chủ trì xem.
- Ghi hình phía máy chủ (FFmpeg, không giải mã khi đang họp), xem lại và chia sẻ bản ghi. Cần container FFmpeg: `docker compose -f infra/docker-compose.yml --profile recording up -d ffmpeg` và `FFMPEG_COMMAND="docker exec -i -w /work tws-ffmpeg ffmpeg"`.
- Chép lời bản ghi (Whisper hoặc faster-whisper qua `TRANSCRIBE_URL`); chưa đặt biến này thì nút chép lời không chạy.
- Tóm tắt bằng AI (`055_ai_summaries`): khi chép lời xong, bản chép lời được gửi tới `SUMMARY_URL` (endpoint `/v1/chat/completions` dạng OpenAI, ví dụ Ollama tự host để dữ liệu không rời trường; mô hình `SUMMARY_MODEL`). Bản ghi họp có đoạn tóm tắt và danh sách việc cần làm, chủ trì bấm "Thêm vào việc cần làm" để đưa từng việc sang Kanban. Chỉ gửi văn bản chép lời, không gửi âm thanh; kết quả chỉ là gợi ý, người dùng vẫn tự viết biên bản.
- Chưa có: làm mờ/thay nền; chưa kiểm RTP qua nhiều mạng với TURN thật. Gọi vào phòng họp từ máy lẻ (dial-in) đi qua Asterisk nên tạm dừng cùng tổng đài.

### E-learning

- Khóa học thuộc khoa/phòng ban, có giảng viên phụ trách, bản nháp/xuất bản, chương và bài học sắp xếp được.
- Bốn loại bài: video (tải lên tới 2 GB, FFmpeg chuyển sang HLS, phát bằng hls.js), tài liệu (nội dung hoặc PDF), bài kiểm tra, buổi live.
- Kiểm tra: ngân hàng câu hỏi (một lựa chọn, nhiều lựa chọn, đúng/sai), bốc ngẫu nhiên số câu, trộn phương án, giới hạn thời gian tính trên máy chủ, lưu bài làm dở, chấm tự động theo điểm đạt, giới hạn số lần làm cho người học (`053_quiz_max_attempts`).
- Buổi live là một lịch họp của khóa: điểm danh tự động (có mặt từ 70% thời lượng), đóng buổi, xem lại bản ghi.
- Người học: tự ghi danh, gửi yêu cầu ghi danh vào khóa "cần duyệt" (giảng viên duyệt hoặc từ chối ở tab Học viên, `049_course_enrollment_requests`) hoặc được giao khóa (được báo qua chuông khi ghi danh xong hoặc bị từ chối), theo dõi tiến độ, chứng nhận khi hoàn thành với mã xác minh công khai (`/verify/<mã>`).
- Giảng viên: danh sách người học, tiến độ từng người, xuất tiến độ (`.xlsx`/`.csv`).
- Thảo luận khóa học qua một nhóm làm việc riêng (chat, tệp, phòng họp); gửi yêu cầu hỗ trợ ngay từ bài học.
- Chép lời video bài học (cùng dịch vụ Whisper như bản ghi họp).
- Theo dõi thời gian xem video: trình phát gửi từng đoạn đã thực sự phát (tua không tính, mỗi lần gửi bị giới hạn theo thời gian thực), bài video chỉ hoàn thành khi đã xem đủ 90%, mở lại thì phát tiếp từ chỗ xem dở. Bài tài liệu và video chưa rõ thời lượng vẫn do người học tự bấm hoàn thành.
- Chưa có: bài tự luận/nộp bài chấm tay; tệp bài học đang lưu trên đĩa của máy chủ API (một máy chủ).

Tổng đài: cuộc gọi có ghi âm được chép lời rồi tóm tắt bằng AI (cùng `SUMMARY_URL`), kèm gợi ý mã kết quả lấy từ danh sách mã của phòng ban; ở "Lời thoại" bấm "Áp dụng vào ghi nhận" để điền mã kết quả và ghi chú (ghi chú đã có thì giữ nguyên). Khi đang chờ trong hàng đợi, người gọi nghe hướng dẫn bấm `*` để hẹn gọi lại: cuộc gọi kết thúc là "Hẹn gọi lại" (không tính là bỏ máy trong KPI) và phòng ban có ticket gọi lại ưu tiên cao (`056_queue_callback`). Chỉ số điện thoại thật mới được đề nghị; cuộc gọi từ trình duyệt và số ẩn thì không.

Báo cáo đơn vị (menu "Báo cáo đơn vị", cho quản trị hệ thống và trưởng khoa / giáo vụ đơn vị): theo khoảng ngày, mỗi khoa/phòng ban có số cuộc gọi vào hàng đợi, nghe máy, bỏ máy, hẹn gọi lại; số phiên và giờ họp do giảng viên, nhân viên của đơn vị chủ trì; số khóa đang mở, lượt ghi danh và hoàn thành. Chỉ có số đếm, không có dữ liệu từng người.

Nhật ký truy cập (dùng chung): mỗi lượt nghe ghi âm cuộc gọi, tin nhắn thoại hoặc mở bản ghi cuộc họp được ghi lại (`050_media_access_log`); quản trị hệ thống xem ở Quản trị hệ thống → "Nhật ký hoạt động", gộp cùng thay đổi nhóm và tổ chức. Ghi âm và bản ghi họp chỉ phát qua link ký HMAC gắn với người xem và hết hạn (ghi âm 60 giây, playlist 5 phút); quản trị hệ thống không tự nghe ghi âm hay đọc ticket của phòng ban mình không có vai trò. Điểm danh, tiến độ khóa học và báo cáo cuộc gọi xuất được `.xlsx` (dòng tiêu đề in đậm) hoặc `.csv`; ô văn bản trong `.xlsx` là chuỗi thuần, CSV chặn công thức Excel (ô bắt đầu bằng `= + - @`).

Menu đi theo chức năng, không theo nhóm: "Tin nhắn", "Họp", "Công việc", "Tài liệu" gom dữ liệu của mọi nhóm bạn tham gia (nhóm chỉ là bộ lọc); "Nhóm của tôi" để tạo nhóm, nhập mã mời, xem thành viên, rời nhóm và vào trang quản lý. Link cũ `/app/workspace?...` tự chuyển sang trang tương ứng.

Chat nhóm giữ làm kênh trao đổi nội bộ: ảnh/file/voice, reaction, thread/mention, ghim, tìm kiếm, gửi lại không trùng. Trang "Tin nhắn" giống Messenger: mỗi nhóm là một đoạn chat, xếp chung với trò chuyện 1-1 (`026_direct_messages`) theo tin mới nhất, tin nhắn dạng bong bóng, đầu đoạn chat nhóm có nút "Họp ngay". "Tạo nhóm" chọn từ 2 người trở lên, tên nhóm không bắt buộc (mặc định ghép tên thành viên), người được chọn vào nhóm ngay. Nhóm mới chỉ có một kênh chat; kênh phụ của nhóm cũ được ẩn, dữ liệu vẫn giữ. "Tài liệu" tìm tệp theo tên ở mọi nhóm và tải tệp lên một kênh.

Nền tảng chung: đăng nhập email + mật khẩu (OTP qua email), hồ sơ, presence, lưu file DB/S3, metrics, migration có khóa.

"Công việc" là một bảng Kanban cho việc ở mọi nhóm (mặc định việc giao cho tôi; lọc theo nhóm, sắp hết hạn, trạng thái, ưu tiên); mỗi thẻ ghi tên nhóm và kênh, việc cần làm từ biên bản họp cũng vào đây. Phân hệ quản lý đồ án tốt nghiệp đã được gỡ; chỉ còn khoa, bộ môn, giảng viên và phân quyền (trang "Quản trị hệ thống"). Các bảng `thesis_*` đã được xóa (`054_drop_thesis_tables`); hồ sơ người gọi lấy MSSV từ mã người dùng.

## Chạy local

Node **22**, npm, Docker. Từ PowerShell ở thư mục gốc:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:migrate
```

Sửa JWT_SECRET thành chuỗi ngẫu nhiên ít nhất32 ký tự; kiểm DATABASE_URL/WEB_ORIGIN/VITE_API_URL. Cấu hình Resend hoặc SMTP để đăng ký/nhận OTP; hệ thống không log mã xác thực.

Chạy API và web cùng lúc bằng một lệnh (Ctrl+C dừng cả hai):

```powershell
npm run dev
```

Cần chạy riêng thì dùng `npm run dev:api` hoặc `npm run dev:web`.

Web localhost:5173; API localhost:3001. Vite dùng polling watcher trong development Windows. DB đã có dữ liệu nâng cấp bằng migrate, không xóa volume. Tổng 56 migration (`services/api/migrations`), bytea cũ vẫn tương thích.

Dev server dùng cổng của `WEB_ORIGIN` trong `.env` (mẫu mặc định 5173), báo lỗi nếu cổng bận.

### Tổng đài (Asterisk 22)

Điền `ASTERISK_ARI_PASSWORD` và `ASTERISK_SPIKE_SIP_PASSWORD` (≥ 12 ký tự) trong `.env`, rồi:

```powershell
npm run callcenter:up        # build Asterisk 22 từ mã nguồn (lần đầu vài phút), mở 5060/udp, 8088, 10000-10499/udp
npm run callcenter:ari-spike # in StasisStart khi có cuộc gọi vào ứng dụng ARI "tworkspace"
npm run callcenter:seed -- giaovu@demo.tworkspace.test gv.ha@demo.tworkspace.test  # 2 phòng ban, hotline ASTERISK_TRUNK_NUMBER (mặc định 19001234; IVR phím 1/2), máy lẻ cho từng email
```

- Máy lẻ thử: 1001, 1002 (Zoiper/Linphone, UDP 127.0.0.1:5060) và 1101 (trình duyệt), cùng mật khẩu `ASTERISK_SPIKE_SIP_PASSWORD`.
- Số thử: 1001/1002/1101 gọi nhau; 8000 echo kiểm tra tiếng; 9000 chuyển vào ARI.
- SIP trunk (CC-4): điền `ASTERISK_TRUNK_USERNAME/PASSWORD/SERVER/NUMBER` trong `.env` rồi `npm run callcenter:up`; Asterisk đăng ký qua cổng 5070/udp (`pjsip show registrations`). Cuộc gọi vào đầu số đi vào IVR của hotline có số bằng `ASTERISK_TRUNK_NUMBER`. Máy lẻ được quyền "Gọi ra ngoài" (BR-20, tổng đài viên bật sẵn) gọi số di động/cố định trong nước (0 + 9–10 số); tối đa 4 cuộc gọi ra cùng lúc, 30 phút mỗi cuộc. Số quốc tế (00…, +…) luôn bị chặn. Để trống `ASTERISK_TRUNK_USERNAME` thì tổng đài chỉ dùng nội bộ.
- Máy khác trong LAN: đặt `ASTERISK_EXTERNAL_IP` là IP LAN của máy chạy Docker.

## Kiểm tra

```powershell
npm run typecheck
npm run lint
npm test
npm run test:sfu
npm run test:e2e
npm run build
```

`test:e2e` (Playwright, dùng Chrome đã cài) chạy trên `npm run dev` và DB local: đăng nhập, trang Quản trị hệ thống, hai người họp video với camera giả và tự vào lại phòng sau khi mất mạng, mở trang Khóa học và Tổng đài, menu theo chức năng, tài khoản chưa có nhóm, gửi tin trong kênh, tải tệp từ "Tài liệu", lên lịch rồi vào phòng từ danh sách lịch họp. Tài khoản test tạo trong `e2e/global-setup.mjs` và bị xoá khi chạy xong.

`npm test` chạy unit test của web và API; các test cần PostgreSQL chỉ chạy khi đặt `RUN_DB_TESTS=1` (gồm luồng e-learning đầy đủ, phiên họp, biên bản, ghi hình, QoS). `test:sfu` chạy riêng các test có PostgreSQL và mediasoup. Kiểm signaling/worker không chứng minh RTP đa mạng.

```powershell
npm run benchmark:chat
node scripts/benchmarks/summarize-chat-load.mjs
npm run verify:restore
```

Dữ liệu demo khoa CNTT: tạo quản trị hệ thống trước (`node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin`), đặt `SEED_ACADEMIC_PASSWORD` trong `.env` rồi chạy `npm run seed:academic` (thêm `-- --reset` để tạo lại). `giaovu@demo.tworkspace.test` là giáo vụ khoa, `truongkhoa@…` là lãnh đạo khoa, `gv.*@…` là giảng viên, `sv01…sv30@…` là sinh viên.

Dữ liệu cho buổi bảo vệ: `npm run demo:seed` (cần Asterisk và FFmpeg đang chạy: `npm run callcenter:up`, `docker compose -f infra/docker-compose.yml --profile recording up -d ffmpeg`). Ngoài khoa CNTT, tổng đài và khóa CC-101, `scripts/database/seed-showcase.mjs` tạo nhóm "Giáo vụ Khoa CNTT" với lịch họp tuần này, một cuộc họp đã qua có bản ghi + chép lời + tóm tắt AI + 3 việc, khóa CC-201 đủ 4 loại bài (tài liệu, kiểm tra, lớp live đã chốt điểm danh, video xem lại), `gv.ha` hoàn thành CC-201 (mã chứng nhận in ra để mở `/verify/<mã>`). Muốn có lịch sử tổng đài như một ca trực thật, chạy trước `node scripts/callcenter/simulate-shift.mjs giaovu@demo.tworkspace.test gv.ha@demo.tworkspace.test gv.lan@demo.tworkspace.test` (khoảng 30 phút; 28 cuộc gọi qua ACD thật với PBX giả lập), rồi seed sẽ gắn chép lời, tóm tắt AI, ghi âm và điểm QA cho một cuộc của `gv.ha`. Bản ghi hình là ảnh thử của FFmpeg, ghi âm là lời nhắc của Asterisk, chép lời/tóm tắt là văn bản soạn sẵn.

Benchmark local50/100/200 socket,2 API process,4tin/giây,30s ×2/mức:732tin,0lỗi/trùng trong kịch bản. Kết quả đo tải (k6, chat, ACD và SIPp tới 200 cuộc đồng thời, MOS theo E-model, KPI ca trực mô phỏng, Mesh/SFU, họp qua TURN), dữ liệu gốc và giới hạn ở [docs/benchmarks](docs/benchmarks/README.md). Restore dùng hai DB QA mới, kiểm20 migration/dữ liệu Unicode và dọn đúng fixtures.

## API và vận hành

- GET /health: liveness.
- GET /ready: PostgreSQL và schema đã migrate tới migration mới nhất.
- GET /api/openapi.json: danh mục REST; socket types trong packages/shared/src/socket.ts.
- Gom theo người dùng (mọi nhóm đang tham gia): `GET /api/tasks?assignee=me|all&workspace&status&priority&deadline&archived` (tối đa 500), `GET /api/files?workspace&q&before&limit`, `GET /api/meetings/calendar?from&to` (tối đa 42 ngày; lịch họp chưa hủy và các phiên họp kèm người tham gia).
- GET /api/operations/metrics: cần OPERATIONS_TOKEN riêng.
- SOCKET_ADAPTER=postgres: đồng bộ chat/task/notification giữa node, lease45s/heartbeat15s. WebSocket hoặc sticky-session nếu polling.
- SFU_PUBLIC_URL/room affinity: media socket đến đúng owner; một room/router trên một worker/node. Adapter không chia sẻ media transport.

[Triển khai lên VPS](docs/deploy/trien-khai-vps.md): tường lửa, chứng chỉ Let's Encrypt, `infra/.env.prod`, Compose production (`--profile turn` bật coturn), migrate, tạo quản trị, kiểm tra sau triển khai. Vẫn cần VPS có IP công khai, tên miền, email và trunk Pitel thật.

## Tài liệu

| Nội dung | Tài liệu |
| --- | --- |
| Đặc tả đề tài | [docs/thesis/Đặc tả đề tài đồ án.docx](docs/thesis/Đặc%20tả%20đề%20tài%20đồ%20án.docx) |
| Báo cáo đồ án | [docs/thesis](docs/thesis) (`Bao_Cao_Do_An_T-WorkSpace*.docx/pdf`) |
| Triển khai VPS | [docs/deploy/trien-khai-vps.md](docs/deploy/trien-khai-vps.md) |
| Kết quả đo, dữ liệu gốc | [docs/benchmarks/README.md](docs/benchmarks/README.md) |
| Chương đánh giá (bản nháp) | [docs/thesis/chuong-danh-gia.md](docs/thesis/chuong-danh-gia.md) |
| Mở rộng nhiều máy chủ | [docs/architecture/scale-out.md](docs/architecture/scale-out.md) |

Source đã triển khai và kiểm local; còn gate RTP3/6/10 đa mạng/TURN, email/S3 cloud, native zoom200%, máy yếu, CI remote và backup production. Không kết luận production-ready. `npm audit --omit=dev` không còn lỗ hổng (đã nâng nodemailer); còn một lỗi mức moderate của `minimatch` trong công cụ dev (eslint), chưa có bản sửa.
