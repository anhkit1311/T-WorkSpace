import { useEffect, useState } from "react";
import type { HomeSummary } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { governanceApi } from "./api";
import { Button, ListItem } from "../../shared/ui/Primitives";
import "./home-priorities.css";

// new_message / channel_read keep the unread-message count live, not only mentions.
const REFRESH_EVENTS = [
  "task_changed",
  "notifications_changed",
  "new_message",
  "channel_read",
  "connect",
  "access_revoked",
];

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
    for (const event of REFRESH_EVENTS) socket?.on(event, refresh);
    return () => {
      active = false;
      window.clearTimeout(timer);
      for (const event of REFRESH_EVENTS) socket?.off(event, refresh);
    };
  }, [accessToken, socket, revision]);
  return (
    <section className="home-priorities" aria-label="Việc cần quan tâm">
      <header className="home-priorities__header">
        <div>
          <span className="editorial-tag editorial-tag--stacked">Nhiệm vụ & Sự kiện</span>
          <h2>Tiếp tục công việc</h2>
        </div>
        <Button
          variant="text"
          className="home-priorities__view-all"
          onClick={() => navigate({ view: "tasks" })}
        >
          Xem tất cả
        </Button>
      </header>
      {error && (
        <p role="alert" className="home-priorities-error">
          {error}{" "}
          <button type="button" onClick={() => setRevision((old) => old + 1)}>
            Thử lại
          </button>
        </p>
      )}
      {!summary && !error && (
        <p role="status" className="home-priorities-loading">
          Đang tải công việc và lịch họp…
        </p>
      )}
      {summary && (
        <div className="home-priority-grid">
          <article className="home-priority-card">
            <h3>Công việc được giao</h3>
            {summary.tasks.length === 0 ? (
              <p className="home-priority-empty">Chưa có công việc cần xử lý.</p>
            ) : (
              <ul className="home-priority-list">
                {summary.tasks.map((task) => {
                  const dueDate = task.dueAt ? new Date(task.dueAt) : null;
                  const metaPrimary = dueDate
                    ? dueDate.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
                    : task.status === "doing"
                      ? "Đang làm"
                      : "Cần làm";
                  const metaSecondary = dueDate
                    ? dueDate.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })
                    : "Không hạn";
                  return (
                    <li key={task.id} className="home-priority-list-item">
                      <ListItem
                        icon="check-square"
                        title={task.title}
                        subtitle={`#${task.channelName} · ${task.status === "doing" ? "Đang làm" : "Cần làm"}`}
                        metaPrimary={metaPrimary}
                        metaSecondary={metaSecondary}
                        onClick={() =>
                          navigate({
                            view: "tasks",
                            workspaceId: task.workspaceId,
                            channelId: task.channelId,
                            taskId: task.id,
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              variant="secondary"
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
                {summary.meetings.map((meeting) => {
                  const startDate = new Date(meeting.startsAt);
                  return (
                    <li key={meeting.id} className="home-priority-list-item">
                      <ListItem
                        icon="video"
                        title={meeting.title}
                        subtitle={`Phòng #${meeting.roomName}`}
                        metaPrimary={startDate.toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        metaSecondary={startDate.toLocaleDateString("vi-VN", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                        onClick={() =>
                          navigate({
                            view: "meetings",
                            workspaceId: meeting.workspaceId,
                            channelId: meeting.roomId,
                            scheduleId: meeting.id,
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              variant="secondary"
              icon="calendar"
              onClick={() => navigate({ view: "meetings" })}
            >
              Mở lịch họp
            </Button>
          </article>
          <article className="home-priority-card home-priority-card--notif">
            <h3>Thông báo</h3>
            <div className="home-priority-notif-body">
              <strong className="home-notification-count">
                {summary.unreadNotifications + summary.unreadMessages}
              </strong>
              {summary.unreadNotifications + summary.unreadMessages ? (
                <p>
                  {summary.unreadMessages} tin nhắn chưa đọc · {summary.unreadNotifications} lượt
                  nhắc tên/trả lời
                </p>
              ) : (
                <p>Bạn đã xem hết tin nhắn và thông báo.</p>
              )}
            </div>
            {summary.unreadChannels.length > 0 && (
              <ul className="home-unread-channels" aria-label="Kênh có tin nhắn chưa đọc">
                {summary.unreadChannels.map((channel) => (
                  <li key={channel.channelId}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate({
                          view: "chat",
                          workspaceId: channel.workspaceId,
                          channelId: channel.channelId,
                        })
                      }
                    >
                      <span>
                        #{channel.channelName}
                        <small>{channel.workspaceName}</small>
                      </span>
                      <b aria-label={`${channel.unreadCount} tin chưa đọc`}>
                        {channel.unreadCount}
                      </b>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="secondary"
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
