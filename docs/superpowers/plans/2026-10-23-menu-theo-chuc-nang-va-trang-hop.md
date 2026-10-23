# Menu theo chức năng và trang Họp dạng lịch tuần: kế hoạch làm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bỏ khung "vào nhóm rồi chọn tab"; menu chính có Tin nhắn, Họp, Công việc, Tài liệu gom dữ liệu của mọi nhóm, "Nhóm của tôi" chỉ để quản lý; trang Họp mở ra lịch tuần, vào phòng qua một màn hình kiểm tra thiết bị riêng.

**Architecture:** Máy chủ thêm ba API đọc thuần gom theo người dùng (`/api/tasks`, `/api/files`, `/api/meetings/calendar`), dùng lại quyền `channel_access` như API hiện có. Web bỏ `WorkspaceShell`; mỗi mục menu render thẳng một trang (`MessagesPage`, `TaskBoardPage`, `FilesPage`, `MeetingPage`, `GroupsPage`). Tham số `workspace` trên URL thành bộ lọc nhóm của trang. `MeetingPage` tách thành lịch (`MeetingsCalendar`), màn hình trước khi vào (`PreJoinScreen`) và phòng họp (giữ nguyên phần đang có).

**Tech Stack:** React 19 + TypeScript (Vite), Node 22 + PostgreSQL, Socket.IO, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-menu-theo-chuc-nang-va-trang-hop-design.md`

## Global Constraints

- Không thêm thư viện mới (lịch tuần tự vẽ bằng CSS grid).
- Chữ trên giao diện tiếng Việt, đúng nhãn của spec: "Tin nhắn", "Họp", "Công việc", "Tài liệu", "Nhóm của tôi", "Họp ngay", "+ Lên lịch", "Hôm nay", "Vào", "Vào phòng", "Lọc thêm", "Việc mới", "Tải lên", "Tạo nhóm", "Nhập mã mời", "Quản lý".
- Màu chỉ dùng token CSS sẵn có, chạy đúng cả chế độ sáng và tối; bố cục chạy ở bề rộng ≤ 480 px.
- Không đổi mô hình dữ liệu: không migration mới; việc vẫn thuộc kênh, tệp vẫn là tệp đính kèm của kênh.
- Phòng họp bên trong (lưới video, thanh điều khiển, bảng bên) giữ nguyên.
- Mọi chức năng làm được ở giao diện cũ vẫn làm được ở giao diện mới.
- Commit thẳng trên `main`, mỗi task một commit, cuối message có `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Lệnh kiểm tra chung:
  - Build: `npm run build --workspace @doan/shared && npm run build --workspace @doan/api`
  - DB test: `cd services/api && RUN_DB_TESTS=1 node --test test/<file>.test.js`
  - Web test: `cd apps/web && node --experimental-strip-types --test test/*.test.js`
  - `npm run typecheck`, `npm run lint`, `npm run test:e2e`

## Review Focus

1. **Link cũ** (thông báo, email mời, `.ics`, Ctrl K) có `workspace`/`channel`/`message`/`thread`/`task`/`schedule` phải mở đúng trang mới, không ra trang "Đường dẫn không hợp lệ" → test trong Task 4.
2. **Người chưa có nhóm nào**: Tin nhắn, Công việc, Tài liệu, Họp hiện trạng thái trống có nút "Tạo nhóm" / "Nhập mã mời", không báo lỗi → test trong Task 5 (E2E với tài khoản mới).
3. **Nhóm hoặc kênh đã lưu trữ**: không xuất hiện trong ô chọn khi tạo việc, tải tệp, họp ngay, lên lịch; nội dung cũ vẫn xem được → test trong Task 1 và Task 3.
4. **Ranh giới lịch tuần theo giờ Việt Nam**: cuộc họp 23:30 chủ nhật, cuộc họp qua nửa đêm, cuộc họp ngoài khung 7h–21h, hai cuộc họp trùng giờ → test trong Task 10.
5. **Đang trong cuộc họp mà bấm mục "Họp"**: phải thấy phòng họp, không thấy lịch hay màn hình kiểm tra; rời phòng thì về lịch → test trong Task 10.

