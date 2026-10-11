# Kế hoạch mở rộng 11 tuần (12/10 – 27/12/2026)

Mục tiêu: làm rõ chữ **"tích hợp"** trong tên đề tài và thêm **đóng góp có số đo**, không mở rộng tràn lan. Mỗi tính năng phải đi kèm thiết kế (Chương 3), hiện thực (Chương 4), kiểm thử hoặc đo đạc (Chương 5), và được gỡ khỏi mục Hướng phát triển (Chương 6).

Giả định: hạn nộp là cuối tuần 11 (27/12/2026). **Đóng băng code vào 06/12 (cuối tuần 8).** Sau mốc này chỉ sửa lỗi.

## Tổng quan

| Tuần | Ngày | Hạng mục | Mốc kiểm tra |
| --- | --- | --- | --- |
| 1 | 12/10–18/10 | F1: schema, API ghi chú/agenda, tạo việc trong họp | Migration 021 chạy, test API qua |
| 2 | 19/10–25/10 | F1: UI panel trong phòng họp, tin tổng kết sau họp | Demo luồng họp → task → tổng kết |
| 3 | 26/10–01/11 | F1: test, trang lịch sử cuộc họp; F2: observer phía server | F1 hoàn tất |
| 4 | 02/11–08/11 | F2: UI người đang nói, auto-spotlight, chính sách lớp kết hợp | Demo trên 4 tab |
| 5 | 09/11–15/11 | F2: mở rộng media-lab (audio theo kịch bản), chạy đo | Có file JSON trong `docs/evidence/media-lab` |
| 6 | 16/11–22/11 | F3: điểm chất lượng mạng mỗi người, phản ứng thích nghi | Badge chất lượng hiển thị đúng |
| 7 | 23/11–29/11 | F3: thực nghiệm suy giảm mạng (loss/delay/băng thông) | Bảng kết quả 4 kịch bản |
| 8 | 30/11–06/12 | F4: tin nhắn trực tiếp 1–1 (hoặc P2P↔SFU nếu vượt tiến độ) · **đóng băng code** | `typecheck/lint/test/test:sfu/build` xanh |
| 9 | 07/12–13/12 | Cập nhật báo cáo Chương 1, 3, 4 | Bản nháp gửi GVHD |
| 10 | 14/12–20/12 | Chương 5, 6, hình, bảng, sửa theo góp ý | Bản gần cuối |
| 11 | 21/12–27/12 | Dự phòng, slide, video demo, tập bảo vệ | Nộp |

Điều kiện quyết định cuối tuần 6: nếu F1–F3 xong đúng hạn **và** media-lab ổn định thì tuần 8 làm F4b (P2P↔SFU). Nếu không thì làm F4a (DM). Không làm cả hai.

---

## F1. Cuộc họp tạo ra kết quả công việc (tuần 1–3)

**Thông điệp khi bảo vệ:** cuộc họp không phải một module tách rời. Agenda được lấy từ lịch họp, việc phát sinh trong họp thành thẻ Kanban, và kết quả được đăng lại vào kênh.

### Luồng người dùng
1. Khi tạo lịch họp (`meeting_schedules`), người tạo thêm các mục agenda.
2. Khi vào phòng họp, có panel **"Ghi chú & việc cần làm"** gồm agenda có thể tick, ghi chú chung soạn realtime, và nút "Tạo việc" (tiêu đề, người phụ trách là một người tham dự, deadline).
3. Khi cuộc họp kết thúc (host kết thúc, host rời quá hạn, hoặc người cuối cùng rời), hệ thống đăng **một** tin tổng kết vào kênh: thời lượng, người tham dự, agenda đã xong hoặc chưa, các task đã tạo (có link), và trích ghi chú.
4. Trang lịch sử cuộc họp `/w/:ws/meetings/sessions/:id` hiển thị toàn bộ tổng kết.

