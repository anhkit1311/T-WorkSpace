import { useEffect, useState } from "react";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi, downloadCsv, type ProjectRow } from "./api";
import { useThesis } from "./context";
import { formatDateTime, projectStatus } from "./labels";

const scopes = [
  { id: "mine", label: "Liên quan đến tôi" },
  { id: "supervising", label: "Tôi hướng dẫn" },
  { id: "reviewing", label: "Tôi phản biện" },
  { id: "committee", label: "Hội đồng của tôi" },
  { id: "all", label: "Toàn khoa" },
];

export function ProjectsPanel() {
  const { token, term, revision, openProject, run } = useThesis();
  const wide = Boolean(term?.viewer.admin || term?.viewer.head);
  const [scope, setScope] = useState(wide ? "all" : "mine");
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!term) return;
    academicApi<{ projects: ProjectRow[] }>(token, `terms/${term.id}/projects?scope=${scope}`)
      .then((data) => {
        setRows(data.projects);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [token, term, revision, scope]);
  if (!term) return null;
  const visibleScopes = scopes.filter((s) => (s.id === "all" ? wide : s.id === "mine" || term.viewer.lecturer || wide));
  return (
    <section>
      <div className="thesis-section-head">
        <h2>Đồ án ({rows.length})</h2>
        <div className="thesis-toolbar">
          {visibleScopes.length > 1 && (
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Phạm vi">
              {visibleScopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          {wide && <Button variant="secondary" icon="download" onClick={() => void run("Đã xuất danh sách", () => downloadCsv(token, term.id, "assignments"), { reload: false })}>Xuất CSV</Button>}
        </div>
      </div>
      {error && <p className="inline-alert">{error}</p>}
      {rows.length === 0 ? (
        <p>Chưa có đồ án nào trong phạm vi này.</p>
      ) : (
        <table className="thesis-table">
          <thead><tr><th>Mã</th><th>Đề tài</th><th>GVHD</th><th>Phản biện</th><th>Buổi HD</th><th>Bảo vệ</th><th>Điểm</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const [label, tone] = projectStatus(row.status);
              return (
                <tr key={row.id} className="is-clickable" onClick={() => openProject(row.id)}>
                  <td><strong>{row.code}</strong></td>
                  <td>{row.topicCode} · {row.topicTitle}</td>
                  <td>{row.supervisorName}</td>
                  <td>{row.reviewerName ?? "—"}{row.recommendation && <small> ({row.recommendation === "approve" ? "đồng ý" : "không đồng ý"})</small>}</td>
                  <td>{row.confirmedLogs}/{term.policy.minSupervisionLogs}</td>
                  <td>{row.defenseAt ? `${row.committeeCode} · ${formatDateTime(row.defenseAt)}` : "—"}</td>
                  <td>{row.finalScore !== null ? `${row.finalScore} (${row.letter})` : "—"}</td>
                  <td><Badge tone={tone}>{label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