---

### Task 1: API công việc của mọi nhóm

**Files:**
- Modify: `services/api/src/modules/tasks/service.ts` (thêm `listAllTasks`)
- Modify: `services/api/src/modules/tasks/routes.ts` (route `GET /api/tasks`)
- Modify: `packages/shared/src/index.ts` (type `TaskBoardItem`)
- Test: `services/api/test/cross-group.test.js` (file mới, dùng chung cho Task 1–3)

**Interfaces:**
- Produces: `listAllTasks(userId: string, params: URLSearchParams): Promise<{ tasks: TaskBoardItem[]; truncated: boolean }>`
- Produces: `type TaskBoardItem = TaskItem & { workspaceId: string; workspaceName: string; channelName: string; workspaceArchived: boolean }`
- Tham số: `assignee=me|all` (mặc định `me`), `workspace=<uuid>`, `deadline=overdue|upcoming|none`, `priority`, `status`, `archived=true`. Dùng lại cách kiểm tra tham số của `listTasks`; giới hạn 500 như `listTasks`.

- [ ] **Step 1: Viết test hỏng** `"Cross-group: tasks of every group, mine by default, outsiders see none"` (skip khi `RUN_DB_TESTS !== "1"`, dựng người dùng/nhóm như `tasks.test.js`):
  - Hai nhóm A, B của `owner`; `member` chỉ ở A. Tạo 3 việc: A giao `owner`, B giao `owner`, A giao `member`.
  - `listAllTasks(owner, new URLSearchParams())` → 2 việc, đều `assigneeId === owner`, có `workspaceName` và `channelName` đúng.
  - `assignee=all` → 3 việc; `workspace=<B>` → 1 việc.
  - `listAllTasks(member, "assignee=all")` → chỉ 2 việc của A.
  - `listAllTasks(outsider, "assignee=all")` → 0 việc.
  - Lưu trữ nhóm B (`updateWorkspace` như `tasks.test.js`) → việc của B vẫn trả về với `workspaceArchived === true`.
- [ ] **Step 2:** Build rồi chạy `RUN_DB_TESTS=1 node --test test/cross-group.test.js` → FAIL (`listAllTasks` không tồn tại).
- [ ] **Step 3:** Viết `listAllTasks` dùng chung `projection`, join `channels c` và `workspaces w` để lấy tên và `w.archived_at IS NOT NULL`. Route khớp đúng `pathname === "/api/tasks"` và `GET`, đặt trước `taskRoute`.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5:** Commit `feat(tasks): list tasks across every group`.

### Task 2: API tài liệu của mọi nhóm

**Files:**
- Modify: `services/api/src/modules/workspaces/home.ts` (`listWorkspaceFiles` nhận `workspaceId: string | null`, thêm `q`)
- Modify: `services/api/src/modules/workspaces/routes.ts` (route `GET /api/files`)
- Modify: `packages/shared/src/index.ts` (`WorkspaceFileItem` thêm `workspaceId`, `workspaceName`)
- Test: `services/api/test/cross-group.test.js`

**Interfaces:**
- Produces: `listWorkspaceFiles(userId, workspaceId: string | null, before?: string, limit = 30, prioritizePinned = false, q?: string): Promise<{ files: WorkspaceFileItem[]; hasMore: boolean }>`. Khi `workspaceId === null` thì bỏ kiểm tra thành viên (join `channel_access` đã giới hạn quyền). `q` lọc `a.file_name ILIKE '%' || q || '%'` (escape `%` và `_`).
- Route: `GET /api/files?workspace=&q=&before=&limit=` (limit mặc định 24, như route theo nhóm).

