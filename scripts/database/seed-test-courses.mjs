// Seed comprehensive test courses for e-learning feature verification.
// Safe to re-run: existing test courses by code are updated or preserved.
// Usage: node scripts/database/seed-test-courses.mjs

import { randomInt, randomUUID } from "node:crypto";
import "../../dist/api/config/env.js";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { ElearningRepository } from "../../dist/api/modules/elearning/repository/elearning-repository.js";
import { CourseService } from "../../dist/api/modules/elearning/service/course-service.js";

const repo = new ElearningRepository();
const courses = new CourseService(repo);

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const generateCertCode = () =>
  `TDTU-${Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

async function main() {
  console.log("=== BẮT ĐẦU TẠO CÁC KHÓA HỌC KIỂM THỬ E-LEARNING ===");

  // 1. Tìm tài khoản admin để thực hiện tạo khóa học
  const adminRow = await pool.query(
    `SELECT u.id, u.email, u.display_name 
     FROM users u 
     JOIN academic_role_grants r ON r.user_id = u.id 
     WHERE r.role = 'system_admin' 
     ORDER BY r.created_at LIMIT 1`
  );
  if (!adminRow.rowCount) {
    throw new Error("Không tìm thấy tài khoản system_admin nào trong hệ thống.");
  }
  const adminId = adminRow.rows[0].id;
  console.log(`> Quản trị viên thực hiện: ${adminRow.rows[0].display_name} (${adminRow.rows[0].email})`);

  // 2. Lấy danh sách người dùng để phân công / ghi danh
  const allUsers = (await pool.query(`SELECT id, email, display_name FROM users`)).rows;
  console.log(`> Số lượng tài khoản người dùng trong hệ thống: ${allUsers.length}`);

  // 3. Tìm các đơn vị học thuật
  const unitsResult = await pool.query(`SELECT id, code, name FROM academic_units`);
  const unitsMap = new Map(unitsResult.rows.map((u) => [u.code, u]));
  const cnttUnit = unitsMap.get("001") || unitsResult.rows[0];
  const qtkdUnit = unitsMap.get("003") || unitsResult.rows[0];
  const nnUnit = unitsMap.get("005") || unitsResult.rows[0];

  console.log(`> Đơn vị CNTT: ${cnttUnit.name} (id: ${cnttUnit.id})`);
  console.log(`> Đơn vị QTKD: ${qtkdUnit.name} (id: ${qtkdUnit.id})`);
  console.log(`> Đơn vị Ngoại ngữ: ${nnUnit.name} (id: ${nnUnit.id})`);

  // Helper xóa khóa học cũ nếu muốn làm mới hoàn toàn
  const deleteCourseIfExists = async (code) => {
    const existing = (await pool.query(`SELECT id FROM courses WHERE code = $1`, [code])).rows[0];
    if (existing) {
      await pool.query(`DELETE FROM courses WHERE id = $1`, [existing.id]);
      console.log(`  [Dọn dẹp] Đã xóa khóa ${code} cũ để tạo mới hoàn chỉnh.`);
    }
  };

  // ---------------------------------------------------------------------------------------------------
  // KHÓA 1: CS-102 - Lập trình Web Hiện đại với React & TypeScript (Open, Published)
  // ---------------------------------------------------------------------------------------------------
  await deleteCourseIfExists("CS-102");
  console.log("\n[1/6] Tạo khóa học CS-102: Lập trình Web Hiện đại với React & TypeScript (Open)...");
  {
    const created = await courses.create(adminId, {
      unitId: cnttUnit.id,
      code: "CS-102",
      title: "Lập trình Web Hiện đại với React & TypeScript",
      description: "Khóa học chuyên sâu về xây dựng ứng dụng web hiện đại. Bao gồm TypeScript cơ bản đến nâng cao, React Hooks, quản lý state và kiến trúc Component sạch.",
      enrollment: "open",
    });

    await courses.addChapter(adminId, created.id, { title: "Chương 1: TypeScript nâng cao trong ứng dụng React" });
    await courses.addChapter(adminId, created.id, { title: "Chương 2: React Hooks & State Management" });
    await courses.addChapter(adminId, created.id, { title: "Chương 3: Kiểm tra đánh giá năng lực" });

    const detail = await courses.detail(adminId, created.id);
    const [ch1, ch2, ch3] = detail.chapters.map((c) => c.id);

    // Bài 1
    const l1 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Bài 1: TypeScript Interfaces & Generics" });
    await courses.updateLesson(adminId, l1.id, {
      body: `# TypeScript Interfaces & Generics trong ứng dụng React

