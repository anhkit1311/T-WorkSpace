# Dịch vụ call center, video conferencing, e-learning cho TDTU

[Cấu trúc mã nguồn](docs/guides/24-cau-truc-du-an.md) · [Mục lục tài liệu](docs/README.md)

Đồ án: **Xây dựng các dịch vụ call center, video conferencing, e-learning cho doanh nghiệp**. Doanh nghiệp áp dụng là Đại học Tôn Đức Thắng (TDTU), dùng nội bộ.

Kiến trúc modular monolith: React/TypeScript + Node.js/Socket.IO + PostgreSQL; mediasoup (SFU) cho họp và lớp live; Asterisk 22 điều khiển qua ARI cho tổng đài. Cập nhật **23/10/2026**.

## Ba dịch vụ

| Dịch vụ | Trạng thái |
| --- | --- |
| Họp trực tuyến | Chạy được đủ luồng (chi tiết bên dưới); đang tập trung hoàn thiện |
| E-learning | Chạy được đủ luồng có backend (chi tiết bên dưới); đang tập trung hoàn thiện |
| Call center (VoIP) | Đã có ACD, IVR, softphone trình duyệt, ghi âm, phiếu, giám sát, chấm chất lượng (`infra/asterisk`, schema `025`, `037`–`039`). **Tạm dừng** cho tới khi có số điện thoại để thử VoIP thật |

### Họp trực tuyến

- Trang "Họp" là lịch tuần (thứ 2 → chủ nhật, 7h–21h, giờ Việt Nam) của mọi nhóm: lịch họp và cả cuộc họp mở nhanh đã diễn ra; xanh lá đang diễn ra, xanh dương sắp tới, xám đã qua. Bấm một cuộc họp mở cột chi tiết: vào phòng, sửa, hủy, tải `.ics`; cuộc họp đã qua có bản ghi, biên bản và điểm danh. "Họp ngay" chọn nhóm (nhớ nhóm dùng gần nhất) rồi vào bước kiểm tra. Điện thoại xem danh sách theo ngày.
- Màn hình kiểm tra trước khi vào (riêng cho từng phòng): xem trước camera, đo mức micro, chọn micro/camera/loa và chất lượng video (360p–720p), ai đang trong phòng, nút "Vào phòng".
- SFU mediasoup: simulcast, chọn lớp video theo ô đang hiển thị hoặc người đang nói, bố cục lưới / tiêu điểm / người nói, ghim, phân trang lưới, chia sẻ màn hình, chat trong phòng.
- Điều hành: phòng chờ, cho vào, mời ra, khóa phòng, tắt micro người khác, giơ tay, đồng chủ trì, chuyển chủ trì, kết thúc phiên.
- Ổn định: tự vào lại phòng khi mất mạng (rớt socket hoặc lỗi ICE), khởi động lại ICE, tạm dừng nhận video khi tab bị ẩn.
- Chất lượng mạng (QoS): RTT, băng thông, mất gói, jitter, tự hạ chất lượng khi mạng yếu; xuất CSV/JSON.
- Biên bản: chương trình họp, ghi chú chung (phát hiện sửa trùng), việc cần làm đưa sang Kanban, gửi tóm tắt vào kênh nhóm.
- Điểm danh từ máy chủ: giờ vào, giờ rời, thời gian có mặt (gộp nhiều tab/kết nối lại), xuất CSV có MSSV; chỉ chủ trì và đồng chủ trì xem.
- Ghi hình phía máy chủ (FFmpeg, không giải mã khi đang họp), xem lại và chia sẻ bản ghi. Cần container FFmpeg: `docker compose -f infra/docker-compose.yml --profile recording up -d ffmpeg` và `FFMPEG_COMMAND="docker exec -i -w /work nexo-ffmpeg ffmpeg"`.
- Chép lời bản ghi (Whisper hoặc faster-whisper qua `TRANSCRIBE_URL`); chưa đặt biến này thì nút chép lời không chạy.
- Chưa có: làm mờ/thay nền; chưa kiểm RTP qua nhiều mạng với TURN thật. Gọi vào phòng họp từ máy lẻ (dial-in) đi qua Asterisk nên tạm dừng cùng tổng đài.

### E-learning