- [ ] **Step 1:** Viết test hỏng `"Cross-group: files of every group, filtered by group and name"`: gửi 1 tệp ở A, 1 tệp ở B (dùng `saveMessage` có attachment như `tasks.test.js`).
  - `listWorkspaceFiles(owner, null)` → 2 tệp, có `workspaceName`.
  - `null` với `q` khớp một tên → 1 tệp; `q` chứa `%` → 0 tệp.
  - `member` → chỉ tệp của A.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Sửa hàm và route; route `/api/workspaces/:id/files` cũ vẫn chạy như trước.
- [ ] **Step 4:** Chạy test này và `RUN_DB_TESTS=1 node --test test/governance.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(files): list files across every group`.

### Task 3: API lịch họp theo khoảng ngày

**Files:**
- Create: `services/api/src/modules/meetings/calendar.ts`
- Modify: `services/api/src/modules/meetings/routes.ts` (route `GET /api/meetings/calendar`)
- Modify: `packages/shared/src/index.ts` (type `MeetingCalendar`)
- Test: `services/api/test/cross-group.test.js`

**Interfaces:**
- Produces:
  ```ts
  type MeetingCalendarSession = { id: string; roomId: string; roomName: string; workspaceId: string; workspaceName: string;
    scheduleId: string | null; title: string | null; startedAt: string; endedAt: string | null; people: string[] };
  type MeetingCalendar = { schedules: MeetingScheduleItem[]; sessions: MeetingCalendarSession[] };
  listMeetingCalendar(userId: string, from: Date, to: Date): Promise<MeetingCalendar>
  ```
- `schedules`: lịch không huỷ, giao với `[from, to)`, chỉ ở phòng người dùng xem được, dùng lại `selectSchedule` của `schedules.ts`.
- `sessions`: phiên có `started_at < to` và (`ended_at` null hoặc `ended_at > from`) ở phòng người dùng xem được. `title` lấy từ lịch nếu có. `people` là tên người đang kết nối nếu phiên chưa kết thúc, ngược lại là người đã được vào phòng (`meeting_attendees.state='admitted'`).
- Kiểm tra: `from` và `to` là ISO hợp lệ, `to > from`, khoảng ≤ 42 ngày; sai thì 400 `INVALID_RANGE`.

- [ ] **Step 1:** Viết test hỏng `"Cross-group: meeting calendar covers past, live and upcoming, only rooms you can see"`:
  - Tạo 1 lịch đã qua và 1 lịch sắp tới ở phòng của A, cùng 1 phiên đã kết thúc (chèn thẳng `meeting_sessions` và `meeting_attendees` như `meeting-sessions.test.js`).
  - `owner` trong khoảng 14 ngày → 2 lịch, 1 phiên có `people` gồm tên `owner`.
  - `outsider` → rỗng.
  - Lịch đã huỷ không có trong kết quả.
  - Khoảng 60 ngày → lỗi `INVALID_RANGE`.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Viết `calendar.ts` và route.
- [ ] **Step 4:** Chạy → PASS; chạy thêm `meeting-sessions.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(meetings): calendar endpoint for a date range`.

### Task 4: Điều hướng mới và chuyển link cũ

**Files:**
- Modify: `apps/web/src/app/navigation.ts`, `apps/web/src/app/types.ts`
- Test: `apps/web/test/app-route.test.js`

**Interfaces:**
- `ViewId` thêm `"groups"`; giữ `"workspace"` chỉ để đọc link cũ.
- `readAppRoute`:
  - `/app/workspace?workspace=X` → `{ view: "chat", workspaceId: X }`;
  - `/app/chat?workspace=X&channel=Y` giữ `view: "chat"` (bỏ dòng đổi sang `"workspace"`);
  - `tasks`, `files`, `meetings` giữ `workspaceId` làm bộ lọc.
- Xoá `isWorkspaceTabView`, `selectWorkspaceRoute`, `switchWorkspaceTabRoute` và type `WorkspaceTabId`; sửa mọi chỗ gọi (grep) cho phù hợp các trang ở Task 5–10.

