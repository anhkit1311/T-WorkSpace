# Motion 6/10 — cải thiện trong phạm vi khóa giao diện

Đợt kiểm tra 04–05/10/2026, nhánh `feat/motion-upgrade-2026-10`. Đây là cải thiện hành vi và chuyển động của giao diện đã chốt, không phải bản thiết kế mới. Giữ hệ navy + glass, font, bố cục, vị trí DOM, nhãn, icon, video và nền Three.js hiện có. Không thay nghiệp vụ, API, socket hay quyền truy cập.

**Kết luận:** các thay đổi được phép đã triển khai và qua kiểm tra mã nguồn. Đã kiểm tra trực tiếp các màn và thao tác bên dưới. Không tuyên bố đạt 60fps hoặc hoàn tất các mục cần thiết bị/trace chưa có. Đối chiếu pixel còn khác biệt được ghi rõ ở mục 4; chưa đạt chứng minh mọi ảnh tĩnh trùng tuyệt đối.

## 1. Đã sửa

- Tập trung timing/easing/spring vào `shared/motion/tokens.ts`, sinh CSS từ cùng nguồn; gom 8 keyframe hiện có, thay 19 `transition: all` bằng thuộc tính cụ thể, bỏ `will-change` thường trực.
- `MotionProvider`, `useMotionSafe`, CSS và GSAP dùng cùng quyết định reduced motion. Bản giảm hiển thị đầy đủ nội dung ngay, không dịch chuyển; video và cảnh trang trí dừng động.
- Tab workspace thay nội dung cũ ngay, chỉ animate nội dung mới theo hướng 6px / 220ms. Hủy animation trước khi chuyển tiếp: không giữ hai tab cũ/mới cùng lớp.
- Surface đang thoát trở thành `inert`, không bắt chuột/bàn phím. Search mở lại nhanh không bị lớp đóng cũ chặn. Panel ở normal flow đóng ngay để tránh cột trắng còn giữ chỗ.
- Modal và panel modal quản lý focus/Escape; trả focus ngay lúc thoát. Dùng `preventScroll` và bỏ autoFocus dư ở form tạo/tham gia nhóm để tránh mất nút mở làm điểm trả focus.
- Button native có hover/press; tooltip dùng portal; lỗi field rung một lần; reaction picker/count, icon gửi, số liệu và toast có phản hồi nhẹ. Hiệu ứng thành công chỉ chạy sau kết quả thao tác thật.
- Nền Three.js dùng một ticker, có lease dừng khi overlay che, không cạnh tranh khi họp. Hạt tự giảm một nửa sau 2 giây liên tục dưới 50Hz; cleanup scene và tween được giữ tập trung.
- DEV probe `?motion-debug=1` đo callback rAF, long tasks, CLS và blur trong cây DOM. Query được lấy ra trước khi router sản phẩm đọc để không làm hỏng route. Không có probe trong build production.

## 2. Thành phần → motion → bản không chuyển động

| Thành phần | Motion đã thêm/chuẩn hóa | Khi reduced motion |
| --- | --- | --- |
| Button / IconButton | Hover -1px, press .97; loading giữ chiều rộng; successFlash opacity 600ms sau API thành công | Giữ nhãn, disabled/loading và phản hồi trạng thái; không scale/dịch chuyển/flash |
| Tooltip | Portal, trễ hover 400ms; focus bàn phím hiện ngay; nhấn giữ có nhãn | Hiện nhãn ngay theo trigger, không dịch chuyển |
| Icon trạng thái / chuông | Pop icon hiện có 1→1.18→1; chuông lắc 400ms khi aria-label thông báo thay đổi | Icon/nhãn/trạng thái sẵn có cập nhật ngay |
| Field | Error shake ≤4px một lần; focus ring hiện có | Error text và aria vẫn đầy đủ; không rung |
| Reaction | Count dịch 4px; picker opacity/scale, emoji stagger 20ms | Emoji và count đổi ngay |
| Gửi chat | Phản hồi transform/opacity trên SVG gửi hiện có | Kết quả gửi/composer hiện ngay; không bay icon |
| Số liệu trang chủ | Count-up 600ms, hủy rAF khi unmount | Giá trị cuối ngay |
| Toast | Presence; kéo ngang để đóng; giữ timer/pause hover/focus hiện có | Nội dung và nút đóng hiện ngay |
| Views / tab workspace | View ngắn; tab mới trượt ±6px / 220ms, cancel khi bấm nhanh | Nội dung hoàn chỉnh ngay, opacity 1 / transform none |
| Modal / search / account menu | Presence, focus và lớp thoát inert | Mở/đóng tức thời; cùng focus, Escape, scroll lock |
| Chi tiết nhiệm vụ / thread | Panel 260ms vào, 160ms ra; không giữ focus/lớp tương tác khi thoát | Panel có đủ nội dung ngay |
| Chat info / danh sách kênh mobile | Entry có kiểm soát; info normal-flow đóng ngay; focus trap khi modal | Cùng panel và hình dạng, không dịch chuyển |
| Landing / ViewReveal | GSAP reveal/timeline hiện có, matchMedia và revert | Nội dung HTML hiện đủ, không parallax/reveal động |
| Video / Three.js | Mood, pulse sau thành công; adaptive particles; dừng khi che/hidden/họp | Video paused; cảnh static, ticker không chạy |

