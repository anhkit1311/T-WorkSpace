# Kiến trúc, schema và luồng — 01/10/2026

Tài liệu này mô tả source hiện tại, thay cho giả định Redis/eventname cũ trong bản thiết kế ban đầu. Snapshot PostgreSQL sau20migration: [schema-2026-10-01.json](../evidence/schema-2026-10-01.json), đầy đủ cột/nullability/FK/check/unique/index của36table và view `channel_access`. Tạo lại bằng `node scripts/database/schema-evidence.mjs` sau build. ERD dưới đây chia theo miền, chỉ hiển thị cột quan trọng để đọc; dùng snapshotSQL cho chi tiết.

## Kiến trúc

```mermaid
flowchart TB
 Browser[React SPA · URL định danh · IndexedDB drafts]
 LB[HTTPS API endpoint · sticky nếu polling]
 API1[Node API 1 · REST / Socket.IO]
 API2[Node API 2 · REST / Socket.IO]
 PG[(PostgreSQL · durable data / LISTEN NOTIFY / TTL)]
 Files[(Private DB bytea hoặc S3)]
 SFU1[mediasoup worker pool node1]
 SFU2[mediasoup worker pool node2]
 TURN[STUN / coturn]
 Browser -->|REST + chat socket| LB
 LB --> API1
 LB --> API2
 API1 <--> PG
 API2 <--> PG
 API1 --> Files
 API2 --> Files
 API1 --> SFU1
 API2 --> SFU2
 Browser -->|media-location → socket đúng owner| API1
 Browser <-->|WebRTC RTP / RTCP| SFU1
 Browser <-->|ICE relay khi cần| TURN
 TURN <--> SFU1
```

Một room có một SFU router trên một worker/node. DB session affinity chọn owner, adapter chỉ đồng bộ ứng dụng; không chia sẻ transport/router. Chat socket giữ ở endpointAPI, media có socket riêng tới SFUowner nếu cần. Lease45s/heartbeat15s áp dụng cảlocal để dọn crash; modepostgres mở broadcast liên node. Đường media tới node2 tương tựnode1.

## ERD quản trị và xác thực

```mermaid
erDiagram
 users ||--o{ workspaces : owner_id
 users ||--o{ memberships : user_id
 workspaces ||--o{ memberships : workspace_id
 workspaces ||--o{ channels : workspace_id
 users ||--o{ channels : created_by
 channels ||--o{ channel_memberships : channel_id
 users ||--o{ channel_memberships : user_id
 workspaces ||--o{ workspace_invitations : workspace_id
 users o|--o{ workspace_invitations : created_by_accepted_by
 workspaces ||--o{ audit_events : workspace_id
 users o|--o{ audit_events : actor_id
 users ||--o{ refresh_sessions : user_id
 users ||--o{ password_resets : user_id
 users ||--o{ socket_presence : user_id
 users {
  uuid id PK
  varchar email UK
  text password_hash
  boolean email_verified
  varchar display_name
  varchar bio
  text_array interests
  boolean show_activity
 }
 workspaces {
  uuid id PK
  uuid owner_id FK
  varchar slug UK
  timestamptz archived_at
 }
 memberships {
  uuid workspace_id PK,FK
  uuid user_id PK,FK
  varchar role
 }
 channels {
  uuid id PK
  uuid workspace_id FK
  varchar type
  boolean is_private
  integer position
  timestamptz archived_at
 }
```

`channel_access` làview memberships ×channels, kênh riêng yêu cầu channel_memberships **kể cảowner/admin**; `can_write` kiểm workspace/kênh không lưu trữ. Owner có thể tự cấp membership qua quản trị; không bypass để đọc nội dung. Owner integrity: một ownerrole, khớpworkspaces.owner_id, deferredconstraint khi commit. Invitationtoken lưuSHA256, không lưu token gốc. `email_otps` khóa theo email (khôngFKuser); rate_limits theo key; api_instances/helperattachments/cleanup/schema_migrations là bảng vận hành độc lập.

## ERD chat và công việc