- Khóa học thuộc khoa/phòng ban, có giảng viên phụ trách, bản nháp/xuất bản, chương và bài học sắp xếp được.
- Bốn loại bài: video (tải lên tới 2 GB, FFmpeg chuyển sang HLS, phát bằng hls.js), tài liệu (nội dung hoặc PDF), bài kiểm tra, buổi live.
- Kiểm tra: ngân hàng câu hỏi (một lựa chọn, nhiều lựa chọn, đúng/sai), bốc ngẫu nhiên số câu, trộn phương án, giới hạn thời gian tính trên máy chủ, lưu bài làm dở, chấm tự động theo điểm đạt.
- Buổi live là một lịch họp của khóa: điểm danh tự động (có mặt từ 70% thời lượng), đóng buổi, xem lại bản ghi.
- Người học: tự ghi danh hoặc được giao khóa, theo dõi tiến độ, chứng nhận khi hoàn thành với mã xác minh công khai (`/verify/<mã>`).
- Giảng viên: danh sách người học, tiến độ từng người, xuất CSV tiến độ.
- Thảo luận khóa học qua một nhóm làm việc riêng (chat, tệp, phòng họp); gửi yêu cầu hỗ trợ ngay từ bài học.
- Chép lời video bài học (cùng dịch vụ Whisper như bản ghi họp).
- Theo dõi thời gian xem video: trình phát gửi từng đoạn đã thực sự phát (tua không tính, mỗi lần gửi bị giới hạn theo thời gian thực), bài video chỉ hoàn thành khi đã xem đủ 90%, mở lại thì phát tiếp từ chỗ xem dở. Bài tài liệu và video chưa rõ thời lượng vẫn do người học tự bấm hoàn thành.
- Chưa có: bài tự luận/nộp bài chấm tay; tệp bài học đang lưu trên đĩa của máy chủ API (một máy chủ).

Menu đi theo chức năng, không theo nhóm: "Tin nhắn", "Họp", "Công việc", "Tài liệu" gom dữ liệu của mọi nhóm bạn tham gia (nhóm chỉ là bộ lọc); "Nhóm của tôi" để tạo nhóm, nhập mã mời, xem thành viên, rời nhóm và vào trang quản lý. Link cũ `/app/workspace?...` tự chuyển sang trang tương ứng.

Chat nhóm giữ làm kênh trao đổi nội bộ: ảnh/file/voice, reaction, thread/mention, ghim, tìm kiếm, gửi lại không trùng. Trang "Tin nhắn" giống Messenger: mỗi nhóm là một đoạn chat, xếp chung với trò chuyện 1-1 (`026_direct_messages`) theo tin mới nhất, tin nhắn dạng bong bóng, đầu đoạn chat nhóm có nút "Họp ngay". "Tạo nhóm" chọn từ 2 người trở lên, tên nhóm không bắt buộc (mặc định ghép tên thành viên), người được chọn vào nhóm ngay. Nhóm mới chỉ có một kênh chat; kênh phụ của nhóm cũ được ẩn, dữ liệu vẫn giữ. "Tài liệu" tìm tệp theo tên ở mọi nhóm và tải tệp lên một kênh.

Nền tảng chung: đăng nhập email + mật khẩu (OTP qua email), hồ sơ, presence, lưu file DB/S3, metrics, migration có khóa.

"Công việc" là một bảng Kanban cho việc ở mọi nhóm (mặc định việc giao cho tôi; lọc theo nhóm, sắp hết hạn, trạng thái, ưu tiên); mỗi thẻ ghi tên nhóm và kênh, việc cần làm từ biên bản họp cũng vào đây. Phân hệ quản lý đồ án tốt nghiệp đã được gỡ; chỉ còn khoa, bộ môn, giảng viên và phân quyền (trang "Quản trị hệ thống"). Các bảng `thesis_*` (migration 022–024) vẫn giữ trong DB, không còn code dùng.

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

Web localhost:5173; API localhost:3001. Vite dùng polling watcher trong development Windows. DB đã có dữ liệu nâng cấp bằng migrate, không xóa volume. Tổng 40 migration (`services/api/migrations`), bytea cũ vẫn tương thích.

Dev server dùng cổng của `WEB_ORIGIN` trong `.env` (mẫu mặc định 5173), báo lỗi nếu cổng bận.

### Tổng đài (Asterisk 22, đang tạm dừng)

Điền `ASTERISK_ARI_PASSWORD` và `ASTERISK_SPIKE_SIP_PASSWORD` (≥ 12 ký tự) trong `.env`, rồi:

```powershell
npm run callcenter:up        # build Asterisk 22 từ mã nguồn (lần đầu vài phút), mở 5060/udp, 8088, 10000-10099/udp
npm run callcenter:ari-spike # in StasisStart khi có cuộc gọi vào ứng dụng ARI "nexo"
npm run callcenter:seed -- giaovu@demo.nexo.test gv.ha@demo.nexo.test  # 2 phòng ban, hotline 19001234 (IVR phím 1/2), máy lẻ cho từng email
```

- Máy lẻ thử: 1001, 1002 (Zoiper/Linphone, UDP 127.0.0.1:5060) và 1101 (trình duyệt), cùng mật khẩu `ASTERISK_SPIKE_SIP_PASSWORD`.
- Trang thử JsSIP: `http://localhost:<cổng web>/softphone-test.html` (chỉ có ở dev server).
- Số thử: 1001/1002/1101 gọi nhau; 8000 echo kiểm tra tiếng; 9000 chuyển vào ARI.
- Không có SIP trunk: tổng đài chỉ dùng nội bộ TDTU. Máy lẻ của các phòng ban gọi nhau, sinh viên gọi hotline từ trình duyệt (đã đăng nhập). Số ngoài (0…, 00…, +…) bị từ chối.
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

