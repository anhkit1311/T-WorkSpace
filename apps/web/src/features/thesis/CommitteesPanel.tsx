import { useEffect, useState } from "react";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi, downloadCsv, type Committee, type Lecturer } from "./api";
import { useThesis } from "./context";
import { committeeRoleLabel, formatDateTime, projectStatus, rankLabel, toLocalInput } from "./labels";

interface Plan {
  applied: boolean;
  scheduled: { projectId: string; projectCode: string; committeeId: string; start: string; end: string }[];
  unscheduled: { projectId: string; projectCode: string; reason: string }[];
}

export function CommitteesPanel() {
  const { token, term, revision, run, openProject } = useThesis();
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [form, setForm] = useState({ code: "", name: "", room: "" });
  const [member, setMember] = useState<Record<string, { lecturerId: string; role: string }>>({});
  const admin = Boolean(term?.viewer.admin);
  useEffect(() => {
    if (!term) return;
    void academicApi<{ committees: Committee[] }>(token, `terms/${term.id}/committees`).then((d) => setCommittees(d.committees)).catch(() => setCommittees([]));
    if (admin) void academicApi<{ lecturers: Lecturer[] }>(token, `terms/${term.id}/lecturers`).then((d) => setLecturers(d.lecturers)).catch(() => undefined);
  }, [token, term, revision, admin]);
  if (!term) return null;
  const canCreate = admin && ["execution", "review", "defense"].includes(term.status);
  return (
    <div className="thesis-stack">
      {canCreate && (
        <section>
          <h2>Thành lập hội đồng</h2>
          <p>Hội đồng gồm 3–5 giảng viên: đúng 1 chủ tịch (Tiến sĩ trở lên), 1 thư ký, còn lại là ủy viên. Sau khi xác nhận, thành phần hội đồng bị khóa.</p>
          <form className="thesis-inline-form" onSubmit={async (event) => {
            event.preventDefault();
            const done = await run("Đã tạo hội đồng", () => academicApi(token, `terms/${term.id}/committees`, "POST", form));
            if (done) setForm({ code: "", name: "", room: "" });
          }}>
            <input placeholder="Mã (VD: HD01)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required aria-label="Mã hội đồng" />
            <input placeholder="Tên hội đồng" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required aria-label="Tên hội đồng" />
            <input placeholder="Phòng" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} required aria-label="Phòng" />
            <Button type="submit" icon="plus">Tạo</Button>
          </form>
        </section>
      )}
      {admin && ["review", "defense"].includes(term.status) && committees.some((c) => c.status === "confirmed") && <AutoSchedule committees={committees.filter((c) => c.status === "confirmed")} />}
      <section>
        <div className="thesis-section-head">
          <h2>Hội đồng ({committees.length})</h2>
          {admin && <Button variant="secondary" icon="download" onClick={() => void run("Đã xuất lịch", () => downloadCsv(token, term.id, "schedule"), { reload: false })}>Xuất lịch CSV</Button>}
        </div>
        {committees.length === 0 && <p>Chưa có hội đồng.</p>}
        <ul className="thesis-cards">
          {committees.map((committee) => (
            <li key={committee.id} className="thesis-card">
              <div className="thesis-card__head">
                <strong>{committee.code} · {committee.name} · phòng {committee.room}</strong>
                <Badge tone={committee.status === "confirmed" ? "green" : "amber"}>{committee.status === "confirmed" ? "Đã xác nhận" : "Nháp"}</Badge>
              </div>
              <ul className="thesis-members">
                {committee.members.map((m) => (
                  <li key={m.lecturerId}>
                    <strong>{committeeRoleLabel[m.role]}</strong>: {rankLabel[m.rank]} {m.displayName}
                    {admin && committee.status === "draft" && (
                      <Button size="sm" variant="ghost" onClick={() => void run("Đã bỏ thành viên", () => academicApi(token, `committees/${committee.id}/members`, "POST", { lecturerId: m.lecturerId, remove: true }))}>Bỏ</Button>
                    )}
                  </li>
                ))}
              </ul>
              {admin && committee.status === "draft" && (
                <div className="thesis-inline-form">
                  <select value={member[committee.id]?.lecturerId ?? ""} onChange={(e) => setMember({ ...member, [committee.id]: { role: member[committee.id]?.role ?? "member", lecturerId: e.target.value } })} aria-label="Giảng viên">
                    <option value="">Chọn giảng viên</option>
                    {lecturers.filter((l) => !committee.members.some((m) => m.lecturerId === l.lecturerId)).map((l) => <option key={l.lecturerId} value={l.lecturerId}>{rankLabel[l.rank]} {l.displayName}</option>)}
                  </select>
                  <select value={member[committee.id]?.role ?? "member"} onChange={(e) => setMember({ ...member, [committee.id]: { lecturerId: member[committee.id]?.lecturerId ?? "", role: e.target.value } })} aria-label="Vai trò">
                    <option value="chair">Chủ tịch</option>
                    <option value="secretary">Thư ký</option>
                    <option value="member">Ủy viên</option>
                  </select>
                  <Button size="sm" disabled={!member[committee.id]?.lecturerId} onClick={() => void run("Đã thêm thành viên", () => academicApi(token, `committees/${committee.id}/members`, "POST", member[committee.id]))}>Thêm</Button>
                  <Button size="sm" variant="secondary" onClick={() => void run("Đã xác nhận hội đồng", () => academicApi(token, `committees/${committee.id}/confirm`, "POST", { version: committee.version }))}>Xác nhận</Button>
                </div>
              )}
              {committee.slots.length > 0 && (
                <table className="thesis-table">
                  <thead><tr><th>Giờ</th><th>Đồ án</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {committee.slots.map((slot) => (
                      <tr key={slot.id} className="is-clickable" onClick={() => openProject(slot.projectId)}>
                        <td>{formatDateTime(slot.startsAt)} – {new Date(slot.endsAt).toLocaleTimeString("vi-VN", { timeStyle: "short" })}</td>
                        <td><strong>{slot.projectCode}</strong> · {slot.topicTitle}</td>
                        <td><Badge tone={projectStatus(slot.status)[1]}>{projectStatus(slot.status)[0]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AutoSchedule({ committees }: { committees: Committee[] }) {
  const { token, term, run } = useThesis();
  const defaultDay = term ? new Date(`${String(term.defenseStartsOn).slice(0, 10)}T08:00`) : new Date();
  const [sessions, setSessions] = useState(
    committees.map((c) => ({ committeeId: c.id, startsAt: toLocalInput(defaultDay), endsAt: toLocalInput(new Date(+defaultDay + 4 * 3600_000)) })),
  );
  const [slotMinutes, setSlotMinutes] = useState(45);
  const [plan, setPlan] = useState<Plan | null>(null);
  if (!term) return null;
  const body = (apply: boolean) => ({
    slotMinutes,
    apply,
    sessions: sessions.map((s) => ({ committeeId: s.committeeId, startsAt: new Date(s.startsAt).toISOString(), endsAt: new Date(s.endsAt).toISOString() })),
  });
  const reasons: Record<string, string> = { no_eligible_committee: "mọi hội đồng đều có GVHD của đồ án", no_free_slot: "hết ca trống không trùng lịch" };
  return (
    <section>
      <h2>Xếp lịch bảo vệ tự động</h2>
      <p>Thuật toán ràng buộc tự xây: không trùng giờ trong hội đồng hay của bất kỳ giảng viên nào, GVHD không ngồi hội đồng của đồ án mình. Ưu tiên đồ án khó xếp trước, hội đồng có giảng viên phản biện, rồi cân bằng tải.</p>
      <table className="thesis-table">
        <thead><tr><th>Hội đồng</th><th>Bắt đầu buổi</th><th>Kết thúc buổi</th></tr></thead>
        <tbody>
          {sessions.map((session, index) => (
            <tr key={session.committeeId}>
              <td>{committees.find((c) => c.id === session.committeeId)?.code}</td>
              <td><input type="datetime-local" value={session.startsAt} onChange={(e) => setSessions(sessions.map((s, i) => (i === index ? { ...s, startsAt: e.target.value } : s)))} aria-label="Bắt đầu" /></td>
              <td><input type="datetime-local" value={session.endsAt} onChange={(e) => setSessions(sessions.map((s, i) => (i === index ? { ...s, endsAt: e.target.value } : s)))} aria-label="Kết thúc" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="thesis-inline-form">
        <label className="thesis-inline-label">Mỗi ca <input type="number" min={15} max={180} step={5} value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))} /> phút</label>
        <Button variant="secondary" onClick={async () => { const p = await run("", () => academicApi<Plan>(token, `terms/${term.id}/auto-schedule`, "POST", body(false)), { silent: true, reload: false }); if (p) setPlan(p); }}>Xem trước</Button>
        <Button disabled={!plan || !plan.scheduled.length} onClick={async () => { const p = await run("Đã áp dụng lịch bảo vệ", () => academicApi<Plan>(token, `terms/${term.id}/auto-schedule`, "POST", body(true))); if (p) setPlan(null); }}>Áp dụng</Button>
      </div>
      {plan && (
        <div className="thesis-gap">
          <p><strong>{plan.scheduled.length}</strong> đồ án xếp được, <strong>{plan.unscheduled.length}</strong> không xếp được.</p>
          <ul className="thesis-members">
            {plan.scheduled.map((s) => <li key={s.projectId}>{committees.find((c) => c.id === s.committeeId)?.code} · {formatDateTime(s.start)} · đồ án {s.projectCode}</li>)}
            {plan.unscheduled.map((u) => <li key={u.projectId} className="is-warning">Đồ án {u.projectCode}: {reasons[u.reason] ?? u.reason}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
