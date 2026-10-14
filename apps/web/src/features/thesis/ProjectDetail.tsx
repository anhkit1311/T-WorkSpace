import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { academicApi, uploadToChannel, type Committee, type Lecturer, type ProjectDetail, type Submission, type SupervisionLog } from "./api";
import { useThesis } from "./context";
import { formatDateTime, milestoneKindLabel, projectFlow, projectStatus, rankLabel, submissionStatus, toLocalInput } from "./labels";
import { ScoreSheetEditor } from "./ScoreSheetEditor";

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const { token, revision, openProject } = useThesis();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    academicApi<ProjectDetail>(token, `projects/${projectId}`)
      .then((data) => {
        setProject(data);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [token, projectId]);
  useEffect(load, [load, revision]);
  if (error)
    return (
      <section>
        <p className="inline-alert">{error}</p>
        <Button variant="ghost" icon="chevron-left" onClick={() => openProject(null)}>Quay lại</Button>
      </section>
    );
  if (!project) return <p className="loading-note">Đang tải đồ án…</p>;
  return <ProjectBody project={project} />;
}

function ProjectBody({ project }: { project: ProjectDetail }) {
  const { openProject } = useThesis();
  const { navigate } = useApp();
  const [label, tone] = projectStatus(project.status);
  const step = projectFlow.indexOf(project.status);
  const roles = project.viewerRoles;
  return (
    <div className="thesis-stack">
      <section>
        <div className="thesis-section-head">
          <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => openProject(null)}>Danh sách đồ án</Button>
          {project.workspaceId && (roles.student || roles.supervisor) && (
            <Button variant="secondary" icon="users" onClick={() => navigate({ view: "workspace", workspaceId: project.workspaceId! })}>Không gian làm việc của nhóm</Button>
          )}
        </div>
        <p className="thesis-eyebrow">{project.termCode} · {project.code}</p>
        <h2 className="thesis-project-title">{project.topicCode} · {project.topicTitle}</h2>
        <p>
          <Badge tone={tone}>{label}</Badge> · GVHD: <strong>{project.supervisorName}</strong>
          {project.coSupervisorName && <> · Đồng HD: {project.coSupervisorName}</>}
        </p>
        <ul className="thesis-members thesis-members--inline">
          {project.members.map((m) => <li key={m.studentId}>{m.studentCode} · {m.displayName}{m.leader && " (trưởng nhóm)"}</li>)}
        </ul>
        {step >= 0 && (
          <ol className="thesis-flow" aria-label="Tiến trình đồ án">
            {projectFlow.map((status, index) => (
              <li key={status} className={index < step ? "is-done" : index === step ? "is-current" : ""}>{projectStatus(status)[0]}</li>
            ))}
          </ol>
        )}
      </section>
      <SubmissionsSection project={project} />
      <LogsSection project={project} />
      <EvaluationSection project={project} />
      <section>
        <h2>Nhật ký trạng thái</h2>
        <ul className="thesis-timeline">
          {project.events.map((event, index) => (
            <li key={index}>
              <strong>{projectStatus(event.toStatus)[0]}</strong> — {event.actorName ?? "Hệ thống"}, {formatDateTime(event.createdAt)}
              {event.note && <em> · {event.note}</em>}
            </li>
          ))}
        </ul>
        <p className="thesis-note">Nhật ký này chỉ được ghi thêm; cơ sở dữ liệu từ chối mọi thao tác sửa hoặc xóa.</p>
      </section>
    </div>
  );
}

