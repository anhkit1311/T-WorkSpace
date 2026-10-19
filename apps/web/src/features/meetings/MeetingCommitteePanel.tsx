import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi } from "../thesis/api";
import { ThesisContext, type ThesisContextValue } from "../thesis/context";
import { committeeRoleLabel, projectStatus } from "../thesis/labels";
import { ScoreSheetEditor } from "../thesis/ScoreSheetEditor";
import { getSessionCommitteeApi, type MeetingCommittee } from "./api";
import "./meeting-attendance.css";

const time = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * MT-3: in a meeting scheduled for a defense committee, members score each defense with the
 * academic rubric (the same score sheet as the thesis module) and the chair records the conclusion.
 * Shown only to committee members; students and guests just see the meeting.
 */
export function MeetingCommitteePanel({ sessionId }: { sessionId: string }) {
  const { accessToken, notify } = useApp();
  const [committee, setCommittee] = useState<MeetingCommittee | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [conclusion, setConclusion] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    const next = await getSessionCommitteeApi(accessToken, sessionId).catch(() => null);
    setCommittee(next);
    setSelected((current) => current ?? next?.slots.find((slot) => !slot.result)?.projectId ?? next?.slots[0]?.projectId ?? null);
  }, [accessToken, sessionId]);

  useEffect(() => void load(), [load, revision]);

  // The score sheet editor runs inside the thesis feature's context; it only uses token, run and revision.
  const context = useMemo(
    () =>
      ({
        token: accessToken ?? "",
        revision,
        reload: () => setRevision((value) => value + 1),
        openProject: () => {},
        profile: null,
        term: null,
        run: async <T,>(label: string, action: () => Promise<T>) => {
          setError("");
          try {
            const result = await action();
            notify(label);
            setRevision((value) => value + 1);
            return result;
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Không thực hiện được thao tác.");
            return undefined;
          }
        },
      }) as unknown as ThesisContextValue,
    [accessToken, revision, notify],
  );

  if (!committee || !accessToken) return null;
  const slot = committee.slots.find((item) => item.projectId === selected) ?? null;
  const leads = committee.myRole === "chair" || committee.myRole === "secretary";

  return (
    <ThesisContext.Provider value={context}>
      <section className="meeting-attendance meeting-committee" aria-labelledby="meeting-committee-title">
        <div className="meeting-attendance-head">
          <h4 id="meeting-committee-title">
            Hội đồng {committee.code} · {committee.name}
          </h4>
          {committee.myRole && <Badge tone="blue">{committeeRoleLabel[committee.myRole]}</Badge>}
        </div>
        <p className="meeting-committee-members">
          {committee.members.map((member) => `${committeeRoleLabel[member.role]}: ${member.displayName}`).join(" · ")}
        </p>
        <ul className="meeting-recording-list">
          {committee.slots.map((item) => (
            <li key={item.projectId}>
              <span>
                {time(item.startsAt)} · {item.projectCode} — {item.topicTitle}
              </span>
              <Badge tone={projectStatus(item.status)[1] as "neutral"}>
                {item.result ? `${item.result.finalScore} (${item.result.letter})` : projectStatus(item.status)[0]}
              </Badge>
              <Button size="sm" variant={item.projectId === selected ? "secondary" : "ghost"} onClick={() => setSelected(item.projectId)}>
                {item.projectId === selected ? "Đang xem" : "Mở"}
              </Button>
            </li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        {slot && (
          <div className="meeting-committee-slot">
            {slot.status === "scheduled" && leads && (
              <Button
                size="sm"
                onClick={() =>
                  void context.run("Đã xác nhận bảo vệ", () =>
                    academicApi(accessToken, `projects/${slot.projectId}/defended`, "POST", { version: slot.version }),
                  )
                }
              >
                Xác nhận đã bảo vệ
              </Button>
            )}
            {slot.status === "scheduled" && !leads && <p>Chờ chủ tịch hoặc thư ký xác nhận đã bảo vệ để bắt đầu chấm.</p>}
            {slot.status === "defended" && committee.myRole && (
              <ScoreSheetEditor key={slot.projectId} projectId={slot.projectId} role="committee" />
            )}
            {slot.status === "defended" && committee.myRole === "chair" && (
              <form
                className="meeting-committee-conclusion"
                onSubmit={(event) => {
                  event.preventDefault();
                  // The same text explains a large score spread when the server asks for one.
                  void context.run("Đã chốt kết luận hội đồng", () =>
                    academicApi(accessToken, `projects/${slot.projectId}/finalize`, "POST", {
                      version: slot.version,
                      conclusion: conclusion.trim(),
                      deviationNote: conclusion.trim() || undefined,
                    }),
                  ).then((result) => result && setConclusion(""));
                }}
              >
                <label>
                  Kết luận của hội đồng
                  <textarea rows={3} maxLength={4000} required value={conclusion} onChange={(event) => setConclusion(event.target.value)} />
                </label>
                <Button size="sm" type="submit" icon="lock" disabled={conclusion.trim().length < 10}>
                  Chốt kết luận
                </Button>
              </form>
            )}
            {slot.result && (
              <p className="meeting-committee-result">
                Điểm {slot.result.finalScore} ({slot.result.letter}) · {slot.result.passed ? "Đạt" : "Không đạt"}
                {slot.result.conclusion && <><br />Kết luận: {slot.result.conclusion}</>}
              </p>
            )}
          </div>
        )}
      </section>
    </ThesisContext.Provider>
  );
}
