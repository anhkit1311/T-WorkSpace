import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ChannelItem, MeetingNotes, MeetingOutcomes } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Button, IconButton } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { ApiError } from "../auth/api";
import { getChannelsApi } from "../chat/api";
import {
  addAgendaItemApi,
  createMeetingTaskApi,
  deleteAgendaItemApi,
  getMeetingOutcomesApi,
  saveMeetingNotesApi,
  setOutcomeChannelApi,
  updateAgendaItemApi,
} from "./api";
import { MeetingAttendancePanel } from "./MeetingAttendancePanel";
import { MeetingRecordingPanel } from "./MeetingRecordingPanel";
import { cn } from "../../shared/lib/utils";
import { COUNT, INPUT, META, NOTE_BOX, PANEL, PANEL_TITLE } from "./panel-ui";

export type OutcomeSection = "channel" | "agenda" | "notes" | "tasks" | "recording" | "attendance";
const ALL: OutcomeSection[] = ["channel", "agenda", "notes", "tasks", "recording", "attendance"];
const TASK_TONE = {
  todo: "bg-secondary text-muted-foreground",
  doing: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  done: "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]",
} as const;

const SAVE_DELAY_MS = 800;
const statusLabel = { todo: "Cần làm", doing: "Đang làm", done: "Xong" } as const;

type SaveState = "idle" | "saving" | "saved" | "error";

