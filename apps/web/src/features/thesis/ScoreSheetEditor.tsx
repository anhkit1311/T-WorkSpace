import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi } from "./api";
import { useThesis } from "./context";
import { graderRoleLabel } from "./labels";

interface Sheet {
  id: string;
  graderRole: string;
  graderId: string;
  graderName: string;
  total: number | null;
  comment: string;
  submittedAt: string | null;
  version: number;
  scores: Record<string, number>;
}
interface Criterion {
  id: string;
  graderRole: string;
  code: string;
  name: string;
  weight: number;
}

/** Rubric-based score sheet. The total shown here mirrors the server formula; the server recomputes it. */
export function ScoreSheetEditor({ projectId, role }: { projectId: string; role: "supervisor" | "reviewer" | "committee" }) {
  const { token, run, revision } = useThesis();
  const { user } = useApp();
  const [rubric, setRubric] = useState<Criterion[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  useEffect(() => {
    void academicApi<{ sheets: Sheet[]; rubric: Criterion[] }>(token, `projects/${projectId}/scores`).then((data) => {
      setRubric(data.rubric.filter((c) => c.graderRole === role));
      setSheets(data.sheets);
      const mine = data.sheets.find((s) => s.graderRole === role && s.graderId === user?.id);
      setScores(Object.fromEntries(Object.entries(mine?.scores ?? {}).map(([k, v]) => [k, String(v)])));
      setComment(mine?.comment ?? "");
    }).catch(() => undefined);
  }, [token, projectId, role, revision, user?.id]);
  const mine = sheets.find((s) => s.graderRole === role && s.graderId === user?.id);
  const preview = useMemo(() => {
    if (!rubric.length || rubric.some((c) => scores[c.id] === undefined || scores[c.id] === "")) return null;
    return Math.round(rubric.reduce((sum, c) => sum + Number(scores[c.id]) * c.weight, 0)) / 100;
  }, [rubric, scores]);
  const save = (submit: boolean) =>
    run(submit ? "Đã nộp phiếu điểm" : "Đã lưu nháp phiếu điểm", () =>
      academicApi(token, `projects/${projectId}/scores`, "POST", {
        graderRole: role,
        scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
        comment,
        submit,
        ...(mine ? { version: mine.version } : {}),
      }),
    );
  const committeeSheets = role === "committee" ? sheets.filter((s) => s.graderRole === "committee") : [];
  return (
    <div className="thesis-card thesis-score">
      <div className="thesis-card__head">
        <h3>Phiếu điểm — {graderRoleLabel[role]}</h3>
        {mine?.submittedAt ? <Badge tone="green">Đã nộp · {mine.total}</Badge> : <Badge tone="amber">Chưa nộp</Badge>}
      </div>
      <table className="thesis-table">
        <thead><tr><th>Tiêu chí</th><th>Trọng số</th><th>Điểm (0–10, bước 0,25)</th></tr></thead>
        <tbody>
          {rubric.map((criterion) => (
            <tr key={criterion.id}>
              <td>{criterion.code} · {criterion.name}</td>
              <td>{criterion.weight}%</td>
              <td>
                <input type="number" min={0} max={10} step={0.25} disabled={Boolean(mine?.submittedAt)} value={scores[criterion.id] ?? ""} onChange={(e) => setScores({ ...scores, [criterion.id]: e.target.value })} aria-label={`Điểm ${criterion.name}`} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>Tổng (tạm tính)</td><td><strong>{preview ?? "—"}</strong></td></tr></tfoot>
      </table>
      <textarea rows={2} placeholder="Nhận xét" disabled={Boolean(mine?.submittedAt)} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Nhận xét" />
      {!mine?.submittedAt && (
        <div className="thesis-actions">
          <Button variant="secondary" onClick={() => void save(false)}>Lưu nháp</Button>
          <Button icon="lock" disabled={preview === null} onClick={() => void save(true)}>Nộp phiếu</Button>
        </div>
      )}
      <small>Phiếu đã nộp bị khóa ở cơ sở dữ liệu; sau khi hội đồng chốt, mọi phiếu của đồ án đều bị khóa.</small>
      {committeeSheets.length > 1 && (
        <ul className="thesis-members">
          {committeeSheets.map((s) => <li key={s.id}>{s.graderName}: {s.submittedAt ? s.total : "chưa nộp"}</li>)}
        </ul>
      )}
    </div>
  );
}
