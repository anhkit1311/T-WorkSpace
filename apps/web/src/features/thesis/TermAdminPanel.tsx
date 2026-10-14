import { useEffect, useState } from "react";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi, downloadCsv, type Lecturer } from "./api";
import { useThesis } from "./context";
import { formatDateTime, graderRoleLabel, milestoneKindLabel, rankLabel, termLabel, toLocalInput } from "./labels";

interface Student {
  studentId: string;
  displayName: string;
  email: string;
  studentCode: string;
  className: string;
  credits: number;
  gpa: number;
  eligible: boolean;
  overrideReason: string | null;
  projectCode: string | null;
}
interface AuditEvent {
  id: string;
  entity: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}
interface LedgerCheck {
  entries: number;
  chainIntact: boolean;
  brokenAt: { seq: string; reason: string } | null;
  mismatches: { projectCode: string; stored: number; ledger: number | null }[];
  intact: boolean;
}

export function TermAdminPanel() {
  const { term } = useThesis();
  if (!term) return null;
  return (
    <div className="thesis-stack">
      <PhaseCard />
      <div className="thesis-columns">
        <MilestonesCard />
        <RubricCard />
      </div>
      <StudentsCard />
      <QuotaCard />
      <GradesCard />
      <AuditCard />
    </div>
  );
}

function PhaseCard() {
  const { token, term, run } = useThesis();
  if (!term) return null;
  return (
    <section>
      <h2>Giai đoạn của đợt</h2>
      <p>Hiện tại: <strong>{termLabel(term.status)}</strong>{term.nextPhase && <> · Kế tiếp: <strong>{termLabel(term.nextPhase)}</strong></>}. Đợt chỉ đi tiến từng bước; điều kiện chuyển giai đoạn được kiểm tra ở máy chủ.</p>
      {term.blockers.length > 0 ? (
        <ul className="thesis-blockers">{term.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
      ) : (
        term.nextPhase && <p className="thesis-ok">Đã đủ điều kiện chuyển sang giai đoạn tiếp theo.</p>
      )}
      <div className="thesis-policy">
        <span>Nhóm {term.policy.minGroupSize}–{term.policy.maxGroupSize} SV</span>
        <span>{term.policy.maxPreferences} nguyện vọng</span>
        <span>Tối thiểu {term.policy.minCredits} TC, GPA {term.policy.minGpa}</span>
        <span>≥ {term.policy.minSupervisionLogs} buổi hướng dẫn</span>
        <span>Điểm: {term.policy.weights.supervisor}/{term.policy.weights.reviewer}/{term.policy.weights.committee}</span>
        <span>Lệch tối đa {term.policy.maxScoreDeviation}</span>
        <span>Nộp trễ: {term.policy.latePolicy === "reject" ? "không nhận" : "nhận, gắn cờ"}</span>
      </div>
      {term.nextPhase && (
        <Button disabled={term.blockers.length > 0} icon="arrow-right" onClick={() => void run(`Đã chuyển sang: ${termLabel(term.nextPhase!)}`, () => academicApi(token, `terms/${term.id}/advance`, "POST", { version: term.version }))}>
          Chuyển sang “{termLabel(term.nextPhase)}”
        </Button>
      )}
    </section>
  );
}

function MilestonesCard() {
  const { token, term, run } = useThesis();
  const [form, setForm] = useState({ code: "", name: "", kind: "progress", dueAt: "", required: true });
  if (!term) return null;
  const editable = ["draft", "registration", "execution"].includes(term.status);
  return (
    <section>
      <h2>Mốc nộp bài</h2>
      <ul className="thesis-list">
        {term.milestones.map((m) => (
          <li key={m.id}><span><strong>{m.code}</strong> · {m.name} <small>({milestoneKindLabel[m.kind]})</small></span><span>{formatDateTime(m.dueAt)}</span></li>
        ))}
      </ul>
      {editable && (
        <form className="thesis-form" onSubmit={async (event) => {
          event.preventDefault();
          const dueAt = form.kind === "final" ? term.finalDueAt : new Date(form.dueAt).toISOString();
          const done = await run("Đã thêm mốc", () => academicApi(token, `terms/${term.id}/milestones`, "POST", { ...form, dueAt }));
          if (done) setForm({ code: "", name: "", kind: "progress", dueAt: "", required: true });
        }}>
          <div className="thesis-form-row">
            <input placeholder="Mã (VD: DC)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required aria-label="Mã mốc" />
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Loại mốc">
              <option value="proposal">Đề cương</option>
              <option value="progress">Tiến độ</option>
              <option value="final">Báo cáo cuối</option>
            </select>
          </div>
          <input placeholder="Tên mốc" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required aria-label="Tên mốc" />
          {form.kind !== "final" && <input type="datetime-local" value={form.dueAt} max={toLocalInput(new Date(term.finalDueAt))} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} required aria-label="Hạn" />}
          {form.kind === "final" && <small>Hạn của báo cáo cuối luôn trùng hạn nộp cuối của đợt ({formatDateTime(term.finalDueAt)}).</small>}
          <Button type="submit" icon="plus">Thêm mốc</Button>
        </form>
      )}
    </section>
  );
}

