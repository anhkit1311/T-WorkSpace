-- Portal announcements and publishing permissions
CREATE TABLE IF NOT EXISTS portal_announcements (
  id uuid PRIMARY KEY,
  title varchar(255) NOT NULL,
  category varchar(50) NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'training', 'event', 'urgent')),
  badge varchar(50) DEFAULT 'Mới',
  summary text NOT NULL,
  content text NOT NULL,
  scope varchar(100) NOT NULL DEFAULT 'Toàn trường',
  pinned boolean NOT NULL DEFAULT false,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name varchar(160) NOT NULL DEFAULT 'Phòng Công tác Sinh viên',
  author_title varchar(160) DEFAULT 'Cán bộ quản trị',
  unit_id uuid REFERENCES academic_units(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_announcements_created_at ON portal_announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_announcements_category ON portal_announcements(category);
CREATE INDEX IF NOT EXISTS idx_portal_announcements_pinned ON portal_announcements(pinned);

CREATE TABLE IF NOT EXISTS announcement_publishers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed initial announcements if none exist
INSERT INTO portal_announcements (id, title, category, badge, summary, content, scope, pinned, author_name, author_title, created_at)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Thông báo v/v Tổ chức Tuần lễ Sinh hoạt Công dân - Sinh viên đầu năm học 2026 - 2027',
    'general',
    'Mới',
    'Nhà trường thông báo kế hoạch tổ chức Tuần lễ Sinh hoạt Công dân - Sinh viên năm học 2026 - 2027 dành cho toàn thể sinh viên các khóa, hình thức trực tiếp kết hợp trực tuyến qua Cổng nội bộ.',
    'Căn cứ kế hoạch đào tạo và công tác sinh viên năm học 2026 - 2027, Trường Đại học Tôn Đức Thắng thông báo kế hoạch tổ chức "Tuần lễ Sinh hoạt Công dân - Sinh viên" đầu khóa và đầu năm học như sau:\n\n1. Mục đích:\n- Nâng cao nhận thức của sinh viên về đường lối, chủ trương của Đảng, chính sách, pháp luật của Nhà nước.\n- Phổ biến quy chế đào tạo, chuẩn đầu ra, quy định về đạo đức tác phong và các chế độ chính sách học vụ.\n\n2. Thời gian và hình thức:\n- Thời gian: Từ ngày 15/10/2026 đến hết ngày 30/10/2026.\n- Hình thức: Kết hợp báo cáo trực tiếp tại Hội trường 2A và kiểm tra trắc nghiệm chuyên đề trực tuyến trên cổng E-Learning.\n\n3. Yêu cầu:\n- Toàn thể sinh viên tham gia đầy đủ các buổi sinh hoạt theo thời khóa biểu của từng Khoa.\n- Kết quả sinh hoạt là điều kiện bắt buộc để đánh giá điểm rèn luyện học kỳ.',
    'Toàn trường',
    true,
    'Phòng Công tác Sinh viên',
    'Tổ trưởng Quản lý Đào tạo',
    now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Kế hoạch đăng ký môn học và thời khóa biểu Học kỳ 1 năm học 2026 - 2027',
    'training',
    'Quan trọng',
    'Phòng Đại học thông báo thời gian mở cổng đăng ký học phần chính thức cho sinh viên các khóa từ ngày 25/10/2026. Sinh viên kiểm tra học phí và điều kiện tiên quyết trước đợt đăng ký.',
    'Kính gửi sinh viên các khóa bậc Đại học chính quy,\n\nPhòng Đại học thông báo lịch đăng ký học phần Học kỳ 1 năm học 2026 - 2027 chi tiết như sau:\n\n- Đợt 1 (Sinh viên năm cuối & Khóa 23): Bắt đầu từ 08:00 ngày 25/10/2026 đến 17:00 ngày 26/10/2026.\n- Đợt 2 (Khóa 24 & Khóa 25): Bắt đầu từ 08:00 ngày 27/10/2026 đến 17:00 ngày 28/10/2026.\n- Đợt 3 (Đăng ký bổ sung toàn trường): Từ ngày 29/10/2026 đến hết ngày 31/10/2026.\n\nLưu ý: Sinh viên cần hoàn tất đóng học phí đúng hạn và rà soát các môn tiên quyết trên hệ thống trước khi đăng ký.',
    'Phòng Đại học',
    false,
    'Phòng Đại học',
    'Ban Giáo vụ',
    now() - interval '2 hours'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Hội thảo Khoa học Quốc tế & Lễ trao Giải thưởng Nghiên cứu Trẻ TDTU 2026',
    'event',
    'Mới',
    'Chào mừng Ngày Nhà giáo Việt Nam 20/11, Trường Đại học Tôn Đức Thắng tổ chức Hội thảo Khoa học Quốc tế và phát động Giải thưởng Sinh viên Nghiên cứu Khoa học TDTU 2026.',
    'Ban Giám hiệu trân trọng kính mời toàn thể Giảng viên, Nghiên cứu sinh, Học viên cao học và Sinh viên tham dự chuỗi sự kiện Khoa học & Công nghệ TDTU 2026:\n\n- Địa điểm: Hội trường A, Trụ sở chính Tân Phong, Quận 7.\n- Thời gian: 08:30 ngày 18/11/2026.\n- Các chuyên đề tiêu biểu: Trí tuệ nhân tạo trong giáo dục đại học, Truyền thông số và IoT, Năng lượng tái tạo và Phát triển bền vững.\n- Sinh viên tham dự được cấp chứng nhận và cộng điểm rèn luyện hoạt động khoa học.',
    'Toàn trường',
    false,
    'Phòng Quản lý Phát triển KH&CN',
    'Trưởng phòng QLKH',
    now() - interval '1 day'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Thông báo khẩn về việc kiểm tra rà soát thông tin bảo hiểm y tế sinh viên đợt 1',
    'urgent',
    'Khẩn',
    'Yêu cầu sinh viên chưa nộp mã thẻ BHYT hoặc thông tin còn sai lệch cập nhật ngay trên Cổng nội bộ trước 17:00 ngày 30/10/2026 để đảm bảo quyền lợi khám chữa bệnh.',
    'Nhằm đảm bảo quyền lợi khám chữa bệnh và quyền lợi bảo hiểm y tế theo Luật BHYT hiện hành, Trạm Y tế và Phòng Công tác Sinh viên đề nghị sinh viên khẩn trương thực hiện:\n\n1. Truy cập mục Trang cá nhân trên Cổng nội bộ để kiểm tra mã số BHXH/BHYT.\n2. Trường hợp mã số chưa chính xác hoặc chưa được gia hạn, sinh viên điền biểu mẫu điều chỉnh trực tuyến đính kèm.\n3. Hạn chót cập nhật: 17:00 ngày 30/10/2026. Mọi thắc mắc vui lòng liên hệ Trạm Y tế TDTU hoặc hotline Tổng đài nội bộ nhánh 105.',
    'Toàn trường',
    false,
    'Trạm Y tế TDTU',
    'Bác sĩ Trưởng Trạm',
    now() - interval '2 days'
  )
ON CONFLICT (id) DO NOTHING;