```mermaid
erDiagram
 channels ||--o{ messages : channel_id
 users ||--o{ messages : author_id
 messages o|--o{ messages : reply_to_thread_root
 message_attachments o|--o{ messages : attachment_id
 channels ||--o{ message_attachments : channel_id
 users ||--o{ message_attachments : uploader_id
 channels ||--o{ channel_preferences : channel_id
 users ||--o{ channel_preferences : user_id
 messages ||--o{ message_reactions : message_id
 messages ||--o{ message_mentions : message_id
 messages ||--o{ message_pins : message_id
 messages ||--o{ message_bookmarks : message_id
 messages ||--o{ thread_reads : root_id
 messages ||--o{ notifications : message_id
 users ||--o{ notifications : user_id
 workspaces ||--o{ workspace_notification_preferences : workspace_id
 channels ||--o{ tasks : channel_id
 users ||--o{ tasks : created_by
 users o|--o{ tasks : assignee_id
 messages o|--o{ tasks : source_message_id
 tasks ||--o{ task_checklist : task_id
 tasks ||--o{ task_comments : task_id
 tasks ||--o{ task_activity : task_id
 tasks ||--o{ task_attachments : task_id
 message_attachments ||--o{ task_attachments : attachment_id
 messages {
  uuid id PK
  uuid channel_id FK
  uuid author_id FK
  uuid client_message_id
  char client_payload_hash
  uuid thread_root_id FK
  text content
  timestamptz deleted_at
 }
 tasks {
  uuid id PK
  uuid client_task_id
  uuid source_message_id FK
  uuid assignee_id FK
  text status
  bigint position
  integer version
 }
 message_attachments {
  uuid id PK
  text storage_provider
  text object_key
  bytea data
  integer file_size
 }
```

Các bảng reaction/mention/bookmark/read/preference còn FKuser, pin FKpinned_by, comment/activity FKactor; chi tiết trongsnapshot. Message unique(author_id,client_message_id), task unique(created_by,client_task_id). Tệpproviderdb giữbytea, providers3 giữobject_key; check chỉ một dạng lưu. Message softdelete và quyền root còn hiệu lực khi đọc thread/search/file/notif. Trigger xóa metadataS3 đưaobject vào queue kể cảcascade.

## ERD họp

```mermaid
erDiagram
 channels ||--o{ meeting_schedules : channel_id
 users ||--o{ meeting_schedules : created_by
 channels ||--o{ meeting_sessions : channel_id
 users ||--o{ meeting_sessions : host_id
 meeting_schedules o|--o{ meeting_sessions : schedule_id
 meeting_sessions ||--o{ meeting_attendees : session_id
 users ||--o{ meeting_attendees : user_id
 meeting_sessions ||--o{ meeting_connections : session_id
 users ||--o{ meeting_connections : user_id
 channels ||--o{ meeting_participations : channel_id
 users ||--o{ meeting_participations : user_id
 meeting_sessions o|--o{ meeting_participations : session_id
 meeting_sessions {
  uuid id PK
  uuid channel_id FK
  uuid schedule_id FK
  uuid host_id FK
  text media_instance_id
  boolean waiting_enabled
  boolean locked
  timestamptz ended_at
 }
 meeting_attendees {
  uuid session_id PK,FK
  uuid user_id PK,FK
  text role
  text state
  boolean raised_hand
 }
 meeting_connections {
  text socket_id PK
  uuid session_id FK
  uuid user_id FK
  text instance_id
 }
```

`media_instance_id`/`instance_id` làrouting key, không FKapi_instances vìlease có thể hết/xóa trong khi cần giữ lịch sử. Một sessionactive/channel bằng partialuniqueindex. Waiting/admitted/kicked tách host/cohost/member; đếmuserdistinct vàtabsriêng.

## Sequence auth

```mermaid
sequenceDiagram
 participant U as Browser
 participant A as Auth API
 participant D as PostgreSQL
 participant E as Email provider
 U->>A: register(email,password,name)
 A->>D: salted password hash + OTP hash/expiry
 A->>E: OTP (không log mã)
 E-->>U: Email OTP
 U->>A: verify-otp(email,code)
 A->>D: lock OTP / check attempt / consume
 A-->>U: access JWT + HttpOnly refresh cookie
 U->>A: refresh(cookie)
 A->>D: rotate token hash / revoke old
 A-->>U: new access + refresh cookie
```