function SubmissionsSection({ project }: { project: ProjectDetail }) {
  const { token, run, revision, term } = useThesis();
  const { notify } = useApp();
  const [items, setItems] = useState<Submission[]>([]);
  const [milestoneId, setMilestoneId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  useEffect(() => {
    void academicApi<{ submissions: Submission[] }>(token, `projects/${project.id}/submissions`).then((d) => setItems(d.submissions)).catch(() => setItems([]));
  }, [token, project.id, revision]);
  const submit = async () => {
    if (!file || !milestoneId || !project.workspaceId) return;
    setBusy(true);
    await run("Đã nộp bài", async () => {
      const channels = await academicChannels(token, project.workspaceId!);
      const target = channels.find((c) => c.name === "tai-lieu") ?? channels.find((c) => c.type === "text");
      if (!target) throw new Error("Không tìm thấy kênh tài liệu của nhóm.");
      const uploaded = await uploadToChannel(token, target.id, file);
      return academicApi(token, `projects/${project.id}/submissions`, "POST", { milestoneId, attachmentId: uploaded.id, note });
    });
    setBusy(false);
    setFile(null);
    setNote("");
  };
  const download = async (submission: Submission) => {
    await run("", async () => {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/academic/submissions/${submission.id}/file`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
      if (!response.ok) throw new Error("Không tải được tệp.");
      const url = URL.createObjectURL(await response.blob());
      Object.assign(document.createElement("a"), { href: url, download: submission.fileName }).click();
      URL.revokeObjectURL(url);
    }, { silent: true, reload: false });
  };
  const verify = async (submission: Submission) => {
    const result = await run("", () => academicApi<{ intact: boolean }>(token, `submissions/${submission.id}/verify`), { silent: true, reload: false });
    if (result)
      notify(
        result.intact ? "Tệp toàn vẹn" : "Tệp đã bị thay đổi",
        result.intact ? `SHA-256 khớp với lúc nộp (${submission.sha256.slice(0, 16)}…).` : "Nội dung hiện tại không còn khớp mã băm lúc nộp.",
        result.intact ? "success" : "warning",
      );
  };
  const roles = project.viewerRoles;
  return (
    <section>
      <h2>Mốc nộp bài</h2>
      <table className="thesis-table">
        <thead><tr><th>Mốc</th><th>Hạn</th><th>Bản mới nhất</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {project.milestones.map((m) => {
            const [label, tone] = m.latestReviewStatus ? submissionStatus(m.latestReviewStatus) : ["Chưa nộp", "neutral" as const];
            const overdue = !m.latestSubmissionId && new Date(m.dueAt) < new Date();
            return (
              <tr key={m.id}>
                <td><strong>{m.code}</strong> · {m.name} <small>({milestoneKindLabel[m.kind]}{m.required ? ", bắt buộc" : ""})</small></td>
                <td>{formatDateTime(m.dueAt)}</td>
                <td>{m.latestVersion ? `v${m.latestVersion} · ${formatDateTime(m.latestSubmittedAt)}` : "—"}{m.latestIsLate && <Badge tone="red">Trễ</Badge>}</td>
                <td>{overdue ? <Badge tone="red">Quá hạn</Badge> : <Badge tone={tone}>{label}</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {roles.student && term && ["execution", "review"].includes(term.status) && (
        <div className="thesis-upload">
          <h3>Nộp bài</h3>
          <div className="thesis-form-row">
            <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} aria-label="Mốc nộp">
              <option value="">Chọn mốc</option>
              {project.milestones.map((m) => <option key={m.id} value={m.id} disabled={m.latestReviewStatus === "accepted"}>{m.code} · {m.name}</option>)}
            </select>
            <input type="file" accept=".pdf,.doc,.docx,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Tệp nộp" />
          </div>
          <input placeholder="Ghi chú cho giảng viên (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Ghi chú" />
          <Button icon="upload" loading={busy} disabled={!file || !milestoneId} onClick={() => void submit()}>Nộp</Button>
          <p className="thesis-note">Mỗi lần nộp tạo phiên bản mới, lưu mã SHA-256 của tệp; bản đã nộp không thể sửa hay xóa.</p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <h3 className="thesis-gap">Lịch sử nộp</h3>
          <ul className="thesis-cards">
            {items.map((s) => {
              const [label, tone] = submissionStatus(s.reviewStatus);
              return (
                <li key={s.id} className="thesis-card">
                  <div className="thesis-card__head">
                    <strong>{s.milestoneCode} v{s.versionNo} · {s.fileName}</strong>
                    <span><Badge tone={tone}>{label}</Badge> {s.isLate && <Badge tone="red">Nộp trễ</Badge>}</span>
                  </div>
                  <small>{s.submittedBy} · {formatDateTime(s.submittedAt)} · SHA-256 <code>{s.sha256.slice(0, 16)}…</code></small>
                  {s.note && <p className="thesis-prewrap">{s.note}</p>}
                  {s.feedback && <p className="thesis-feedback">Nhận xét GVHD: {s.feedback}</p>}
                  <div className="thesis-actions">
                    <Button size="sm" variant="ghost" icon="download" onClick={() => void download(s)}>Tải về</Button>
                    <Button size="sm" variant="ghost" icon="check-square" onClick={() => void verify(s)}>Kiểm tra toàn vẹn</Button>
                  </div>
                  {roles.supervisor && s.reviewStatus === "pending" && (
                    <div className="thesis-decision">
                      <textarea rows={2} placeholder="Nhận xét (bắt buộc ≥ 20 ký tự khi yêu cầu sửa)" value={feedback[s.id] ?? ""} onChange={(e) => setFeedback({ ...feedback, [s.id]: e.target.value })} aria-label="Nhận xét" />
                      <div className="thesis-actions">
                        <Button size="sm" icon="check" onClick={() => void run("Đã chấp nhận bản nộp", () => academicApi(token, `submissions/${s.id}/review`, "POST", { decision: "accepted", feedback: feedback[s.id] ?? "" }))}>Chấp nhận</Button>
                        <Button size="sm" variant="secondary" onClick={() => void run("Đã yêu cầu chỉnh sửa", () => academicApi(token, `submissions/${s.id}/review`, "POST", { decision: "revision_requested", feedback: feedback[s.id] ?? "" }))}>Yêu cầu sửa</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

async function academicChannels(token: string, workspaceId: string): Promise<{ id: string; name: string; type: string }[]> {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/workspaces/${workspaceId}/channels`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!response.ok) throw new Error("Không tải được kênh của nhóm.");
  return (await response.json()).channels;
}

function LogsSection({ project }: { project: ProjectDetail }) {
  const { token, run, revision, term } = useThesis();
  const [logs, setLogs] = useState<SupervisionLog[]>([]);
  const [form, setForm] = useState({ heldAt: toLocalInput(new Date()), mode: "offline", content: "", nextActions: "" });
  useEffect(() => {
    void academicApi<{ logs: SupervisionLog[] }>(token, `projects/${project.id}/logs`).then((d) => setLogs(d.logs)).catch(() => setLogs([]));
  }, [token, project.id, revision]);
  const roles = project.viewerRoles;
  const canWrite = (roles.student || roles.supervisor) && term && ["execution", "review"].includes(term.status);
  const { confirmed, required } = project.supervision;
  return (
    <section>
      <div className="thesis-section-head">
        <h2>Nhật ký hướng dẫn</h2>
        <Badge tone={confirmed >= required ? "green" : "amber"}>{confirmed}/{required} buổi đã xác nhận hai phía</Badge>
      </div>
      <p>Một buổi chỉ được tính khi cả giảng viên và một sinh viên trong nhóm xác nhận. Sau khi đủ hai xác nhận, nhật ký bị khóa.</p>
      {logs.length > 0 && (
        <ul className="thesis-cards">
          {logs.map((log) => {
            const full = log.supervisorConfirmedAt && log.studentConfirmedAt;
            const mayConfirm = (roles.supervisor && !log.supervisorConfirmedAt) || (roles.student && !log.studentConfirmedAt);
            return (
              <li key={log.id} className="thesis-card">
                <div className="thesis-card__head">
                  <strong>{formatDateTime(log.heldAt)} · {log.mode === "online" ? "Trực tuyến" : "Trực tiếp"}</strong>
                  <span>
                    <Badge tone={log.supervisorConfirmedAt ? "green" : "neutral"}>GV {log.supervisorConfirmedAt ? "✓" : "…"}</Badge>{" "}
                    <Badge tone={log.studentConfirmedAt ? "green" : "neutral"}>SV {log.studentConfirmedAt ? "✓" : "…"}</Badge>
                    {full && <Icon name="lock" size={14} />}
                  </span>
                </div>
                <p className="thesis-prewrap">{log.content}</p>
                {log.nextActions && <p className="thesis-feedback">Việc tiếp theo: {log.nextActions}</p>}
                <small>Ghi bởi {log.createdBy}</small>
                {mayConfirm && <div className="thesis-actions"><Button size="sm" icon="check" onClick={() => void run("Đã xác nhận buổi hướng dẫn", () => academicApi(token, `logs/${log.id}/confirm`, "POST", { version: log.version }))}>Xác nhận</Button></div>}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && (
        <form className="thesis-form thesis-gap" onSubmit={async (event) => {
          event.preventDefault();
          const done = await run("Đã ghi nhật ký, chờ bên kia xác nhận", () => academicApi(token, `projects/${project.id}/logs`, "POST", { ...form, heldAt: new Date(form.heldAt).toISOString() }));
          if (done) setForm({ ...form, content: "", nextActions: "" });
        }}>
          <h3>Ghi buổi hướng dẫn</h3>
          <div className="thesis-form-row">
            <input type="datetime-local" value={form.heldAt} onChange={(e) => setForm({ ...form, heldAt: e.target.value })} aria-label="Thời điểm" required />
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} aria-label="Hình thức">
              <option value="offline">Trực tiếp</option>
              <option value="online">Trực tuyến</option>
            </select>
          </div>
          <textarea rows={3} placeholder="Nội dung đã trao đổi (≥ 20 ký tự)" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} minLength={20} required aria-label="Nội dung" />
          <textarea rows={2} placeholder="Việc cần làm tiếp theo" value={form.nextActions} onChange={(e) => setForm({ ...form, nextActions: e.target.value })} aria-label="Việc tiếp theo" />
          <Button type="submit">Ghi nhật ký</Button>
        </form>
      )}
    </section>
  );
}

function EvaluationSection({ project }: { project: ProjectDetail }) {
  const { token, run, term } = useThesis();
  const roles = project.viewerRoles;
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [reviewer, setReviewer] = useState({ reviewerId: "", dueAt: toLocalInput(new Date(Date.now() + 7 * 86_400_000)) });
  const [review, setReview] = useState({ recommendation: "approve", comments: "", questions: "" });
  const [slot, setSlot] = useState({ committeeId: "", startsAt: "", minutes: 45 });
  const [text, setText] = useState("");
  const [newScore, setNewScore] = useState("");
  useEffect(() => {
    if (!term) return;
    if (roles.head && ["defense_approved", "under_review"].includes(project.status))
      void academicApi<{ lecturers: Lecturer[] }>(token, `terms/${term.id}/lecturers`).then((d) => setLecturers(d.lecturers)).catch(() => undefined);
    if (roles.admin && project.status === "review_passed" && ["review", "defense"].includes(term.status))
      void academicApi<{ committees: Committee[] }>(token, `terms/${term.id}/committees`).then((d) => setCommittees(d.committees.filter((c) => c.status === "confirmed"))).catch(() => undefined);
  }, [token, term, roles.head, roles.admin, project.status]);
  if (!term) return null;
  const s = project.status;
  const v = project.version;
  const graderRoles = [
    roles.supervisor && ["defense_approved", "under_review", "review_passed", "scheduled", "defended"].includes(s) && "supervisor",
    roles.reviewer && ["under_review", "review_passed", "scheduled", "defended"].includes(s) && "reviewer",
    roles.committee && s === "defended" && "committee",
  ].filter(Boolean) as ("supervisor" | "reviewer" | "committee")[];

  return (
    <section>
      <h2>Phản biện, bảo vệ & kết quả</h2>
      <dl className="thesis-facts">
        <div><dt>Phản biện</dt><dd>{project.review ? `${project.review.reviewerName} · hạn ${formatDateTime(project.review.dueAt)}${project.review.submittedAt ? ` · ${project.review.recommendation === "approve" ? "đồng ý cho bảo vệ" : "không đồng ý"}` : " · chưa nộp"}` : "Chưa phân công"}</dd></div>
        <div><dt>Lịch bảo vệ</dt><dd>{project.defense ? `${project.defense.committeeCode} (${project.defense.room}) · ${formatDateTime(project.defense.startsAt)}` : "Chưa xếp"}</dd></div>
        <div><dt>Kết quả</dt><dd>{project.result ? <><strong>{project.result.finalScore}</strong> ({project.result.letter}) · {project.result.passed ? "Đạt" : "Không đạt"}{project.result.adjustedByAppeal && " · đã điều chỉnh sau phúc khảo"}{!project.result.publishedAt && " · chưa công bố"}</> : "Chưa có"}</dd></div>
      </dl>
      {project.result && (
        <p className="thesis-note">Thành phần: GVHD {project.result.supervisorScore} × {term.policy.weights.supervisor}% + Phản biện {project.result.reviewerScore} × {term.policy.weights.reviewer}% + Hội đồng {project.result.committeeScore} × {term.policy.weights.committee}%.</p>
      )}
      {project.review?.comments && (
        <div className="thesis-feedback">
          <strong>Nhận xét phản biện:</strong>
          <p className="thesis-prewrap">{project.review.comments}</p>
          {project.review.questions && <p className="thesis-prewrap"><strong>Câu hỏi:</strong> {project.review.questions}</p>}
        </div>
      )}

      <div className="thesis-action-grid">
        {roles.supervisor && s === "final_submitted" && (
          <ActionCard title="Đồng ý cho bảo vệ" hint={`Cần ≥ ${project.supervision.required} buổi hướng dẫn xác nhận hai phía và mọi mốc bắt buộc được chấp nhận.`}>
            <textarea rows={2} placeholder="Nhận xét của GVHD" value={text} onChange={(e) => setText(e.target.value)} aria-label="Nhận xét" />
            <Button icon="check" onClick={() => void run("Đã đồng ý cho bảo vệ", () => academicApi(token, `projects/${project.id}/approve-defense`, "POST", { version: v, note: text }))}>Đồng ý cho bảo vệ</Button>
          </ActionCard>
        )}
        {roles.head && (s === "defense_approved" || (s === "under_review" && !project.review?.submittedAt)) && (
          <ActionCard title={s === "under_review" ? "Phân công lại phản biện" : "Phân công phản biện"} hint="Phản biện phải khác GVHD và đồng hướng dẫn.">
            <select value={reviewer.reviewerId} onChange={(e) => setReviewer({ ...reviewer, reviewerId: e.target.value })} aria-label="Giảng viên phản biện">
              <option value="">Chọn giảng viên</option>
              {lecturers.filter((l) => l.lecturerId !== project.supervisorId).map((l) => <option key={l.lecturerId} value={l.lecturerId}>{rankLabel[l.rank]} {l.displayName} · đang phản biện {l.reviews}</option>)}
            </select>
            <input type="datetime-local" value={reviewer.dueAt} onChange={(e) => setReviewer({ ...reviewer, dueAt: e.target.value })} aria-label="Hạn phản biện" />
            <Button disabled={!reviewer.reviewerId} onClick={() => void run("Đã phân công phản biện", () => academicApi(token, `projects/${project.id}/reviewer`, "POST", { version: v, reviewerId: reviewer.reviewerId, dueAt: new Date(reviewer.dueAt).toISOString() }))}>Phân công</Button>
          </ActionCard>
        )}
        {roles.reviewer && s === "under_review" && (
          <ActionCard title="Phiếu phản biện" hint="Khi đề nghị cho bảo vệ, cần nộp phiếu điểm phản biện trước.">
            <select value={review.recommendation} onChange={(e) => setReview({ ...review, recommendation: e.target.value })} aria-label="Đề nghị">
              <option value="approve">Đồng ý cho bảo vệ</option>
              <option value="reject">Không đồng ý cho bảo vệ</option>
            </select>
            <textarea rows={4} placeholder="Nhận xét (≥ 50 ký tự)" value={review.comments} onChange={(e) => setReview({ ...review, comments: e.target.value })} aria-label="Nhận xét" />
            <textarea rows={2} placeholder="Câu hỏi cho sinh viên" value={review.questions} onChange={(e) => setReview({ ...review, questions: e.target.value })} aria-label="Câu hỏi" />
            <Button onClick={() => void run("Đã nộp phiếu phản biện", () => academicApi(token, `projects/${project.id}/review`, "POST", review))}>Nộp phiếu phản biện</Button>
          </ActionCard>
        )}
        {roles.admin && s === "review_passed" && ["review", "defense"].includes(term.status) && (
          <ActionCard title="Xếp lịch bảo vệ" hint="Hệ thống từ chối nếu hội đồng hoặc bất kỳ giảng viên nào bị trùng giờ, hoặc GVHD ngồi hội đồng.">
            <select value={slot.committeeId} onChange={(e) => setSlot({ ...slot, committeeId: e.target.value })} aria-label="Hội đồng">
              <option value="">Chọn hội đồng</option>
              {committees.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.room}</option>)}
            </select>
            <div className="thesis-form-row">
              <input type="datetime-local" value={slot.startsAt} onChange={(e) => setSlot({ ...slot, startsAt: e.target.value })} aria-label="Bắt đầu" />
              <input type="number" min={15} max={180} step={5} value={slot.minutes} onChange={(e) => setSlot({ ...slot, minutes: Number(e.target.value) })} aria-label="Số phút" />
            </div>
            <Button disabled={!slot.committeeId || !slot.startsAt} onClick={() => {
              const start = new Date(slot.startsAt);
              void run("Đã xếp lịch bảo vệ", () => academicApi(token, `projects/${project.id}/defense`, "POST", { committeeId: slot.committeeId, startsAt: start.toISOString(), endsAt: new Date(+start + slot.minutes * 60000).toISOString() }));
            }}>Xếp lịch</Button>
          </ActionCard>
        )}
        {s === "scheduled" && term.status === "defense" && (roles.admin || roles.committee) && (
          <ActionCard title="Ca bảo vệ" hint="Chủ tịch hoặc thư ký xác nhận sau khi ca bắt đầu.">
            {roles.committee && <Button onClick={() => void run("Đã xác nhận đã bảo vệ", () => academicApi(token, `projects/${project.id}/defended`, "POST", { version: v }))}>Xác nhận đã bảo vệ</Button>}
            {roles.admin && <Button variant="secondary" onClick={() => void run("Đã hủy ca bảo vệ", () => academicApi(token, `projects/${project.id}/defense`, "DELETE"))}>Hủy ca</Button>}
          </ActionCard>
        )}
        {roles.committee && s === "defended" && ["defense", "grading"].includes(term.status) && (
          <ActionCard title="Chốt điểm hội đồng" hint={`Thư ký hoặc chủ tịch chốt khi đủ phiếu. Nếu điểm các thành viên lệch quá ${term.policy.maxScoreDeviation}, chỉ chủ tịch chốt kèm giải trình.`}>
            <textarea rows={2} placeholder="Giải trình chênh lệch (nếu có)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Giải trình" />
            <Button icon="lock" onClick={() => void run("Đã chốt điểm và ghi vào sổ cái", () => academicApi(token, `projects/${project.id}/finalize`, "POST", { version: v, deviationNote: text || undefined }))}>Chốt điểm</Button>
          </ActionCard>
        )}
        {roles.student && project.result?.publishedAt && !project.appeal && (
          <ActionCard title="Phúc khảo" hint={`Trong ${term.policy.appealWindowDays} ngày kể từ khi công bố điểm, mỗi đồ án một đơn.`}>
            <textarea rows={3} placeholder="Lý do phúc khảo (≥ 30 ký tự)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Lý do" />
            <Button onClick={() => void run("Đã nộp đơn phúc khảo", () => academicApi(token, `projects/${project.id}/appeal`, "POST", { reason: text }))}>Nộp đơn</Button>
          </ActionCard>
        )}
        {roles.head && project.appeal?.status === "submitted" && (
          <ActionCard title="Xử lý phúc khảo" hint="Người đã hướng dẫn/chấm đồ án không được xử lý. Điều chỉnh điểm được ghi vào sổ cái, phiếu gốc giữ nguyên.">
            <p className="thesis-prewrap">{project.appeal.reason}</p>
            <textarea rows={2} placeholder="Kết luận (≥ 30 ký tự)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Kết luận" />
            <input type="number" step={0.1} min={0} max={10} placeholder="Điểm mới (nếu điều chỉnh)" value={newScore} onChange={(e) => setNewScore(e.target.value)} aria-label="Điểm mới" />
            <div className="thesis-actions">
              <Button variant="secondary" onClick={() => void run("Đã giữ nguyên điểm", () => academicApi(token, `projects/${project.id}/appeal/decision`, "POST", { decision: "upheld", note: text }))}>Giữ nguyên</Button>
              <Button disabled={!newScore} onClick={() => void run("Đã điều chỉnh điểm", () => academicApi(token, `projects/${project.id}/appeal/decision`, "POST", { decision: "adjusted", note: text, newScore: Number(newScore) }))}>Điều chỉnh</Button>
            </div>
          </ActionCard>
        )}
        {roles.admin && ["proposal", "in_progress", "final_submitted", "defense_approved", "under_review", "review_passed", "scheduled"].includes(s) && (
          <ActionCard title="Xử lý hành chính" hint="Đình chỉ hoặc cho rút đồ án; bắt buộc ghi lý do (≥ 20 ký tự).">
            <textarea rows={2} placeholder="Lý do / số quyết định" value={text} onChange={(e) => setText(e.target.value)} aria-label="Lý do" />
            <div className="thesis-actions">
              {["proposal", "in_progress", "final_submitted"].includes(s) && <Button variant="secondary" onClick={() => void run("Đã cho rút đồ án", () => academicApi(token, `projects/${project.id}/office-action`, "POST", { version: v, action: "withdraw", reason: text }))}>Cho rút</Button>}
              <Button variant="danger" onClick={() => void run("Đã đình chỉ đồ án", () => academicApi(token, `projects/${project.id}/office-action`, "POST", { version: v, action: "suspend", reason: text }))}>Đình chỉ</Button>
            </div>
          </ActionCard>
        )}
      </div>
      {project.appeal && project.appeal.status !== "submitted" && (
        <p className="thesis-feedback">Phúc khảo: {project.appeal.status === "adjusted" ? `điểm điều chỉnh thành ${project.appeal.newScore}` : "giữ nguyên điểm"} — {project.appeal.decisionNote}</p>
      )}
      {graderRoles.map((role) => <ScoreSheetEditor key={role} projectId={project.id} role={role} />)}
    </section>
  );
}

function ActionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="thesis-card thesis-action-card">
      <h3>{title}</h3>
      {hint && <small>{hint}</small>}
      {children}
    </div>
  );
}
