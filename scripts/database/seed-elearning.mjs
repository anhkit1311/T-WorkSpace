// Demo e-learning data tied to the call center: course CC-101 for agents (documents + a quiz
// drawn from a question bank), used as the coaching course of the admissions department and with a
// QA score sheet for its calls. Safe to re-run: an existing CC-101 is kept.
// Usage: npm run build --workspace @doan/api && node scripts/database/seed-elearning.mjs [--with-training]
//   --with-training also makes CC-101 required before agents may go "Sẵn sàng" (E1 gate).
import "../../dist/api/config/env.js";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { ElearningRepository } from "../../dist/api/modules/elearning/repository/elearning-repository.js";
import { CourseService } from "../../dist/api/modules/elearning/service/course-service.js";
import { CallCenterRepository } from "../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { QaRepository } from "../../dist/api/modules/callcenter/repository/qa-repository.js";
import { CallCenterAdminService } from "../../dist/api/modules/callcenter/service/admin-service.js";
import { CallCenterQaService } from "../../dist/api/modules/callcenter/service/qa-service.js";

const courses = new CourseService(new ElearningRepository());
const ccRepo = new CallCenterRepository();
const admin = new CallCenterAdminService(ccRepo, () => null, async () => {}, (event, details) => console.warn(event, details));
const qa = new CallCenterQaService(ccRepo, new QaRepository());

const PROCESS = `Quy trình tiếp nhận cuộc gọi tại tổng đài TDTU (5 bước):

1. Chào hỏi theo mẫu: "Trường Đại học Tôn Đức Thắng xin nghe, em/anh/chị cần hỗ trợ gì ạ?"
2. Xác minh người gọi: họ tên, MSSV hoặc số CCCD (với thí sinh), số điện thoại liên hệ.
3. Lắng nghe, tóm tắt lại yêu cầu và xác nhận đã hiểu đúng.
4. Giải đáp theo kịch bản của phòng ban; nếu chưa xử lý ngay được thì tạo phiếu yêu cầu và hẹn thời gian phản hồi.
5. Kết thúc: hỏi lại còn cần hỗ trợ gì không, cảm ơn và chào.

Sau cuộc gọi: chọn kết quả cuộc gọi, ghi chú ngắn gọn trong 30 giây hoàn tất.`;

const SCRIPT = `Kịch bản tư vấn tuyển sinh (phòng Tuyển sinh, phím 1):

- Hỏi thí sinh quan tâm ngành nào, phương thức xét tuyển nào (học bạ, điểm thi THPT, ĐGNL).
- Với câu hỏi về điểm chuẩn: chỉ đọc điểm chuẩn đã công bố trên trang tuyển sinh, không dự đoán.
- Với hồ sơ bị lỗi: tạo phiếu yêu cầu, ghi rõ mã hồ sơ, hẹn phản hồi trong 1 ngày làm việc.
- Khi người gọi bức xúc: giữ giọng bình tĩnh, ghi nhận, không tranh luận; chuyển giám sát nếu cần.`;

const QUESTIONS = [
  {
    kind: "single",
    prompt: "Bước đầu tiên khi nhận một cuộc gọi là gì?",
    options: [{ id: "a", text: "Chào hỏi theo mẫu của trường" }, { id: "b", text: "Hỏi ngay MSSV" }, { id: "c", text: "Chuyển máy cho giám sát" }],
    answer: ["a"],
  },
  {
    kind: "multiple",
    prompt: "Thông tin nào dùng để xác minh người gọi là sinh viên?",
    options: [{ id: "a", text: "Họ tên" }, { id: "b", text: "MSSV" }, { id: "c", text: "Mật khẩu tài khoản" }],
    answer: ["a", "b"],
    explanation: "Không bao giờ hỏi mật khẩu của người gọi.",
  },
  {
    kind: "true_false",
    prompt: "Khi chưa xử lý ngay được yêu cầu, tổng đài viên nên tạo phiếu yêu cầu và hẹn thời gian phản hồi.",
    answer: [true],
  },
  {
    kind: "single",
    prompt: "Thí sinh hỏi điểm chuẩn năm nay sẽ là bao nhiêu. Cách trả lời đúng?",
    options: [{ id: "a", text: "Dự đoán dựa trên năm trước" }, { id: "b", text: "Chỉ cung cấp điểm chuẩn đã công bố chính thức" }, { id: "c", text: "Từ chối trả lời" }],
    answer: ["b"],
  },
  {
    kind: "true_false",
    prompt: "Ghi chú sau cuộc gọi có thể bỏ qua nếu cuộc gọi ngắn.",
    answer: [false],
  },
];