### Migration `021_meeting_outcomes.sql`
```sql
CREATE TABLE meeting_agenda_items (
 id uuid PRIMARY KEY,
 schedule_id uuid NOT NULL REFERENCES meeting_schedules(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 position integer NOT NULL DEFAULT 0,
 done_session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL
);
CREATE TABLE meeting_notes (
 session_id uuid PRIMARY KEY REFERENCES meeting_sessions(id) ON DELETE CASCADE,
 content text NOT NULL DEFAULT '' CHECK(length(content)<=20000),
 version integer NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN meeting_session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL;
CREATE INDEX tasks_meeting_idx ON tasks(meeting_session_id) WHERE meeting_session_id IS NOT NULL;
ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK(kind IN ('user','meeting_summary'));
ALTER TABLE messages ADD COLUMN meeting_session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL;
-- Mỗi phiên họp chỉ có đúng một tin tổng kết, kể cả khi nhiều node cùng kết thúc phiên
CREATE UNIQUE INDEX messages_meeting_summary_idx ON messages(meeting_session_id) WHERE kind='meeting_summary';
```
Nhớ cập nhật kiểm tra schema của `/ready` (đang yêu cầu 020) và `npm run verify:restore`.

### Backend
- **Gom việc kết thúc phiên về một hàm.** Hiện có 3 chỗ `UPDATE meeting_sessions SET ended_at` trong [sessions.ts](../../services/api/src/modules/meetings/sessions.ts) (dòng ~59, ~210, ~314). Tách thành `endSession(client, sessionId)`, và hàm này gọi `createMeetingSummary` trong **cùng transaction**, dùng `INSERT … ON CONFLICT DO NOTHING` nhờ unique index ở trên.
- Module mới `services/api/src/modules/meetings/outcomes.ts`: `getNotes`, `saveNotes(baseVersion)` (trả conflict giống task version conflict), `listAgenda`, `toggleAgenda`, `createMeetingTask` (gọi lại `createTask` trong [tasks/service.ts](../../services/api/src/modules/tasks/service.ts) với thêm `meetingSessionId`), `buildSummary`.
- Quyền: chỉ người tham dự đã `admitted` mới sửa ghi chú hoặc tạo việc. Người phụ trách task phải là thành viên kênh.
- Socket (khai báo trong `packages/shared/src/socket.ts`): `meeting_notes_update` → ack `{version}` hoặc `{conflict, current}`, rồi phát `meeting_notes_updated`; `meeting_agenda_toggle`; `meeting_task_create`, phát kèm sự kiện task sẵn có để Kanban cập nhật realtime.
- REST: `GET /api/meetings/sessions/:id/summary`, `GET/PUT /api/meetings/schedules/:id/agenda`. Cập nhật OpenAPI.
- Tin tổng kết: `kind='meeting_summary'`, `author_id` = host, `content` là văn bản dự phòng ngắn (để tìm kiếm và thông báo vẫn chạy). Phần chi tiết lấy qua API summary.

### Frontend
- `apps/web/src/features/meetings/MeetingOutcomesPanel.tsx`: tab mới trong panel họp, cạnh người tham dự và chat.
- Ghi chú: textarea có debounce 600 ms và gửi kèm `baseVersion`. Khi conflict thì hiện bản mới và giữ bản nháp cục bộ để người dùng tự gộp. **Không dùng CRDT**, vì sẽ tốn thêm 1–2 tuần mà không cần thiết cho đồ án. Trong báo cáo, ghi lý do chọn optimistic concurrency.
- Chat: thẻ `MeetingSummaryCard` render khi `message.kind === 'meeting_summary'`.
- Kanban: task có `meetingSessionId` hiện nhãn "Từ cuộc họp …" kèm link, tương tự `source_message_id`.

### Kiểm thử và đánh giá
- API unit: lỗi conflict khi lưu ghi chú; người ngoài cuộc họp bị từ chối; task được gắn đúng phiên.
- Integration (`test:sfu`, có PostgreSQL): kết thúc phiên đồng thời từ 2 process (`SOCKET_ADAPTER=postgres`) → **đúng 1** tin tổng kết.
- Chương 5: bảng test case chức năng; đo độ trễ đồng bộ ghi chú p50/p95 với 10 client bằng cách sửa nhẹ script benchmark chat.

---

## F2. Phát hiện người đang nói và chính sách chọn luồng kết hợp (tuần 3–5)

