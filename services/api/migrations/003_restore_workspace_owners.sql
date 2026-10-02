-- Phiên bản cũ của join-demo có thể ghi đè owner thành member.
INSERT INTO memberships (workspace_id, user_id, role)
SELECT id, owner_id, 'owner' FROM workspaces
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';
