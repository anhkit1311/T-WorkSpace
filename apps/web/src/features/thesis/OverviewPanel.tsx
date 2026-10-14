import { useEffect, useState } from "react";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi, type Group } from "./api";
import { useThesis } from "./context";
import { formatDate, projectStatus, topicStatus } from "./labels";

interface Dashboard {
  students: { total: number; eligible: number; assigned: number };
  topics: Record<string, number>;
  projects: Record<string, number>;
  submissions: { code: string; late: number; total: number }[];
  grades: { letter: string; n: number; mean: number }[];
  supervisorLoad: { displayName: string; quota: number; used: number }[];
}
interface AtRisk {
  id: string;
  code: string;
  status: string;
  supervisorName: string;
  lastConfirmedLog: string | null;
  overdueMilestones: string[];
  inactive: boolean;
}

export function OverviewPanel() {
  const { term } = useThesis();
  if (!term) return null;
  return term.viewer.student && !term.viewer.lecturer && !term.viewer.admin && !term.viewer.head ? <StudentOverview /> : <StaffOverview />;
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="thesis-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function StaffOverview() {
  const { token, term, revision, openProject } = useThesis();
  const [data, setData] = useState<Dashboard | null>(null);
  const [risk, setRisk] = useState<AtRisk[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!term) return;
    Promise.all([academicApi<Dashboard>(token, `terms/${term.id}/dashboard`), academicApi<{ projects: AtRisk[] }>(token, `terms/${term.id}/at-risk`)])
      .then(([dashboard, atRisk]) => {
        setData(dashboard);
        setRisk(atRisk.projects);
      })
      .catch((e: Error) => setError(e.message));
  }, [token, term, revision]);
  if (error) return <p className="inline-alert">{error}</p>;
  if (!data) return <p className="loading-note">Đang tải số liệu…</p>;
  const projectTotal = Object.values(data.projects).reduce((sum, n) => sum + n, 0);
  const done = (data.projects.completed ?? 0) + (data.projects.failed ?? 0);
  return (
    <div className="thesis-stack">
      <section>
        <h2>Số liệu đợt</h2>
        <div className="thesis-stats">
          <Stat label="Sinh viên ghi danh" value={data.students.total} hint={`${data.students.eligible} đủ điều kiện`} />
          <Stat label="Đã có đề tài" value={data.students.assigned} hint={data.students.eligible ? `${Math.round((data.students.assigned / data.students.eligible) * 100)}% SV đủ ĐK` : undefined} />
          <Stat label="Đề tài đã duyệt" value={data.topics.approved ?? 0} hint={`${data.topics.submitted ?? 0} chờ duyệt`} />
          <Stat label="Đồ án" value={projectTotal} hint={`${done} đã kết thúc`} />
        </div>
      </section>
      <div className="thesis-columns">
        <section>
          <h2>Đồ án theo trạng thái</h2>
          {projectTotal === 0 ? (
            <p>Chưa có đồ án nào được hình thành.</p>
          ) : (
            <ul className="thesis-bars">
              {Object.entries(data.projects)
                .sort((a, b) => b[1] - a[1])
                .map(([status, n]) => {
                  const [label, tone] = projectStatus(status);
                  return (
                    <li key={status}>
                      <span>{label}</span>
                      <span className={`thesis-bar thesis-bar--${tone}`} style={{ width: `${(n / projectTotal) * 100}%` }} />
                      <strong>{n}</strong>
                    </li>
                  );
                })}
            </ul>
          )}
          <h3 className="thesis-gap">Đề tài</h3>
          <div className="thesis-chips">
            {Object.entries(data.topics).map(([status, n]) => {
              const [label, tone] = topicStatus(status);
              return <Badge key={status} tone={tone}>{label}: {n}</Badge>;
            })}
          </div>
        </section>
        <section>
          <h2>Tải hướng dẫn</h2>
          <ul className="thesis-bars">
            {data.supervisorLoad.slice(0, 12).map((row) => (
              <li key={row.displayName}>
                <span>{row.displayName}</span>
                <span className={`thesis-bar ${row.used >= row.quota ? "thesis-bar--red" : "thesis-bar--blue"}`} style={{ width: `${row.quota ? Math.min(100, (row.used / row.quota) * 100) : 0}%` }} />
                <strong>{row.used}/{row.quota}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section>
        <h2>Đồ án cần chú ý</h2>
        <p>Quá 14 ngày không có buổi hướng dẫn được xác nhận hai phía, hoặc quá hạn mốc bắt buộc mà chưa nộp.</p>
        {risk.length === 0 ? (
          <p className="thesis-ok">Không có đồ án nào có nguy cơ.</p>
        ) : (
          <table className="thesis-table">
            <thead><tr><th>Mã</th><th>GVHD</th><th>Trạng thái</th><th>Buổi HD gần nhất</th><th>Mốc quá hạn</th><th /></tr></thead>
            <tbody>
              {risk.map((row) => {
                const [label, tone] = projectStatus(row.status);
                return (
                  <tr key={row.id}>
                    <td><strong>{row.code}</strong></td>
                    <td>{row.supervisorName}</td>
                    <td><Badge tone={tone}>{label}</Badge></td>
                    <td>{row.lastConfirmedLog ? formatDate(row.lastConfirmedLog) : <Badge tone="red">Chưa có</Badge>}</td>
                    <td>{row.overdueMilestones.join(", ") || "—"}</td>
                    <td><Button size="sm" variant="ghost" onClick={() => openProject(row.id)}>Mở</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {data.grades.length > 0 && (
        <section>
          <h2>Phân phối điểm</h2>
          <div className="thesis-chips">
            {data.grades.sort((a, b) => a.letter.localeCompare(b.letter)).map((row) => (
              <Badge key={row.letter} tone={row.letter === "F" ? "red" : "green"}>{row.letter}: {row.n} (TB {row.mean})</Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StudentOverview() {
  const { token, term, profile, revision, openProject } = useThesis();
  const [mine, setMine] = useState<{ group: Group | null; invitations: unknown[] } | null>(null);
  useEffect(() => {
    if (term) void academicApi<{ group: Group | null; invitations: unknown[] }>(token, `terms/${term.id}/my-group`).then(setMine).catch(() => setMine({ group: null, invitations: [] }));
  }, [token, term, revision]);
  if (!term) return null;
  const enrollment = profile.enrollments.find((item) => item.termId === term.id);
  const steps = [
    { label: "Đủ điều kiện làm đồ án", done: Boolean(enrollment?.eligible) },
    { label: "Lập nhóm", done: Boolean(mine?.group) },
    { label: "Đăng ký nguyện vọng", done: Boolean(mine?.group?.registrations.length) },
    { label: "Được giảng viên nhận", done: Boolean(mine?.group?.projectId) },
  ];
  return (
    <div className="thesis-stack">
      <section>
        <h2>Việc của bạn trong đợt {term.code}</h2>
        <p>Mã sinh viên: <strong>{enrollment?.studentCode ?? "—"}</strong></p>
        <ol className="thesis-checklist">
          {steps.map((step) => (
            <li key={step.label} className={step.done ? "is-done" : ""}>{step.label}</li>
          ))}
        </ol>
        {!enrollment?.eligible && <p className="inline-alert">Bạn chưa đủ điều kiện làm đồ án trong đợt này (tín chỉ tối thiểu {term.policy.minCredits}, GPA tối thiểu {term.policy.minGpa}). Liên hệ giáo vụ khoa nếu có sai sót.</p>}
        {mine?.group?.projectId && (
          <Button icon="arrow-right" onClick={() => openProject(mine.group!.projectId)}>Mở đồ án {mine.group.projectCode}</Button>
        )}
      </section>
      <section>
        <h2>Các mốc của đợt</h2>
        <table className="thesis-table">
          <thead><tr><th>Mốc</th><th>Loại</th><th>Hạn</th></tr></thead>
          <tbody>
            <tr><td>Đăng ký đề tài</td><td>—</td><td>{formatDate(term.registrationClosesAt)}</td></tr>
            {term.milestones.map((m) => (
              <tr key={m.id}><td>{m.code} · {m.name}</td><td>{m.required ? "Bắt buộc" : "Không bắt buộc"}</td><td>{formatDate(m.dueAt)}</td></tr>
            ))}
            <tr><td>Bảo vệ</td><td>—</td><td>{formatDate(term.defenseStartsOn)} – {formatDate(term.defenseEndsOn)}</td></tr>
          </tbody>
        </table>
        <p className="thesis-note">Điểm tổng kết = {term.policy.weights.supervisor}% GVHD + {term.policy.weights.reviewer}% phản biện + {term.policy.weights.committee}% hội đồng. Đạt khi ≥ {term.policy.passScore}. Phúc khảo trong {term.policy.appealWindowDays} ngày sau khi công bố.</p>
      </section>
    </div>
  );
}
