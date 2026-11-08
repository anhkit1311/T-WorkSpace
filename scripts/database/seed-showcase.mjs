// Demo-day data on top of seed-academic, callcenter seed-demo and seed-elearning: a "Giáo vụ CNTT" group
// with this week's meetings, a thesis council with its criteria, a past meeting with recording,
// transcript, AI summary and tasks on the board, a held live class whose attendance is closed (replay
// video added) in course CC-201 that has all four lesson kinds, completed by one agent (certificate for
// /verify/:code) and in progress for another, and one hotline call with transcript, AI summary and a QA score.
// Recordings are a test pattern made by FFmpeg (FFMPEG_COMMAND), the call audio is Asterisk's own
// prompts: the transcripts and summaries are written text, not the output of TRANSCRIBE_URL/SUMMARY_URL.
// Safe to re-run: does nothing once the group exists. Usage: npm run build --workspace @doan/api && node scripts/database/seed-showcase.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import "../../dist/api/config/env.js";
import { config } from "../../dist/api/config/config.js";
import { pool, withTransaction } from "../../dist/api/infrastructure/database/db.js";
import { toVtt } from "../../dist/api/infrastructure/speech/transcribe.js";
import { runFfmpeg } from "../../dist/api/modules/meetings/recording/ffmpeg.js";
import { createMeetingSummary } from "../../dist/api/modules/meetings/outcomes.js";
import { createTask } from "../../dist/api/modules/tasks/service.js";
import { addWorkspaceMember, createWorkspace, getWorkspaceChannels } from "../../dist/api/modules/workspaces/service.js";
import { ElearningRepository } from "../../dist/api/modules/elearning/repository/elearning-repository.js";
import { CourseService } from "../../dist/api/modules/elearning/service/course-service.js";
import { LearningService } from "../../dist/api/modules/elearning/service/learning-service.js";
import { LiveClassService } from "../../dist/api/modules/elearning/service/live-service.js";
import { CallCenterRepository } from "../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { QaRepository } from "../../dist/api/modules/callcenter/repository/qa-repository.js";
import { CallCenterQaService } from "../../dist/api/modules/callcenter/service/qa-service.js";

const GROUP = "Giáo vụ Khoa CNTT";
const sql = (text, values = []) => pool.query(text, values);
// FFmpeg runs with cwd = mediaDir; as in the API, a relative MEDIA_DIR is under services/api.
if (!isAbsolute(config.mediaDir)) process.chdir(resolve("services/api"));
const mediaRoot = resolve(config.mediaDir);

const repo = new ElearningRepository();
const courses = new CourseService(repo);
const learning = new LearningService(repo, courses);
const live = new LiveClassService(repo, courses, () => {});
const ccRepo = new CallCenterRepository();
const qa = new CallCenterQaService(ccRepo, new QaRepository());

const user = async (handle) => {
  const row = (await sql(`SELECT id FROM users WHERE email=$1`, [`${handle}@demo.nexo.test`])).rows[0];
  if (!row) throw new Error(`Thiếu tài khoản ${handle}@demo.nexo.test: chạy seed-academic trước.`);
  return row.id;
};
/** Local (Asia/Ho_Chi_Minh) time `days` from this week's Monday. */
const thisWeek = (days, hour, minute = 0) => {
  const now = new Date(Date.now() + 7 * 3600_000);
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  return new Date(monday + days * 86_400_000 + (hour - 7) * 3600_000 + minute * 60_000);
};
const daysAgo = (days, hour, minute = 0) => {
  const now = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days) + (hour - 7) * 3600_000 + minute * 60_000);
};
const minutes = (date, count) => new Date(date.getTime() + count * 60_000);

