-- Meeting summary messages froze the old slug room name in their first line (see 060).
UPDATE messages SET content = regexp_replace(content, '^Tổng kết cuộc họp: phong-hop', 'Tổng kết cuộc họp: Phòng họp')
WHERE kind = 'meeting_summary' AND content LIKE 'Tổng kết cuộc họp: phong-hop%';