- [ ] **Step 1:** Thêm test hỏng `"old workspace links open the function pages"`:
  - `/app/workspace?workspace=W` → `{view:"chat", workspaceId:W}`;
  - `/app/chat?workspace=W&channel=C&message=M` → `{view:"chat", workspaceId:W, channelId:C, messageId:M}`;
  - `/app/tasks?workspace=W&channel=C&task=T` giữ nguyên ba id;
  - `/app/meetings?workspace=W&channel=R&schedule=S` giữ nguyên;
  - `/app/groups` → `{view:"groups"}`.
  - Sửa các test cũ đang chờ `view: "workspace"` cho khớp.
- [ ] **Step 2:** Chạy web test → FAIL.
- [ ] **Step 3:** Sửa `navigation.ts` và `types.ts`.
- [ ] **Step 4:** Chạy web test → PASS. (`typecheck` sẽ còn lỗi ở chỗ gọi cho tới khi xong Task 5.)
- [ ] **Step 5:** Commit cùng Task 5 (hai task phải vào chung một commit để build xanh).

### Task 5: Menu mới, bỏ khung nhóm, trang "Nhóm của tôi"

**Files:**
- Modify: `apps/web/src/app/layout/AppShell.tsx`
- Create: `apps/web/src/features/workspaces/GroupsPage.tsx` (+ `groups-page.css`)
- Modify: `apps/web/src/features/workspaces/WorkspaceAdminPage.tsx` (nhận thêm các việc chỉ có trong `WorkspaceShell`)
- Delete: `apps/web/src/features/workspaces/WorkspaceShell.tsx`, `workspace-shell.css` (sau khi chuyển hết chức năng)
- Test: `e2e/app.spec.ts`

**Interfaces:**
- `MENU_ITEMS` theo thứ tự:
  - `home`, `messages` ("Tin nhắn", view `chat`), `meetings` ("Họp", view `meetings`), `tasks` ("Công việc", icon `check-square`, view `tasks`), `files` ("Tài liệu", icon `folder`, view `files`), `elearning`, `switchboard`;
  - sau vạch ngăn: `groups` ("Nhóm của tôi", icon `users`, view `groups`, badge `groups`), `notifications`, `access`, `profile`.
- Bỏ `staff` và `roles`; `FIRST_MANAGE_ITEM = "groups"`; `BOTTOM_BAR_ITEMS = {"home","messages","meetings","elearning"}`.
- `renderPage`: `chat`→`MessagesPage`, `tasks`→`TaskBoardPage`, `files`→`FilesPage` (Task 8; trong lúc chờ dùng `WorkspaceFilesTab` chuyển ra file riêng), `meetings`→`MeetingPage`, `groups`→`GroupsPage`, `admin`→`WorkspaceAdminPage`.
- `GroupsPage`:
  - liệt kê `getWorkspacesApi` (tên, số người, vai trò);
  - "Tạo nhóm" mở `CreateWorkspaceModal`;
  - "Nhập mã mời" là modal nhập mã đang có trong `WorkspaceShell`;
  - "Quản lý" → `navigate({ view: "admin", workspaceId })`.
- Trước khi xoá `WorkspaceShell`, liệt kê mọi hành động trong đó (thêm thành viên bằng email, tạo link mời, rời nhóm, xem thành viên, đổi tên/lưu trữ…) và bảo đảm mỗi việc có trong `GroupsPage` hoặc `WorkspaceAdminPage`.

- [ ] **Step 1:** Sửa E2E hỏng `"menu theo chức năng"` (alice):
  - Menu có đúng các nút "Tin nhắn", "Họp", "Công việc", "Tài liệu", "Nhóm của tôi";
  - không còn nút "Nhóm làm việc" và "Quản trị nhóm";
  - "Nhóm của tôi" hiện tên nhóm E2E và nút "Quản lý".
  - Thêm E2E `"tài khoản chưa có nhóm thấy hướng dẫn tạo nhóm"`: tạo thêm user `carol` không nhóm trong `global-setup.mjs` (xoá trong teardown); mở lần lượt Tin nhắn, Công việc, Tài liệu, Họp, mỗi trang có nút "Tạo nhóm" hoặc "Nhập mã mời".