function RubricCard() {
  const { token, term, run } = useThesis();
  const [role, setRole] = useState<"supervisor" | "reviewer" | "committee">("committee");
  const [rows, setRows] = useState<{ code: string; name: string; weight: string }[]>([]);
  useEffect(() => {
    if (!term) return;
    const current = term.rubric.filter((c) => c.graderRole === role);
    setRows(current.length ? current.map((c) => ({ code: c.code, name: c.name, weight: String(c.weight) })) : [{ code: "", name: "", weight: "" }]);
  }, [term, role]);
  if (!term) return null;
  const total = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const editable = term.status === "draft";
  return (
    <section>
      <div className="thesis-section-head">
        <h2>Rubric chấm điểm</h2>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Vai trò chấm">
          {(["supervisor", "reviewer", "committee"] as const).map((r) => <option key={r} value={r}>{graderRoleLabel[r]}</option>)}
        </select>
      </div>
      <table className="thesis-table">
        <thead><tr><th>Mã</th><th>Tiêu chí</th><th>Trọng số %</th><th /></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td><input value={row.code} disabled={!editable} onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, code: e.target.value.toUpperCase() } : r)))} aria-label="Mã tiêu chí" /></td>
              <td><input value={row.name} disabled={!editable} onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))} aria-label="Tên tiêu chí" /></td>
              <td><input type="number" min={1} max={100} value={row.weight} disabled={!editable} onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, weight: e.target.value } : r)))} aria-label="Trọng số" /></td>
              <td>{editable && rows.length > 1 && <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, i) => i !== index))}>×</Button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>Tổng</td><td><Badge tone={total === 100 ? "green" : "red"}>{total}</Badge></td><td /></tr></tfoot>
      </table>
      {editable ? (
        <div className="thesis-actions">
          <Button variant="ghost" size="sm" onClick={() => setRows([...rows, { code: "", name: "", weight: "" }])}>+ Tiêu chí</Button>
          <Button size="sm" disabled={total !== 100} onClick={() => void run("Đã lưu rubric", () => academicApi(token, `terms/${term.id}/rubric`, "POST", { graderRole: role, criteria: rows.map((r) => ({ code: r.code, name: r.name, weight: Number(r.weight) })) }))}>Lưu rubric</Button>
        </div>
      ) : (
        <small>Rubric bị khóa khi đợt rời trạng thái nháp.</small>
      )}
    </section>
  );
}

/** Parses "email,studentCode,className,credits,gpa" lines; a header row is skipped. */
function parseRoster(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 5 && cells[0].includes("@"))
    .map(([email, studentCode, className, credits, gpa]) => ({ email, studentCode, className, credits: Number(credits), gpa: Number(gpa.replace(",", ".")) }));
}

