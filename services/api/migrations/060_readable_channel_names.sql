-- Default channels used slug names (tong-quan, phong-hop); show proper Vietnamese instead.
UPDATE channels SET name = CASE name
  WHEN 'tong-quan' THEN 'Tổng quan'
  WHEN 'phong-hop' THEN 'Phòng họp'
  WHEN 'thong-bao' THEN 'Thông báo'
  WHEN 'tai-lieu' THEN 'Tài liệu'
  WHEN 'y-tuong' THEN 'Ý tưởng'
  WHEN 'bai-tap' THEN 'Bài tập'
  WHEN 'tro-giang' THEN 'Trợ giảng'
END
WHERE name IN ('tong-quan', 'phong-hop', 'thong-bao', 'tai-lieu', 'y-tuong', 'bai-tap', 'tro-giang');
