-- M2: cuộc gọi chuyển sang họp video; phòng hỗ trợ (nhóm làm việc riêng) được dùng lại nếu mời lần nữa.
ALTER TABLE cc_calls ADD COLUMN video_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
