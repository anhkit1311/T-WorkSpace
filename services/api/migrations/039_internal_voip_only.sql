-- Nội bộ TDTU: không còn SIP trunk ra mạng ngoài, máy lẻ chỉ gọi nhau và sinh viên gọi hotline qua web.
-- Quyền "gọi ra ngoài" (BR-20, 037) không còn ý nghĩa.
ALTER TABLE cc_extensions DROP COLUMN can_call_out;