### Ownership

| Công cụ | Trách nhiệm | Vị trí triển khai |
| --- | --- | --- |
| Motion for React 13.2 | Control, presence, gesture, panel và wrapper view; existing dock indicator | `shared/ui/Primitives.tsx`, `shared/motion/`, `AppShell`, `WorkspaceShell`, chat/thread/task/search |
| GSAP 3.15 | Timeline/reveal của landing và child page blocks; Three.js uniforms | `LandingPage`, `ViewReveal`, `ambient-scene.ts` |
| Three.js 0.186 | Cảnh nền hiện có: motes/mist, materials và renderer | `AmbientBackdrop`, `ambient-scene.ts` |
| CSS | Spinner/keyframes hiện có, màu/viền/focus | `motion.css`, `keyframes.css`, stylesheet hiện có |

Không để GSAP và Motion điều khiển cùng transform/opacity trên một element: wrapper thuộc Motion, child reveal thuộc GSAP. Control có `data-motion-control` không dùng CSS hover transform cạnh tranh.

### Tokens

| Nhóm | Giá trị cuối |
| --- | --- |
| Duration, giây | micro .12; overlay .22; page .30; story .90; panel .26; panelExit .16; count .60; enter .22; exit .14; reveal .55; stagger .05; scene 1.10 |
| EASE cubic-bezier | out [.16,1,.3,1]; inOut [.65,0,.35,1]; emphasized [.2,0,0,1] |
| SPRING stiffness / damping / mass | snappy 520 / 38 / .7; gentle 260 / 30 / .9; bouncy 420 / 24 / .7 |
| Typography, radius, màu, spacing | Giữ nguyên token hiện hành theo khóa giao diện; không áp dụng scale/font/radius mới |

## 3. Kiểm tra thực tế

Chạy localhost web 5176, API 3001; đăng nhập qua form email/password bình thường bằng fixture QA riêng. Không bypass auth. Fixture và nhóm do đợt này tạo đã được dọn bằng kiểm tra chính xác ID/email/owner; dữ liệu người dùng giữ nguyên.

