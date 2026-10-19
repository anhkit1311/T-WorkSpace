-- 2.1: mọi cuộc gọi có ghi âm được tự động chép lời (speech-to-text) khi ghi âm kết thúc.
-- Đoạn [{start,end,text}] nằm ngay trên cc_calls vì ghi âm gốc ở Asterisk, không có thư mục HLS.
ALTER TABLE cc_calls ADD COLUMN transcript_status varchar(12)
  CHECK (transcript_status IN ('processing', 'ready', 'failed'));
ALTER TABLE cc_calls ADD COLUMN transcript jsonb;