`test:e2e` (Playwright, dùng Chrome đã cài) chạy trên `npm run dev` và DB local: đăng nhập, trang Quản trị hệ thống, hai người họp video với camera giả và tự vào lại phòng sau khi mất mạng, mở trang Khóa học và Tổng đài, menu theo chức năng, tài khoản chưa có nhóm, gửi tin trong kênh, tạo việc từ "Công việc", tải tệp từ "Tài liệu", lên lịch rồi vào phòng từ lịch tuần. Tài khoản test tạo trong `e2e/global-setup.mjs` và bị xoá khi chạy xong.

`npm test` chạy unit test của web và API; các test cần PostgreSQL chỉ chạy khi đặt `RUN_DB_TESTS=1` (gồm luồng e-learning đầy đủ, phiên họp, biên bản, ghi hình, QoS). `test:sfu` chạy riêng các test có PostgreSQL và mediasoup. Kiểm signaling/worker không chứng minh RTP đa mạng.

```powershell
npm run benchmark:chat
node scripts/benchmarks/summarize-chat-load.mjs
npm run verify:restore
```

Dữ liệu demo khoa CNTT: tạo quản trị hệ thống trước (`node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin`), đặt `SEED_ACADEMIC_PASSWORD` trong `.env` rồi chạy `npm run seed:academic` (thêm `-- --reset` để tạo lại). `giaovu@demo.nexo.test` là giáo vụ khoa, `truongkhoa@…` là lãnh đạo khoa, `gv.*@…` là giảng viên, `sv01…sv30@…` là sinh viên.

Benchmark local50/100/200 socket,2 API process,4tin/giây,30s ×2/mức:732tin,0lỗi/trùng trong kịch bản. Raw, phân vị và giới hạn ở [báo cáo20](docs/benchmarks/20-benchmark-va-nghiem-thu.md). Restore dùng hai DB QA mới, kiểm20 migration/dữ liệu Unicode và dọn đúng fixtures.

## API và vận hành

- GET /health: liveness.
- GET /ready: PostgreSQL và schema đã migrate tới migration mới nhất.
- GET /api/openapi.json: danh mục REST; socket types trong packages/shared/src/socket.ts.
- Gom theo người dùng (mọi nhóm đang tham gia): `GET /api/tasks?assignee=me|all&workspace&status&priority&deadline&archived` (tối đa 500), `GET /api/files?workspace&q&before&limit`, `GET /api/meetings/calendar?from&to` (tối đa 42 ngày; lịch họp chưa hủy và các phiên họp kèm người tham gia).
- GET /api/operations/metrics: cần OPERATIONS_TOKEN riêng.
- SOCKET_ADAPTER=postgres: đồng bộ chat/task/notification giữa node, lease45s/heartbeat15s. WebSocket hoặc sticky-session nếu polling.
- SFU_PUBLIC_URL/room affinity: media socket đến đúng owner; một room/router trên một worker/node. Adapter không chia sẻ media transport.

[Triển khai HTTPS/Compose](docs/guides/10-trien-khai-production.md), [backend/storage/retention/backup](docs/guides/17-backend-va-van-hanh.md). Compose production truyền các env mới, kiểm /ready, proxy upload8MiB; vẫn cần secrets, domain, email, public IP và TURN thực.

## Tài liệu bàn giao

| Nội dung                            | Tài liệu                                              |
| ----------------------------------- | ----------------------------------------------------- |
| Checklist8 giai đoạn                | [13](docs/planning/13-trien-khai-theo-giai-doan-2026-09-30.md) |
| Quyền/quản trị/invitation           | [14](docs/modules/14-quan-tri-va-hop-dong.md)                 |
| Chat/thread/search/Kanban           | [15](docs/modules/15-chat-va-kanban.md)                       |
| Session/host/media                  | [16](docs/modules/16-dieu-hanh-hop-va-media.md)               |
| Backend và vận hành                 | [17](docs/guides/17-backend-va-van-hanh.md)                  |
| UI/drafts/before-after bundle       | [18](docs/modules/18-giao-dien-va-ban-nhap.md)                |
| Kiến trúc/ERD/6 sequence            | [19](docs/analysis/19-kien-truc-schema-va-luong.md)            |
| Benchmark/raw/QoS/procedure         | [20](docs/benchmarks/20-benchmark-va-nghiem-thu.md)              |
| Cài đặt/env/quyền/traceability/demo | [21](docs/guides/21-ban-giao-va-demo.md)                     |

Source đã triển khai và kiểm local; còn gate RTP3/6/10 đa mạng/TURN, email/S3 cloud, native zoom200%, máy yếu, CI remote và backup production. Không kết luận production-ready. Audit npm còn7 high trong devtool transitive; chi tiết giới hạn ở bàn giao.
