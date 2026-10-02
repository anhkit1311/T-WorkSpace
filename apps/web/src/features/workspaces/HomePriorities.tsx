import { useEffect, useState } from "react";
import type { HomeSummary } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { governanceApi } from "./api";
import { Button } from "../../shared/ui/Primitives";
import "./home-priorities.css";
export function HomePriorities() {
  const { accessToken, navigate } = useApp(),
    { socket } = useSocket();
  const [summary, setSummary] = useState<HomeSummary | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!accessToken) return;
    let active = true,
      generation = 0;
    let timer: number | undefined;
    const load = () => {
      const current = ++generation;
      void governanceApi<HomeSummary>(accessToken, "home")
        .then((data) => {
          if (active && current === generation) {
            setSummary(data);
            setError("");
          }
        })
        .catch((reason) => {
          if (active) setError(reason.message);
        });
    };
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 200);
    };
    load();
    for (const event of ["task_changed", "notifications_changed", "connect", "access_revoked"])
      socket?.on(event, refresh);
    return () => {
      active = false;
      window.clearTimeout(timer);
      for (const event of ["task_changed", "notifications_changed", "connect", "access_revoked"])
        socket?.off(event, refresh);
    };
  }, [accessToken, socket, revision]);
  return (
    <section className="home-priorities" aria-label="Việc cần quan tâm">
      <header className="home-priorities__header">
        <div>
          <span className="editorial-tag" style={{ display: "block", marginBottom: "4px" }}>
            Nhiệm vụ & Sự kiện
          </span>
          <h2>Tiếp tục công việc</h2>
        </div>
        <span className="home-priorities__subtitle">Những việc dành cho bạn</span>
      </header>
      {error && (
        <p role="alert" className="home-priorities-error">
          {error} <button type="button" onClick={() => setRevision((old) => old + 1)}>Thử lại</button>
        </p>
      )}
      {!summary && !error && <p role="status" className="home-priorities-loading">Đang tải công việc và lịch họp…</p>}
      {summary && (
        <div className="home-priority-grid">
          <article className="home-priority-card">
            <h3>Công việc được giao</h3>
            {summary.tasks.length === 0 ? (
              <p className="home-priority-empty">Chưa có công việc cần xử lý.</p>
            ) : (
              <ul className="home-priority-list">
                {summary.tasks.map((task) => (
                  <li key={task.id} className="home-priority-list-item">
                    <button
                      type="button"
                      className="home-priority-item-btn"
                      onClick={() =>
                        navigate({
                          view: "tasks",
                          workspaceId: task.workspaceId,
                          channelId: task.channelId,
                          taskId: task.id,
                        })
                      }
                    >
                      <strong className="home-priority-item-title">{task.title}</strong>
                      <div className="home-priority-meta-row">
                        <span className="home-priority-pill home-priority-pill--channel">#{task.channelName}</span>
                        <span className={`home-priority-pill home-priority-pill--${task.status}`}>
                          {task.status === "doing" ? "Đang làm" : "Cần làm"}
                        </span>
                        {task.dueAt && (
                          <span className={`home-priority-pill ${Date.parse(task.dueAt) < Date.now() ? "home-priority-pill--overdue" : "home-priority-pill--due"}`}>
                            {Date.parse(task.dueAt) < Date.now() ? "Quá hạn: " : "Hạn: "}
                            {new Date(task.dueAt).toLocaleDateString("vi-VN")}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="tasks"
              onClick={() => navigate({ view: "tasks" })}
            >
              Xem bảng công việc
            </Button>
          </article>
          <article className="home-priority-card">
            <h3>Lịch họp sắp tới</h3>
            {summary.meetings.length === 0 ? (
              <p className="home-priority-empty">Chưa có cuộc họp được lên lịch.</p>
            ) : (
              <ul className="home-priority-list">
                {summary.meetings.map((meeting) => (
                  <li key={meeting.id} className="home-priority-list-item">
                    <button
                      type="button"
                      className="home-priority-item-btn"
                      onClick={() =>
                        navigate({
                          view: "meetings",
                          workspaceId: meeting.workspaceId,
                          channelId: meeting.roomId,
                          scheduleId: meeting.id,
                        })
                      }
                    >
                      <strong className="home-priority-item-title">{meeting.title}</strong>
                      <div className="home-priority-meta-row">
                        <span className="home-priority-pill home-priority-pill--time">
                          {new Date(meeting.startsAt).toLocaleString("vi-VN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                        <span className="home-priority-pill home-priority-pill--channel">
                          {meeting.roomName}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="calendar"
              onClick={() => navigate({ view: "meetings" })}
            >
              Mở lịch họp
            </Button>
          </article>
          <article className="home-priority-card home-priority-card--notif">
            <h3>Thông báo</h3>
            <div className="home-priority-notif-body">
              <strong className="home-notification-count">{summary.unreadNotifications}</strong>
              <p>
                {summary.unreadNotifications ? "thông báo chưa đọc" : "Bạn đã xem hết thông báo."}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon="bell"
              onClick={() => navigate({ view: "notifications" })}
            >
              Xem thông báo
            </Button>
          </article>
        </div>
      )}
    </section>
  );
}