- [ ] **Step 2:** `npm run test:e2e` → hai test mới FAIL.
- [ ] **Step 3:** Làm `AppShell`, `GroupsPage`, chuyển chức năng, xoá `WorkspaceShell`.
- [ ] **Step 4:** `npm run typecheck && npm run lint`, web test, `npm run test:e2e` → PASS.
- [ ] **Step 5:** Commit `feat(web): function-first menu, My groups page` (gồm cả Task 4).

### Task 6: Tin nhắn gộp kênh của mọi nhóm

**Files:**
- Modify: `apps/web/src/features/chat/LiveChatPage.tsx`, `apps/web/src/features/chat/MessagesPage.tsx`, CSS chat liên quan
- Test: `e2e/app.spec.ts`

**Interfaces:**
- `ChatPage` tải kênh văn bản của **mọi** nhóm (`getWorkspacesApi` rồi `getChannelsApi` song song, như cách `MeetingPage` đang tải phòng) cùng trò chuyện riêng.
- `workspaceId` hiện tại = `workspaceId` của kênh đang chọn (trò chuyện riêng là `null`). Thành viên và phòng họp của nhóm tải theo nhóm đó khi đổi kênh.
- Cột trái:
  - ô tìm;
  - mỗi nhóm là một mục thu gọn/mở được (tên nhóm, tổng tin chưa đọc), có nút "+" cho chủ nhóm/quản trị → `navigate({view:"admin", workspaceId})`;
  - cuối cùng là "Trò chuyện riêng";
  - nhóm đã lưu trữ hiện cuối danh sách, ghi "Đã lưu trữ".
- Route đọc `workspaceId`/`channelId` để chọn kênh; không có thì chọn kênh đầu của nhóm đầu, hoặc của `workspaceId` nếu link có.
- Đầu kênh có nhãn tên nhóm và nút "Họp ngay" → `openChannel(workspaceId, meetingRoomId, true)`.
- Bỏ chế độ `directOnly`. Bỏ dòng mô tả "kênh nhóm nằm trong tab Trao đổi…" ở `MessagesPage`.
- Không có nhóm và không có trò chuyện riêng → trạng thái trống có "Tạo nhóm" và "Nhập mã mời" (mở `navigate({view:"groups"})`).

- [ ] **Step 1:** E2E hỏng `"Tin nhắn liệt kê kênh của nhóm và gửi được tin"` (alice):
  - Mở `/app/chat`; thấy tên nhóm E2E và kênh đầu;
  - gửi "xin chào e2e", tin hiện trong khung;
  - mở `/app/workspace?workspace=<id>` thì vẫn ở Tin nhắn, đúng kênh đó.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Làm.
- [ ] **Step 4:** typecheck, lint, E2E → PASS. Tự kiểm tay trong trình duyệt: thread, ghim, tìm trong kênh, gửi tệp, trò chuyện riêng, thông tin kênh.
- [ ] **Step 5:** Commit `feat(chat): one inbox for every group's channels`.

### Task 7: Công việc gộp

**Files:**
- Modify: `apps/web/src/features/tasks/TaskBoardPage.tsx` (+ CSS)
- Test: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `GET /api/tasks` (Task 1), `TaskBoardItem`.
- Bảng lấy từ `governanceApi<{tasks: TaskBoardItem[]; truncated: boolean}>(token, "tasks?" + params)`; nghe `task_changed` thì tải lại bất kể kênh.
- Thanh lọc:
  - "Của tôi / Tất cả" (`assignee`);
  - "Nhóm" (`workspace`, khởi tạo từ `route.workspaceId`);
  - "Sắp hết hạn" (`deadline=upcoming`);
  - menu "Lọc thêm" chứa ưu tiên, trạng thái, "Đã lưu trữ".