async function schedule(roomId, by, title, startsAt, endsAt, description = "") {
  const id = randomUUID();
  await sql(`INSERT INTO meeting_schedules(id,channel_id,created_by,title,description,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [
    id, roomId, by, title, description, startsAt, endsAt,
  ]);
  return id;
}

/** A finished meeting: session, who was there when, and a ready recording with transcript and summary. */
async function heldMeeting({ roomId, scheduleId, host, startedAt, endedAt, visits, segments, summary, actions }) {
  const sessionId = randomUUID();
  await withTransaction(async (client) => {
    const outcome = (
      await client.query(
        `SELECT c.id FROM channels c JOIN channels room ON room.workspace_id=c.workspace_id WHERE room.id=$1 AND c.type='text' ORDER BY c.position,c.created_at LIMIT 1`,
        [roomId],
      )
    ).rows[0]?.id;
    await client.query(
      `INSERT INTO meeting_sessions(id,channel_id,schedule_id,host_id,started_at,outcome_channel_id) VALUES($1,$2,$3,$4,$5,$6)`,
      [sessionId, roomId, scheduleId, host, startedAt, outcome ?? null],
    );
    for (const [userId, from, to] of visits) {
      await client.query(
        `INSERT INTO meeting_participations(id,channel_id,user_id,socket_id,joined_at,left_at,session_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), roomId, userId, `seed-${randomUUID()}`, minutes(startedAt, from), minutes(startedAt, to), sessionId],
      );
      // The room's admitted list: the summary post and the attendance export read it.
      await client.query(`INSERT INTO meeting_attendees(session_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'admitted',$4)`, [
        sessionId, userId, userId === host ? "host" : "member", minutes(startedAt, from),
      ]);
    }
  });
  const recordingId = randomUUID();
  const dir = `recordings/${recordingId}`; // also FFmpeg's path inside its container: always "/"
  await mkdir(join(mediaRoot, dir), { recursive: true });
  const seconds = Math.ceil(segments.at(-1).end) + 2;
  let status = "ready";
  try {
    // 720p test pattern + silence, cut like a real recording part (p0000_*.ts) and served as index.m3u8.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", `testsrc2=s=1280x720:r=25:d=${seconds}`, "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`,
      "-t", String(seconds), "-c:v", "libx264", "-preset", "veryfast", "-b:v", "500k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k",
      "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_segment_filename", `${dir}/p0000_%05d.ts`, `${dir}/index.m3u8`,
    ]);
  } catch (error) {
    status = "failed";
    console.warn(`FFmpeg không chạy được (${error.message}); bản ghi ${recordingId} để trạng thái lỗi.`);
  }
  await writeFile(join(mediaRoot, dir, "transcript.json"), JSON.stringify({ segments }));
  await writeFile(join(mediaRoot, dir, "captions.vtt"), toVtt(segments));
  await sql(
    `INSERT INTO meeting_recordings(id,session_id,channel_id,started_by,status,shared,started_at,stopped_at,duration_seconds,transcript_status,ai_summary,ai_actions,error)
     VALUES($1,$2,$3,$4,$5,true,$6,$7,$8,'ready',$9,$10,$11)`,
    [recordingId, sessionId, roomId, host, status, startedAt, minutes(startedAt, seconds / 60), seconds, summary, JSON.stringify(actions), status === "failed" ? "Không có FFmpeg khi seed" : null],
  );
  return { sessionId, recordingId, end: async () => {
    await withTransaction(async (client) => {
      await client.query(`UPDATE meeting_sessions SET ended_at=$2 WHERE id=$1`, [sessionId, endedAt]);
      await createMeetingSummary(client, sessionId);
    });
  } };
}