| Kiểm tra | Kết quả / giới hạn |
| --- | --- |
| Typecheck baseline / cuối | Qua `npm run typecheck` |
| Lint baseline / cuối | Qua `npm run lint` |
| Web tests | Baseline 14; cuối 21/21 qua, gồm 7 kiểm tra motion mới |
| Web production build | Qua; 2500 modules, Vite lần chốt cuối 4.28s (bản dùng đo bundle trước đó 4.48s, cùng chunk hashes). Đây là thời gian build Vite, không phải tải trang |
| 375 / 768 / 1440 × 900 | 17 vùng màn hình có cặp trước/sau, 51 cặp; xem [index ảnh](screenshots.md). Có kiểm tra bổ sung tasks/chat-info ở 1024 |
| Tab nhanh | 20 lần chuyển liên tục; tối đa 1 `.ws-body`, 1 panel; cuối opacity 1 / transform none. [Dữ liệu](rapid-tabs.json) |
| Search nhanh | Mở/đóng 5 lần, mỗi lần đúng 1 dialog. [Dữ liệu](search-reopen.json) |
| Modal bằng bàn phím | Tab lặp input → Hủy → Đóng → input; Shift+Tab không ra nền; Escape trả về Tạo nhóm mới. [Vòng focus thật](focus-cycle-actual.json) |
| Chat mobile | Info Escape trả focus đúng trigger; drawer có role dialog; không overflow ở 375. [Dữ liệu](mobile-panel-keyboard.json) |
| Chat dữ liệu thật | Draft giữ khi đổi tab; gửi tin dài/URL dài; thêm rồi bỏ reaction; trạng thái cuối đúng; không reanimate toàn history |
| Nhiệm vụ | Tạo qua API hiện có; đổi trạng thái bằng select hiện có. Không xác minh DnD pointer/touch mới |
| Button loading | Width trước/sau 116.05px; API quá nhanh để bắt frame spinner/flight. Không xem ảnh chuỗi là chứng minh pha loading |
| Reduced motion | OS đang bật reduce; kiểm tra bản giảm thật. DEV preview full/reduced không sửa setting OS; video/ticker dừng, tab nội dung đầy đủ |
| Lifecycle | 3 vòng landing/auth: canvas luôn 1; ScrollTrigger landing 2, auth 0; không thấy canvas/trigger tích lũy. Đây không phải chứng minh mọi listener/geometry không leak |
| Console | Không có app error sau bản sửa cuối/reload; 11 lỗi Google GSI do origin localhost5176 chưa cấu hình, đã có trước. [Dữ liệu](console-validation.json) |

Màn đã kiểm tra trực tiếp: landing, login, register, password-reset, home, workspace overview, chat, info, thread, tasks, task detail, lobby, notifications, admin, profile, modal và search. Kiểm tra này xác nhận trình bày và các thao tác nêu trên, không bao phủ mọi trạng thái lỗi/dữ liệu của từng màn.

**Chưa xác minh trực tiếp:** OTP; đăng nhập Google; cuộc gọi đa người/media/QoS/reconnect; network retry/upload/pagination trên history lớn; touch vật lý/long press/drag/swipe; browser zoom 200%; WebGL unavailable/context loss; hidden-tab thật; CPU throttle 4x và Chrome Performance trace. Các nhánh này đã được đọc source nơi liên quan; ghi nhận “Implemented, but not visually verified” cho hành vi motion mới chưa được quan sát. Không sửa backend/media để vượt giới hạn kiểm tra.

Thao tác ghim kênh QA bị kiểm duyệt tự động từ chối vì thay đổi trạng thái ứng dụng; đã bỏ qua, chưa kiểm thử trực tiếp.

## 4. Bằng chứng khóa giao diện và sai khác

125 PNG gồm 51 cặp trước/sau và ảnh thao tác. [screenshots.md](screenshots.md), [pixel-comparison.json](pixel-comparison.json), [DOM metrics](comparison.json). Cả hai pha dùng viewport yêu cầu; riêng PNG landing loại gutter (365×876 / 758×888 / 1430×894) nhất quán ở trước/sau.

Tỉ lệ pixel khác theo ngưỡng RGB >12 (%, **0 không đồng nghĩa file bit-identical**):

| Vùng màn | 375 | 768 | 1440 |
| --- | ---: | ---: | ---: |
| admin | 0 | 0 | 0 |
| chat | 0 | .007 | 0 |
| chat-info | 0 | 0 | .057 |
| home | .931 | 1.833 | .559 |
| landing | .828 | .593 | .570 |
| lobby | 1.495 | .001 | .097 |
| login | 0 | 0 | 0 |
| modal | 10.853 | 1.538 | .820 |
| notifications | 0 | 0 | 0 |
| password-reset | .989 | .616 | .328 |
| profile | 0 | 0 | 0 |
| register | 1.201 | .615 | .328 |
| search | .039 | 11.077 | .004 |
| task-detail | .002 | 9.505 | .102 |
| tasks | 0 | .062 | .051 |
| thread | .168 | .082 | .259 |
| workspace | 0 | 0 | 0 |

Các sai khác được ghi nhận:

