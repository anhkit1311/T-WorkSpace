-- Q3: hàng đợi việc xử lý media (chuyển HLS, phụ đề) trong PostgreSQL. Mỗi tiến trình API lấy việc
-- bằng FOR UPDATE SKIP LOCKED nên nhiều instance chia nhau mà không trùng; việc còn trong bảng
-- sau khi máy chủ khởi động lại.
CREATE TABLE media_jobs (
  id uuid PRIMARY KEY,
  kind varchar(40) NOT NULL,
  ref_id uuid NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One pending or running job per (kind, target): asking twice does not transcode twice.
CREATE UNIQUE INDEX media_jobs_active ON media_jobs (kind, ref_id) WHERE status IN ('queued', 'running');
CREATE INDEX media_jobs_ready ON media_jobs (run_after) WHERE status = 'queued';
