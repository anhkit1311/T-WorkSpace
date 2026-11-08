-- Có SIP trunk (đầu số hotline): quyền "gọi ra ngoài" (BR-20) quay lại sau 039. Tổng đài viên gọi lại
-- người yêu cầu từ ticket nên máy lẻ của họ được bật sẵn.
ALTER TABLE cc_extensions ADD COLUMN IF NOT EXISTS can_call_out boolean NOT NULL DEFAULT false;
UPDATE cc_extensions e SET can_call_out = true, synced_at = NULL
WHERE EXISTS (SELECT 1 FROM cc_members m WHERE m.user_id = e.user_id AND m.role = 'agent');