**Đóng góp:** kết hợp chính sách chọn luồng theo ô hiển thị (đã có) với hoạt động âm thanh, theo tinh thần Last N của Jitsi. Đây là mục 3 trong Hướng phát triển.

### Backend ([room-manager.ts](../../services/api/src/modules/meetings/media/room-manager.ts))
- Khi tạo router, tạo luôn `router.createActiveSpeakerObserver({ interval: 300 })` và `router.createAudioLevelObserver({ threshold: -60, interval: 400 })`.
- Khi tạo producer audio, gọi `observer.addProducer`. Khi đóng producer, `removeProducer` sẽ tự xảy ra.
- Phát vào phòng: `active_speaker {socketId}` và `audio_levels [{socketId, volume}]`. Giới hạn tần suất phía server, tối đa 2–3 lần/giây.
- Ưu tiên băng thông: `consumer.setPriority(2)` cho consumer video của người đang nói, các consumer khác để 1.

### Frontend
- Viền sáng quanh ô đang nói (lấy từ `audio_levels`).
- Bố cục mới **"Tự động"**: `spotlightId` đi theo người đang nói, có **độ trễ giữ 2 s** để không bị nhảy liên tục. Ghim tay thì ghi đè lựa chọn tự động.
- Chính sách lớp kết hợp, mở rộng `demandKey` trong [MeetingPage.tsx](../../apps/web/src/features/meetings/MeetingPage.tsx):
  - Ô không hiển thị → tắt (giữ như hiện tại).
  - Người đang nói → lớp theo kích thước ô, tối thiểu lớp 1.
  - Khi có hơn K ô (ví dụ K=6) → các ô im lặng quá 10 s bị hạ một lớp.
- Giữ cờ chọn chính sách (`visible` | `speaker` | `combined`) để media-lab chuyển được giữa các chế độ.

### Thực nghiệm (media-lab)
- Mỗi client dùng **một file wav riêng** (`--use-file-for-fake-audio-capture`). Harness tạo file theo kịch bản: client *i* nói trong khe thời gian *i* (ví dụ 5 s mỗi người, xoay vòng), còn lại là im lặng.
- Thêm cờ `--policy=visible|speaker|combined`.
- Chỉ số mới:
  - **Độ trễ phát hiện người nói:** từ lúc bắt đầu khe nói đến lúc client nhận `active_speaker`.
  - **Số lần đổi spotlight sai hoặc nhấp nháy.**
  - Downlink mỗi client và bitrate chuyển tiếp ở SFU, với N = 4, 6, 8, 10.
- Kết quả dự kiến cho Chương 5: chính sách `combined` giảm downlink so với `visible` khi N lớn, trong khi người đang nói luôn ở lớp ≥ 1.
- Rủi ro: cờ fake audio trong headless có thể không phát wav đúng nhịp. **Thử việc này ngay đầu tuần 3**, trước khi viết code UI. Phương án dự phòng là bơm audio bằng `AudioContext` + `OscillatorNode` vào track trong client lab.

---

## F3. Chất lượng mạng của từng người và thực nghiệm suy giảm mạng (tuần 6–7)

Hiện tại [qos.ts](../../apps/web/src/features/meetings/webrtc/qos.ts) chỉ thu số liệu của chính mình để xuất CSV/JSON. Phần này mở rộng để mọi người trong phòng đều thấy chất lượng của nhau.

### Thiết kế
- **Phía server (nguồn số liệu chính):** lắng nghe sự kiện `score` của producer và consumer trong mediasoup (thang 0–10 cho mỗi encoding). Gộp theo peer rồi phát `peer_quality {socketId, uplink, downlink}` khi điểm đổi mức.
- **Phía client:** quy đổi loss, RTT, jitter và `qualityLimitationReason` sang 3 mức Tốt / Trung bình / Kém (ngưỡng ghi rõ trong báo cáo).
- UI: biểu tượng cột sóng ở mỗi ô. Khi uplink của chính mình kém kéo dài hơn 10 s, hiện gợi ý "Tắt camera để giữ âm thanh". Khi downlink kém, client tự giới hạn lớp tối đa ở 1.

