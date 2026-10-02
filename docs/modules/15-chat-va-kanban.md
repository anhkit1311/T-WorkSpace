# Chat và công việc

## Phạm vi và quyền

Threads dùng root của cùng kênh, không lồng root. Mention gửi UUID thành viên, tối đa 20; tên hiển thị lấy từ DB. Notification bền vững, duy nhất `(user_id,message_id)`, không tạo cho bản thân, người mất quyền, hoặc người mute kênh/nhóm/tắt thông báo. Mute áp dụng cho thông báo mới; thông báo cũ còn đọc được khi vẫn có quyền. Đánh dấu đọc đồng bộ các tab qua `notifications_changed`.

Pin thuộc kênh và chỉ owner/admin sửa khi kênh ghi được. Bookmark riêng từng user, hoạt động với kênh lưu trữ. Các truy vấn luôn join `channel_access`; không dựa vào room Socket.IO để cấp quyền.

Bảng công việc theo kênh văn bản để kế thừa quyền kênh riêng. Ba cột cần làm/đang làm/hoàn thành. Thành viên có quyền ghi được sửa task, checklist, comment, file và lưu trữ/khôi phục. Người phụ trách phải hiện có quyền đọc kênh lúc giao; khi mất quyền, assignment cũ giữ làm lịch sử nhưng không cấp quyền đọc task. File dùng pipeline upload của chat, chỉ uploader được gắn file cùng kênh, download yêu cầu quyền hiện tại.

## REST

| Method/path | Payload/query | Kết quả/giới hạn |
|---|---|---|
| GET `/api/messages/:id/context` | UUID | target + 25 trước/25 sau, 404 khi mất quyền/xóa |
| GET `/api/threads/:root` | before UUID | 50 phản hồi theo cursor `(created_at,id)` |
| POST `/api/threads/:root/read` | `{}` | timestamp DB |
| GET `/api/notifications` | before, unread=true | 30, unreadCount, hasMore |
| POST `/api/notifications/read` | id tùy chọn | đánh dấu một/tất cả |
| GET/POST `/api/workspaces/:id/notifications` | muted boolean | tùy chọn mute |
| POST `/api/messages/:id/pin\|bookmark` | `{}` | toggle với transaction/advisory lock |
| GET `/api/channels/:id/pins\|bookmarks` | — | tối đa 100 |
| GET `/api/search/messages` | q,workspace,channel,author,from,to,file,before | 30; file=any/image/audio/document; literal `%/_` |
| GET `/api/channels/:id/tasks` | assignee,status,priority,deadline,archived | tối đa 500 + truncated; deadline=overdue/upcoming/none |
| POST `/api/channels/:id/tasks` | clientTaskId,title,description?,assigneeId?,dueAt?,priority?,sourceMessageId? | task detail; retry cùng ID không tạo trùng |
| GET `/api/tasks/:id` | — | checklist, 100 comment và 100 activity gần nhất, file |
| PATCH `/api/tasks/:id` | version bắt buộc, action mặc định update | 409 TASK_CONFLICT khi version khác |

Action task: update (title/description/priority/dueAt/assigneeId/status/archived/beforeTaskId), comment(content), checklist-add(label), checklist-toggle/remove(itemId), attachment-add/remove(attachmentId). Tiêu đề 160, mô tả 8000, comment 4000, checklist 100 mục x 200 ký tự. Create có ID, mutation cần version; retry mutation sau ACK mất phải tải lại rồi xác định thay đổi đã áp dụng, không lặp mù.

Sắp xếp được serialize bằng khóa kênh; position nguyên bội 1024, tie-break UUID. Move dùng beforeTaskId trong cột đích hoặc null để về cuối; không dựa vào position từ client. Transaction kiểm lại quyền/archived. UI kéo thả thay cột hoặc dùng select và nút Đưa lên trên bằng bàn phím; giữ bản đang sửa khi nhận event thay đổi, cung cấp Tải lại.

## Socket

- `send_message` thêm threadRootId, mentionedUserIds, clientMessageId; ACK tối đa 10 giây ở frontend.
- `new_message` có threadRootId; main timeline không lẫn replies.
- `notifications_changed` không chứa nội dung; client fetch với quyền mới.
- `task_changed`: `{channelId,taskId,version}`, tới user rooms của người hiện có quyền; client fetch bảng/chi tiết. Connect/revoke refetch; không coi event là dữ liệu chính.

## Bằng chứng

`conversations.test.js`: phân trang 52 replies, unread/read, mention/mute, bookmark riêng, pin admin, search có dấu/ký tự đặc biệt, context tin ngoài history100, revoke.
`tasks.test.js`: hai writer cùng version chỉ một commit, stable move, assignment sai quyền, source, checklist, comment, file, archive, socket không lộ private, revoke/read-only. Migration 016 tạo tables/FK/check/index; 017 sửa cascade file khi xóa workspace phát hiện từ kiểm thử.

`benchmark-search.mjs` tạo 10.000 tin trong transaction và rollback, 10 mẫu warm local PostgreSQL17.11/Node22.19.0. Plan sử dụng `messages_channel_timeline_idx`; raw tại evidence/search-2026-09-30.json. Đây là query cơ bản có filter kênh, chưa thay thế đo global search đa workspace hay load; chưa thêm extension index khi chưa có nhu cầu và số liệu.