Email cần provider cấu hình; nhánh lỗi trả trạng thái, không coi delivery production đã kiểm. Login xác minh passwordhash+email_verified; logout revoke refresh và dọn draftcục bộ. Passwordreset dùng hash domainriêng, đổi mật khẩu revoke refresh khác; accessJWT đã cấp còn tớiTTL.

## Sequence chat / reconnect

```mermaid
sequenceDiagram
 participant U as Sender / IndexedDB outbox
 participant A as Socket API
 participant D as PostgreSQL
 participant R as Authorized recipients / adapter
 U->>A: send_message(clientMessageId,content,mentions,file)
 A->>D: lock workspace/channel/member + current rights
 A->>D: advisory lock(author,ID) + compare fingerprint
 alt First request
 D-->>A: insert message + mention/notification, commit
 A-->>R: new_message / notifications_changed
 else Identical retry
 D-->>A: existing message (no second broadcast)
 end
 A-->>U: ACK success/message
 U->>U: remove immutable outbox ID
 Note over U,A: On missing ACK keep same ID and payload
 U->>A: reconnect then REST messages?after=cursor
 A->>D: current access + timeline page
 A-->>U: backfill
 U->>U: merge by message ID; paginate until caught up
```

Broadcast recipients lấy quyền DB hiện tại, không dựa channelroom đãjoin trước. Thu hồi private/membership ngắt socketmọinode; REST/backfill/download tiếp tụccheckDB. Replythread root đãxóa không lọt context/search/notif/file.

## Sequence invitation

```mermaid
sequenceDiagram
 participant O as Owner/Admin
 participant A as Governance API
 participant D as PostgreSQL
 participant M as Invitee
 O->>A: create invite(email optional)
 A->>D: random token hash + expiry + audit
 A-->>O: copyable one-time link + email status
 O-->>M: Share link
 M->>A: accept token after login/verified email
 A->>D: lock invite/workspace; check recipient/expiry/revocation
 A->>D: insert membership + mark accepted + audit
 A-->>M: workspace ID
 Note over A,D: Same invite/user replay succeeds; other user or revoked/expired fails
```

## Sequence task

```mermaid
sequenceDiagram
 participant U as Chat / Kanban panel
 participant A as Tasks API
 participant D as PostgreSQL
 participant R as Current channel recipients
 U->>A: create(clientTaskId,sourceMessageId)
 A->>D: current rights + source/check assignee + fingerprint
 D-->>A: created task/version1 or identical existing task
 A-->>R: task_changed(ID,version)
 U->>A: PATCH(version,fields/action/beforeTaskId)
 A->>D: channel lock + task row lock
 alt Version matches
 A->>D: mutation + version increment + stable position + activity
 A-->>U: saved task
 A-->>R: task_changed
 else Conflict
 A-->>U: 409 TASK_CONFLICT
 U->>U: preserve local draft; user reloads before retry
 end
```

## Sequence meeting

```mermaid
sequenceDiagram
 participant U as Lobby
 participant A as API / session owner
 participant D as PostgreSQL
 participant S as mediasoup worker
 U->>A: media-location(channel ID)
 A-->>U: existing owner endpoint or initial endpoint
 U->>A: join_meeting(room,schedule)
 A->>D: access/limits/session lock/affinity
 alt Waiting enabled
 A-->>U: waiting (no SFU peer/media)
 else Admitted
 A->>S: join router, least-room worker
 A-->>U: router capabilities / existing producers
 U->>U: Device.load; create transports; request enabled devices only
 U->>A: connect transport / produce enabled source
 A->>D: requireAdmitted again
 A->>S: create producer/consumer
 U-->>S: WebRTC media
 end
 U->>A: meeting_action(waiting/lock/admit/kick/end)
 A->>D: current host/cohost rights
 A-->>U: meeting state changed / closed
 U->>U: stop tracks / close transports on cancel, leave or failure
 Note over A,D: Expired API lease leaves stale connections and closes history; next session chooses live owner
```

Hủy/nativeoperation timeout có cleanup cho tài nguyên trả vềmuộn. ACK10s, Device.load10s, xin thiết bị30s; quyền thiết bị vẫn do người dùng/trình duyệtquyết định. Worker chết dọn phòng của nó; room khác trên worker khác còn. Chi tiết TURN/simulcast/layer ở [16](../modules/16-dieu-hanh-hop-va-media.md).