### Thực nghiệm suy giảm mạng (một phần mục 1 trong Hướng phát triển)
- Môi trường: chạy harness trong **WSL2 Ubuntu**, dùng `tc qdisc … netem` (loss, delay) và `tbf` (giới hạn băng thông) lên interface mà SFU announce. Phương án dự phòng: SFU chạy trên VPS sẵn có ([26-trien-khai-vps.md](../guides/26-trien-khai-vps.md)), client trên Windows, suy giảm mạng bằng `clumsy`.
- Kịch bản, N = 4, mỗi mức 60 s:

  | Kịch bản | Tham số |
  | --- | --- |
  | Cơ sở | không suy giảm |
  | Mất gói | 2%, 5%, 10% |
  | Độ trễ | 50 ms, 150 ms ± 20 ms |
  | Băng thông | 1 client bị giới hạn 500 kbps downlink |
  | Phục hồi | gỡ suy giảm ở giây 30, đo thời gian quay lại lớp 2 |

- Chỉ số: lớp nhận thực tế, FPS, số lần đứng hình, NACK/PLI, điểm mediasoup, thời gian phục hồi. Đối chiếu với bắt gói Wireshark ở `experiments/packet-capture`.
- Kết luận cần chứng minh: simulcast cùng chính sách lớp giúp client yếu tự hạ lớp mà **không** làm giảm chất lượng của các client khác.

---

## F4. Hạng mục tuần 8 (chọn một)

**F4a. Tin nhắn trực tiếp 1–1 (mặc định, rủi ro thấp)**
- Thêm `channels.kind` (`'channel' | 'direct'`) và bảng `direct_pairs(user_low, user_high, channel_id)` có UNIQUE để tránh tạo trùng.
- Tái sử dụng toàn bộ chat, file, thread và cả gọi video, vì DM cũng là một kênh.
- Bổ sung một mục "Tin nhắn trực tiếp" ở sidebar.

**F4b. Tự chuyển P2P ↔ SFU (chỉ làm khi vượt tiến độ)**
- Khi phòng có 2 người thì dùng một `RTCPeerConnection` trực tiếp, signaling qua socket sẵn có. Khi người thứ 3 vào, chuyển theo kiểu "make-before-break": dựng consumer SFU xong mới đóng P2P.
- Đo: uplink ở N=2 khi dùng P2P so với SFU có simulcast, và khoảng đứng hình khi chuyển (ms).

---

## Cập nhật báo cáo (tuần 9–10)

| Chương | Thay đổi |
| --- | --- |
| 1 | Bổ sung mục tiêu "tích hợp kết quả họp vào workspace", thêm DM vào phạm vi nếu làm F4a |
| 3 | ERD mới (migration 021, 022); sequence diagram cho luồng kết thúc họp → tổng kết, luồng active speaker → chọn lớp, luồng score → badge chất lượng |
| 4 | Hiện thực F1–F4; giải thích lý do chọn optimistic concurrency thay vì CRDT; dùng unique index để bảo đảm idempotent giữa nhiều node |
| 5 | Mục mới: (a) test chức năng và độ trễ ghi chú; (b) so sánh 3 chính sách chọn luồng; (c) suy giảm mạng và phục hồi |
| 6 | Gỡ các mục 3, 5 (DM) và một phần mục 1 khỏi Hướng phát triển; cập nhật kết luận |

Cập nhật cả README (danh sách chức năng, bỏ câu "chưa có direct message"), OpenAPI và bản tiếng Anh `docs/thesis/en`.

## Quy tắc giữ tiến độ
- Mỗi tính năng làm trên một nhánh riêng (`feat/meeting-outcomes`, `feat/active-speaker`, `feat/network-quality`, `feat/direct-messages`), và chỉ merge khi bộ kiểm tra trong README chạy xanh.
- Mỗi cuối tuần ghi số liệu thô vào `docs/evidence/` ngay, không dồn đến lúc viết báo cáo.
- Nếu một hạng mục trễ quá 3 ngày: bỏ phần UI phụ, giữ phần có số đo.
- Sau 06/12 không thêm tính năng.