- Thẻ việc: nhãn tên nhóm, tên kênh làm nhãn phụ.
- "+ Việc mới":
  - hộp thoại chọn nhóm (mặc định nhóm đang lọc, bỏ nhóm đã lưu trữ) và kênh (mặc định kênh văn bản đầu, bỏ kênh đã lưu trữ);
  - tạo qua `POST /api/channels/:id/tasks` như cũ.
- Kéo thả, chi tiết việc, `route.taskId` mở chi tiết: giữ như cũ.
- Bỏ ô chọn "Bảng theo kênh" và nút "Tải lại bảng".

- [ ] **Step 1:** E2E hỏng `"Công việc: tạo việc ở nhóm và thấy trên bảng của tôi"` (alice):
  - Mở `/app/tasks`, bấm "+ Việc mới", chọn nhóm E2E, nhập "Viết biên bản e2e", giao cho mình, lưu;
  - thẻ hiện ở cột "Cần làm" kèm tên nhóm.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Làm.
- [ ] **Step 4:** typecheck, lint, E2E → PASS.
- [ ] **Step 5:** Commit `feat(tasks): one board for my tasks in every group`.

### Task 8: Tài liệu gộp

**Files:**
- Create: `apps/web/src/features/files/FilesPage.tsx` (+ `files-page.css`); dùng lại phần hiển thị của `WorkspaceFilesTab` đã chuyển ra ở Task 5 rồi xoá bản tạm.
- Test: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `GET /api/files` (Task 2).
- Thanh trên: ô tìm (`q`, gõ xong 300 ms mới gọi), "Nhóm" (từ `route.workspaceId`), "Tải lên".
- Mỗi dòng: tên tệp, nhãn nhóm, người gửi, ngày; bấm mở tệp; "Xem trong kênh" → `navigate({view:"chat", workspaceId, channelId, messageId})`. Phân trang "Xem thêm" bằng `before`.
- "Tải lên": chọn nhóm và kênh (bỏ cái đã lưu trữ), rồi gửi như một tin nhắn có tệp đính kèm theo đúng đường gửi tệp của `ChatPage` (`uploadAttachmentApi` rồi gửi tin). Thành công thì tải lại danh sách.

- [ ] **Step 1:** E2E hỏng `"Tài liệu: tải tệp lên nhóm rồi tìm thấy"` (alice):
  - Tải `e2e-tai-lieu.txt` vào nhóm E2E;
  - gõ "tai-lieu" vào ô tìm, thấy dòng tệp với tên nhóm.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Làm.
- [ ] **Step 4:** typecheck, lint, E2E → PASS.
- [ ] **Step 5:** Commit `feat(files): one file list for every group`.

### Task 9: Màn hình kiểm tra trước khi vào phòng

**Files:**
- Create: `apps/web/src/features/meetings/PreJoinScreen.tsx` (+ CSS); chuyển phần `meeting-lobby-preview-box` / `meeting-lobby-action` của `MeetingPage.tsx` sang đây
- Modify: `apps/web/src/features/meetings/MeetingPage.tsx`
- Test: `e2e/app.spec.ts`

**Interfaces:**
- `PreJoinScreen({ room, scheduleId, onBack }: { room: { id: string; name: string; workspaceId: string; workspace: string }; scheduleId?: string; onBack: () => void })`.
  - Gồm: xem trước camera, đo micro, chọn micro/camera/loa và chất lượng, bật/tắt camera và micro.
  - Tiêu đề: tên cuộc họp (từ lịch nếu có `scheduleId`, không thì tên phòng) và tên nhóm; số người đang ở trong lấy từ `GET /api/meetings/calendar` hoặc trạng thái phòng sẵn có.
  - Nút "Vào phòng" gọi `meeting.joinCall` như `enterRoom` hiện nay; nút quay lại gọi `onBack`.