// Agenda, shared notes and tasks of one meeting session. While the session runs it follows
// realtime changes; after it ends the same view is read-only history.
export function MeetingOutcomesPanel({
  sessionId,
  live,
  sections = ALL,
}: {
  sessionId: string;
  live: boolean;
  /** Which parts to show; the meeting report lays them out in two columns. */
  sections?: OutcomeSection[];
}) {
  const { accessToken } = useApp();
  const { controlSocket } = useMeeting();
  const { socket } = useSocket();
  const [outcomes, setOutcomes] = useState<MeetingOutcomes | null>(null);
  const [error, setError] = useState("");
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<MeetingNotes | null>(null);
  const [agendaDraft, setAgendaDraft] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [busy, setBusy] = useState(false);
  // Refs hold the editing state that async callbacks and socket handlers must read fresh.
  const draftRef = useRef("");
  const baseVersion = useRef(0);
  const dirty = useRef(false);
  const conflictRef = useRef<MeetingNotes | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  // Content of the save in flight: its socket echo can arrive before the HTTP response.
  const inFlight = useRef<string | null>(null);
  const pendingTaskId = useRef<string | null>(null);
  conflictRef.current = conflict;

  const applyNotes = (notes: MeetingNotes) => {
    draftRef.current = notes.content;
    baseVersion.current = notes.version;
    dirty.current = false;
    setDraft(notes.content);
  };

  const load = useCallback(async () => {
    if (!accessToken) return null;
    try {
      const next = await getMeetingOutcomesApi(accessToken, sessionId);
      setOutcomes(next);
      setError("");
      if (!dirty.current) applyNotes(next.notes);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được kết quả cuộc họp.");
      return null;
    }
  }, [accessToken, sessionId]);

  useEffect(() => {
    dirty.current = false;
    setConflict(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!accessToken || !outcomes?.workspaceId || !outcomes.canManage) return;
    let active = true;
    void getChannelsApi(accessToken, outcomes.workspaceId)
      .then((items) => {
        if (active) setChannels(items.filter((item) => item.type === "text" && !item.archivedAt));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken, outcomes?.workspaceId, outcomes?.canManage]);

  const saveNotes = useCallback(async () => {
    if (!accessToken || savingRef.current || conflictRef.current || !dirty.current) return;
    savingRef.current = true;
    setSaveState("saving");
    const content = draftRef.current;
    inFlight.current = content;
    let saved = false;
    try {
      const result = await saveMeetingNotesApi(
        accessToken,
        sessionId,
        content,
        baseVersion.current,
      );
      baseVersion.current = result.version;
      dirty.current = draftRef.current !== content;
      setSaveState("saved");
      setOutcomes((current) => (current ? { ...current, notes: result } : current));
      saved = true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "NOTES_CONFLICT") {
        const latest = await load();
        if (latest) setConflict(latest.notes);
        setSaveState("idle");
      } else {
        setSaveState("error");
        setError(reason instanceof Error ? reason.message : "Không lưu được ghi chú.");
      }
    } finally {
      savingRef.current = false;
      inFlight.current = null;
      // Text typed while the request was in flight still needs saving. After a failure the
      // next keystroke or blur retries, so a broken connection cannot cause a request loop.
      if (saved && dirty.current && !conflictRef.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void saveNotes(), SAVE_DELAY_MS);
      }
    }
  }, [accessToken, sessionId, load]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  useEffect(() => {
    if (!live || !controlSocket) return;
    const changed = (data: {
      roomId: string;
      sessionId: string;
      part: string;
      notes?: MeetingNotes;
    }) => {
      if (data.sessionId !== sessionId) return;
      if (data.part === "notes" && data.notes) {
        // Our own save echoes back, either after the response or still in flight.
        if (data.notes.version <= baseVersion.current) return;
        if (inFlight.current !== null && data.notes.content === inFlight.current) return;
        if (dirty.current) setConflict(data.notes);
        else applyNotes(data.notes);
        setOutcomes((current) => (current ? { ...current, notes: data.notes! } : current));
        return;
      }
      void load();
    };
    controlSocket.on("meeting_outcomes_changed", changed);
    return () => {
      controlSocket.off("meeting_outcomes_changed", changed);
    };
  }, [live, controlSocket, sessionId, load]);

  useEffect(() => {
    if (!socket || !outcomes?.outcomeChannelId) return;
    const channelId = outcomes.outcomeChannelId;
    const changed = (data: { channelId: string }) => {
      if (data.channelId === channelId) void load();
    };
    socket.on("task_changed", changed);
    return () => {
      socket.off("task_changed", changed);
    };
  }, [socket, outcomes?.outcomeChannelId, load]);

  const run = async (work: () => Promise<unknown>) => {
    if (!accessToken || busy) return false;
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không cập nhật được.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onNotesChange = (value: string) => {
    draftRef.current = value;
    dirty.current = true;
    setDraft(value);
    setSaveState("idle");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveNotes(), SAVE_DELAY_MS);
  };

  const resolveConflict = (keepMine: boolean) => {
    const latest = conflictRef.current;
    if (!latest) return;
    conflictRef.current = null;
    setConflict(null);
    if (keepMine) {
      baseVersion.current = latest.version;
      dirty.current = true;
      void saveNotes();
    } else applyNotes(latest);
  };

  const addAgenda = async (event: FormEvent) => {
    event.preventDefault();
    const label = agendaDraft.trim();
    if (!label) return;
    if (await run(() => addAgendaItemApi(accessToken!, sessionId, label))) setAgendaDraft("");
  };

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    // Reuse the id until the request succeeds so a retry cannot create a duplicate task.
    pendingTaskId.current ??= crypto.randomUUID();
    const clientTaskId = pendingTaskId.current;
    const created = await run(() =>
      createMeetingTaskApi(accessToken!, sessionId, {
        clientTaskId,
        title,
        assigneeId: taskAssignee || null,
        dueAt: taskDue ? new Date(`${taskDue}T17:00:00`).toISOString() : null,
      }),
    );
    if (created) {
      pendingTaskId.current = null;
      setTaskTitle("");
      setTaskAssignee("");
      setTaskDue("");
    }
  };

  if (!outcomes)
    return (
      <p className={cn("tw", META)} role={error ? "alert" : "status"}>
        {error || "Đang tải ghi chú cuộc họp…"}
      </p>
    );

  const editable = live && outcomes.canEdit;
  const doneCount = outcomes.agenda.filter((item) => item.done).length;
  const show = (part: OutcomeSection) => sections.includes(part);
  return (
    <div className="tw grid min-w-0 content-start gap-3 text-sm text-foreground">
      {error && (
        <p className={NOTE_BOX} role="alert">
          {error}
        </p>
      )}

      {show("agenda") && (
        <section className={PANEL} aria-labelledby={`agenda-${sessionId}`}>
          <h3 id={`agenda-${sessionId}`} className={PANEL_TITLE}>
            Agenda
            {outcomes.agenda.length > 0 && (
              <span className={COUNT}>
                {doneCount}/{outcomes.agenda.length}
              </span>
            )}
          </h3>
          {outcomes.agenda.length ? (
            <ul className="grid">
              {outcomes.agenda.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 border-t py-1.5 first:border-t-0"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-foreground"
                      checked={item.done}
                      disabled={!editable || busy}
                      onChange={(event) =>
                        void run(() =>
                          updateAgendaItemApi(accessToken!, sessionId, item.id, {
                            done: event.target.checked,
                          }),
                        )
                      }
                    />
                    <span
                      className={cn("min-w-0", item.done && "text-muted-foreground line-through")}
                    >
                      {item.label}
                    </span>
                  </label>
                  {item.done && item.doneByName && (
                    <small className="text-xs text-muted-foreground">{item.doneByName}</small>
                  )}
                  {editable && !item.fromSchedule && (
                    <IconButton
                      icon="x"
                      className="size-7"
                      label={`Xóa mục ${item.label}`}
                      onClick={() =>
                        void run(() => deleteAgendaItemApi(accessToken!, sessionId, item.id))
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={META}>Chưa có mục nào.</p>
          )}
          {editable && (
            <form className="flex gap-1.5" onSubmit={(event) => void addAgenda(event)}>
              <input
                className={cn(INPUT, "flex-1")}
                value={agendaDraft}
                maxLength={200}
                onChange={(event) => setAgendaDraft(event.target.value)}
                placeholder="Thêm mục agenda…"
                aria-label="Mục agenda mới"
              />
              <IconButton
                icon="plus"
                label="Thêm mục agenda"
                type="submit"
                disabled={busy || !agendaDraft.trim()}
              />
            </form>
          )}
        </section>
      )}

      {show("notes") && (
        <section className={PANEL} aria-labelledby={`notes-${sessionId}`}>
          <h3 id={`notes-${sessionId}`} className={PANEL_TITLE}>
            Ghi chú chung
            <span className="ml-auto text-xs font-normal text-muted-foreground" role="status">
              {saveState === "saving"
                ? "Đang lưu…"
                : saveState === "saved"
                  ? "Đã lưu"
                  : saveState === "error"
                    ? "Chưa lưu"
                    : ""}
            </span>
          </h3>
          {conflict && (
            <div className={cn(NOTE_BOX, "grid gap-2")} role="alert">
              <p>
                {conflict.updatedByName ?? "Người khác"} vừa cập nhật ghi chú trong lúc bạn đang
                sửa.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => resolveConflict(false)}>
                  Dùng bản mới
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resolveConflict(true)}>
                  Giữ bản của tôi
                </Button>
              </div>
            </div>
          )}
          {editable ? (
            <textarea
              className={cn(INPUT, "h-auto resize-y py-2 leading-relaxed")}
              value={draft}
              maxLength={20000}
              rows={7}
              onChange={(event) => onNotesChange(event.target.value)}
              onBlur={() => void saveNotes()}
              placeholder="Mọi người trong phòng cùng ghi chú tại đây…"
              aria-label="Ghi chú chung của cuộc họp"
            />
          ) : (
            <p className="leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {outcomes.notes.content || (
                <span className="text-muted-foreground">Không có ghi chú.</span>
              )}
            </p>
          )}
          {outcomes.notes.updatedByName && (
            <small className="text-xs text-muted-foreground">
              Cập nhật bởi {outcomes.notes.updatedByName}
              {outcomes.notes.updatedAt
                ? ` lúc ${new Date(outcomes.notes.updatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </small>
          )}
        </section>
      )}

      {show("tasks") && (
        <section className={PANEL} aria-labelledby={`tasks-${sessionId}`}>
          <h3 id={`tasks-${sessionId}`} className={PANEL_TITLE}>
            Việc cần làm
            {outcomes.tasks.length > 0 && (
              <span className={COUNT}>
                {outcomes.tasks.filter((task) => task.status === "done").length}/
                {outcomes.tasks.length}
              </span>
            )}
          </h3>
          {outcomes.tasks.length ? (
            <ul className="grid">
              {outcomes.tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t py-2 first:border-t-0"
                >
                  <Icon
                    name="check-square"
                    size={15}
                    className={
                      task.status === "done" ? "text-emerald-600" : "text-muted-foreground"
                    }
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1",
                      task.status === "done" && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </span>
                  {task.dueAt && (
                    <span className="text-xs text-muted-foreground">
                      hạn {new Date(task.dueAt).toLocaleDateString("vi-VN")}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {task.assigneeName ?? "Chưa giao"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-px text-[11.5px] font-semibold",
                      TASK_TONE[task.status],
                    )}
                  >
                    {statusLabel[task.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={META}>Chưa có việc nào được giao trong cuộc họp.</p>
          )}
          {editable && outcomes.outcomeChannelId && (
            <form className="grid gap-1.5" onSubmit={(event) => void addTask(event)}>
              <input
                className={INPUT}
                value={taskTitle}
                maxLength={160}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Việc cần làm…"
                aria-label="Tên việc cần làm"
              />
              <div className="flex flex-wrap gap-1.5">
                <select
                  className={cn(INPUT, "min-w-[120px] flex-1")}
                  value={taskAssignee}
                  onChange={(event) => setTaskAssignee(event.target.value)}
                  aria-label="Người phụ trách"
                >
                  <option value="">Chưa giao</option>
                  {outcomes.attendees.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
                <input
                  className={INPUT}
                  type="date"
                  value={taskDue}
                  onChange={(event) => setTaskDue(event.target.value)}
                  aria-label="Hạn chót"
                />
                <Button
                  size="sm"
                  type="submit"
                  className="h-[34px]"
                  disabled={busy || !taskTitle.trim()}
                >
                  Tạo việc
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {show("channel") && (
        <section className={PANEL} aria-labelledby={`channel-${sessionId}`}>
          <h3 id={`channel-${sessionId}`} className={PANEL_TITLE}>
            Kênh nhận kết quả
          </h3>
          {outcomes.canManage && editable ? (
            <select
              className={INPUT}
              aria-label="Kênh nhận việc và tổng kết"
              value={outcomes.outcomeChannelId ?? ""}
              disabled={busy}
              onChange={(event) =>
                void run(() => setOutcomeChannelApi(accessToken!, sessionId, event.target.value))
              }
            >
              {!outcomes.outcomeChannelId && <option value="">Chọn kênh văn bản…</option>}
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          ) : (
            <p>
              {outcomes.outcomeChannelName ? (
                `#${outcomes.outcomeChannelName}`
              ) : (
                <span className="text-muted-foreground">Chưa chọn kênh văn bản</span>
              )}
            </p>
          )}
          <small className="text-xs text-muted-foreground">
            Việc tạo trong họp vào bảng công việc của kênh này; tổng kết được đăng khi kết thúc.
          </small>
        </section>
      )}

      {show("recording") && <MeetingRecordingPanel sessionId={sessionId} live={live} />}
      {show("attendance") && <MeetingAttendancePanel sessionId={sessionId} />}
    </div>
  );
}