function StudentsCard() {
  const { token, term, run, revision } = useThesis();
  const [students, setStudents] = useState<Student[]>([]);
  const [csv, setCsv] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (term) void academicApi<{ students: Student[] }>(token, `terms/${term.id}/students?q=${encodeURIComponent(query)}`).then((d) => setStudents(d.students)).catch(() => setStudents([]));
  }, [token, term, revision, query]);
  if (!term) return null;
  const rows = parseRoster(csv);
  const editable = ["draft", "registration"].includes(term.status);
  return (
    <section>
      <div className="thesis-section-head">
        <h2>Sinh viên ({students.length})</h2>
        <input type="search" placeholder="Tìm MSSV / họ tên" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm sinh viên" />
      </div>
      {editable && (
        <div className="thesis-upload">
          <h3>Nhập danh sách</h3>
          <p>Mỗi dòng: <code>email, MSSV, lớp, số tín chỉ, GPA</code>. Hệ thống tự xét điều kiện (≥ {term.policy.minCredits} TC, GPA ≥ {term.policy.minGpa}). Nếu có dòng lỗi, toàn bộ tệp không được ghi.</p>
          <input type="file" accept=".csv,.txt" onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? "")} aria-label="Tệp CSV" />
          <textarea rows={4} placeholder="Hoặc dán nội dung CSV vào đây" value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="Nội dung CSV" />
          <Button icon="upload" disabled={!rows.length} onClick={async () => {
            const done = await run(`Đã nhập ${rows.length} sinh viên`, () => academicApi(token, `terms/${term.id}/students/import`, "POST", { students: rows }));
            if (done) setCsv("");
          }}>Nhập {rows.length || ""} sinh viên</Button>
        </div>
      )}
      <table className="thesis-table">
        <thead><tr><th>MSSV</th><th>Họ tên</th><th>Lớp</th><th>TC</th><th>GPA</th><th>Điều kiện</th><th>Đồ án</th>{editable && <th />}</tr></thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.studentId}>
              <td>{s.studentCode}</td>
              <td>{s.displayName}</td>
              <td>{s.className}</td>
              <td>{s.credits}</td>
              <td>{s.gpa.toFixed(2)}</td>
              <td><Badge tone={s.eligible ? "green" : "red"}>{s.eligible ? "Đủ" : "Chưa đủ"}</Badge>{s.overrideReason && <small title={s.overrideReason}> (ghi đè)</small>}</td>
              <td>{s.projectCode ?? "—"}</td>
              {editable && (
                <td>
                  <Button size="sm" variant="ghost" onClick={() => {
                    const reason = window.prompt(`Lý do ${s.eligible ? "loại" : "công nhận"} điều kiện cho ${s.studentCode} (≥ 10 ký tự):`);
                    if (reason) void run("Đã cập nhật điều kiện", () => academicApi(token, `terms/${term.id}/students/${s.studentId}/eligibility`, "POST", { eligible: !s.eligible, reason }));
                  }}>{s.eligible ? "Loại" : "Công nhận"}</Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function QuotaCard() {
  const { token, term, run, revision } = useThesis();
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  useEffect(() => {
    if (term) void academicApi<{ lecturers: Lecturer[] }>(token, `terms/${term.id}/lecturers`).then((d) => setLecturers(d.lecturers)).catch(() => setLecturers([]));
  }, [token, term, revision]);
  if (!term) return null;
  return (
    <section>
      <h2>Định mức hướng dẫn</h2>
      <p>Số sinh viên tối đa mỗi giảng viên hướng dẫn trong đợt. Hệ thống không cho đặt định mức thấp hơn số đang hướng dẫn.</p>
      <table className="thesis-table">
        <thead><tr><th>Mã GV</th><th>Giảng viên</th><th>Đang HD</th><th>Phản biện</th><th>Định mức</th></tr></thead>
        <tbody>
          {lecturers.map((l) => (
            <tr key={l.lecturerId}>
              <td>{l.staffCode}</td>
              <td>{rankLabel[l.rank]} {l.displayName}</td>
              <td>{l.used}</td>
              <td>{l.reviews}</td>
              <td>
                <input type="number" min={l.used} max={30} defaultValue={l.quota} aria-label={`Định mức ${l.displayName}`} onBlur={(e) => {
                  const quota = Number(e.target.value);
                  if (quota !== l.quota) void run("Đã cập nhật định mức", () => academicApi(token, `terms/${term.id}/quotas`, "POST", { lecturerId: l.lecturerId, quota }));
                }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GradesCard() {
  const { token, term, run } = useThesis();
  const [ledger, setLedger] = useState<LedgerCheck | null>(null);
  if (!term) return null;
  return (
    <section>
      <h2>Điểm & sổ cái</h2>
      <p>Mỗi lần chốt điểm hoặc điều chỉnh phúc khảo đều được ghi vào sổ cái chuỗi băm (SHA-256). Kiểm tra sẽ phát hiện mọi chỉnh sửa trực tiếp vào cơ sở dữ liệu.</p>
      <div className="thesis-actions">
        {term.status === "grading" && !term.gradesPublishedAt && (
          <Button icon="send" onClick={() => void run("Đã công bố điểm", () => academicApi(token, `terms/${term.id}/publish-grades`, "POST", { version: term.version }))}>Công bố điểm</Button>
        )}
        <Button variant="secondary" icon="check-square" onClick={async () => { const r = await run("", () => academicApi<LedgerCheck>(token, `terms/${term.id}/ledger/verify`), { silent: true, reload: false }); if (r) setLedger(r); }}>Kiểm tra sổ cái</Button>
        <Button variant="secondary" icon="download" onClick={() => void run("Đã xuất bảng điểm", () => downloadCsv(token, term.id, "grades"), { reload: false })}>Xuất bảng điểm CSV</Button>
      </div>
      {term.gradesPublishedAt && <p>Đã công bố lúc {formatDateTime(term.gradesPublishedAt)}.</p>}
      {ledger && (
        <div className={ledger.intact ? "thesis-ok" : "inline-alert"}>
          {ledger.intact
            ? `Toàn vẹn: ${ledger.entries} bản ghi, chuỗi băm hợp lệ, điểm khớp sổ cái.`
            : <>
                Phát hiện bất thường.
                {ledger.brokenAt && ` Chuỗi băm hỏng ở bản ghi #${ledger.brokenAt.seq} (${ledger.brokenAt.reason}).`}
                {ledger.mismatches.map((m) => ` ${m.projectCode}: điểm lưu ${m.stored} ≠ sổ cái ${m.ledger}.`)}
              </>}
        </div>
      )}
    </section>
  );
}

function AuditCard() {
  const { token, term, revision } = useThesis();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    if (term) void academicApi<{ events: AuditEvent[] }>(token, `terms/${term.id}/audit`).then((d) => setEvents(d.events)).catch(() => setEvents([]));
  }, [token, term, revision]);
  return (
    <section>
      <h2>Nhật ký kiểm toán</h2>
      <p>100 thao tác gần nhất. Bảng nhật ký chỉ được ghi thêm; mọi lệnh sửa hoặc xóa đều bị cơ sở dữ liệu từ chối.</p>
      <table className="thesis-table thesis-table--compact">
        <thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Thao tác</th><th>Chi tiết</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{formatDateTime(e.createdAt)}</td>
              <td>{e.actorName ?? "Hệ thống"}</td>
              <td><code>{e.action}</code></td>
              <td className="thesis-audit-details">{summarize(e.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function summarize(details: Record<string, unknown>) {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 40)}`)
    .join(" · ");
}
