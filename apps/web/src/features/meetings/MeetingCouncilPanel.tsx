import { useCallback, useEffect, useState } from "react";
import type { CouncilPresenter, CouncilView } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import {
  downloadCouncilApi,
  finalizePresenterApi,
  getSessionCouncilApi,
  setCouncilMemberAbsentApi,
  startPresenterApi,
  submitCouncilSheetApi,
} from "./api";
import "./meeting-attendance.css";
import "./meeting-council.css";

const STATUS = {
  waiting: { label: "Chờ", tone: "neutral" },
  presenting: { label: "Đang trình bày", tone: "green" },
  done: { label: "Đã trình bày", tone: "blue" },
} as const;
const score = (value: number) => value.toFixed(2);

/** NV-MT3: the council of this meeting — presentations, private score sheets, the chair's conclusion. */
export function MeetingCouncilPanel({ sessionId, live }: { sessionId: string; live: boolean }) {
  const { accessToken } = useApp();
  const { controlSocket } = useMeeting();
  const [council, setCouncil] = useState<CouncilView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setCouncil(await getSessionCouncilApi(accessToken, sessionId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được hội đồng.");
    }
  }, [accessToken, sessionId]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!live || !controlSocket) return;
    const changed = (change: { sessionId: string; part: string }) => {
      if (change.sessionId === sessionId && change.part === "council") void load();
    };
    controlSocket.on("meeting_outcomes_changed", changed);
    return () => {
      controlSocket.off("meeting_outcomes_changed", changed);
    };
  }, [live, controlSocket, sessionId, load]);

  const run = async (task: () => Promise<unknown>) => {
    if (!accessToken) return false;
    setBusy(true);
    setError("");
    try {
      await task();
      await load();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không thực hiện được thao tác.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!council) return error ? <p role="alert">{error}</p> : null;
  const chair = council.myRole === "chair";
  const present = council.members.filter((member) => !member.absent);

  return (
    <section className="meeting-attendance meeting-council" aria-labelledby="meeting-council-title">
      <div className="meeting-attendance-head">
        <h4 id="meeting-council-title">Hội đồng</h4>
        {(council.myRole || council.canManage) && (
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            disabled={busy}
            onClick={() => void run(() => downloadCouncilApi(accessToken!, council.scheduleId))}
          >
            Xuất bảng điểm
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}

      <ul className="meeting-council__members" aria-label="Thành viên hội đồng">
        {council.members.map((member) => (
          <li key={member.userId}>
            <span>
              {member.displayName}
              {member.role === "chair" ? " · Chủ tịch" : ""}
              {member.absent ? " · Vắng" : ""}
            </span>
            {chair && member.role !== "chair" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    setCouncilMemberAbsentApi(
                      accessToken!,
                      council.scheduleId,
                      member.userId,
                      !member.absent,
                    ),
                  )
                }
              >
                {member.absent ? "Có mặt" : "Đánh dấu vắng"}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <ol className="meeting-council__presenters">
        {council.presenters.map((presenter) => (
          <li key={presenter.id}>
            <details open={presenter.status === "presenting"}>
              <summary>
                <span>
                  <strong>{presenter.displayName}</strong>
                  {presenter.studentCode && ` (${presenter.studentCode})`} — {presenter.topic}
                </span>
                <Badge tone={presenter.finalizedAt ? "violet" : STATUS[presenter.status].tone}>
                  {presenter.finalScore !== null
                    ? `Điểm ${score(presenter.finalScore)}`
                    : STATUS[presenter.status].label}
                </Badge>
                {council.myRole && (
                  <small>
                    Phiếu{" "}
                    {
                      presenter.submittedBy.filter((id) => present.some((m) => m.userId === id))
                        .length
                    }
                    /{present.length}
                  </small>
                )}
              </summary>
              <PresenterDetail
                council={council}
                presenter={presenter}
                busy={busy}
                run={run}
                accessToken={accessToken!}
              />
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PresenterDetail({
  council,
  presenter,
  busy,
  run,
  accessToken,
}: {
  council: CouncilView;
  presenter: CouncilPresenter;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<boolean>;
  accessToken: string;
}) {
  const { user } = useApp();
  const chair = council.myRole === "chair";
  const final = Boolean(presenter.finalizedAt);
  const absent = council.members.some((member) => member.userId === user?.id && member.absent);
  const [conclusion, setConclusion] = useState("");
  const missing = council.members.filter(
    (member) => !member.absent && !presenter.submittedBy.includes(member.userId),
  );
  const average =
    presenter.sheets && presenter.sheets.length
      ? presenter.sheets.reduce((sum, sheet) => sum + sheet.total, 0) / presenter.sheets.length
      : null;

  return (
    <div className="meeting-council__detail">
      {chair && !final && presenter.status !== "presenting" && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => startPresenterApi(accessToken, presenter.id))}
        >
          Mời trình bày
        </Button>
      )}

      {council.myRole && !final && !absent && (
        <SheetForm
          council={council}
          presenter={presenter}
          busy={busy}
          run={run}
          accessToken={accessToken}
        />
      )}

      {presenter.sheets && presenter.sheets.length > 0 && (
        <table>
          <caption>Phiếu chấm{final ? "" : " (chỉ chủ tịch thấy trước khi chốt)"}</caption>
          <thead>
            <tr>
              <th scope="col">Thành viên</th>
              {council.criteria.map((criterion) => (
                <th scope="col" key={criterion.id}>
                  {criterion.label} ({criterion.weight}%)
                </th>
              ))}
              <th scope="col">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {presenter.sheets.map((sheet) => (
              <tr key={sheet.memberId} title={sheet.comment || undefined}>
                <th scope="row">{sheet.displayName}</th>
                {council.criteria.map((criterion) => (
                  <td key={criterion.id}>{sheet.scores[criterion.id]}</td>
                ))}
                <td>{score(sheet.total)}</td>
              </tr>
            ))}
          </tbody>
          {average !== null && !final && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={council.criteria.length + 1}>
                  Trung bình hiện tại
                </th>
                <td>{score(average)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}

      {chair && !final && (
        <div className="meeting-council__finalize">
          <textarea
            rows={2}
            maxLength={2000}
            value={conclusion}
            onChange={(event) => setConclusion(event.target.value)}
            placeholder="Kết luận của hội đồng"
            aria-label="Kết luận của hội đồng"
          />
          {missing.length > 0 && (
            <small>Chờ phiếu: {missing.map((member) => member.displayName).join(", ")}</small>
          )}
          <Button
            size="sm"
            disabled={busy || missing.length > 0}
            onClick={() =>
              void run(() => finalizePresenterApi(accessToken, presenter.id, conclusion.trim()))
            }
          >
            Chốt kết luận
          </Button>
        </div>
      )}

      {final && presenter.finalScore !== null && (
        <p className="meeting-council__result">
          Điểm hội đồng: <strong>{score(presenter.finalScore)}</strong>
          {presenter.conclusion ? ` · ${presenter.conclusion}` : ""}
        </p>
      )}
    </div>
  );
}

function SheetForm({
  council,
  presenter,
  busy,
  run,
  accessToken,
}: {
  council: CouncilView;
  presenter: CouncilPresenter;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<boolean>;
  accessToken: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      council.criteria.map((criterion) => [
        criterion.id,
        String(presenter.mySheet?.scores[criterion.id] ?? ""),
      ]),
    ),
  );
  const [comment, setComment] = useState(presenter.mySheet?.comment ?? "");
  const scores = Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, Number(value)]),
  );
  const complete = Object.values(values).every(
    (value) => value !== "" && Number(value) >= 0 && Number(value) <= 10,
  );
  const total =
    council.criteria.reduce(
      (sum, criterion) => sum + (scores[criterion.id] || 0) * criterion.weight,
      0,
    ) / 100;

  return (
    <form
      className="meeting-council__sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete)
          void run(() =>
            submitCouncilSheetApi(accessToken, presenter.id, { scores, comment: comment.trim() }),
          );
      }}
    >
      <p>
        {presenter.mySheet
          ? "Phiếu của bạn đã nộp — có thể sửa đến khi chủ tịch chốt."
          : "Phiếu chấm của bạn (thang 10)"}
      </p>
      {council.criteria.map((criterion) => (
        <label key={criterion.id}>
          <span>
            {criterion.label} ({criterion.weight}%)
          </span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.25}
            required
            value={values[criterion.id]}
            onChange={(event) =>
              setValues((old) => ({ ...old, [criterion.id]: event.target.value }))
            }
          />
        </label>
      ))}
      <textarea
        rows={2}
        maxLength={2000}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Nhận xét (không bắt buộc)"
        aria-label="Nhận xét"
      />
      <div className="meeting-council__sheet-foot">
        <span>Tổng: {complete ? score(total) : "—"}</span>
        <Button size="sm" type="submit" disabled={busy || !complete}>
          {presenter.mySheet ? "Cập nhật phiếu" : "Nộp phiếu"}
        </Button>
      </div>
    </form>
  );
}