## 1. Tại sao cần TypeScript trong dự án lớn?
TypeScript cung cấp hệ thống kiểu tĩnh (Static Type Checking) giúp:
- Phát hiện lỗi sớm ngay trong giai đoạn biên dịch thay vì runtime.
- Cải thiện đáng kể trải nghiệm phát triển với Auto-completion và Refactoring thông minh.
- Đóng vai trò như tài liệu sống mô tả dữ liệu API và Props của Components.

## 2. Phân biệt Type Alias và Interface
\`\`\`typescript
// Định nghĩa bằng Interface (thích hợp mở rộng OOP)
interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'lecturer' | 'admin';
}

// Mở rộng interface
interface StudentProfile extends UserProfile {
  studentCode: string;
  gpa: number;
}
\`\`\`

## 3. Generics trong React Components
\`\`\`typescript
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}

export function GenericList<T>({ items, renderItem }: ListProps<T>) {
  return (
    <ul className="list-group">
      {items.map((item, index) => (
        <li key={index}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}
\`\`\`
Ghi nhớ: Hãy tận dụng Generics khi viết các component tái sử dụng (Bảng dữ liệu, Dropdown, Danh sách).`,
      status: "published",
    });

    // Bài 2
    const l2 = await courses.addLesson(adminId, ch2, { kind: "document", title: "Bài 2: React Hooks chuyên sâu (useMemo, useCallback, Custom Hooks)" });
    await courses.updateLesson(adminId, l2.id, {
      body: `# React Hooks Chuyên sâu

## 1. Tránh bẫy Re-render với useMemo & useCallback
- **useMemo**: Lưu trữ kết quả tính toán đắt đỏ giữa các lần render.
\`\`\`typescript
const filteredList = useMemo(() => {
  return bigData.filter(item => item.score >= threshold);
}, [bigData, threshold]);
\`\`\`
- **useCallback**: Lưu trữ tham chiếu hàm để tránh làm re-render các con được bọc bằng \`React.memo\`.

## 2. Quy tắc vàng khi xây dựng Custom Hooks
1. Tên hook luôn bắt đầu bằng tiền tố \`use\`.
2. Không gọi hook bên trong vòng lặp hoặc khối điều kiện.
3. Gom nhóm logic nghiệp vụ và state dùng chung ra khỏi UI component.

Ví dụ Custom Hook debounce tìm kiếm:
\`\`\`typescript
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}
\`\`\``,
      status: "published",
    });

    // Ngân hàng câu hỏi
    const q1 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Trong React, hook nào được dùng để ghi nhớ kết quả tính toán đắt đỏ giữa các lần render?",
      options: [
        { id: "a", text: "useCallback" },
        { id: "b", text: "useMemo" },
        { id: "c", text: "useRef" },
        { id: "d", text: "useEffect" },
      ],
      answer: ["b"],
      explanation: "useMemo dùng để memoize kết quả trả về của hàm tính toán, trong khi useCallback dùng để memoize tham chiếu của bản thân hàm.",
      points: 2,
    });

    const q2 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "multiple",
      prompt: "Những phát biểu nào sau đây là ĐÚNG về TypeScript?",
      options: [
        { id: "a", text: "TypeScript giúp phát hiện lỗi kiểu dữ liệu ở thời điểm biên dịch" },
        { id: "b", text: "Mọi mã JavaScript hợp lệ đều là mã TypeScript hợp lệ" },
        { id: "c", text: "Trình duyệt có thể thực thi trực tiếp mã nguồn .ts mà không cần biên dịch sang .js" },
        { id: "d", text: "Generics cho phép tạo các thành phần hoạt động với nhiều kiểu dữ liệu khác nhau" },
      ],
      answer: ["a", "b", "d"],
      explanation: "Trình duyệt không chạy trực tiếp tệp .ts; mã TypeScript bắt buộc phải được biên dịch (transpile) sang JavaScript tiêu chuẩn.",
      points: 3,
    });

    const q3 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "true_false",
      prompt: "Thay đổi giá trị của một biến tham chiếu qua `useRef` sẽ kích hoạt component re-render lại ngay lập tức.",
      options: [],
      answer: [false],
      explanation: "useRef giữ nguyên tham chiếu và việc thay đổi thuộc tính `.current` không làm component kích hoạt re-render.",
      points: 2,
    });

    const q4 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Thuộc tính `key` trong danh sách React có vai trò quan trọng nhất là gì?",
      options: [
        { id: "a", text: "Dùng để gán CSS class cho phần tử" },
        { id: "b", text: "Giúp thuật toán Reconciliation của React xác định phần tử nào đã thay đổi, thêm hay bị xóa" },
        { id: "c", text: "Để truy cập giá trị của phần tử trong DOM thông qua JavaScript" },
      ],
      answer: ["b"],
      explanation: "Key giúp React phân biệt danh tính ổn định của các nút DOM giữa các lần render, tối ưu hóa hiệu năng render.",
      points: 2,
    });

    // Bài 3: Quiz
    const quizLesson = await courses.addLesson(adminId, ch3, { kind: "quiz", title: "Bài kiểm tra cuối khóa React & TypeScript" });
    await courses.updateLesson(adminId, quizLesson.id, {
      questionIds: [q1.id, q2.id, q3.id, q4.id],
      drawCount: 4,
      shuffle: true,
      passPercent: 70,
      timeLimitSeconds: 900, // 15 phút
      status: "published",
    });

    // Xuất bản khóa học
    await courses.update(adminId, created.id, { status: "published" });
    console.log(`  ✓ Đã tạo CS-102 thành công (3 chương, 2 bài đọc, 1 bài quiz 4 câu).`);
  }

  // ---------------------------------------------------------------------------------------------------
  // KHÓA 2: SE-301 - Quản trị Dự án Phần mềm theo Agile & Scrum (Assigned, Published)
  // ---------------------------------------------------------------------------------------------------
  await deleteCourseIfExists("SE-301");
  console.log("\n[2/6] Tạo khóa học SE-301: Quản trị Dự án Phần mềm theo Agile & Scrum (Assigned)...");
  {
    const created = await courses.create(adminId, {
      unitId: cnttUnit.id,
      code: "SE-301",
      title: "Quản trị Dự án Phần mềm theo Agile & Scrum",
      description: "Khóa đào tạo bắt buộc dành cho sinh viên thực hiện đồ án tốt nghiệp và dự án phần mềm. Hướng dẫn thực hành khung làm việc Scrum, quản lý backlog và phối hợp nhóm hiệu quả.",
      enrollment: "assigned",
    });

    await courses.addChapter(adminId, created.id, { title: "Chương 1: Các trụ cột và Giá trị của Scrum" });
    await courses.addChapter(adminId, created.id, { title: "Chương 2: Đánh giá hiểu biết về Scrum Framework" });

    const detail = await courses.detail(adminId, created.id);
    const [ch1, ch2] = detail.chapters.map((c) => c.id);

    const l1 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Bài 1: 3 Vai trò cốt lõi trong Scrum" });
    await courses.updateLesson(adminId, l1.id, {
      body: `# 3 Vai trò Cốt lõi trong Nhóm Scrum

Trong một nhóm Scrum (Scrum Team), không có sự phân cấp quản lý truyền thống mà là mô hình tự quản (Self-managing) và liên chức năng (Cross-functional):

## 1. Product Owner (PO)
- Chịu trách nhiệm tối đa hóa giá trị của sản phẩm.
- Quản lý và sắp xếp thứ tự ưu tiên của **Product Backlog**.
- Là cầu nối duy nhất đại diện cho tiếng nói của khách hàng và các bên liên quan (Stakeholders).

## 2. Scrum Master (SM)
- Đóng vai trò là Người lãnh đạo phục vụ (Servant Leader).
- Giúp nhóm tuân thủ lý thuyết, thực hành và các quy tắc của Scrum.
- Tháo gỡ các trở ngại (Impediments) cản trở tiến độ của Developers.
- Bảo vệ nhóm khỏi những yêu cầu đột xuất làm gián đoạn Sprint.

## 3. Developers (Đội ngũ phát triển)
- Những người trực tiếp tạo ra phần tăng trưởng sử dụng được (Increment) ở mỗi Sprint.
- Chịu trách nhiệm về chất lượng kỹ thuật, ước lượng công việc và tuân thủ Definition of Done (DoD).`,
      status: "published",
    });

    const l2 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Bài 2: 5 Sự kiện chính trong chu kỳ Sprint" });
    await courses.updateLesson(adminId, l2.id, {
      body: `# 5 Sự kiện (Ceremonies) trong Scrum

Chu kỳ một Sprint thường kéo dài từ 1 đến 4 tuần:

1. **Sprint Planning (Lập kế hoạch Sprint)**:
   - Trả lời 3 câu hỏi: Tại sao Sprint này có giá trị (Sprint Goal)? Có thể làm được gì? Và làm như thế nào?

2. **Daily Scrum (Họp đứng hằng ngày)**:
   - Giới hạn 15 phút dành riêng cho Developers để đồng bộ tiến độ và nhận diện trở ngại.

3. **Sprint (Bản thân Sprint)**:
   - Chiếc hộp thời gian (Timebox) chứa tất cả các hoạt động tạo ra sản phẩm.

4. **Sprint Review (Đánh giá Sprint)**:
   - Trình diễn bản tăng trưởng sản phẩm hoàn chỉnh cho các bên liên quan, thu thập phản hồi thực tế.

5. **Sprint Retrospective (Cải tiến Sprint)**:
   - Diễn ra ngay sau Sprint Review; toàn bộ nhóm cùng nhìn lại quy trình, con người, công cụ và thống nhất ít nhất một hành động cải tiến cụ thể cho Sprint kế tiếp.`,
      status: "published",
    });

    // Câu hỏi
    const q1 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Ai là người chịu trách nhiệm cao nhất đối với việc sắp xếp thứ tự ưu tiên trong Product Backlog?",
      options: [
        { id: "a", text: "Scrum Master" },
        { id: "b", text: "Product Owner" },
        { id: "c", text: "Trưởng nhóm lập trình (Lead Developer)" },
        { id: "d", text: "Giảng viên hướng dẫn" },
      ],
      answer: ["b"],
      explanation: "Product Owner là người duy nhất sở hữu và chịu trách nhiệm tối ưu hóa giá trị của Product Backlog.",
      points: 2,
    });

    const q2 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Thời lượng khuyến nghị tối đa cho buổi họp Daily Scrum là bao nhiêu phút?",
      options: [
        { id: "a", text: "15 phút" },
        { id: "b", text: "30 phút" },
        { id: "c", text: "45 phút" },
        { id: "d", text: "60 phút" },
      ],
      answer: ["a"],
      explanation: "Daily Scrum là buổi họp ngắn định kỳ hàng ngày, giới hạn tối đa 15 phút (Timebox 15 mins).",
      points: 2,
    });

    const q3 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "true_false",
      prompt: "Mục tiêu chính của buổi họp Sprint Retrospective là trình diễn các tính năng phần mềm mới cho khách hàng xem.",
      options: [],
      answer: [false],
      explanation: "Trình diễn tính năng mới cho khách hàng là mục tiêu của Sprint Review. Sprint Retrospective là buổi họp nội bộ nhóm để tìm giải pháp cải tiến quy trình làm việc.",
      points: 2,
    });

    const quiz = await courses.addLesson(adminId, ch2, { kind: "quiz", title: "Kiểm tra kiến thức Scrum Foundation" });
    await courses.updateLesson(adminId, quiz.id, {
      questionIds: [q1.id, q2.id, q3.id],
      drawCount: 3,
      shuffle: true,
      passPercent: 80,
      timeLimitSeconds: 600,
      status: "published",
    });

    await courses.update(adminId, created.id, { status: "published" });

    // Chỉ định học viên (Assign toàn bộ user đang có vào khóa học)
    const userIds = allUsers.map((u) => u.id);
    await repo.enroll(created.id, userIds, "assigned", adminId);
    console.log(`  ✓ Đã tạo SE-301 thành công và chỉ định ${userIds.length} học viên.`);
  }

  // ---------------------------------------------------------------------------------------------------
  // KHÓA 3: AI-101 - Nhập môn Trí tuệ Nhân tạo & Học máy (Open, Published)
  // ---------------------------------------------------------------------------------------------------
  await deleteCourseIfExists("AI-101");
  console.log("\n[3/6] Tạo khóa học AI-101: Nhập môn Trí tuệ Nhân tạo & Học máy (Open)...");
  {
    const created = await courses.create(adminId, {
      unitId: cnttUnit.id,
      code: "AI-101",
      title: "Nhập môn Trí tuệ Nhân tạo & Học máy",
      description: "Nền tảng trí tuệ nhân tạo, phân loại học máy (Supervised, Unsupervised, Reinforcement Learning), mạng nơ-ron nhân tạo và đạo đức AI trong thời đại mới.",
      enrollment: "open",
    });

    await courses.addChapter(adminId, created.id, { title: "Chương 1: Các trường phái Học máy (Machine Learning Paradigms)" });
    await courses.addChapter(adminId, created.id, { title: "Chương 2: Đánh giá mô hình & Kiểm tra tổng kết" });

    const detail = await courses.detail(adminId, created.id);
    const [ch1, ch2] = detail.chapters.map((c) => c.id);

    const l1 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Bài 1: Phân biệt Học có giám sát và Không giám sát" });
    await courses.updateLesson(adminId, l1.id, {
      body: `# Phân loại các trường phái Học máy chính

## 1. Học có giám sát (Supervised Learning)
- Dữ liệu huấn luyện bao gồm cả đầu vào (Features) và nhãn kết quả mong muốn (Labels).
- Chia thành 2 bài toán lớn:
  - **Hồi quy (Regression)**: Dự đoán giá trị liên tục (Ví dụ: Dự đoán giá nhà, dự báo nhiệt độ).
  - **Phân loại (Classification)**: Dự đoán nhãn rời rạc (Ví dụ: Phát hiện email rác, phân loại hình ảnh chó/mèo).

## 2. Học không giám sát (Unsupervised Learning)
- Dữ liệu đầu vào KHÔNG có nhãn trước.
- Thuật toán tự tìm ra các mẫu (Patterns), phân cụm hoặc cấu trúc tiềm ẩn:
  - **Phân cụm (Clustering)**: Gom nhóm khách hàng mục tiêu (K-Means, DBSCAN).
  - **Giảm chiều dữ liệu (Dimensionality Reduction)**: PCA, t-SNE giúp trực quan hóa dữ liệu nhiều chiều.

## 3. Học tăng cường (Reinforcement Learning)
- Tác nhân (Agent) học thông qua quá trình thử - sai bằng cách tương tác với môi trường, nhận phần thưởng (Reward) hoặc hình phạt (Penalty).`,
      status: "published",
    });

    const l2 = await courses.addLesson(adminId, ch2, { kind: "document", title: "Bài 2: Các chỉ số đánh giá mô hình phân loại (Confusion Matrix)" });
    await courses.updateLesson(adminId, l2.id, {
      body: `# Ma trận nhầm lẫn (Confusion Matrix) và Chỉ số đo lường

Khi đánh giá mô hình phân loại nhị phân (Binary Classification):

- **True Positive (TP)**: Dự đoán Dương tính đúng.
- **True Negative (TN)**: Dự đoán Âm tính đúng.
- **False Positive (FP - Type I Error)**: Báo động giả (Dương tính giả).
- **False Negative (FN - Type II Error)**: Bỏ sót trường hợp thực tế (Âm tính giả - cực kỳ nguy hiểm trong y tế!).

## Các công thức cốt lõi:
1. **Accuracy (Độ chính xác)** = (TP + TN) / Tổng mẫu
2. **Precision (Độ chuẩn xác)** = TP / (TP + FP)
3. **Recall (Độ nhạy / Độ bao phủ)** = TP / (TP + FN)
4. **F1-Score** = 2 * (Precision * Recall) / (Precision + Recall) (Trung bình điều hòa giữa Precision và Recall).`,
      status: "published",
    });

    const q1 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Bài toán dự đoán giá bán bất động sản dựa trên diện tích và vị trí thuộc trường phái học máy nào?",
      options: [
        { id: "a", text: "Học có giám sát - Bài toán Hồi quy (Regression)" },
        { id: "b", text: "Học có giám sát - Bài toán Phân loại (Classification)" },
        { id: "c", text: "Học không giám sát - Phân cụm (Clustering)" },
        { id: "d", text: "Học tăng cường (Reinforcement Learning)" },
      ],
      answer: ["a"],
      explanation: "Giá bán là giá trị số liên tục và có nhãn dữ liệu giá trong quá khứ, nên đây là bài toán Hồi quy có giám sát.",
      points: 2,
    });

    const q2 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "true_false",
      prompt: "Trong thuật toán phân cụm K-Means, tập dữ liệu đầu vào bắt buộc phải có sẵn nhãn phân loại do con người gán trước.",
      options: [],
      answer: [false],
      explanation: "K-Means là thuật toán Học không giám sát (Unsupervised Learning), hoạt động trên tập dữ liệu hoàn toàn không có nhãn.",
      points: 2,
    });

    const quiz = await courses.addLesson(adminId, ch2, { kind: "quiz", title: "Đánh giá kiến thức Machine Learning cơ bản" });
    await courses.updateLesson(adminId, quiz.id, {
      questionIds: [q1.id, q2.id],
      drawCount: 2,
      shuffle: true,
      passPercent: 60,
      timeLimitSeconds: 600,
      status: "published",
    });

    await courses.update(adminId, created.id, { status: "published" });
    console.log(`  ✓ Đã tạo AI-101 thành công.`);
  }

  // ---------------------------------------------------------------------------------------------------
  // KHÓA 4: ENG-201 - Tiếng Anh Giao tiếp & Thuyết trình Học thuật (Khoa Ngoại ngữ, Open, Published)
  // ---------------------------------------------------------------------------------------------------
  await deleteCourseIfExists("ENG-201");
  console.log("\n[4/6] Tạo khóa học ENG-201: Tiếng Anh Giao tiếp & Thuyết trình Học thuật (Khoa Ngoại ngữ)...");
  {
    const created = await courses.create(adminId, {
      unitId: nnUnit.id,
      code: "ENG-201",
      title: "Tiếng Anh Giao tiếp & Thuyết trình Học thuật",
      description: "Phát triển kỹ năng thuyết trình ý tưởng khoa học, phản biện luận điểm và giao tiếp chuyên nghiệp bằng tiếng Anh trong môi trường học thuật quốc tế.",
      enrollment: "open",
    });

    await courses.addChapter(adminId, created.id, { title: "Chapter 1: Academic Presentation Skills & Signposting" });
    await courses.addChapter(adminId, created.id, { title: "Chapter 2: Academic English Assessment" });

    const detail = await courses.detail(adminId, created.id);
    const [ch1, ch2] = detail.chapters.map((c) => c.id);

    const l1 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Lesson 1: The Structure of a Great Academic Presentation" });
    await courses.updateLesson(adminId, l1.id, {
      body: `# Structuring an Academic Presentation

A successful academic presentation consists of 3 essential parts:

## 1. Introduction (The Hook & Roadmap)
- **Greeting & Hook**: Capture your audience's attention with a surprising statistic or question.
- **Purpose**: Clearly state your research objective ("The purpose of this study is to...").
- **Outline**: Give a roadmap of what you will cover ("First, I will discuss... Then, I will demonstrate... Finally, we will look at...").

## 2. Body (Delivering Findings with Signposting)
Use signpost language to transition smoothly between sections:
- *Moving to the next point*: "Turning our attention now to..."
- *Highlighting key data*: "What is particularly noticeable in this chart is..."
- *Contrasting views*: "On the one hand... However, evidence suggests..."

## 3. Conclusion & Q&A
- Summarize main takeaways.
- Provide clear recommendations.
- Invite questions politely: "Thank you for your attention. I would be delighted to take any questions you may have."`,
      status: "published",
    });

    const q1 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Which phrase is the most appropriate signpost to introduce the next topic in an academic presentation?",
      options: [
        { id: "a", text: "Now let's turn our attention to the experimental results." },
        { id: "b", text: "I want to talk about other stuff now." },
        { id: "c", text: "Forget what I just said, look here." },
      ],
      answer: ["a"],
      explanation: "'Let us turn our attention to...' is a formal, natural signposting phrase used in academic conferences.",
      points: 2,
    });

    const q2 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "true_false",
      prompt: "Signpost language helps the audience follow the structure and flow of your presentation.",
      options: [],
      answer: [true],
      explanation: "Signposts act like verbal road signs guiding the audience through transitions and main ideas.",
      points: 2,
    });

    const quiz = await courses.addLesson(adminId, ch2, { kind: "quiz", title: "Academic English Final Quiz" });
    await courses.updateLesson(adminId, quiz.id, {
      questionIds: [q1.id, q2.id],
      drawCount: 2,
      shuffle: true,
      passPercent: 70,
      timeLimitSeconds: 600,
      status: "published",
    });

    await courses.update(adminId, created.id, { status: "published" });
    console.log(`  ✓ Đã tạo ENG-201 thành công.`);
  }

  // ---------------------------------------------------------------------------------------------------
  // KHÓA 5: SEC-101 - An toàn Thông tin & Phòng chống Tấn công Mạng (Đã cấp chứng chỉ mẫu!)
  // ---------------------------------------------------------------------------------------------------
  await deleteCourseIfExists("SEC-101");
  console.log("\n[5/6] Tạo khóa học SEC-101: An toàn Thông tin & Phòng chống Tấn công Mạng (Có chứng chỉ)...");
  {
    const created = await courses.create(adminId, {
      unitId: cnttUnit.id,
      code: "SEC-101",
      title: "An toàn Thông tin & Phòng vệ Không gian số",
      description: "Khóa đào tạo nhận thức an ninh mạng cốt lõi: Nhận diện tấn công giả mạo (Phishing), bảo vệ mật khẩu, nguyên lý bảo mật OWASP Top 10 và bảo vệ quyền riêng tư số.",
      enrollment: "open",
    });

    await courses.addChapter(adminId, created.id, { title: "Chương 1: Nhận diện nguy cơ & Phòng vệ chủ động" });

    const detail = await courses.detail(adminId, created.id);
    const [ch1] = detail.chapters.map((c) => c.id);

    const l1 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Bài 1: 5 Dấu hiệu nhận diện Email Lừa đảo (Phishing)" });
    await courses.updateLesson(adminId, l1.id, {
      body: `# Nhận diện và Xử lý Tấn công Phishing

Tấn công phi kỹ thuật (Social Engineering) đặc biệt là Phishing chiếm tới hơn 80% các sự cố rò rỉ dữ liệu:

1. **Địa chỉ email người gửi khả nghi**: Tên hiển thị giả mạo cơ quan uy tín nhưng tên miền email thực tế có sai lệch nhỏ (ví dụ: \`support@tdtu-edu.vn\` thay vì \`@tdtu.edu.vn\`).
2. **Ngôn từ gây hoang mang hoặc thúc giục khẩn cấp**: Ép buộc người dùng hành động ngay trong vòng 24 giờ ("Tài khoản sẽ bị khóa vĩnh viễn nếu không xác minh").
3. **Đường dẫn liên kết (Hyperlink) giả mạo**: Luôn rê chuột kiểm tra URL đích thực tế trước khi nhấp chuột.
4. **Yêu cầu cung cấp thông tin nhạy cảm**: Không có tổ chức nào yêu cầu gửi mật khẩu, mã OTP qua email.
5. **Tệp đính kèm bất thường**: Các tệp có định dạng kép (ví dụ: \`tailieu.pdf.exe\`, \`bangdiem.zip\`).`,
      status: "published",
    });

    const q1 = await courses.saveQuestion(adminId, created.id, null, {
      kind: "single",
      prompt: "Khi nhận được email yêu cầu cung cấp mã OTP ngân hàng để xác thực giao dịch, bạn nên làm gì?",
      options: [
        { id: "a", text: "Cung cấp ngay nếu email có logo chính thức của ngân hàng" },
        { id: "b", text: "Tuyệt đối không cung cấp mã OTP cho bất kỳ ai dưới mọi hình thức" },
        { id: "c", text: "Chuyển tiếp email cho bạn bè để kiểm tra giùm" },
      ],
      answer: ["b"],
      explanation: "Mã OTP là lớp bảo mật cuối cùng thuộc quyền sở hữu cá nhân, ngân hàng và các tổ chức không bao giờ yêu cầu khách hàng cung cấp OTP.",
      points: 5,
    });

    const quiz = await courses.addLesson(adminId, ch1, { kind: "quiz", title: "Kiểm tra nhận thức an toàn thông tin" });
    await courses.updateLesson(adminId, quiz.id, {
      questionIds: [q1.id],
      drawCount: 1,
      shuffle: false,
      passPercent: 100,
      timeLimitSeconds: 300,
      status: "published",
    });

    await courses.update(adminId, created.id, { status: "published" });

    // Seed tiến độ hoàn thành 100% cho các tài khoản người dùng chính để test tính năng CHỨNG CHỈ (Certificate)
    console.log("  -> Ghi nhận hoàn thành 100% và cấp chứng chỉ kiểm thử cho người dùng...");
    for (const user of allUsers) {
      // 1. Ghi danh
      await repo.enroll(created.id, [user.id], "self", null);
      // 2. Đánh dấu hoàn thành tất cả bài học
      await pool.query(`INSERT INTO course_lesson_progress(lesson_id, user_id) VALUES($1, $2) ON CONFLICT DO NOTHING`, [l1.id, user.id]);
      await pool.query(`INSERT INTO course_lesson_progress(lesson_id, user_id) VALUES($1, $2) ON CONFLICT DO NOTHING`, [quiz.id, user.id]);
      // 3. Đánh dấu hoàn thành khóa học
      await pool.query(`UPDATE course_enrollments SET completed_at = now() WHERE course_id = $1 AND user_id = $2`, [created.id, user.id]);
      // 4. Cấp chứng chỉ chính thức
      const certCode = generateCertCode();
      await pool.query(
        `INSERT INTO course_certificates(id, course_id, user_id, code) VALUES($1, $2, $3, $4) ON CONFLICT (course_id, user_id) DO NOTHING`,
        [randomUUID(), created.id, user.id, certCode]
      );
      console.log(`    + Cấp chứng chỉ cho [${user.display_name}]: Mã xác minh = ${certCode}`);
    }
    console.log(`  ✓ Đã tạo SEC-101 thành công với tiến độ 100% và chứng chỉ sẵn sàng.`);
  }

  // ---------------------------------------------------------------------------------------------------
  // KHÓA 6: BA-101 - Nhập môn Phân tích Nghiệp vụ Doanh nghiệp (Khoa QTKD, Draft)
  // ---------------------------------------------------------------------------------------------------
  await deleteCourseIfExists("BA-101");
  console.log("\n[6/6] Tạo khóa học BA-101: Nhập môn Phân tích Nghiệp vụ Doanh nghiệp (Bản nháp - Draft)...");
  {
    const created = await courses.create(adminId, {
      unitId: qtkdUnit.id,
      code: "BA-101",
      title: "Nhập môn Phân tích Nghiệp vụ Doanh nghiệp (BA)",
      description: "Tài liệu đào tạo nội bộ về khảo sát quy trình kinh doanh, xây dựng sơ đồ BPMN, viết đặc tả yêu cầu người dùng (User Story) và phân tích luồng công việc.",
      enrollment: "open",
    });

    await courses.addChapter(adminId, created.id, { title: "Chương 1: Vai trò của Business Analyst trong doanh nghiệp" });
    const detail = await courses.detail(adminId, created.id);
    const [ch1] = detail.chapters.map((c) => c.id);

    const l1 = await courses.addLesson(adminId, ch1, { kind: "document", title: "Bài 1: Phân biệt Yêu cầu Nghiệp vụ (Business Requirements) và Yêu cầu Hệ thống" });
    await courses.updateLesson(adminId, l1.id, {
      body: `# Tổng quan về Vai trò của Business Analyst (BA)

BA đóng vai trò là "Cầu nối ngôn ngữ" giữa nghiệp vụ kinh doanh và đội ngũ công nghệ thông tin.

## 1. Các cấp độ yêu cầu phần mềm:
- **Business Requirements**: Mục tiêu chiến lược của doanh nghiệp (Ví dụ: Tăng 20% doanh thu trực tuyến trong quý 3).
- **User Requirements**: Nhu cầu thực tế của người dùng trực tiếp (Được biểu diễn thông qua User Stories hoặc Use Cases).
- **Functional Requirements**: Mô tả chi tiết hành vi của hệ thống (Hệ thống phải làm gì, hiển thị thông báo gì, lưu dữ liệu thế nào).
- **Non-functional Requirements**: Tiêu chuẩn chất lượng, hiệu năng, bảo mật, tính khả dụng.`,
      status: "draft",
    });

    // Giữ nguyên trạng thái draft để người dùng test chức năng quản trị khóa học nháp
    console.log(`  ✓ Đã tạo BA-101 thành công ở trạng thái bản nháp (Draft).`);
  }

  console.log("\n=== HOÀN TẤT! TẤT CẢ CÁC KHÓA HỌC KIỂM THỬ ĐÃ ĐƯỢC TẠO THÀNH CÔNG ===");
}

try {
  await main();
} catch (error) {
  console.error("Lỗi khi tạo dữ liệu khóa học:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
