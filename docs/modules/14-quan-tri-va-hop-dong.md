# Quyền và hợp đồng mở rộng

## Chính sách

| Đối tượng           | Đọc                                           | Ghi                                                          | Quản trị                                                                  |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Workspace hoạt động | Thành viên hiện tại                           | Theo module                                                  | Owner/admin; đổi role/chuyển owner/lưu trữ chỉ owner                      |
| Workspace lưu trữ   | Lịch sử và tệp giữ nguyên quyền               | Không gửi/sửa tin, tạo lời mời/task/lịch hoặc tham gia media | Owner khôi phục; thành viên có thể rời; không xóa vĩnh viễn               |
| Kênh công khai      | Thành viên workspace                          | Kênh/nhóm chưa lưu trữ                                       | Owner/admin                                                               |
| Kênh riêng tư       | Thành viên workspace và có channel membership | Như đọc + chưa lưu trữ                                       | Owner/admin có thể quản lý metadata/quyền; không tự có quyền đọc nội dung |
| Tệp                 | Quyền hiện tại của kênh và tin chưa xóa       | Upload theo quyền ghi, quota nhóm                            | 8.000.000 byte/tệp; quota nhóm mặc định 512 MiB                           |
| Lời mời             | Chỉ quản trị xem metadata                     | Token hash, 7 ngày, email bound hoặc link một lần            | Owner/admin tạo/thu hồi/gửi lại; người nhận phải có email xác thực        |

Thu hồi private membership hoặc membership ngắt socket, đóng tài nguyên họp; frontend kết nối lại với quyền mới. Mỗi event kiểm lại quyền. Broadcast chat gửi tới user room được lọc bằng `channel_access` hiện tại; không phát payload private theo workspace. Multi instance chưa được kiểm chứng ở giai đoạn này.

Một owner duy nhất theo unique index; constraint trigger kiểm owner membership ở cuối transaction. Chuyển owner tuần tự demote/promote/update owner trong transaction có khóa workspace. Rời nhóm xóa membership private để tham gia lại không tự nhận quyền cũ.

Lưu trữ là thao tác có thể khôi phục, không xóa tin/tệp. Giới hạn quota tính cả upload chưa gắn tin; không reset dữ liệu cũ. `WORKSPACE_FILE_QUOTA_BYTES` điều chỉnh quota.

## REST (đều yêu cầu Bearer token)

| Endpoint                                               | Payload / kết quả                                                               | Quyền                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------- |
| GET `/api/workspaces/:id/administration`               | workspace/channels/memberIds/invitations/audit/usage; 100 audit/invite gần nhất | owner/admin                                  |
| PATCH `/api/workspaces/:id/settings`                   | name?, description?, archived?                                                  | owner/admin; archived chỉ owner              |
| POST `/api/workspaces/:id/leave`                       | `{}`                                                                            | Thành viên khác owner                        |
| POST `/api/workspaces/:id/transfer`                    | userId                                                                          | Owner → thành viên hiện tại                  |
| POST `/api/workspaces/:id/roles`                       | userId, role admin/member                                                       | Owner, target khác owner                     |
| POST `/api/workspaces/:id/channels/manage`             | name, type text/voice/video, description?, isPrivate? → id                      | owner/admin                                  |
| PATCH `/api/workspaces/:id/channels/manage/:channelId` | name?, description?, isPrivate?, archived?                                      | owner/admin                                  |
| POST `/api/workspaces/:id/channels/order`              | ids, mỗi kênh đúng một lần                                                      | owner/admin                                  |
| POST `/api/workspaces/:id/channel-members`             | channelId, userId, allowed boolean                                              | owner/admin; target đang trong nhóm          |
| POST `/api/workspaces/:id/invitations`                 | email?, sendEmail? → id/link/delivery                                           | owner/admin; 20 yêu cầu/giờ/user/IP          |
| POST `/api/workspaces/:id/invitations/:inviteId`       | sendEmail? → thay token cũ, link mới                                            | owner/admin; đã nhận thì không gửi lại       |
| DELETE `/api/workspaces/:id/invitations/:inviteId`     | Thu hồi                                                                         | owner/admin                                  |
| POST `/api/invitations/accept`                         | token → workspaceId                                                             | Email xác thực đúng người nhận, hoặc link mở |
| GET `/api/channels/:id/messages`                       | limit1–100, before hoặc after, search? → messages theo thời gian tăng           | Quyền đọc kênh                               |

Lời mời dùng hash fragment `#token=...` để token không nằm trong HTTP path/query. Đăng nhập/OTP/Google giữ route để tiếp tục nhận lời; UI yêu cầu nhấn nhận. Token không ghi audit/log; DB chỉ hash SHA-256. API chỉ trả token lúc tạo lại. Một link không gắn email chỉ dùng cho một tài khoản; retry người đã nhận là idempotent nhưng không phục hồi quyền đã bị thu hồi.

Email: gửi qua Resend/SMTP đã cấu hình. `delivery=sent` là provider chấp nhận; `failed` không tuyên bố đã giao email. Link đã tạo vẫn dùng được, UI hướng dẫn sao chép. Không gửi email thật trong test.

## Socket

- `send_message`: channelId/content/replyToId?/attachmentId?/clientMessageId?; ACK success/message/error, client timeout 10s. Client mới luôn gửi UUID. Legacy không ID vẫn hoạt động nhưng không chống trùng.
- Key chống trùng `(author, channel, clientMessageId)`, fingerprint nội dung/reply/file; transaction/advisory lock và unique DB. Retry giữ attachment ID, không upload lại khi chỉ mất ACK. Payload đổi hoặc tin đã xóa trả lỗi xung đột.
- `new_message` gồm clientMessageId để UI gỡ bản đang gửi khi ACK mất; duplicate không broadcast lại.
- `access_revoked` xóa dữ liệu đang hiển thị và ngắt socket; reconnect tải lại danh sách/lịch sử theo quyền hiện tại.
- `join_meeting`/transport/produce/consume: quyền media của kênh chưa lưu trữ. Lựa chọn lobby chuyển vào join; nguồn tắt không produce. ACK media có timeout 10s; lỗi/rời/hủy/disconnect dọn track/transport.

## Traceability và bằng chứng

| Yêu cầu                  | Implementation                                    | Kiểm chứng                                                             |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------- |
| URL/home đúng ID         | navigation/AppContext + Home/Chat/Meeting         | web core test + trình duyệt 2 workspace/reload/back/forward            |
| Không phát nguồn bị tắt  | local-media + MeetingContext                      | 4 tổ hợp unit + lobby browser + remote producers=0                     |
| Retry/backfill           | migration012/service/socket/outbox                | integration 6 retry + lost ACK + after + revoked                       |
| Private quyền đồng nhất  | channel_access/service/schedules/socket/upload    | governance integration REST/socket/search/file/media                   |
| Invitation/owner/archive | governance + migrations013–014 + Admin/Invitation | lifecycle/concurrency/DB integrity integration; UI tạo private channel |

Không tuyên bố throughput, QoS mạng thật, email delivery end-to-end hay production readiness từ các test này.
