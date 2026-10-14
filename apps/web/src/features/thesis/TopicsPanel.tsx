import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Field, Modal } from "../../shared/ui/Primitives";
import { academicApi, type Lecturer, type Topic } from "./api";
import { useThesis } from "./context";
import { formatDateTime, rankLabel, topicStatus } from "./labels";

interface Similar {
  code: string;
  termCode: string;
  title: string;
  score: number;
}

export function TopicsPanel() {
  const { token, term, revision, profile } = useThesis();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!term) return;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (filter.trim()) params.set("q", filter.trim());
    const timer = window.setTimeout(() => {
      void academicApi<{ topics: Topic[] }>(token, `terms/${term.id}/topics?${params}`).then((data) => setTopics(data.topics)).catch(() => setTopics([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [token, term, revision, filter, status]);
  if (!term) return null;
  const canPropose = ["draft", "registration"].includes(term.status) && (term.viewer.lecturer || (term.viewer.student && profile.enrollments.some((e) => e.termId === term.id && e.eligible)));
  const staff = term.viewer.admin || term.viewer.head || term.viewer.lecturer;
  return (
    <section>
      <div className="thesis-section-head">
        <h2>Đề tài ({topics.length})</h2>
        <div className="thesis-toolbar">
          <input type="search" placeholder="Tìm theo tên, mã, từ khóa" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Tìm đề tài" />
          {staff && (
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
              <option value="">Mọi trạng thái</option>
              {["draft", "awaiting_supervisor", "submitted", "revision_requested", "approved", "rejected", "closed"].map((s) => (
                <option key={s} value={s}>{topicStatus(s)[0]}</option>
              ))}
            </select>
          )}
          {canPropose && <Button icon="plus" onClick={() => setCreating(true)}>Đề xuất đề tài</Button>}
        </div>
      </div>
      {topics.length === 0 ? (
        <p>Chưa có đề tài phù hợp.</p>
      ) : (
        <table className="thesis-table">
          <thead><tr><th>Mã</th><th>Tên đề tài</th><th>GVHD</th><th>Chỗ</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {topics.map((topic) => {
              const [label, tone] = topicStatus(topic.status);
              return (
                <tr key={topic.id} className="is-clickable" onClick={() => setSelected(topic.id)}>
                  <td><strong>{topic.code}</strong></td>
                  <td>
                    {topic.title}
                    {topic.keywords.length > 0 && <div className="thesis-keywords">{topic.keywords.map((k) => <span key={k}>{k}</span>)}</div>}
                  </td>
                  <td>{rankLabel[topic.supervisorRank]} {topic.supervisorName}</td>
                  <td>{topic.assignedStudents}/{topic.maxStudents}{topic.pendingRegistrations > 0 && <small> · {topic.pendingRegistrations} NV</small>}</td>
                  <td><Badge tone={tone}>{label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {creating && <TopicForm onClose={() => setCreating(false)} />}
      {selected && <TopicDetail topicId={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function TopicForm({ topic, onClose }: { topic?: Topic; onClose: () => void }) {
  const { token, term, run } = useThesis();
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [form, setForm] = useState({
    title: topic?.title ?? "",
    summary: topic?.summary ?? "",
    requirements: topic?.requirements ?? "",
    expectedOutcomes: topic?.expectedOutcomes ?? "",
    keywords: topic?.keywords.join(", ") ?? "",
    maxStudents: topic?.maxStudents ?? term?.policy.maxGroupSize ?? 1,
    supervisorId: "",
  });
  const [saving, setSaving] = useState(false);
  const student = term?.viewer.student && !term.viewer.lecturer;
  useEffect(() => {
    if (term && student && !topic) void academicApi<{ lecturers: Lecturer[] }>(token, `terms/${term.id}/lecturers`).then((d) => setLecturers(d.lecturers)).catch(() => setLecturers([]));
  }, [token, term, student, topic]);
  if (!term) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const body = {
      title: form.title,
      summary: form.summary,
      requirements: form.requirements,
      expectedOutcomes: form.expectedOutcomes,
      keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      maxStudents: Number(form.maxStudents),
      ...(student && !topic ? { supervisorId: form.supervisorId } : {}),
      ...(topic ? { version: topic.version } : {}),
    };
    const result = await run(topic ? "Đã lưu đề tài" : "Đã tạo đề tài nháp", () =>
      topic ? academicApi(token, `topics/${topic.id}`, "PATCH", body) : academicApi(token, `terms/${term.id}/topics`, "POST", body),
    );
    setSaving(false);
    if (result) onClose();
  };
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  return (
    <Modal title={topic ? `Sửa đề tài ${topic.code}` : "Đề xuất đề tài"} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Hủy</Button><Button loading={saving} type="submit" form="topic-form">Lưu</Button></>}>
      <form id="topic-form" className="thesis-form" onSubmit={submit}>
        <Field label="Tên đề tài" hint="10–300 ký tự"><input value={form.title} onChange={set("title")} required minLength={10} maxLength={300} /></Field>
        <Field label="Mô tả" hint="Tối thiểu 50 ký tự: bối cảnh, mục tiêu, phạm vi"><textarea rows={5} value={form.summary} onChange={set("summary")} required minLength={50} /></Field>
        <Field label="Yêu cầu đối với sinh viên"><textarea rows={2} value={form.requirements} onChange={set("requirements")} /></Field>
        <Field label="Kết quả dự kiến"><textarea rows={2} value={form.expectedOutcomes} onChange={set("expectedOutcomes")} /></Field>
        <div className="thesis-form-row">
          <Field label="Từ khóa" hint="Phân tách bằng dấu phẩy"><input value={form.keywords} onChange={set("keywords")} /></Field>
          <Field label="Số SV tối đa" hint={`${term.policy.minGroupSize}–${term.policy.maxGroupSize}`}>
            <input type="number" min={term.policy.minGroupSize} max={term.policy.maxGroupSize} value={form.maxStudents} onChange={set("maxStudents")} />
          </Field>
        </div>
        {student && !topic && (
          <Field label="Giảng viên đề nghị hướng dẫn">
            <select value={form.supervisorId} onChange={set("supervisorId")} required>
              <option value="">Chọn giảng viên</option>
              {lecturers.map((l) => (
                <option key={l.lecturerId} value={l.lecturerId} disabled={l.used >= l.quota}>
                  {rankLabel[l.rank]} {l.displayName} ({l.used}/{l.quota})
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

function TopicDetail({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const { token, term, run, revision } = useThesis();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void academicApi<Topic>(token, `topics/${topicId}`).then(setTopic).catch(() => onClose());
  }, [token, topicId, revision, onClose]);
  if (!topic || !term) return null;
  const decide = async (decision: string) => {
    setBusy(true);
    await run("Đã cập nhật đề tài", () => academicApi(token, `topics/${topic.id}/decision`, "POST", { decision, version: topic.version, note }));
    setBusy(false);
    setNote("");
  };
  const checkSimilar = async () => {
    const result = await run("", () => academicApi<{ matches: Similar[] }>(token, `topics/${topic.id}/similar`), { silent: true, reload: false });
    if (result) setSimilar(result.matches);
  };
  const [label, tone] = topicStatus(topic.status);
  const head = term.viewer.head;
  if (editing) return <TopicForm topic={topic} onClose={() => setEditing(false)} />;
  return (
    <Modal title={`${topic.code} · ${topic.title}`} eyebrow="Đề tài" onClose={onClose}>
      <div className="thesis-detail">
        <p><Badge tone={tone}>{label}</Badge> · GVHD: {rankLabel[topic.supervisorRank]} {topic.supervisorName}{topic.coSupervisorName ? ` · Đồng HD: ${topic.coSupervisorName}` : ""} · Đề xuất bởi {topic.proposerName} ({topic.proposerKind === "student" ? "sinh viên" : "giảng viên"})</p>
        <h3>Mô tả</h3>
        <p className="thesis-prewrap">{topic.summary}</p>
        {topic.requirements && (<><h3>Yêu cầu</h3><p className="thesis-prewrap">{topic.requirements}</p></>)}
        {topic.expectedOutcomes && (<><h3>Kết quả dự kiến</h3><p className="thesis-prewrap">{topic.expectedOutcomes}</p></>)}
        <p>Sức chứa: {topic.assignedStudents}/{topic.maxStudents} sinh viên</p>
        <div className="thesis-actions">
          {["draft", "revision_requested"].includes(topic.status) && <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>Sửa</Button>}
          {["draft", "revision_requested"].includes(topic.status) && <Button loading={busy} onClick={() => void decide("submit")}>Nộp duyệt</Button>}
          {topic.status === "awaiting_supervisor" && (
            <>
              <Button loading={busy} onClick={() => void decide("supervisor_accept")}>Nhận hướng dẫn</Button>
              <Button variant="ghost" loading={busy} onClick={() => void decide("supervisor_decline")}>Từ chối</Button>
            </>
          )}
          {(head || term.viewer.lecturer || term.viewer.admin) && <Button variant="ghost" icon="search" onClick={() => void checkSimilar()}>Kiểm tra trùng lặp</Button>}
        </div>
        {similar && (
          <div className="thesis-similar">
            <h3>Đề tài tương tự</h3>
            {similar.length === 0 ? <p>Không tìm thấy đề tài nào tương tự (ngưỡng 25%).</p> : (
              <ul>{similar.map((s) => <li key={s.code + s.termCode}><Badge tone={s.score >= 0.5 ? "red" : "amber"}>{Math.round(s.score * 100)}%</Badge> {s.termCode}/{s.code} — {s.title}</li>)}</ul>
            )}
          </div>
        )}
        {head && topic.status === "submitted" && (
          <div className="thesis-decision">
            <h3>Duyệt đề tài</h3>
            <textarea rows={2} placeholder="Ghi chú (bắt buộc khi từ chối hoặc yêu cầu sửa)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Ghi chú duyệt" />
            <div className="thesis-actions">
              <Button loading={busy} icon="check" onClick={() => void decide("approve")}>Duyệt</Button>
              <Button variant="secondary" loading={busy} onClick={() => void decide("request_revision")}>Yêu cầu sửa</Button>
              <Button variant="danger" loading={busy} onClick={() => void decide("reject")}>Từ chối</Button>
            </div>
          </div>
        )}
        {topic.history && topic.history.length > 0 && (
          <>
            <h3>Lịch sử xử lý</h3>
            <ul className="thesis-timeline">
              {topic.history.map((h, i) => (
                <li key={i}><strong>{topicStatus(h.toStatus)[0]}</strong> — {h.actorName}, {formatDateTime(h.createdAt)}{h.note && <em> · {h.note}</em>}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