- `MeetingPage` quyết định màn hình:
  - `meeting.inCall` → phòng họp như cũ;
  - có `route.channelId` → `PreJoinScreen`;
  - còn lại → `MeetingsCalendar` (Task 10).
  - Bỏ effect tự chọn phòng đầu và tự `navigate` thêm `channelId`.
- Link `?channel=R` trỏ tới phòng không có quyền → thông báo "Phòng họp không tồn tại hoặc bạn không có quyền truy cập liên kết này." cùng nút về lịch.

- [ ] **Step 1:** Sửa E2E `"hai người vào cùng phòng họp…"`: bấm `getByRole("button", { name: "Vào phòng" })` thay cho `.meeting-lobby-action … /^Tham gia /`, phần còn lại giữ nguyên.
- [ ] **Step 2:** Chạy → FAIL (chưa có nút).
- [ ] **Step 3:** Làm.
- [ ] **Step 4:** typecheck, lint, E2E → PASS.
- [ ] **Step 5:** Commit `feat(meetings): separate pre-join check`.

### Task 10: Trang Họp dạng lịch tuần

**Files:**
- Create: `apps/web/src/features/meetings/calendar.ts` (logic thuần)
- Create: `apps/web/src/features/meetings/MeetingsCalendar.tsx` (+ `meetings-calendar.css`); chuyển form lên lịch của `MeetingPage.tsx` vào đây, thêm ô chọn nhóm
- Modify: `apps/web/src/features/meetings/api.ts` (`getMeetingCalendarApi(token, from: Date, to: Date): Promise<MeetingCalendar>`)
- Delete: phần sảnh cũ còn lại trong `MeetingPage.tsx` (danh sách phòng, "Lịch họp sắp tới", "Cuộc họp gần đây") và CSS không còn dùng
- Test: `apps/web/test/meeting-calendar.test.js`, `e2e/app.spec.ts`

**Interfaces:**
- `calendar.ts`:
  ```ts
  type CalendarEvent = { key: string; title: string; workspaceName: string; workspaceId: string; roomId: string;
    start: Date; end: Date; status: "live" | "upcoming" | "past"; scheduleId: string | null; sessionId: string | null;
    people: string[]; canManage: boolean };
  weekStart(date: Date): Date                      // thứ 2 00:00 giờ Việt Nam (Asia/Ho_Chi_Minh)
  calendarEvents(data: MeetingCalendar, now: Date): CalendarEvent[]
  layoutDay(events: CalendarEvent[], day: Date): { event: CalendarEvent; top: number; height: number; column: number; columns: number }[]
  ```
  - `calendarEvents`: ghép phiên với lịch qua `scheduleId`; phiên của lịch thì `sessionId` gán vào sự kiện của lịch đó; phiên không có lịch thành sự kiện riêng với tiêu đề tên phòng.
  - `status`: `live` khi có phiên chưa kết thúc, `past` khi đã kết thúc hoặc `end <= now`, còn lại `upcoming`.
  - `layoutDay`: `top`/`height` tính theo phần trăm của khung 7h–21h, cắt sự kiện ra ngoài khung vào mép; sự kiện chồng giờ chia cột.