1. **Modal 375 / search 768 / task detail 768:** vị trí cuộn của nền khác sau khi công cụ focus/đưa trigger vào vùng nhìn thấy; panel vẫn giữ geometry/style. [Kiểm tra cô lập](focus-scroll-isolation.json) đo scroll 0 trước focus trigger, 128.8 sau focus trigger, vẫn 128.8 sau modal nhận focus. Không gán thay đổi cuộn đó cho modal.
2. **Register/password-reset, một số close/select/thread:** focus/hover/ring khác giữa lần chụp; thuộc trạng thái tương tác được phép, không phải đổi theme.
3. **Home/landing/lobby và viền nút nhỏ:** có sai khác raster; source không đổi màu/font/radius/shadow tĩnh. Việc bỏ permanent `will-change` có thể thay compositing/rasterization, nhưng chưa có paint trace để chứng minh nguyên nhân toàn bộ. Không tuyên bố ảnh tĩnh trùng tuyệt đối.
4. DOM metrics của dock ở một số width lấy lúc resize transition chưa dừng (62.2–63.6 so với 62); ảnh dock vẫn trùng theo ngưỡng. Không dùng số đó để suy ra thay đổi kích thước CSS.

Những khác biệt này không bị che khỏi báo cáo. Muốn chứng minh mức pixel tuyệt đối cần một lượt chụp có focus, scroll, video frame và timing compositor cố định hơn; không tự đổi giao diện để ép phép đo.

## 5. Số đo hiệu năng

| Cửa sổ quan sát | Long tasks / lớn nhất | CLS | Tài nguyên |
| --- | --- | --- | --- |
| Baseline home, gồm initial load | 0 / 0ms | .0505 | Video paused; blur DOM 6, depth 1 |
| Sau sửa, reset ở home đã ổn định, reduced | 0 / 0ms | 0 | Canvas 1; scene paused; video paused; blur 6, depth 1 |
| Sau sửa, reset rồi home→workspace + 20 đổi tab, full preview | 0 / 0ms | 0 | Canvas 1; scene running; video playing; blur 1, depth 1 |
| Mở overlay lần đầu rồi giữ | 1 / 53ms | .0001 | Canvas 1; render count giữ 4051 qua hai lần quan sát; video paused; blur 3, depth 2 |

[Baseline](performance-before.json), [reduced](performance-after-reduced.json), [full](performance-after-full.json), [overlay](overlay-resource.json).

- Probe hiển thị rAF 200Hz ở các mẫu cuối; trong chuỗi chuyển tab có mẫu 98Hz. **Đây là callback rAF của môi trường kiểm thử, không phải GPU/compositor FPS. Không suy ra đạt 60fps/≥55fps.**
- Baseline CLS chứa tải ban đầu; mẫu sau reset ở thời điểm khác. Không dùng .0505→0 như phép so sánh đồng điều kiện để tuyên bố cải thiện CLS.
- Có long task 53ms khi mở overlay trong cửa sổ đo; chưa có trace phân tách scripting/rendering/painting để xác định nguồn. Điều kiện “không long task >50ms” chưa đạt chứng minh.
- Blur ở đây là DOM count/depth, không phải số compositing layers. Trong các mẫu nêu trên độ chồng tối đa 2; chưa audit mọi popup tổ hợp.
- Lifecycle JSON có bộ đếm nhiều giờ; chỉ dùng canvas/ScrollTrigger counts, không dùng làm cửa sổ benchmark.

### Bundle gzip

| Tổng tất cả chunk | Trước | Sau | Chênh lệch |
| --- | ---: | ---: | ---: |
| JavaScript | 440,304 B | 447,956 B | +7,652 B |
| CSS | 42,315 B | 42,781 B | +466 B |
| Tổng | 482,619 B | 490,737 B | **+8,118 B (~7.93 KiB), dưới 25 KB** |

[bundle-summary.json](bundle-summary.json). Đây là tổng chunk build, không phải initial request payload hay thời gian tải. Không thêm dependency. GSAP/Three.js chunks giữ nguyên kích thước; diagnostic bị loại khỏi production.

## 6. Đề xuất cần chủ dự án duyệt — chưa triển khai

Các mục sau xung đột khóa giao diện; chỉ ghi đề xuất, không tạo nút giả hoặc tự đổi bản đã chốt. Ảnh là **giao diện hiện tại để xác định vị trí**, không phải mockup thiết kế mới.

