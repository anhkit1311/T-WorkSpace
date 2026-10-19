import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChannelItem, WorkspaceItem, TaskItem, TaskDetail } from "@doan/shared";
import { getWorkspacesApi, getChannelsApi, uploadAttachmentApi } from "../chat/api";
import { governanceApi } from "../workspaces/api";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Button, IconButton, ConfirmDialog } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import { beforeTaskAt } from "../../shared/lib/interaction";
import { AttachmentView } from "../chat/ChatAttachment";
import type { ChannelMember } from "../chat/ThreadPanel";
import "./task-board.css";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { useDraft } from "../../shared/hooks/useDraft";

const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" } as const;
const priorities = { low: "Thấp", normal: "Bình thường", high: "Cao", urgent: "Khẩn cấp" } as const;
interface CallCenterTicket {
  id: string;
  title: string;
  studentId: string;
  description: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  branch: string;
  createdAt: string;
}

type Board = { tasks: TaskItem[]; truncated: boolean };
export function TaskBoardPage() {
  const { accessToken, user, route, navigate, notify } = useApp();
  const { socket, isConnected } = useSocket();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]),
    [channels, setChannels] = useState<ChannelItem[]>([]),
    [members, setMembers] = useState<ChannelMember[]>([]),
    [board, setBoard] = useState<Board>({ tasks: [], truncated: false });
  const [ccTickets, setCcTickets] = useState<CallCenterTicket[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("tdtu_callcenter_tickets");
      if (raw) setCcTickets(JSON.parse(raw));
    } catch {
      // Storage unavailable or corrupt: start with no tickets.
    }
  }, []);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [boardRevision, setBoardRevision] = useState(0);
  const [createSuccess, setCreateSuccess] = useState(0);
  const [loadedBoardRevision, setLoadedBoardRevision] = useState(-1);
  const [creation, setCreation, creationReady] = useDraft<{ title: string; id: string }>(
    `${user?.id ?? "anonymous"}:task-create:${route.channelId ?? ""}`,
    { title: "", id: crypto.randomUUID() },
  );
  const title = creation.title,
    setTitle = (title: string) => setCreation((old) => ({ ...old, title }));
  const [assigned, setAssigned] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [priorityFilter, setPriorityFilter] = useState(""),
    [deadline, setDeadline] = useState(""),
    [archived, setArchived] = useState(false);
  const dragId = useRef<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const focusCreateRef = useRef(false);
  useEffect(() => {
    if (!busy && !loading && loadedBoardRevision === boardRevision && creationReady && focusCreateRef.current && createInputRef.current) {
      // Restore after the board refresh settles.
      createInputRef.current.focus();
      focusCreateRef.current = false;
    }
  }, [busy, loading, creationReady, boardRevision, loadedBoardRevision]);
  const [movingIds, setMovingIds] = useState<Set<string>>(() => new Set());
  const movingRef = useRef(new Set<string>());
  const [dropTarget, setDropTarget] = useState<{status:string; before:string | null} | null>(null);
  const workspace = workspaces.find((w) => w.id === route.workspaceId),
    channel = channels.find((c) => c.id === route.channelId);
  const readOnly = Boolean(workspace?.archivedAt || channel?.archivedAt);
  useEffect(() => {
    if (!accessToken || route.view !== "tasks") return;
    let active = true;
    setLoading(true);
    setError("");
    void getWorkspacesApi(accessToken)
      .then((items) => {
        if (!active) return;
        setWorkspaces(items);
        if (route.workspaceId && !items.some((w) => w.id === route.workspaceId))
          throw new Error("Bạn không có quyền xem nhóm trong liên kết.");
        if (!route.workspaceId && items[0])
          navigate({ view: "tasks", workspaceId: items[0].id }, true);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, route.view, route.workspaceId, navigate, revision]);
  useEffect(() => {
    setChannels([]);
    setMembers([]);
    setBoard({ tasks: [], truncated: false });
    if (!accessToken || !route.workspaceId || route.view !== "tasks") return;
    let active = true;
    setLoading(true);
    void getChannelsApi(accessToken, route.workspaceId)
      .then((items) => {
        if (!active) return;
        const text = items.filter((c) => c.type === "text");
        setChannels(text);
        if (route.channelId && !text.some((c) => c.id === route.channelId))
          throw new Error("Kênh không tồn tại hoặc quyền đã thay đổi.");
        if (!route.channelId && text[0]) navigate({ ...route, channelId: text[0].id }, true);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, route.workspaceId, route.channelId, route.view, navigate, revision]);
  useEffect(() => {
    if (!accessToken || !route.channelId || route.view !== "tasks") return;
    let active = true;
    let generation = 0;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      assignee: assigned,
      status: statusFilter,
      priority: priorityFilter,
      deadline,
      archived: String(archived),
    });
    for (const [key, value] of [...params]) if (!value) params.delete(key);
    const load = () => {
      const request = ++generation;
      void governanceApi<Board>(accessToken, `channels/${route.channelId}/tasks?${params}`)
        .then((data) => {
          if (active && request === generation) setBoard(data);
        })
        .catch((reason) => {
          if (active) {
            setBoard({ tasks: [], truncated: false });
            setError(reason.message);
          }
        })
        .finally(() => {
          if (active && request === generation) {
            setLoading(false);
            setLoadedBoardRevision(boardRevision);
          }
        });
    };
    const changed = (event: { channelId: string }) => {
      if (event.channelId === route.channelId) load();
    };
    const revoked = () => {
      setBoard({ tasks: [], truncated: false });
      setMembers([]);
      setRevision((n) => n + 1);
      load();
    };
    load();
    void governanceApi<{ members: ChannelMember[] }>(
      accessToken,
      `channels/${route.channelId}/members`,
    )
      .then((data) => {
        if (active) setMembers(data.members);
      })
      .catch(reason => {if(active)setError(reason instanceof Error ? reason.message : "Không tải được người phụ trách.");});
    socket?.on("task_changed", changed);
    socket?.on("connect", load);
    socket?.on("access_revoked", revoked);
    return () => {
      active = false;
      socket?.off("task_changed", changed);
      socket?.off("connect", load);
      socket?.off("access_revoked", revoked);
    };
  }, [
    accessToken,
    route.channelId,
    route.view,
    assigned,
    statusFilter,
    priorityFilter,
    deadline,
    archived,
    revision,
    boardRevision,
    socket,
  ]);
  const fail = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : "Không thể cập nhật nhiệm vụ.");
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !channel || busy || readOnly || !creationReady) return;
    setBusy(true);
    setError("");
    try {
      const data = await governanceApi<{ task: TaskDetail }>(
        accessToken,
        `channels/${channel.id}/tasks`,
        "POST",
        { title, clientTaskId: creation.id },
      );
      setCreation({ title: "", id: crypto.randomUUID() });
      focusCreateRef.current = true;
      setBoardRevision((n) => n + 1);
      setCreateSuccess(n => n + 1);
      notify("Đã tạo nhiệm vụ", undefined, "success", {label:"Mở",onClick:() => navigate({...route,taskId:data.task.id})});
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };
  const move = async (task: TaskItem, status: TaskItem["status"], beforeTaskId?: string | null) => {
    if (!accessToken || busy || movingRef.current.has(task.id) || readOnly || task.archivedAt) return;
    movingRef.current.add(task.id);
    setMovingIds(new Set(movingRef.current));
    setError("");
    setBoard((old) => ({
      ...old,
      tasks: old.tasks.map((item) => (item.id === task.id ? { ...item, status } : item)),
    }));
    try {
      await governanceApi(accessToken, `tasks/${task.id}`, "PATCH", {
        version: task.version,
        status,
        ...(beforeTaskId !== undefined ? { beforeTaskId } : {}),
      });
      setBoardRevision((n) => n + 1);
    } catch (reason) {
      setBoard(old => ({...old,tasks:old.tasks.map(item => item.id === task.id ? task : item)}));
      fail(reason);
    } finally {
      movingRef.current.delete(task.id);
      setMovingIds(new Set(movingRef.current));
    }
  };
  return (
    <section className="task-page" aria-label="Bảng công việc">
      <header className="task-page-heading">
        <div>
          <h2>Bảng công việc Kanban{channel ? ` — #${channel.name}` : ""}</h2>
          <p>Theo dõi tiến độ nhiệm vụ theo từng kênh trong nhóm {workspace?.name ?? ""}.</p>
        </div>
        <span role="status">{isConnected ? "Đồng bộ trực tiếp" : "Đang chờ kết nối"}</span>
      </header>
      <div className="task-toolbar">
        <label>
          Bảng theo kênh
          <select
            value={route.channelId ?? ""}
            onChange={(event) => {
              setError("");
              navigate({
                view: "tasks",
                workspaceId: route.workspaceId,
                channelId: event.target.value,
              });
            }}
          >
            <option value="">Chọn kênh</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isPrivate ? " · Riêng tư" : ""}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          onClick={() => setRevision((n) => n + 1)}
        >
          Tải lại bảng
        </Button>
      </div>
      {error && (
        <p className="task-alert" role="alert">
          {error}
        </p>
      )}
      {readOnly && <p role="status">Nhóm/kênh đã lưu trữ. Bạn có thể xem công việc.</p>}
      {!workspaces.length && !loading && !error && (
        <p>Tạo nhóm ở trang chủ để bắt đầu quản lý công việc.</p>
      )}
      {channel && (
        <>
          <form className="task-create" onSubmit={create}>
            <label>
              Nhiệm vụ mới
              <input
                ref={createInputRef}
                value={title}
                maxLength={160}
                disabled={busy || readOnly || !creationReady}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ví dụ: Hoàn thiện tài liệu thiết kế"
                required
              />
            </label>
            <Button icon="plus" successFlash={createSuccess} type="submit" loading={busy} disabled={busy || readOnly || !title.trim()}>
              Tạo nhiệm vụ
            </Button>
          </form>
          <div className="task-filters">
            <label>
              Người phụ trách
              <select value={assigned} onChange={(event) => setAssigned(event.target.value)}>
                <option value="">Mọi người</option>
                <option value={user?.id}>Của tôi</option>
                {members
                  .filter((m) => m.userId !== user?.id)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Trạng thái
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">Tất cả</option>
                {Object.entries(statuses).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ưu tiên
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
              >
                <option value="">Tất cả</option>
                {Object.entries(priorities).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hạn chót
              <select value={deadline} onChange={(event) => setDeadline(event.target.value)}>
                <option value="">Tất cả</option>
                <option value="overdue">Quá hạn</option>
                <option value="upcoming">Trong 7 ngày</option>
                <option value="none">Chưa có hạn</option>
              </select>
            </label>
            <label className="task-checkbox">
              <input
                type="checkbox"
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
              />
              Đã lưu trữ
            </label>
          </div>
          {loading && <p role="status">Đang tải công việc…</p>}
          {board.truncated && <p>Hiển thị tối đa 500 nhiệm vụ. Dùng bộ lọc để thu hẹp kết quả.</p>}

          {/* Call Center Integration Alert Banner */}
          {ccTickets.length > 0 && (
            <div className="task-callcenter-banner">
              <div>
                <strong>Liên thông Tổng đài:</strong> Đang có {ccTickets.length} phiếu yêu cầu học vụ
                được chuyên viên tạo trực tiếp từ bàn trực Softphone.
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  try {
                    localStorage.removeItem("tdtu_callcenter_tickets");
                    setCcTickets([]);
                    notify(
                      "Đã xử lý tất cả phiếu",
                      "Toàn bộ phiếu tổng đài đã được hoàn tất và lưu trữ.",
                      "info",
                    );
                  } catch {
                    // Storage unavailable: nothing to clear.
                  }
                }}
              >
                Đánh dấu đã hoàn thành
              </Button>
            </div>
          )}

          <div className="task-columns">
            {Object.entries(statuses).map(([key, label]) => {
              const items = board.tasks
                .filter((t) => t.status === key)
                .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
              return (
                <section
                  key={key}
                  className={`task-column ${dropTarget?.status === key ? "is-drop-target" : ""}`}
                  aria-label={label}
                  onDragOver={(event) => {event.preventDefault(); setDropTarget({status:key,before:beforeTaskAt(Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')).map(el => ({id:el.dataset.taskId!,top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})),event.clientY,dragId.current)});}}
                  onDrop={(event) => {
                    event.preventDefault();
                    const task = board.tasks.find((t) => t.id === dragId.current);
                    const before = beforeTaskAt(Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')).map(el => ({id:el.dataset.taskId!,top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})),event.clientY,dragId.current);
                    dragId.current = null;
                    setDropTarget(null);
                    if (task) void move(task, key as TaskItem["status"], before);
                  }}
                >
                  <h3>
                    {label} <span>{items.length + (key === "todo" ? ccTickets.length : 0)}</span>
                  </h3>
                  {key === "todo" &&
                    ccTickets.map((ticket) => (
                      <article key={ticket.id} className="task-card priority-high">
                        <span className="task-card-cc-badge">
                          <Icon name="phone-call" size={12} />
                          {ticket.branch} · MSSV: {ticket.studentId}
                        </span>
                        <div className="task-title" style={{ cursor: "default" }}>
                          {ticket.title}
                        </div>
                        <small style={{ color: "#475569" }}>{ticket.description}</small>
                        <time>
                          Tiếp nhận:{" "}
                          {new Date(ticket.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </article>
                    ))}
                  {!items.length && (key !== "todo" || !ccTickets.length) && (
                    <p className="task-empty">Chưa có công việc</p>
                  )}
                  {items.map((task, index) => (
                    <article
                      key={task.id}
                      className={`task-card priority-${task.priority} ${dropTarget?.before === task.id ? "is-insert-before" : ""}`}
                      data-task-id={task.id}
                      aria-busy={movingIds.has(task.id) || undefined}
                      draggable={!busy && !movingIds.has(task.id) && !readOnly && !archived}
                      onDragEnd={() => {dragId.current=null;setDropTarget(null);}}
                      onDragStart={(event) => {
                        dragId.current = task.id;
                        event.dataTransfer.setData("text/plain", task.id);
                      }}
                    >
                      <button
                        className="task-title"
                        onClick={() => navigate({ ...route, taskId: task.id })}
                      >
                        {task.title}
                      </button>
                      <small>
                        {priorities[task.priority]} · {task.assigneeName ?? "Chưa giao"}
                      </small>
                      {task.meetingSessionId && (
                        <small className="task-origin">
                          <Icon name="video" size={12} /> Từ cuộc họp
                        </small>
                      )}
                      {task.dueAt && (
                        <time dateTime={task.dueAt}>
                          Hạn: {new Date(task.dueAt).toLocaleDateString("vi-VN")}
                        </time>
                      )}
                      {task.checklistTotal > 0 && (
                        <small>
                          Checklist {task.checklistDone}/{task.checklistTotal}
                        </small>
                      )}
                      <label>
                        Chuyển trạng thái
                        <select
                          value={task.status}
                          disabled={busy || movingIds.has(task.id) || readOnly || archived}
                          onChange={(event) =>
                            void move(task, event.target.value as TaskItem["status"])
                          }
                        >
                          {Object.entries(statuses).map(([value, name]) => (
                            <option key={value} value={value}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={index === 0 || busy || movingIds.has(task.id) || readOnly || archived}
                        onClick={() => void move(task, task.status, items[index - 1].id)}
                      >
                        Đưa lên trên
                      </Button>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}
      <AnimatePresence mode="wait" initial={false}>{route.taskId && accessToken && (
        <TaskPanel
          key={route.taskId}
          taskId={route.taskId}
          token={accessToken}
          readOnly={readOnly}
          members={members}
          onClose={() => navigate({ ...route, taskId: undefined })}
          onSaved={() => setBoardRevision((n) => n + 1)}
        />
      )}</AnimatePresence>
    </section>
  );
}

function TaskPanel({
  taskId,
  token,
  readOnly,
  members,
  onClose,
  onSaved,
}: {
  taskId: string;
  token: string;
  readOnly: boolean;
  members: ChannelMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const safe = useMotionSafe();
  const present = useIsPresent();
  const { socket } = useSocket();
  const { route, navigate, user } = useApp();
  const panelRef = usePanelDialog(onClose, true, ".task-panel-scrim");
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{title:string; description:string; body:object} | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [changed, setChanged] = useState(false),
    [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [priority, setPriority] = useState("normal"),
    [assigneeId, setAssigneeId] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [comment, setComment] = useState(""),
    [checklist, setChecklist] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [savedDraft, setSavedDraft, draftReady] = useDraft<{
    version: number;
    title: string;
    description: string;
    priority: string;
    assigneeId: string;
    dueAt: string;
    dirty: boolean;
    comment: string;
    checklist: string;
    file: File | null;
  } | null>(`${user?.id ?? "anonymous"}:task:${taskId}`, null);
  const savedDraftRef = useRef(savedDraft),
    restoredRef = useRef(false);
  savedDraftRef.current = savedDraft;
  const attached = useRef<string | null>(null),
    closeRef = useRef<HTMLButtonElement>(null),
    taskRef = useRef(task),
    dirtyRef = useRef(dirty);
  taskRef.current = task;
  dirtyRef.current = dirty;
  const apply = (data: TaskDetail) => {
    const draft = !restoredRef.current ? savedDraftRef.current : null;
    restoredRef.current = true;
    if (draft) {
      setTask({ ...data, version: draft.version });
      setTitle(draft.title);
      setDescription(draft.description);
      setPriority(draft.priority);
      setAssigneeId(draft.assigneeId);
      setDueAt(draft.dueAt);
      setDirty(draft.dirty);
      setComment(draft.comment);
      setChecklist(draft.checklist);
      setFile(draft.file);
      setChanged(draft.version !== data.version);
      return;
    }
    setTask(data);
    setTitle(data.title);
    setDescription(data.description);
    setPriority(data.priority);
    setAssigneeId(data.assigneeId ?? "");
    setDueAt(
      data.dueAt
        ? new Date(
            new Date(data.dueAt).getTime() - new Date(data.dueAt).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "",
    );
    setDirty(false);
    setChanged(false);
  };
  useEffect(() => {
    if (!task || !draftReady || !restoredRef.current) return;
    setSavedDraft(
      dirty || comment || checklist || file
        ? {
            version: task.version,
            title,
            description,
            priority,
            assigneeId,
            dueAt,
            dirty,
            comment,
            checklist,
            file,
          }
        : null,
    );
  }, [
    task?.version,
    draftReady,
    dirty,
    title,
    description,
    priority,
    assigneeId,
    dueAt,
    comment,
    checklist,
    file,
  ]);
  const reload = async () => {
    try {
      const data = await governanceApi<TaskDetail>(token, `tasks/${taskId}`);
      if (data.channelId !== route.channelId)
        throw new Error("Nhiệm vụ không thuộc bảng trong liên kết.");
      apply(data);
      setError("");
    } catch (reason) {
      setTask(null);
      setError(reason instanceof Error ? reason.message : "Không tải được nhiệm vụ.");
    }
  };
  useEffect(() => {
    let active = true;
    const previous = document.activeElement as HTMLElement | null;
    if (!draftReady) return;
    closeRef.current?.focus();
    const load = () =>
      void governanceApi<TaskDetail>(token, `tasks/${taskId}`)
        .then((data) => {
          if (!active) return;
          if (data.channelId !== route.channelId)
            throw new Error("Liên kết nhiệm vụ không thuộc kênh này.");
          if (dirtyRef.current) {
            setChanged(true);
            return;
          }
          apply(data);
        })
        .catch((reason) => {
          if (active) {
            setTask(null);
            setError(reason.message);
          }
        });
    const event = (data: { taskId: string; version: number }) => {
      if (data.taskId === taskId && data.version > (taskRef.current?.version ?? 0)) load();
    };
    const revoked = () => {
      setTask(null);
      load();
    };
    load();
    socket?.on("task_changed", event);
    socket?.on("connect", load);
    socket?.on("access_revoked", revoked);
    return () => {
      active = false;
      socket?.off("task_changed", event);
      socket?.off("connect", load);
      socket?.off("access_revoked", revoked);
      if (previous?.isConnected) previous.focus();
    };
  }, [taskId, token, route.channelId, socket, draftReady]);
  const patch = async (body: object) => {
    if (!task || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await governanceApi<{ task: TaskDetail }>(token, `tasks/${taskId}`, "PATCH", {
        ...body,
        version: task.version,
      });
      apply(result.task);
      onSaved();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!task || !file || busy) return;
    setBusy(true);
    setProgress(null);
    setError("");
    try {
      attached.current ??= (await uploadAttachmentApi(token, task.channelId, file, setProgress)).id;
      const data = await governanceApi<{ task: TaskDetail }>(token, `tasks/${taskId}`, "PATCH", {
        version: task.version,
        action: "attachment-add",
        attachmentId: attached.current,
      });
      apply(data.task);
      attached.current = null;
      setFile(null);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không gắn được tệp.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const disabled = busy || readOnly || Boolean(task?.archivedAt);
  // Visible reasons for locked controls (a title tooltip is invisible to keyboard and touch).
  const dirtyNoteId = "task-panel-dirty-note";
  const readOnlyNoteId = "task-panel-readonly-note";
  const lockedBy = dirty ? dirtyNoteId : undefined;
  return (
    <>
      <button
        type="button"
        className="task-panel-scrim"
        inert={!present}
        style={present ? undefined : {pointerEvents:"none"}}
        aria-label="Đóng chi tiết nhiệm vụ"
        tabIndex={-1}
        onClick={onClose}
      />
      <motion.aside
        {...safe.panel}
        inert={!present}
        style={present ? undefined : {pointerEvents:"none"}}
        aria-description={dirty ? "Lưu thay đổi trước khi thêm checklist, tệp hoặc bình luận." : undefined}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="task-panel"
        aria-label="Chi tiết nhiệm vụ"
      >
        <header>
          <h2>Chi tiết nhiệm vụ</h2>
          <IconButton ref={closeRef} icon="x" label="Đóng bảng chi tiết" onClick={onClose} />
        </header>
        {error && (
          <p className="task-alert" role="alert">
            {error}
          </p>
        )}
        {changed && (
          <p role="status">
            Nhiệm vụ đã thay đổi. Bản đang sửa được giữ lại; tải lại để lấy phiên bản mới.
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          disabled={busy}
          onClick={() => void reload()}
        >
          Tải lại nhiệm vụ
        </Button>
        {!task && !error && <p role="status">Đang tải…</p>}
        {task && (
          <>
            <small>
              Phiên bản {task.version}
              {task.archivedAt ? " · Đã lưu trữ" : ""}
            </small>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void patch({
                  title,
                  description,
                  priority,
                  assigneeId: assigneeId || null,
                  dueAt: dueAt ? new Date(dueAt).toISOString() : null,
                }).then(() => {
                  // Saving disables the fieldset and then the clean Save button, which drops
                  // focus to <body>; keep keyboard users inside the panel.
                  if (document.activeElement === document.body) panelRef.current?.focus();
                });
              }}
              onChange={() => setDirty(true)}
            >
              <fieldset disabled={disabled}>
                <label>
                  Tiêu đề
                  <input
                    value={title}
                    maxLength={160}
                    required
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  Mô tả
                  <textarea
                    value={description}
                    maxLength={8000}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label>
                  Ưu tiên
                  <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                    {Object.entries(priorities).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Người phụ trách
                  <select
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                  >
                    <option value="">Chưa giao</option>
                    {assigneeId && !members.some((m) => m.userId === assigneeId) && (
                      <option value={assigneeId}>{task.assigneeName} · Đã mất quyền</option>
                    )}
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Hạn chót
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                </label>
                <Button type="submit" disabled={!dirty || disabled}>
                  Lưu thay đổi
                </Button>
              </fieldset>
            </form>
            {task.meetingSessionId && (
              <p className="task-panel-note">
                <Icon name="video" size={13} /> Việc này được giao trong một cuộc họp; xem tổng
                kết cuộc họp trong kênh.
              </p>
            )}
            {task.sourceMessageId && (
              <Button
                variant="secondary"
                size="sm"
                icon="message"
                onClick={() =>
                  navigate({
                    view: "chat",
                    workspaceId: route.workspaceId,
                    channelId: task.channelId,
                    messageId: task.sourceMessageId!,
                  })
                }
              >
                Mở tin nhắn nguồn
              </Button>
            )}
            {dirty && (
              <small id={dirtyNoteId} className="task-panel-note" role="status">
                Bạn có thay đổi chưa lưu. Lưu trước khi thêm checklist, tệp, bình luận hoặc lưu trữ.
              </small>
            )}
            <h3>Checklist</h3>
            {task.checklist.map((item) => (
              <div key={item.id} className="task-checklist-item">
                <label>
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={disabled || dirty}
                    aria-describedby={lockedBy}
                    onChange={() => void patch({ action: "checklist-toggle", itemId: item.id })}
                  />
                  {item.label}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || dirty}
                  title={dirty ? "Lưu thay đổi trước khi bỏ mục checklist." : undefined}
                  aria-describedby={lockedBy}
                  onClick={() => setConfirmation({title:"Bỏ mục", description:`Bỏ mục “${item.label}” khỏi checklist?`, body:{action:"checklist-remove",itemId:item.id}})}
                >
                  Bỏ mục
                </Button>
              </div>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void patch({ action: "checklist-add", label: checklist }).then((ok) => {
                  if (ok) setChecklist("");
                });
              }}
            >
              <label>
                Mục checklist mới
                <input
                  value={checklist}
                  maxLength={200}
                  disabled={disabled}
                  onChange={(event) => setChecklist(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                icon="plus"
                disabled={disabled || dirty || !checklist.trim()}
                title={dirty ? "Lưu thay đổi trước khi thêm checklist." : undefined}
                aria-describedby={lockedBy}
              >
                Thêm mục
              </Button>
            </form>
            <h3>Tệp đính kèm</h3>
            {progress !== null && busy && (
              <p role="status">
                Tải tệp {progress}%{" "}
                <progress max={100} value={progress} aria-label="Tiến độ tải tệp nhiệm vụ" />
              </p>
            )}
            {task.attachments.map((attachment) => (
              <div key={attachment.id}>
                <AttachmentView attachment={attachment} accessToken={token} />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || dirty}
                  title={dirty ? "Lưu thay đổi trước khi gỡ tệp." : undefined}
                  aria-describedby={lockedBy}
                  onClick={() => setConfirmation({title:"Gỡ tệp", description:"Gỡ tệp khỏi nhiệm vụ này? Tệp sẽ không còn xuất hiện trong danh sách đính kèm của nhiệm vụ.",body:{action:"attachment-remove",attachmentId:attachment.id}})}
                >
                  Gỡ tệp
                </Button>
              </div>
            ))}
            <label>
              Chọn tệp
              <input
                type="file"
                disabled={disabled || Boolean(attached.current)}
                onChange={(event) => {
                  attached.current = null;
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
            </label>
            {file && <small>{file.name}</small>}
            <Button
              variant="secondary"
              size="sm"
              icon="upload"
              disabled={disabled || dirty || !file}
              title={dirty ? "Lưu thay đổi trước khi gắn tệp." : undefined}
              aria-describedby={lockedBy}
              loading={busy && progress !== null}
              onClick={() => void upload()}
            >
              Tải và gắn tệp
            </Button>
            <h3>Bình luận</h3>
            {task.comments.length === 100 && <small>Hiển thị 100 bình luận gần nhất.</small>}
            {task.comments.map((item) => (
              <article key={item.id}>
                <strong>{item.authorName}</strong>
                <time>{new Date(item.createdAt).toLocaleString("vi-VN")}</time>
                <p>{item.content}</p>
              </article>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void patch({ action: "comment", content: comment }).then((ok) => {
                  if (ok) setComment("");
                });
              }}
            >
              <label>
                Bình luận mới
                <textarea
                  value={comment}
                  maxLength={4000}
                  disabled={disabled}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                size="sm"
                icon="send"
                disabled={disabled || dirty || !comment.trim()}
                title={dirty ? "Lưu thay đổi trước khi gửi bình luận." : undefined}
                aria-describedby={lockedBy}
              >
                Gửi bình luận
              </Button>
            </form>
            <h3>Lịch sử hoạt động</h3>
            <ol>
              {task.activity.map((item) => (
                <li key={item.id}>
                  {item.actorName} ·{" "}
                  {(
                    {
                      created: "Tạo nhiệm vụ",
                      update: "Cập nhật nhiệm vụ",
                      comment: "Bình luận",
                      "checklist-add": "Thêm checklist",
                      "checklist-toggle": "Đánh dấu checklist",
                      "checklist-remove": "Bỏ checklist",
                      "attachment-add": "Gắn tệp",
                      "attachment-remove": "Gỡ tệp",
                    } as Record<string, string>
                  )[item.action] ?? item.action}
                  <time>{new Date(item.createdAt).toLocaleString("vi-VN")}</time>
                </li>
              ))}
            </ol>
            {readOnly && (
              <small id={readOnlyNoteId} className="task-panel-note">
                Nhóm hoặc kênh đã lưu trữ nên không thể lưu trữ hay khôi phục nhiệm vụ.
              </small>
            )}
            <Button
              variant={task.archivedAt ? "secondary" : "danger"}
              size="sm"
              disabled={busy || readOnly || dirty}
              aria-describedby={readOnly ? readOnlyNoteId : lockedBy}
              onClick={() => task.archivedAt ? void patch({archived:false}) : setConfirmation({title:"Lưu trữ nhiệm vụ",description:"Nhiệm vụ sẽ chuyển sang danh sách đã lưu trữ. Bạn có thể khôi phục từ bộ lọc Đã lưu trữ.",body:{archived:true}})}
            >
              {task.archivedAt ? "Khôi phục nhiệm vụ" : "Lưu trữ nhiệm vụ"}
            </Button>
          </>
        )}
        <AnimatePresence>{confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.title} loading={busy} onClose={() => setConfirmation(null)} onConfirm={() => void patch(confirmation.body).then(ok => {if(ok)setConfirmation(null);})} />}</AnimatePresence>
      </motion.aside>
    </>
  );
}