try {
  const adminRow = await pool.query(`SELECT user_id FROM academic_role_grants WHERE role='system_admin' ORDER BY created_at LIMIT 1`);
  if (!adminRow.rowCount) throw new Error("Cần một tài khoản system_admin (scripts/ops/create-user.mjs --admin).");
  const adminId = adminRow.rows[0].user_id;
  const unit = (await pool.query(`SELECT id FROM academic_units ORDER BY (code='CNTT') DESC, created_at LIMIT 1`)).rows[0];
  if (!unit) throw new Error("Chưa có đơn vị học thuật nào.");

  let course = (await pool.query(`SELECT id FROM courses WHERE code='CC-101'`)).rows[0];
  if (course) console.log("Khóa CC-101 đã có; giữ nguyên.");
  else {
    const created = await courses.create(adminId, {
      unitId: unit.id,
      code: "CC-101",
      title: "Nghiệp vụ tổng đài viên cơ bản",
      description: "Khóa bắt buộc cho tổng đài viên mới: quy trình tiếp nhận cuộc gọi, kịch bản tư vấn và bài kiểm tra.",
      enrollment: "assigned",
    });
    course = { id: created.id };
    const chapterIds = async () => (await courses.detail(adminId, course.id)).chapters.map((chapter) => chapter.id);
    await courses.addChapter(adminId, course.id, { title: "Chương 1: Tiếp nhận cuộc gọi" });
    await courses.addChapter(adminId, course.id, { title: "Chương 2: Xử lý tình huống" });
    const [first, second] = await chapterIds();

    const doc = async (chapterId, title, body) => {
      const { id } = await courses.addLesson(adminId, chapterId, { kind: "document", title });
      await courses.updateLesson(adminId, id, { body, status: "published" });
    };
    await doc(first, "Quy trình 5 bước tiếp nhận cuộc gọi", PROCESS);
    const questionIds = [];
    for (const question of QUESTIONS) questionIds.push((await courses.saveQuestion(adminId, course.id, null, question)).id);
    const quiz = await courses.addLesson(adminId, first, { kind: "quiz", title: "Kiểm tra chương 1" });
    // E4: 4 of the 5 questions, shuffled per attempt.
    await courses.updateLesson(adminId, quiz.id, { questionIds, drawCount: 4, shuffle: true, passPercent: 70, timeLimitSeconds: 600, status: "published" });
    await doc(second, "Kịch bản tư vấn tuyển sinh", SCRIPT);
    await courses.update(adminId, course.id, { status: "published" });
    console.log("Đã tạo khóa CC-101 (2 chương, 2 tài liệu, 1 bài kiểm tra rút 4/5 câu).");
  }

  const department = (await admin.listDepartments(adminId)).find((item) => item.code === "CC_TS");
  if (!department) console.log("Chưa có phòng Tuyển sinh (chạy callcenter:seed trước) — bỏ qua liên kết tổng đài.");
  else {
    const withTraining = process.argv.includes("--with-training");
    await admin.updateDepartment(adminId, department.id, {
      coachingCourseId: course.id,
      qaThreshold: 70,
      ...(withTraining ? { trainingCourseId: course.id } : {}),
    });
    if (!(await qa.criteria(adminId, department.id)).length)
      await qa.saveCriteria(adminId, department.id, {
        criteria: [
          { label: "Chào hỏi và xác minh người gọi", weight: 2 },
          { label: "Lắng nghe, tóm tắt đúng yêu cầu", weight: 2 },
          { label: "Hướng dẫn chính xác, đầy đủ", weight: 3 },
          { label: "Kết thúc và ghi chú sau cuộc gọi", weight: 1 },
        ],
      });
    console.log(`Phòng Tuyển sinh: CC-101 là khóa bồi dưỡng (điểm QA < 70%)${withTraining ? " và khóa bắt buộc trước khi trực" : ""}; đã có phiếu chấm 4 tiêu chí.`);
  }
} finally {
  await pool.end();
}
