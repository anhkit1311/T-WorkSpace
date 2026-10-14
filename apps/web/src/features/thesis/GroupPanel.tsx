import { useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi, type Group, type Topic } from "./api";
import { useThesis } from "./context";
import { formatDateTime, registrationStatus } from "./labels";

interface MyGroup {
  group: Group | null;
  invitations: { groupId: string; leaderName: string; invitedAt: string }[];
}

export function GroupPanel() {
  const { token, term, revision, run, openProject } = useThesis();
  const { user } = useApp();
  const [mine, setMine] = useState<MyGroup | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [code, setCode] = useState("");
  const [wishes, setWishes] = useState<string[]>([]);
  useEffect(() => {
    if (!term) return;
    void academicApi<MyGroup>(token, `terms/${term.id}/my-group`).then((data) => {
      setMine(data);
      setWishes(data.group?.registrations.filter((r) => r.status === "pending").sort((a, b) => a.rank - b.rank).map((r) => r.topicId) ?? []);
    });
    void academicApi<{ topics: Topic[] }>(token, `terms/${term.id}/topics?status=approved`).then((d) => setTopics(d.topics)).catch(() => setTopics([]));
  }, [token, term, revision]);
  if (!term || !mine) return <p className="loading-note">Đang tải…</p>;
  const group = mine.group;
  const open = term.status === "registration";
  const leader = Boolean(group && user && group.leaderId === user.id);
  const activeCount = group?.members.filter((m) => m.status === "active").length ?? 0;
  const locked = Boolean(group?.registrations.some((r) => r.status === "pending" || r.status === "accepted"));

  if (!group)
    return (
      <div className="thesis-stack">
        <section>
          <h2>Bạn chưa có nhóm</h2>
          <p>Mỗi nhóm có {term.policy.minGroupSize}–{term.policy.maxGroupSize} sinh viên. Người tạo nhóm là trưởng nhóm, có quyền mời thành viên và đăng ký nguyện vọng.</p>
          <Button disabled={!open} onClick={() => void run("Đã tạo nhóm", () => academicApi(token, `terms/${term.id}/groups`, "POST", {}))}>Tạo nhóm mới</Button>
          {!open && <p className="thesis-note">Đợt không ở giai đoạn đăng ký.</p>}
        </section>
        {mine.invitations.length > 0 && (
          <section>
            <h2>Lời mời vào nhóm</h2>
            <ul className="thesis-list">
              {mine.invitations.map((invite) => (
                <li key={invite.groupId}>
                  <span>Nhóm của <strong>{invite.leaderName}</strong> · {formatDateTime(invite.invitedAt)}</span>
                  <span className="thesis-actions">
                    <Button size="sm" onClick={() => void run("Đã tham gia nhóm", () => academicApi(token, `groups/${invite.groupId}/invitation-response`, "POST", { response: "accept" }))}>Tham gia</Button>
                    <Button size="sm" variant="ghost" onClick={() => void run("Đã từ chối lời mời", () => academicApi(token, `groups/${invite.groupId}/invitation-response`, "POST", { response: "decline" }))}>Từ chối</Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );

  const move = (index: number, delta: number) => {
    const next = [...wishes];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setWishes(next);
  };
  return (
    <div className="thesis-stack">
      <section>
        <div className="thesis-section-head">
          <h2>Nhóm của tôi</h2>
          {group.projectId && <Button icon="arrow-right" onClick={() => openProject(group.projectId)}>Mở đồ án {group.projectCode}</Button>}
        </div>
        <table className="thesis-table">
          <thead><tr><th>MSSV</th><th>Họ tên</th><th>Vai trò</th><th /></tr></thead>
          <tbody>
            {group.members.map((member) => (
              <tr key={member.studentId}>
                <td>{member.studentCode}</td>
                <td>{member.displayName}</td>
                <td>{member.studentId === group.leaderId ? <Badge tone="violet">Trưởng nhóm</Badge> : member.status === "invited" ? <Badge tone="amber">Đang mời</Badge> : "Thành viên"}</td>
                <td>
                  {open && group.status === "forming" && !locked && leader && member.studentId !== group.leaderId && (
                    <Button size="sm" variant="ghost" onClick={() => void run("Đã cập nhật nhóm", () => academicApi(token, `groups/${group.id}/leave`, "POST", { studentId: member.studentId }))}>
                      {member.status === "invited" ? "Hủy mời" : "Mời ra"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {open && group.status === "forming" && !locked && (
          <div className="thesis-inline-form">
            {leader && activeCount < term.policy.maxGroupSize && (
              <>
                <input placeholder="Mã sinh viên cần mời" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Mã sinh viên" />
                <Button size="sm" disabled={!code.trim()} onClick={async () => {
                  const done = await run("Đã gửi lời mời", () => academicApi(token, `groups/${group.id}/invitations`, "POST", { version: group.version, studentCode: code.trim() }));
                  if (done) setCode("");
                }}>Mời</Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => void run("Đã rời nhóm", () => academicApi(token, `groups/${group.id}/leave`, "POST", {}))}>Rời nhóm</Button>
          </div>
        )}
      </section>

      <section>
        <h2>Nguyện vọng đề tài</h2>
        <p>Đăng ký tối đa {term.policy.maxPreferences} đề tài theo thứ tự ưu tiên. Khi đang có nguyện vọng chờ duyệt, thành phần nhóm bị khóa. Giảng viên nhận nhóm ở một nguyện vọng thì các nguyện vọng còn lại tự hủy.</p>
        {group.registrations.length > 0 && (
          <table className="thesis-table">
            <thead><tr><th>#</th><th>Đề tài</th><th>GVHD</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {group.registrations.map((r) => {
                const [label, tone] = registrationStatus(r.status);
                return (
                  <tr key={r.id}>
                    <td>{r.rank}</td>
                    <td><strong>{r.topicCode}</strong> {r.topicTitle}</td>
                    <td>{r.supervisorName}</td>
                    <td><Badge tone={tone}>{label}</Badge>{r.note && <small className="thesis-note"> {r.note}</small>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {open && group.status === "forming" && leader && (
          <div className="thesis-wishes">
            <h3>Sắp xếp nguyện vọng</h3>
            <ol>
              {wishes.map((topicId, index) => {
                const topic = topics.find((t) => t.id === topicId);
                return (
                  <li key={topicId}>
                    <span>{topic ? `${topic.code} · ${topic.title}` : topicId}</span>
                    <span className="thesis-actions">
                      <Button size="sm" variant="ghost" disabled={index === 0} aria-label="Lên" onClick={() => move(index, -1)}>↑</Button>
                      <Button size="sm" variant="ghost" disabled={index === wishes.length - 1} aria-label="Xuống" onClick={() => move(index, 1)}>↓</Button>
                      <Button size="sm" variant="ghost" onClick={() => setWishes(wishes.filter((w) => w !== topicId))}>Bỏ</Button>
                    </span>
                  </li>
                );
              })}
            </ol>
            {wishes.length < term.policy.maxPreferences && (
              <select value="" onChange={(e) => e.target.value && setWishes([...wishes, e.target.value])} aria-label="Thêm nguyện vọng">
                <option value="">+ Thêm đề tài vào nguyện vọng</option>
                {topics
                  .filter((t) => !wishes.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id} disabled={t.maxStudents - t.assignedStudents < activeCount}>
                      {t.code} · {t.title} ({t.assignedStudents}/{t.maxStudents})
                    </option>
                  ))}
              </select>
            )}
            <div className="thesis-actions">
              <Button onClick={() => void run(wishes.length ? "Đã đăng ký nguyện vọng" : "Đã rút toàn bộ nguyện vọng", () => academicApi(token, `groups/${group.id}/preferences`, "POST", { version: group.version, topicIds: wishes }))}>
                {wishes.length ? "Gửi nguyện vọng" : "Rút nguyện vọng"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

interface Pending {
  id: string;
  rank: number;
  createdAt: string;
  topicCode: string;
  topicTitle: string;
  members: { studentCode: string; displayName: string; gpa: number }[];
}

export function RegistrationsPanel() {
  const { token, term, revision, run } = useThesis();
  const [items, setItems] = useState<Pending[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (term) void academicApi<{ registrations: Pending[] }>(token, `terms/${term.id}/registrations/pending`).then((d) => setItems(d.registrations)).catch(() => setItems([]));
  }, [token, term, revision]);
  if (!term) return null;
  return (
    <section>
      <h2>Nguyện vọng chờ bạn duyệt ({items.length})</h2>
      <p>Hệ thống kiểm tra lại sức chứa đề tài và định mức hướng dẫn của bạn ngay khi bạn nhận nhóm. Khi nhận, đồ án và không gian làm việc của nhóm được tạo tự động.</p>
      {items.length === 0 ? (
        <p className="thesis-ok">Không có nguyện vọng nào đang chờ.</p>
      ) : (
        <ul className="thesis-cards">
          {items.map((item) => (
            <li key={item.id} className="thesis-card">
              <div className="thesis-card__head">
                <strong>{item.topicCode} · {item.topicTitle}</strong>
                <Badge tone={item.rank === 1 ? "green" : "neutral"}>Nguyện vọng {item.rank}</Badge>
              </div>
              <ul className="thesis-members">
                {item.members.map((m) => <li key={m.studentCode}>{m.studentCode} · {m.displayName} · GPA {m.gpa.toFixed(2)}</li>)}
              </ul>
              <small>Đăng ký lúc {formatDateTime(item.createdAt)}</small>
              <input placeholder="Ghi chú / lý do từ chối" value={notes[item.id] ?? ""} onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })} aria-label="Ghi chú" />
              <div className="thesis-actions">
                <Button size="sm" icon="check" onClick={() => void run("Đã nhận nhóm, đồ án đã được tạo", () => academicApi(token, `registrations/${item.id}/decision`, "POST", { decision: "accept", note: notes[item.id] ?? "" }))}>Nhận nhóm</Button>
                <Button size="sm" variant="danger" onClick={() => void run("Đã từ chối nguyện vọng", () => academicApi(token, `registrations/${item.id}/decision`, "POST", { decision: "reject", note: notes[item.id] ?? "" }))}>Từ chối</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