- `MeetingsCalendar`:
  - Thanh trên: "‹", "Tuần dd–dd/mm", "›", "Hôm nay", bộ lọc nhóm (từ `route.workspaceId`), "Họp ngay", "+ Lên lịch".
  - Lưới 7 cột thứ 2 → chủ nhật, cột giờ 7h–21h; màu: `live` xanh lá, `upcoming` xanh dương nhạt, `past` xám.
  - Bấm sự kiện mở cột phải:
    - `upcoming` và `live`: "Vào" (→ `navigate({view:"meetings", workspaceId, channelId: roomId, scheduleId})`), "Sửa", "Huỷ" (khi `canManage`), "tải .ics"; với `live` hiện danh sách `people`.
    - `past`: `MeetingRecordingPanel`, `MeetingOutcomesPanel` (`live={false}`), `MeetingAttendancePanel` (cho chủ trì và đồng chủ trì như hiện nay) theo `sessionId`.
  - "Họp ngay": hộp chọn nhóm (mặc định nhóm vào gần nhất, lưu `localStorage["meeting:lastWorkspace"]`, bọc try/catch). Nhóm nhiều phòng thì chọn tiếp phòng. Sau đó chuyển sang màn hình kiểm tra.
  - Bề rộng ≤ 768 px: danh sách theo ngày thay cho lưới; chi tiết mở toàn màn hình.
  - Chưa có nhóm nào: trạng thái trống có "Tạo nhóm" / "Nhập mã mời".

- [ ] **Step 1:** Viết unit test hỏng `meeting-calendar.test.js`:
  - `weekStart` của "2026-10-25T16:30:00Z" (CN 23:30 giờ VN) → "2026-10-18T17:00:00Z" (thứ 2 19/10 00:00 giờ VN);
  - `weekStart` của "2026-10-25T17:30:00Z" (thứ 2 00:30 giờ VN) → "2026-10-25T17:00:00Z";
  - lịch 10:00–11:00 giờ VN có phiên chưa kết thúc → `live`, `sessionId` gán đúng;
  - phiên không lịch → sự kiện riêng, tiêu đề là tên phòng;
  - hai sự kiện 9:00–10:00 và 9:30–10:30 → `columns === 2`, khác `column`;
  - sự kiện 6:00–8:00 → `top === 0`;
  - sự kiện 23:00 CN – 01:00 thứ 2 → có mặt trong `layoutDay` của cả hai ngày, mỗi ngày cắt vào mép.
- [ ] **Step 2:** Chạy web test → FAIL.
- [ ] **Step 3:** Viết `calendar.ts` → web test PASS.
- [ ] **Step 4:** Thêm E2E hỏng `"Họp: lên lịch rồi thấy trên lịch tuần, vào được phòng"` (alice):
  - Mở `/app/meetings`, bấm "+ Lên lịch", tạo "Họp e2e" trong nhóm E2E bắt đầu sau 1 giờ;
  - sự kiện hiện trên lịch; bấm sự kiện, bấm "Vào", thấy nút "Vào phòng";
  - bấm "Vào phòng", rồi bấm mục menu "Họp": vẫn thấy phòng họp (có ô video), không thấy lịch.
- [ ] **Step 5:** Làm `MeetingsCalendar` và `getMeetingCalendarApi`, xoá sảnh cũ.
- [ ] **Step 6:** typecheck, lint, web test, `npm run test:e2e` → PASS.
- [ ] **Step 7:** Commit `feat(meetings): weekly calendar as the meetings page`.

### Task 11: Kiểm tra cuối và README

**Files:**
- Modify: `README.md` (mục "### Họp trực tuyến" và phần Nhóm/Chat: mô tả menu theo chức năng, lịch tuần, màn hình kiểm tra; ba API mới)

- [ ] **Step 1:** Chạy đủ: `npm run typecheck`, `npm run lint`, `npm test`, web test, `RUN_DB_TESTS=1` cho `cross-group`, `tasks`, `governance`, `meeting-sessions`, `npm run test:e2e`. Tất cả PASS.
- [ ] **Step 2:** Kiểm tay trong trình duyệt (localhost) ở 1440 px và 390 px, sáng và tối:
  - Mỗi trang: Tin nhắn, Họp, Công việc, Tài liệu, Nhóm của tôi.
  - Các link cũ trong Review Focus 1.
  - Bàn phím: Tab qua menu, lịch, cột chi tiết.
  - Chụp màn hình làm bằng chứng.
- [ ] **Step 3:** Cập nhật README.
- [ ] **Step 4:** Commit `docs: README for the function-first menu and meetings calendar` và push `main`.
