-- M3: phụ đề và bản chép lời (speech-to-text) cho bản ghi cuộc họp và bài giảng video.
-- Tệp captions.vtt và transcript.json nằm cạnh playlist HLS; ở đây chỉ giữ trạng thái xử lý.
ALTER TABLE meeting_recordings ADD COLUMN transcript_status varchar(12)
  CHECK (transcript_status IN ('processing', 'ready', 'failed'));
ALTER TABLE course_lessons ADD COLUMN transcript_status varchar(12)
  CHECK (transcript_status IN ('processing', 'ready', 'failed'));
