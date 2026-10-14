// Seeds a demonstration faculty for the thesis-management module.
//
//   SEED_ACADEMIC_PASSWORD=<password> npm run seed:academic
//
// Every record goes through the real service layer, so all business rules apply. The only
// shortcut is moving term deadlines into the past with SQL, which stands in for waiting weeks.
// Two terms are created: HK1 is mid-execution (projects in many states), HK2 is open for
// registration (topics awaiting approval, wishes awaiting supervisors).
// All accounts share SEED_ACADEMIC_PASSWORD; without it a random password is generated and printed once.
// `--reset` removes the demo faculty and its accounts first (development databases only).
import { randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { hashPassword } from "../../dist/api/modules/auth/password.js";
import * as org from "../../dist/api/modules/academic/organization.js";
import * as terms from "../../dist/api/modules/academic/terms.js";
import * as topics from "../../dist/api/modules/academic/topics.js";
import * as groups from "../../dist/api/modules/academic/groups.js";
import * as projects from "../../dist/api/modules/academic/projects.js";
import * as evaluation from "../../dist/api/modules/academic/evaluation.js";
import { uploadFile } from "../../dist/api/modules/files/service.js";

const DOMAIN = "demo.nexo.test";
const sql = (text, values = []) => pool.query(text, values);
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const days = (d) => hours(d * 24);
const dateOnly = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const lecturers = [
  ["truongkhoa", "Trần Minh Khoa", "pgs", "KHMT", "GV001"],
  ["gv.lan", "Nguyễn Thị Lan", "ts", "KHMT", "GV002"],
  ["gv.hung", "Lê Quốc Hùng", "ts", "HTTT", "GV003"],
  ["gv.mai", "Phạm Ngọc Mai", "ths", "HTTT", "GV004"],
  ["gv.tuan", "Đỗ Anh Tuấn", "ts", "KTPM", "GV005"],
  ["gv.ha", "Vũ Thu Hà", "ths", "KTPM", "GV006"],
  ["gv.son", "Hoàng Văn Sơn", "pgs", "KHMT", "GV007"],
  ["gv.linh", "Bùi Khánh Linh", "ts", "HTTT", "GV008"],
];
const familyNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô"];
const givenNames = ["An", "Bình", "Chi", "Dũng", "Giang", "Hải", "Hạnh", "Khánh", "Long", "My", "Nam", "Ngân", "Phúc", "Quân", "Thảo", "Trang", "Tú", "Vy", "Yến", "Đạt", "Huy", "Kiệt", "Minh", "Nhi", "Phong", "Sơn", "Tâm", "Uyên"];

const topicBank = [
  ["truongkhoa", "Nền tảng cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm", ["webrtc", "sfu", "realtime"]],
  ["gv.lan", "Ứng dụng học sâu nhận diện khuôn mặt để điểm danh sinh viên", ["deep learning", "computer vision"]],
  ["gv.hung", "Hệ thống quản lý thư viện số tích hợp tìm kiếm ngữ nghĩa", ["search", "nlp"]],
  ["gv.mai", "Xây dựng hệ thống thương mại điện tử cho hợp tác xã nông nghiệp", ["e-commerce", "web"]],
  ["gv.tuan", "Kiểm thử tự động giao diện web bằng mô hình học máy", ["testing", "machine learning"]],
  ["gv.ha", "Ứng dụng di động theo dõi sức khỏe tinh thần sinh viên", ["mobile", "health"]],
  ["gv.son", "Phát hiện gian lận giao dịch thẻ bằng học máy trên dữ liệu mất cân bằng", ["fraud", "imbalanced data"]],
  ["gv.linh", "Hệ thống gợi ý khóa học cá nhân hóa dựa trên lịch sử học tập", ["recommender", "education"]],
  ["gv.lan", "Chatbot hỗ trợ tư vấn tuyển sinh dùng mô hình ngôn ngữ lớn", ["llm", "chatbot"]],
  ["gv.hung", "Hệ thống quản lý phòng khám tư nhân với đặt lịch trực tuyến", ["healthcare", "booking"]],
];
const nextTopics = [
  ["gv.tuan", "Đánh giá hiệu năng kiến trúc microservice trên Kubernetes", ["kubernetes", "microservices"]],
  ["gv.son", "Nhận diện khuôn mặt điểm danh lớp học bằng mạng nơ-ron tích chập", ["computer vision", "cnn"]],
  ["gv.linh", "Phân tích cảm xúc bình luận mạng xã hội tiếng Việt", ["nlp", "sentiment"]],
  ["gv.mai", "Hệ thống quản lý ký túc xá sinh viên", ["web", "management"]],
  ["gv.ha", "Trò chơi giáo dục giúp học sinh tiểu học học toán", ["game", "education"]],
  ["gv.lan", "Tóm tắt văn bản tiếng Việt tự động bằng mô hình Transformer", ["nlp", "summarization"]],
];
const summary = (title) =>
  `Đề tài "${title}" hướng tới xây dựng một sản phẩm hoàn chỉnh: khảo sát hiện trạng, phân tích yêu cầu, thiết kế kiến trúc và cơ sở dữ liệu, cài đặt, kiểm thử và đánh giá kết quả trên dữ liệu thực tế.`;

async function account(handle, displayName, passwordHash) {
  const email = `${handle}@${DOMAIN}`;
  const row = await sql(
    `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,$4,true)
     ON CONFLICT ((lower(email))) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`,
    [randomUUID(), email, passwordHash, displayName],
  );
  return { id: row.rows[0].id, email };
}

const pdf = (label) => Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

/** Deletes the demo faculty. Append-only guards are bypassed for this session only. */
async function reset() {
  const unit = (await sql(`SELECT id FROM academic_units WHERE code='CNTT'`)).rows[0];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (unit) {
      await client.query(`SET LOCAL session_replication_role = replica`);
      const terms = `(SELECT id FROM thesis_terms WHERE unit_id=$1)`;
      const projects = `(SELECT id FROM thesis_projects WHERE term_id IN ${terms})`;
      const workspaces = (await client.query(`SELECT workspace_id FROM thesis_projects WHERE term_id IN ${terms} AND workspace_id IS NOT NULL`, [unit.id])).rows.map((r) => r.workspace_id);
      for (const table of ["thesis_appeals", "thesis_results", "thesis_reviews", "thesis_supervision_logs", "thesis_submissions", "thesis_project_events"])
        await client.query(`DELETE FROM ${table} WHERE project_id IN ${projects}`, [unit.id]);
      await client.query(`DELETE FROM thesis_score_items WHERE sheet_id IN (SELECT id FROM thesis_score_sheets WHERE project_id IN ${projects})`, [unit.id]);
      await client.query(`DELETE FROM thesis_score_sheets WHERE project_id IN ${projects}`, [unit.id]);
      await client.query(`DELETE FROM thesis_lecturer_bookings WHERE slot_id IN (SELECT id FROM thesis_defense_slots WHERE project_id IN ${projects})`, [unit.id]);
      await client.query(`DELETE FROM thesis_defense_slots WHERE project_id IN ${projects}`, [unit.id]);
      await client.query(`DELETE FROM thesis_grade_ledger WHERE term_id IN ${terms}`, [unit.id]);
      await client.query(`DELETE FROM thesis_committee_members WHERE committee_id IN (SELECT id FROM thesis_committees WHERE term_id IN ${terms})`, [unit.id]);
      await client.query(`DELETE FROM thesis_committees WHERE term_id IN ${terms}`, [unit.id]);
      await client.query(`DELETE FROM thesis_projects WHERE term_id IN ${terms}`, [unit.id]);
      await client.query(`DELETE FROM thesis_registrations WHERE group_id IN (SELECT id FROM thesis_groups WHERE term_id IN ${terms})`, [unit.id]);
      for (const table of ["thesis_group_members", "thesis_groups", "thesis_rubric_criteria", "thesis_milestones", "thesis_enrollments", "thesis_term_supervisors"])
        await client.query(`DELETE FROM ${table} WHERE term_id IN ${terms}`, [unit.id]);
      await client.query(`DELETE FROM thesis_topic_decisions WHERE topic_id IN (SELECT id FROM thesis_topics WHERE term_id IN ${terms})`, [unit.id]);
      await client.query(`DELETE FROM thesis_topics WHERE term_id IN ${terms}`, [unit.id]);
      await client.query(`DELETE FROM academic_audit_events WHERE unit_id=$1 OR term_id IN ${terms}`, [unit.id]);
      for (const table of ["thesis_terms", "academic_role_grants", "academic_staff", "academic_departments"]) await client.query(`DELETE FROM ${table} WHERE unit_id=$1`, [unit.id]);
      await client.query(`DELETE FROM academic_units WHERE id=$1`, [unit.id]);
      await client.query(`SET LOCAL session_replication_role = origin`);
      if (workspaces.length) await client.query(`DELETE FROM workspaces WHERE id=ANY($1::uuid[])`, [workspaces]);
    }
    const users = `(SELECT id FROM users WHERE email LIKE '%@${DOMAIN}')`;
    await client.query(`DELETE FROM academic_role_grants WHERE user_id IN ${users}`);
    await client.query(`DELETE FROM academic_notifications WHERE user_id IN ${users}`);
    await client.query(`DELETE FROM workspaces WHERE owner_id IN ${users}`);
    await client.query(`DELETE FROM users WHERE id IN ${users}`);
    await client.query("COMMIT");
    console.log("Removed the demo faculty and its accounts.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (process.argv.includes("--reset")) await reset();
  if ((await sql(`SELECT 1 FROM academic_units WHERE code='CNTT'`)).rowCount) {
    console.log("Demo faculty CNTT already exists; nothing to do.");
    return;
  }
  const password = process.env.SEED_ACADEMIC_PASSWORD || randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(password);
  const people = {};
  people.giaovu = await account("giaovu", "Phòng Giáo vụ khoa CNTT", passwordHash);
  for (const [handle, name] of lecturers) people[handle] = await account(handle, name, passwordHash);
  const students = [];
  for (let i = 1; i <= 30; i++) {
    const handle = `sv${String(i).padStart(2, "0")}`;
    const name = `${familyNames[i % familyNames.length]} ${["Văn", "Thị", "Minh", "Gia", "Ngọc"][i % 5]} ${givenNames[i % givenNames.length]}`;
    people[handle] = await account(handle, name, passwordHash);
    students.push(handle);
  }
  const id = (handle) => people[handle].id;
  const as = (handle) => id(handle);

  // ---- organisation ------------------------------------------------------------------
  await sql(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin') ON CONFLICT DO NOTHING`, [randomUUID(), id("giaovu")]);
  const unit = await org.createUnit(as("giaovu"), { code: "CNTT", name: "Khoa Công nghệ Thông tin" });
  await org.grantRole(as("giaovu"), { role: "unit_admin", unitId: unit.id, email: people.giaovu.email });
  await org.grantRole(as("giaovu"), { role: "unit_head", unitId: unit.id, email: people.truongkhoa.email });
  await org.grantRole(as("giaovu"), { role: "unit_head", unitId: unit.id, email: people["gv.son"].email });
  const departments = {};
  for (const [code, name] of [["KHMT", "Khoa học máy tính"], ["HTTT", "Hệ thống thông tin"], ["KTPM", "Kỹ thuật phần mềm"]])
    departments[code] = (await org.createDepartment(as("giaovu"), unit.id, { code, name })).id;
  for (const [handle, , rank, department, staffCode] of lecturers)
    await org.upsertStaff(as("giaovu"), unit.id, { email: people[handle].email, staffCode, rank, departmentId: departments[department], defaultQuota: 6 });

  const rubric = {
    supervisor: [["TD", "Thái độ, tinh thần làm việc", 30], ["ND", "Nội dung và mức độ hoàn thành", 50], ["BC", "Chất lượng báo cáo", 20]],
    reviewer: [["PT", "Phân tích, thiết kế", 40], ["SP", "Sản phẩm, kết quả", 40], ["BC", "Hình thức báo cáo", 20]],
    committee: [["TR", "Trình bày", 30], ["TL", "Trả lời câu hỏi", 30], ["KQ", "Kết quả đạt được", 40]],
  };
  async function configureTerm(code, name, open, close, finalDue) {
    let term = await terms.createTerm(as("giaovu"), unit.id, {
      code, name,
      registrationOpensAt: open, registrationClosesAt: close, finalDueAt: finalDue,
      defenseStartsOn: new Date(Date.parse(finalDue) + 5 * 86_400_000).toISOString().slice(0, 10),
      defenseEndsOn: new Date(Date.parse(finalDue) + 12 * 86_400_000).toISOString().slice(0, 10),
      minCredits: 120, minGpa: 2.0, minGroupSize: 1, maxGroupSize: 2, maxPreferences: 3, minSupervisionLogs: 4,
    });
    for (const [graderRole, criteria] of Object.entries(rubric))
      await terms.setRubric(as("giaovu"), term.id, { graderRole, criteria: criteria.map(([c, n, w]) => ({ code: c, name: n, weight: w })) });
    await terms.createMilestone(as("giaovu"), term.id, { code: "DC", name: "Đề cương chi tiết", kind: "proposal", dueAt: new Date(Date.parse(close) + 10 * 86_400_000).toISOString() });
    await terms.createMilestone(as("giaovu"), term.id, { code: "TD1", name: "Báo cáo tiến độ giữa kỳ", kind: "progress", dueAt: new Date(Date.parse(close) + 35 * 86_400_000).toISOString() });
    await terms.createMilestone(as("giaovu"), term.id, { code: "BC", name: "Báo cáo tốt nghiệp", kind: "final", dueAt: finalDue });
    return term;
  }
  async function enrol(term, handles, ineligible = []) {
    await terms.importEnrollments(as("giaovu"), term.id, {
      students: handles.map((handle, index) => ({
        email: people[handle].email,
        studentCode: `21${String(Number(handle.slice(2)) + 520000).padStart(6, "0")}`,
        className: index % 2 ? "CNTT-K21A" : "CNTT-K21B",
        credits: ineligible.includes(handle) ? 104 : 128 + (index % 9),
        gpa: Number((2.4 + ((index * 37) % 15) / 10).toFixed(2)),
      })),
    });
  }
  async function propose(term, [lecturer, title, keywords], decision = "approve") {
    let topic = await topics.createTopic(as(lecturer), term.id, { title, summary: summary(title), keywords, maxStudents: 2, requirements: "Nắm vững lập trình và cơ sở dữ liệu; chủ động, báo cáo tiến độ hằng tuần." });
    topic = await topics.decideTopic(as(lecturer), topic.id, { decision: "submit", version: topic.version });
    if (decision === "pending") return topic;
    const head = [topic.proposedBy, topic.supervisorId].includes(id("truongkhoa")) ? "gv.son" : "truongkhoa";
    return topics.decideTopic(as(head), topic.id, decision === "approve" ? { decision: "approve", version: topic.version } : { decision, version: topic.version, note: "Cần làm rõ phạm vi dữ liệu và tiêu chí đánh giá." });
  }
  async function formGroup(term, leader, member) {
    let group = await groups.createGroup(as(leader), term.id);
    if (member) {
      const code = (await sql(`SELECT student_code FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2`, [term.id, id(member)])).rows[0].student_code;
      group = await groups.inviteMember(as(leader), group.id, { version: group.version, studentCode: code });
      group = await groups.respondInvitation(as(member), group.id, { response: "accept" });
    }
    return group;
  }
  async function accept(term, group, topic) {
    const pending = (await groups.pendingRegistrations(topic.supervisorId, term.id)).registrations.find((r) => r.groupId === group.id && r.topicId === topic.id);
    return (await groups.decideRegistration(topic.supervisorId, pending.id, { decision: "accept", note: "Nhóm phù hợp với đề tài." })).projectId;
  }

  // ---- HK1: mid-execution -----------------------------------------------------------------
  const hk1 = await configureTerm("DATN-2026-HK1", "Đồ án tốt nghiệp học kỳ 1, 2026–2027", hours(-1), hours(48), days(55));
  await enrol(hk1, students.slice(0, 18), ["sv18"]);
  await terms.advanceTerm(as("giaovu"), hk1.id, { version: (await terms.getTerm(as("giaovu"), hk1.id)).version });
  const hk1Topics = [];
  for (const entry of topicBank) hk1Topics.push(await propose(hk1, entry));
  const pairs = [["sv01", "sv02"], ["sv03", "sv04"], ["sv05", "sv06"], ["sv07", "sv08"], ["sv09", null], ["sv10", "sv11"], ["sv12", null], ["sv13", "sv14"]];
  const hk1Projects = [];
  for (const [index, [leader, member]] of pairs.entries()) {
    let group = await formGroup(hk1, leader, member);
    // Second wish points at a topic nobody takes as a first choice, so it always has room.
    const wish = [hk1Topics[index], hk1Topics[8 + (index % 2)]];
    group = await groups.setPreferences(as(leader), group.id, { version: group.version, topicIds: wish.map((t) => t.id) });
    hk1Projects.push({ projectId: await accept(hk1, group, wish[0]), students: [leader, member].filter(Boolean), supervisor: wish[0].supervisorId });
  }
  // Registration is over: move the deadline into the past and open the execution phase.
  await sql(`UPDATE thesis_terms SET registration_opens_at=now()-interval '20 days',registration_closes_at=now()-interval '18 days' WHERE id=$1`, [hk1.id]);
  await terms.advanceTerm(as("giaovu"), hk1.id, { version: (await terms.getTerm(as("giaovu"), hk1.id)).version });

  const projectInfo = async (projectId) => (await sql(`SELECT workspace_id,version FROM thesis_projects WHERE id=$1`, [projectId])).rows[0];
  const milestone = async (kind) => (await sql(`SELECT id FROM thesis_milestones WHERE term_id=$1 AND kind=$2`, [hk1.id, kind])).rows[0].id;
  const submitFile = async (project, student, kind, label) => {
    const { workspace_id } = await projectInfo(project.projectId);
    const channel = (await sql(`SELECT id FROM channels WHERE workspace_id=$1 AND name='tai-lieu'`, [workspace_id])).rows[0].id;
    const file = await uploadFile(as(student), channel, `${label}.pdf`, "application/pdf", pdf(label));
    return projects.submit(as(student), project.projectId, { milestoneId: await milestone(kind), attachmentId: file.id, note: "Nhóm nộp theo đúng mẫu của khoa." });
  };
  const supervisorOf = (project) => project.supervisor;
  const logs = async (project, count) => {
    const topicsTalked = ["Thống nhất phạm vi, mục tiêu và kế hoạch thực hiện theo tuần.", "Góp ý thiết kế cơ sở dữ liệu, chuẩn hóa và ràng buộc toàn vẹn.", "Rà soát kiến trúc hệ thống và luồng xử lý nghiệp vụ chính.", "Đánh giá kết quả kiểm thử, bổ sung kịch bản kiểm thử tải.", "Góp ý cấu trúc báo cáo, chương kết quả và hướng phát triển."];
    for (let i = 0; i < count; i++) {
      const log = await projects.createLog(supervisorOf(project), project.projectId, { heldAt: days(-16 + i * 3), mode: i % 2 ? "online" : "offline", content: topicsTalked[i % topicsTalked.length], nextActions: "Hoàn thiện các mục đã thống nhất trước buổi gặp tiếp theo." });
      await projects.confirmLog(as(project.students[0]), log.id, { version: 1 });
    }
  };
  const acceptLatest = async (project, kind, feedback = "Đạt yêu cầu.") => {
    const submission = (await sql(`SELECT s.id FROM thesis_submissions s JOIN thesis_milestones m ON m.id=s.milestone_id WHERE s.project_id=$1 AND m.kind=$2 ORDER BY version_no DESC LIMIT 1`, [project.projectId, kind])).rows[0];
    await projects.reviewSubmission(supervisorOf(project), submission.id, { decision: "accepted", feedback });
  };
  const [p1, p2, p3, p4, p5, p6, p7, p8] = hk1Projects;
  // p1: through review, ready to be scheduled once the term enters the review phase.
  await submitFile(p1, p1.students[0], "proposal", "de-cuong-nhom-1");
  await acceptLatest(p1, "proposal");
  await submitFile(p1, p1.students[1], "progress", "tien-do-nhom-1");
  await acceptLatest(p1, "progress");
  await logs(p1, 5);
  await submitFile(p1, p1.students[0], "final", "bao-cao-nhom-1");
  await projects.approveDefense(supervisorOf(p1), p1.projectId, { version: (await projectInfo(p1.projectId)).version, note: "Nhóm hoàn thành tốt, đồng ý cho bảo vệ." });
  const crit = async (role) => (await sql(`SELECT id,code FROM thesis_rubric_criteria WHERE term_id=$1 AND grader_role=$2`, [hk1.id, role])).rows;
  const sheet = async (role, values) => Object.fromEntries((await crit(role)).map((c, i) => [c.id, values[i % values.length]]));
  await evaluation.saveScoreSheet(supervisorOf(p1), p1.projectId, { graderRole: "supervisor", scores: await sheet("supervisor", [9, 8.5, 8]), comment: "Chủ động, chăm chỉ.", submit: true });
  const reviewerFor = (supervisor) => [id("gv.tuan"), id("gv.linh")].find((r) => r !== supervisor);
  const headFor = (supervisor) => (supervisor === id("truongkhoa") ? id("gv.son") : id("truongkhoa"));
  await evaluation.assignReviewer(headFor(p1.supervisor), p1.projectId, { version: (await projectInfo(p1.projectId)).version, reviewerId: reviewerFor(p1.supervisor), dueAt: days(10) });
  await evaluation.saveScoreSheet(reviewerFor(p1.supervisor), p1.projectId, { graderRole: "reviewer", scores: await sheet("reviewer", [8, 8.5, 7.5]), submit: true });
  await evaluation.submitReview(reviewerFor(p1.supervisor), p1.projectId, { recommendation: "approve", comments: "Đồ án có phạm vi rõ ràng, thiết kế hợp lý, sản phẩm chạy ổn định; cần bổ sung đánh giá hiệu năng khi tải lớn.", questions: "Hệ thống xử lý xung đột dữ liệu đồng thời như thế nào?" });
  // p2: final submitted, under review.
  await submitFile(p2, p2.students[0], "proposal", "de-cuong-nhom-2");
  await acceptLatest(p2, "proposal");
  await logs(p2, 4);
  await submitFile(p2, p2.students[0], "progress", "tien-do-nhom-2");
  await acceptLatest(p2, "progress");
  await submitFile(p2, p2.students[1], "final", "bao-cao-nhom-2");
  await projects.approveDefense(supervisorOf(p2), p2.projectId, { version: (await projectInfo(p2.projectId)).version });
  await evaluation.assignReviewer(headFor(p2.supervisor), p2.projectId, { version: (await projectInfo(p2.projectId)).version, reviewerId: reviewerFor(p2.supervisor), dueAt: days(12) });
  // p3: final submitted, waiting for the supervisor's go-ahead (only 2 of 4 logs: blocked).
  await submitFile(p3, p3.students[0], "proposal", "de-cuong-nhom-3");
  await acceptLatest(p3, "proposal");
  await logs(p3, 2);
  await submitFile(p3, p3.students[1], "final", "bao-cao-nhom-3");
  // p4: in progress, progress report waiting for feedback.
  await submitFile(p4, p4.students[0], "proposal", "de-cuong-nhom-4");
  await acceptLatest(p4, "proposal");
  await logs(p4, 3);
  await submitFile(p4, p4.students[1], "progress", "tien-do-nhom-4");
  // p5: proposal revised once, then accepted.
  await submitFile(p5, p5.students[0], "proposal", "de-cuong-nhom-5-v1");
  const firstDraft = (await sql(`SELECT id FROM thesis_submissions WHERE project_id=$1 ORDER BY submitted_at LIMIT 1`, [p5.projectId])).rows[0].id;
  await projects.reviewSubmission(supervisorOf(p5), firstDraft, { decision: "revision_requested", feedback: "Bổ sung phần khảo sát hiện trạng và tiêu chí đánh giá." });
  await submitFile(p5, p5.students[0], "proposal", "de-cuong-nhom-5-v2");
  await acceptLatest(p5, "proposal");
  await logs(p5, 1);
  // p6: proposal waiting for feedback; p7, p8: nothing yet (at-risk list).
  await submitFile(p6, p6.students[0], "proposal", "de-cuong-nhom-6");
  void p7;
  void p8;
  // A log the student wrote and the supervisor has not confirmed yet.
  await projects.createLog(as(p6.students[0]), p6.projectId, { heldAt: days(-2), mode: "offline", content: "Trao đổi về công nghệ sử dụng và phân công công việc trong nhóm." });

  // ---- HK2: registration open ------------------------------------------------------------------
  const hk2 = await configureTerm("DATN-2026-HK2", "Đồ án tốt nghiệp học kỳ 2, 2026–2027", hours(-2), days(14), days(130));
  await enrol(hk2, students.slice(18), ["sv30"]);
  await terms.advanceTerm(as("giaovu"), hk2.id, { version: (await terms.getTerm(as("giaovu"), hk2.id)).version });
  const hk2Topics = [];
  for (const [index, entry] of nextTopics.entries()) hk2Topics.push(await propose(hk2, entry, index === 4 ? "request_revision" : index === 5 ? "pending" : "approve"));
  // A student proposes their own topic and waits for the lecturer to accept it.
  const own = await topics.createTopic(as("sv19"), hk2.id, { title: "Ứng dụng quản lý chi tiêu cá nhân có phân tích thói quen", summary: summary("Ứng dụng quản lý chi tiêu cá nhân"), supervisorId: id("gv.mai"), maxStudents: 1 });
  await topics.decideTopic(as("sv19"), own.id, { decision: "submit", version: own.version });
  const g1 = await formGroup(hk2, "sv20", "sv21");
  await groups.setPreferences(as("sv20"), g1.id, { version: g1.version, topicIds: [hk2Topics[0].id, hk2Topics[1].id] });
  const g2 = await formGroup(hk2, "sv22", null);
  await groups.setPreferences(as("sv22"), g2.id, { version: g2.version, topicIds: [hk2Topics[1].id, hk2Topics[2].id, hk2Topics[3].id] });
  const g3 = await formGroup(hk2, "sv23", "sv24");
  const accepted = await groups.setPreferences(as("sv23"), g3.id, { version: g3.version, topicIds: [hk2Topics[2].id] });
  await accept(hk2, accepted, hk2Topics[2]);
  const g4 = await groups.createGroup(as("sv25"), hk2.id);
  const code26 = (await sql(`SELECT student_code FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2`, [hk2.id, id("sv26")])).rows[0].student_code;
  await groups.inviteMember(as("sv25"), g4.id, { version: g4.version, studentCode: code26 });

  console.log(`Seeded faculty CNTT: ${Object.keys(people).length} accounts @${DOMAIN}, terms DATN-2026-HK1 (execution) and DATN-2026-HK2 (registration).`);
  console.log("Accounts: giaovu (system admin + office), truongkhoa & gv.son (unit heads), gv.* (lecturers), sv01–sv30 (students).");
  if (!process.env.SEED_ACADEMIC_PASSWORD) console.log(`Generated password for every demo account: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