| Đề xuất | Vì sao cần duyệt | Ảnh vị trí hiện tại |
| --- | --- | --- |
| Switch thay checkbox/Bật–Tắt; morph/replacement icon | Thay hình dạng/icon ở rest | [Profile](profile-before-1440.png), [info](chat-info-before-1440.png) |
| Reaction “+” xoay; pending bubble và status SVG mới | Thay Smile/status text/DOM luồng tin hiện có | [Chat](chat-before-1440.png) |
| Mic ring, QoS bars, badge mới, dock tự ẩn; FLIP tile | Thêm khối và đổi cách bố trí/hiển thị cuộc gọi | [Lobby](lobby-before-1440.png) |
| Sliding tab background mới | Thêm nền/indicator nơi hiện chưa có | [Workspace](workspace-before-1440.png), [Login](login-before-1440.png) |
| Password meter / OTP 6 ô | Thêm nội dung, đổi input và geometry | [Register](register-before-1440.png) |
| Toast countdown / “+N”; skeleton mới | Thêm khối/indicator tĩnh | [Home](home-before-1440.png) |
| Bottom sheet thay modal mobile; swipe panel | Đổi shape/vị trí/kích thước và tương tác đóng | [Modal mobile](modal-before-375.png) |
| Shared card→header, ViewTransition thử nghiệm | Cần thay cấu trúc/phối hợp view; giữ lazy flow hiện có | [Home](home-before-1440.png), [Workspace](workspace-before-1440.png) |
| DnD rewrite, ghost/vạch chèn/keyboard handles; stagger/FLIP toàn list | Thêm khối/handle; rủi ro scroll anchor và optimistic update ngoài scope presentation | [Tasks](tasks-before-1440.png) |
| Landing 01/02/03, pin showcase/mockup, mask theo dòng, CTA magnetic | Đổi khối, text wrapping, scroll narrative hoặc phần tử tĩnh | [Landing](landing-before-1440.png) |
| Blur đổi style / content-visibility virtualization | Có thể đổi ảnh đã chốt, đo chiều cao và scroll anchor | [Chat](chat-before-1440.png), [Search](search-before-1440.png) |

Không animate lại lịch sử chat hay cả board khi socket update. Giữ status select của Kanban như keyboard alternative hiện có. Không thêm @dnd-kit, Reorder hoặc Lottie.

## 7. Chạy, cleanup và mở rộng

```powershell
# Từ D:\DoAnTotNghiep; dùng .env cấu hình dự án hiện có
npm run db:up
npm run db:migrate
npm run dev:api
# Terminal khác
npm run dev:web
```

Dùng URL Vite báo trong terminal (đợt QA là 5176); API hiện có ở 3001. DEV thêm `?motion-debug=1` vào URL màn cần đo, dùng “Đo lại” trước từng cửa sổ. “Theo máy” dùng setting OS; “Giảm/Đầy đủ” chỉ preview trong DEV. Production không có probe/công tắc này.

```powershell
npm run motion:css --workspace @doan/web
npm run typecheck
npm run lint
npm run test --workspace @doan/web
npm run build --workspace @doan/web
```

- Thêm animation qua `useMotionSafe`; dùng cùng tokens, chọn một owner cho mỗi property. Không animate width/height/margin list, không `transition: all`/permanent `will-change`.
- GSAP dùng context/matchMedia và revert; dọn ticker, tween, observer, listener, timer và rAF khi unmount. Three.js dispose geometry/material/renderer. Không tạo render loop thứ hai.
- Scene cover dùng lease độc lập cho nested overlay; khi exit phải inert và trả focus; không kéo dài content exit để trì hoãn thao tác.
- Nền video/static giữ được presentation khi Three import/WebGL thất bại; các nhánh context-loss/unsupported chưa được kiểm tra trực tiếp. HTML và thao tác sản phẩm không phụ thuộc canvas.
- Không tái bật decoration trong cuộc gọi. Thay đổi media sau này cần kiểm tra cuộc gọi thật riêng.

### Bảo toàn working tree

Không stash/reset/revert, không stage toàn bộ file có sửa sẵn của người dùng. Các commit motion nhỏ: `a7520b6`, `e0cd19d`, `6f084bd`, `32f2548`. Các hunk motion trong file đã có user changes và `WorkspaceShell.tsx` chưa tracked được giữ trong working tree. **Không coi commit history là toàn bộ sản phẩm hiện tại.**

[own-changes.patch](own-changes.patch) lưu delta motion so với snapshot giao diện đầu đợt trong `backups/motion-locked-20261005/baseline`. Patch có cả hunk đã commit; không apply mù trên HEAD. Snapshot/fixture không được đưa vào tài liệu public. Server/tab QA tạm đã đóng; server web/API/Docker sẵn có của người dùng được giữ.