try {
  if ((await sql(`SELECT 1 FROM workspaces WHERE name=$1`, [GROUP])).rowCount) {
    console.log(`Nhóm "${GROUP}" đã có; bỏ qua seed trình diễn.`);
  } else {
    const [giaovu, truongkhoa, lan, hung, ha, mai] = await Promise.all(["giaovu", "truongkhoa", "gv.lan", "gv.hung", "gv.ha", "gv.mai"].map(user));
    const students = await Promise.all(["sv01", "sv02", "sv03"].map(user));

    // ---- group and this week's calendar ----------------------------------------------------------
    const workspace = await createWorkspace(giaovu, GROUP);
    for (const id of [truongkhoa, lan, hung, ha, mai, ...students]) await addWorkspaceMember(workspace.id, id);
    const room = (await getWorkspaceChannels(giaovu, workspace.id)).find((channel) => channel.type === "video");
    for (const [day, hour, title, length] of [
      [0, 8, "Giao ban khoa đầu tuần", 60],
      [1, 14, "Họp bộ môn Khoa học máy tính", 90],
      [3, 15, "Rà soát đề cương học phần học kỳ 2", 60],
      [4, 10, "Họp triển khai tư vấn tuyển sinh 2027", 60],
    ])
      await schedule(room.id, giaovu, title, thisWeek(day, hour), minutes(thisWeek(day, hour), length));

    // ---- thesis council (BR-12): chair, members, weighted criteria, presenters ------------------
    const councilStart = thisWeek(2, 8);
    const council = await schedule(room.id, truongkhoa, "Hội đồng bảo vệ đồ án tốt nghiệp – đợt 1", councilStart, minutes(councilStart, 180),
      "Hội đồng chấm đồ án tốt nghiệp ngành Khoa học máy tính.");
    for (const [member, role] of [[truongkhoa, "chair"], [lan, "member"], [hung, "member"]])
      await sql(`INSERT INTO council_members(schedule_id,user_id,role) VALUES($1,$2,$3)`, [council, member, role]);
    for (const [position, [label, weight]] of [["Nội dung và kết quả", 40], ["Trình bày", 30], ["Trả lời câu hỏi", 30]].entries())
      await sql(`INSERT INTO council_criteria(id,schedule_id,label,weight,position) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), council, label, weight, position]);
    for (const [position, [student, topic]] of [
      [students[0], "Hệ thống tổng đài và họp trực tuyến cho trường đại học"],
      [students[1], "Ứng dụng học trực tuyến có điểm danh lớp live"],
      [students[2], "Phân tích chất lượng thoại VoIP bằng E-model"],
    ].entries())
      await sql(`INSERT INTO council_presenters(id,schedule_id,user_id,topic,position) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), council, student, topic, position]);

    // ---- a past meeting: recording, transcript, AI summary, tasks on the board --------------------
    const reviewStart = daysAgo(1, 9);
    const review = await schedule(room.id, giaovu, "Họp rút kinh nghiệm ca trực tổng đài", reviewStart, minutes(reviewStart, 45));
    const reviewMeeting = await heldMeeting({
      roomId: room.id, scheduleId: review, host: giaovu, startedAt: reviewStart, endedAt: minutes(reviewStart, 42),
      visits: [[giaovu, 0, 42], [ha, 1, 42], [lan, 2, 40], [truongkhoa, 5, 30]],
      segments: [
        { start: 0, end: 6, text: "Giáo vụ: Mình bắt đầu rút kinh nghiệm ca trực hotline sáng nay." },
        { start: 6, end: 14, text: "Cô Hà: Ca sáng có 28 cuộc gọi, phần lớn hỏi lịch thi và học phí học kỳ 2." },
        { start: 14, end: 22, text: "Cô Lan: Khoảng 10 giờ có một đợt gọi dồn, ba người gọi phải chờ và hai người bấm phím sao để hẹn gọi lại." },
        { start: 22, end: 30, text: "Thầy Khoa: Phiếu hẹn gọi lại cần được xử lý trước 11 giờ, đừng để quá nửa ngày." },
        { start: 30, end: 38, text: "Giáo vụ: Em sẽ bổ sung câu trả lời mẫu về học phí vào kịch bản tư vấn." },
        { start: 38, end: 46, text: "Cô Hà: Em đề nghị thêm một người trực vào khung 9 đến 11 giờ trong tuần thi." },
        { start: 46, end: 54, text: "Thầy Khoa: Đồng ý, cô Lan lên lịch trực bổ sung và gửi lại cho khoa trước thứ sáu." },
      ],
      summary:
        "Ca trực sáng có 28 cuộc gọi, chủ yếu hỏi lịch thi và học phí. Đợt gọi dồn lúc 10 giờ làm 3 người phải chờ, 2 người hẹn gọi lại. " +
        "Thống nhất: xử lý phiếu hẹn gọi lại trước 11 giờ, bổ sung kịch bản trả lời về học phí, thêm một người trực khung 9–11 giờ trong tuần thi.",
      actions: ["Xử lý các phiếu hẹn gọi lại trước 11 giờ", "Bổ sung câu trả lời mẫu về học phí vào kịch bản", "Lên lịch trực bổ sung khung 9–11 giờ tuần thi"],
    });
    const outcome = (await sql(`SELECT outcome_channel_id FROM meeting_sessions WHERE id=$1`, [reviewMeeting.sessionId])).rows[0].outcome_channel_id;
    for (const [title, assigneeId, days] of [
      ["Xử lý các phiếu hẹn gọi lại trước 11 giờ", ha, 1],
      ["Bổ sung câu trả lời mẫu về học phí vào kịch bản tư vấn", giaovu, 3],
      ["Lên lịch trực bổ sung khung 9–11 giờ tuần thi", lan, 4],
    ])
      await createTask(giaovu, outcome, { clientTaskId: randomUUID(), title, assigneeId, dueAt: daysAgo(-days, 17).toISOString() }, { meetingSessionId: reviewMeeting.sessionId });
    await reviewMeeting.end();

    // ---- CC-201: document, quiz, live class (held, attendance closed) and its replay video --------
    const admin = (await sql(`SELECT user_id FROM academic_role_grants WHERE role='system_admin' ORDER BY created_at LIMIT 1`)).rows[0].user_id;
    const unit = (await sql(`SELECT id FROM academic_units WHERE code='CNTT'`)).rows[0];
    const course = await courses.create(admin, {
      unitId: unit.id,
      code: "CC-201",
      title: "Kỹ năng xử lý tình huống tổng đài",
      description: "Tình huống khó khi trực hotline: người gọi bức xúc, câu hỏi ngoài phạm vi, gọi dồn và hẹn gọi lại.",
      enrollment: "assigned",
    });
    await courses.addChapter(admin, course.id, { title: "Chương 1: Tình huống khó" });
    const chapterId = (await courses.detail(admin, course.id)).chapters[0].id;
    const documentLesson = await courses.addLesson(admin, chapterId, { kind: "document", title: "Ba tình huống khó thường gặp" });
    await courses.updateLesson(admin, documentLesson.id, {
      status: "published",
      body: "1. Người gọi bức xúc: để họ nói hết, tóm tắt lại vấn đề, hẹn thời gian phản hồi cụ thể.\n" +
        "2. Câu hỏi ngoài phạm vi phòng ban: chuyển cuộc gọi có giới thiệu trước với đồng nghiệp.\n" +
        "3. Gọi dồn: nhắc người gọi có thể bấm phím * để được gọi lại; phiếu hẹn gọi lại có ưu tiên cao.",
    });
    const questionIds = [];
    for (const question of [
      { kind: "single", prompt: "Người gọi đang bức xúc. Việc đầu tiên nên làm?", options: [{ id: "a", text: "Để họ nói hết rồi tóm tắt lại" }, { id: "b", text: "Ngắt lời để giải thích quy định" }, { id: "c", text: "Chuyển ngay cho giám sát" }], answer: ["a"] },
      { kind: "true_false", prompt: "Khi gọi dồn, người gọi bấm * sẽ được tạo phiếu hẹn gọi lại ưu tiên cao.", answer: [true] },
      { kind: "single", prompt: "Câu hỏi thuộc phòng ban khác thì xử lý thế nào?", options: [{ id: "a", text: "Đọc số điện thoại phòng đó rồi gác máy" }, { id: "b", text: "Chuyển cuộc gọi có giới thiệu trước" }], answer: ["b"] },
    ])
      questionIds.push((await courses.saveQuestion(admin, course.id, null, question)).id);
    const quiz = await courses.addLesson(admin, chapterId, { kind: "quiz", title: "Kiểm tra tình huống" });
    await courses.updateLesson(admin, quiz.id, { questionIds, passPercent: 70, timeLimitSeconds: 600, status: "published" });
    const classStart = daysAgo(2, 15);
    const classSchedule = await schedule(room.id, giaovu, "Lớp live CC-201: Xử lý tình huống khó", classStart, minutes(classStart, 60),
      "Buổi học trực tuyến · CC-201 Kỹ năng xử lý tình huống tổng đài");
    const liveLesson = await repo.createLesson({ courseId: course.id, chapterId, title: "Lớp live: Xử lý tình huống khó", kind: "live", scheduleId: classSchedule, status: "published" });
    await courses.update(admin, course.id, { status: "published" });
    await courses.assign(admin, course.id, { emails: ["gv.ha@demo.nexo.test", "gv.lan@demo.nexo.test", "sv01@demo.nexo.test"] });
    const liveClass = await heldMeeting({
      roomId: room.id, scheduleId: classSchedule, host: giaovu, startedAt: classStart, endedAt: minutes(classStart, 60),
      // Hà stays the whole class (≥ 70%: attended), Lan leaves after 25 minutes (not attended).
      visits: [[giaovu, 0, 60], [ha, 1, 59], [lan, 2, 25]],
      segments: [
        { start: 0, end: 8, text: "Hôm nay chúng ta luyện ba tình huống khó: người gọi bức xúc, hỏi ngoài phạm vi và gọi dồn." },
        { start: 8, end: 18, text: "Với người gọi bức xúc: để họ nói hết, tóm tắt lại vấn đề, rồi hẹn thời gian phản hồi cụ thể." },
        { start: 18, end: 28, text: "Câu hỏi ngoài phạm vi phòng ban: dùng chức năng chuyển cuộc gọi, có giới thiệu trước với đồng nghiệp." },
        { start: 28, end: 36, text: "Khi gọi dồn, nhắc người gọi có thể bấm phím sao để được gọi lại, hệ thống tạo phiếu ưu tiên cao." },
      ],
      summary: "Buổi live luyện 3 tình huống: người gọi bức xúc, câu hỏi ngoài phạm vi (chuyển cuộc gọi có giới thiệu) và gọi dồn (hướng dẫn bấm * để hẹn gọi lại).",
      actions: ["Ôn lại quy trình chuyển cuộc gọi có giới thiệu"],
    });
    await liveClass.end();
    const closed = await live.close(admin, liveLesson);

    // Hà completes everything: the document, the quiz (right answers), the replay watched to the end; Lan only the document.
    const lessons = (await courses.detail(admin, course.id)).chapters.flatMap((chapter) => chapter.lessons);
    await learning.complete(ha, documentLesson.id);
    await learning.complete(lan, documentLesson.id);
    // Reported like the player does: 10 s stretches 5 s apart (the anti-skip rule credits ≤ 2.2 s per second waited).
    for (const replay of lessons.filter((item) => item.kind === "video" && item.durationSeconds))
      for (let from = 0; from < replay.durationSeconds; from += 10) {
        const to = Math.min(from + 10, replay.durationSeconds);
        await learning.watch(ha, replay.id, { from, to, position: to });
        await new Promise((done) => setTimeout(done, 5000));
      }
    const attempt = await learning.startQuiz(ha, quiz.id);
    const correct = new Map((await sql(`SELECT id,answer FROM course_questions WHERE id=ANY($1::uuid[])`, [attempt.questions.map((q) => q.id)])).rows.map((row) => [row.id, row.answer]));
    await learning.submitQuiz(ha, attempt.id, { answers: Object.fromEntries(attempt.questions.map((q) => [q.id, correct.get(q.id)])) });
    let certificate = null;
    try {
      certificate = await courses.certificate(ha, course.id);
    } catch (error) {
      console.warn(`Chưa cấp được chứng nhận cho gv.ha: ${error.message}`);
    }

    // ---- a hotline call with transcript, AI summary and a QA score -------------------------------
    const call = (
      await sql(
        `SELECT c.id,c.department_id FROM cc_calls c WHERE c.outcome='answered' AND c.agent_user_id=$1 AND c.ai_summary IS NULL ORDER BY c.started_at DESC LIMIT 1`,
        [ha],
      )
    ).rows[0];
    if (!call) console.log("Chưa có cuộc gọi nào của gv.ha (chạy scripts/callcenter/simulate-shift.mjs) — bỏ qua cuộc gọi mẫu.");
    else {
      const segments = [
        { start: 0, end: 5, text: "Tổng đài viên: Trường Đại học Tôn Đức Thắng xin nghe, em cần hỗ trợ gì ạ?" },
        { start: 5, end: 12, text: "Người gọi: Dạ em là sinh viên khóa 23, em muốn hỏi hạn đóng học phí học kỳ 2." },
        { start: 12, end: 20, text: "Tổng đài viên: Hạn đóng là ngày 15 tháng 1, em đóng qua cổng thanh toán trên trang sinh viên." },
        { start: 20, end: 26, text: "Người gọi: Nếu em đóng trễ thì có bị khóa đăng ký học phần không ạ?" },
        { start: 26, end: 34, text: "Tổng đài viên: Có em nhé, quá hạn hệ thống sẽ khóa đăng ký đến khi hoàn tất học phí." },
        { start: 34, end: 38, text: "Người gọi: Dạ em cảm ơn ạ." },
      ];
      const disposition = (await sql(`SELECT id FROM cc_dispositions WHERE code='TU_VAN' LIMIT 1`)).rows[0]?.id ?? null;
      // Audio: Asterisk's own prompts joined into one WAV in the PBX's recording store, so the player has something to play.
      const name = `call-${call.id}`;
      let recordingKey = null;
      try {
        execFileSync("docker", ["exec", "infra-asterisk-1", "sh", "-c",
          `mkdir -p /var/spool/asterisk/recording && cd /var/lib/asterisk/sounds/en && cat conf-now-recording.gsm auth-thankyou.gsm queue-thankyou.gsm > /tmp/${name}.gsm && asterisk -rx "file convert /tmp/${name}.gsm /var/spool/asterisk/recording/${name}.wav" && chown asterisk:asterisk /var/spool/asterisk/recording/${name}.wav`]);
        recordingKey = name;
      } catch {
        console.warn("Không ghi được tệp âm thanh vào Asterisk (container infra-asterisk-1) — cuộc gọi mẫu không có ghi âm.");
      }
      await sql(
        `UPDATE cc_calls SET transcript_status='ready', transcript=$2, ai_summary=$3, ai_disposition_id=$4, recording_key=COALESCE($5,recording_key),
           notes='Hỏi hạn đóng học phí học kỳ 2' WHERE id=$1`,
        [call.id, JSON.stringify(segments), "Sinh viên khóa 23 hỏi hạn đóng học phí học kỳ 2 và hậu quả khi đóng trễ; đã hướng dẫn hạn 15/1 và việc khóa đăng ký học phần.", disposition, recordingKey],
      );
      const criteria = await qa.criteria(giaovu, call.department_id);
      const scores = Object.fromEntries(criteria.map((criterion, index) => [criterion.id, [9, 8, 9, 7][index] ?? 8]));
      await qa.saveReview(giaovu, call.id, { scores, comment: "Chào hỏi đúng mẫu, hướng dẫn rõ. Cần ghi chú ngay sau cuộc gọi." }).catch((error) =>
        console.warn(`Chưa chấm QA được: ${error.message}`),
      );
    }

    console.log(`Đã seed nhóm "${GROUP}": 5 lịch họp tuần này (1 hội đồng 3 tiêu chí, 3 người bảo vệ), 1 cuộc họp đã qua có bản ghi + chép lời + tóm tắt + 3 việc.`);
    console.log(`CC-201: lớp live đã chốt điểm danh (${closed?.attended ?? 0}/${closed?.learners ?? 0} đạt), thêm video xem lại; gv.ha hoàn thành${certificate ? `, mã chứng nhận ${certificate.code} (/verify/${certificate.code})` : ""}.`);
  }
} finally {
  await pool.end();
}
