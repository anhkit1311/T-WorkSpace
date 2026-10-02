# Giao diện và bản nháp — 01/10/2026

## Chức năng

- Trang chủ lấy `GET /api/home`: tối đa 6 công việc đang mở được giao cho mình, 4 lịch họp sắp tới và số thông báo chưa đọc. Mỗi mục mở URL mang đúng workspace/channel/task/schedule. Dữ liệu lọc bằng quyền kênh hiện tại.
- Chat, chủ đề, biểu mẫu tạo nhiệm vụ và panel sửa nhiệm vụ lưu bản nháp theo tài khoản/tài nguyên bằng IndexedDB. File/Blob được giữ bằng structured clone. Outbox giữ clientMessageId và attachmentId để retry đúng lần gửi sau reload; có nút bỏ lần gửi chưa xác nhận.
- Bản nháp nhiệm vụ giữ version gốc. Nếu server đã thay đổi, UI giữ nội dung đang sửa và yêu cầu tải lại khi conflict; không ghi đè bằng version mới một cách im lặng.
- Bản nháp có TTL 7 ngày, cache bộ nhớ tối đa 12 mục. Đăng xuất dọn dữ liệu của tài khoản, chặn callback cũ ghi lại sau logout. Nếu IndexedDB bị chặn/đầy, chỉ giữ trong bộ nhớ; không bảo đảm khôi phục qua reload trong trường hợp đó. Đây là dữ liệu cục bộ của trình duyệt, không đồng bộ thiết bị.
- Upload dùng XMLHttpRequest để lấy tiến độ byte thật. 100% nghĩa là đã chuyển hết byte, vẫn cần chờ server kiểm tra/lưu. Giới hạn 8 MB; hiển thị B/KB/MB đúng cho tệp nhỏ.
- Panel chủ đề/nhiệm vụ và sidebar mobile trap Tab, Escape đóng, khôi phục focus và trạng thái inert. Các trang lazy có error boundary với tải lại; bản nháp nằm ngoài vòng đời panel.

## Theme thực tế

Ứng dụng hiện dùng nhận diện dark/orbit. `styles.css` là nền; `workspace-theme.css` là entry override duy nhất, hợp nhất 8 lớp CSS theo đúng thứ tự cascade cũ. Đã bỏ 8 file override không còn import. Semantic alias gồm `--text-primary`, `--text-secondary`, `--text-muted`, `--border-subtle`, `--surface-raised`; các trang dùng các token nền/tương phản đã có. Không công bố một light theme chưa được nghiệm thu.

Việc hợp nhất entry chưa loại hết selector lịch sử hoặc giảm CSS: entry production sau sửa 182,04 kB (gzip32,60 kB), so với baseline181,71 kB. Không ghi nhận đây là cải tiến dung lượng CSS.

MotionConfig tôn trọng `prefers-reduced-motion: reduce`; global rules giảm animation/transition. Browser QA đang bật reduced motion (console Motion xác nhận); thao tác vẫn hoạt động. Không thay cài đặt hệ điều hành của người dùng.

## Bằng chứng trình duyệt

| Ca                                                        | Kết quả                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Chat: viết → chuyển trang → reload → trở lại              | Nội dung bản nháp còn                                                       |
| Chat: chọn tệp QA144B → reload → gửi                      | File còn trong bản nháp, upload/download thật qua API                       |
| Thread: viết → Escape → mở lại → reload                   | Nội dung bản nháp còn                                                       |
| Task: sửa tiêu đề → Escape → mở lại → reload              | Nội dung và version gốc còn; tải lại nhiệm vụ lấy dữ liệu server            |
| Task panel: Shift+Tab tại đầu/Tab tại cuối                | Focus quay vòng trong dialog                                                |
| Sidebar mobile: Shift+Tab, Escape, mở trang               | Focus giới hạn trong sidebar, điều hướng đóng sau chọn                      |
| Chat/home 375/768/1024/1440                               | document scrollWidth bằng viewport, không tràn ngang                        |
| Task board375/768/1024/1440 và panel375                   | Không tràn ngang; có thao tác select thay kéo thả                           |
| Profile bio236 ký tự, admin và thông báo375/768/1024/1440 | Không tràn ngang                                                            |
| Meeting375: hand/waiting/lock/end                         | Không tràn ngang, trở về lobby và history kết thúc                          |
| Đăng nhập từ URL lời mời bằng thành viên đã có            | Giữ token qua login, nhận lại idempotent và giữ vai trò owner; chat kết nối |

Ảnh thật: `evidence/home-1440-2026-10-01.jpg`, `evidence/task-375-2026-10-01.jpg`, `evidence/meeting-375-2026-10-01.jpg`. Số đo DOM ở `evidence/ui-responsive-2026-10-01.json`; E2E ở báo cáo bàn giao.

Trang lời mời ngừng render khi route đã chuyển, tránh flash “thiếu mã” trong animation thoát. Socket chỉ báo connected sau khi namespace đã xác thực, xử lý connect_error và thử kết nối lại khi token mới đến sau lỗi xác thực. Việc kiểm bằng thành viên đã có không thay thế E2E thêm thành viên mới/thu hồi quyền giữa hai tài khoản.

IAB không cung cấp CPU throttling hoặc native zoom qua API; phím Ctrl+= không thay đổi viewport. Chưa nghiệm thu zoom trình duyệt200% và máy cấu hình yếu. Thử effective width720 chỉ là phép kiểm layout, không thay cho native zoom. Chưa có đủ dữ liệu để quyết định virtualization; lịch sử hiện phân trang100 tin, thread50, bảng tối đa500.

## Cải tiến trước/sau có đo

`MeetingContext` chỉ dynamic import mediasoup khi người dùng vào họp. Đồ thị dependency tĩnh của production entry:

|                      |     Trước | Sau build cuối |
| -------------------- | --------: | -------------: |
| JavaScript           | 689.837 B |      448.517 B |
| Tổng gzip từng chunk | 184.796 B |      141.540 B |

Giảm 34,98% byte JavaScript tĩnh và 23,41% gzip; vendor mediasoup 236.046 B chuyển sang tải lúc join. Raw: `evidence/bundle-before-2026-10-01.json`, `evidence/bundle-after-2026-10-01.json`; script `scripts/benchmarks/bundle-evidence.mjs`. Phép đo này không đo mạng, tốc độ khung hình hay CPU máy yếu.

## Module chính

`features/HomePriorities.tsx`, `workspaces/home.ts`, `drafts.ts`, `hooks/useDraft.ts`, `hooks/usePanelDialog.ts`, `webrtc/operation.ts`, `api/chat.ts`, TaskBoardPage/ThreadPanel/LiveChatPage/MeetingContext và `workspace-theme.css`. Không có migration mới ở giai đoạn UI.
