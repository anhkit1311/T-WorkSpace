import { useEffect, useState } from "react";
import type { HomeSummary } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { governanceApi } from "./api";
import { Button, ListItem } from "../../shared/ui/Primitives";
import type { IconName } from "../../shared/ui/Icon";
import "./home-priorities.css";

const SAMPLE_TASKS: {
  id: string;
  icon: IconName;
  title: string;
  subtitle: string;
  metaPrimary: string;
  metaSecondary: string;
}[] = [
  {
    id: "sample-task-1",
    icon: "check-square",
    title: "Hoàn thiện giao diện Trang chủ",
    subtitle: "Đồ án tốt nghiệp · Giao bởi Anh Kiệt",
    metaPrimary: "18:00",
    metaSecondary: "Hôm nay",
  },
  {
    id: "sample-task-2",
    icon: "tasks",
    title: "Kiểm thử kết nối WebRTC đa điểm",
    subtitle: "Đồ án tốt nghiệp · Cần làm",
    metaPrimary: "23:59",
    metaSecondary: "08/10",
  },
  {
    id: "sample-task-3",
    icon: "file",
    title: "Viết báo cáo chương 3 kiến trúc",
    subtitle: "Nhóm Nghiên cứu · Đang làm",
    metaPrimary: "17:00",
    metaSecondary: "10/10",
  },
];

const SAMPLE_MEETINGS: {
  id: string;
  icon: IconName;
  title: string;
  subtitle: string;
  metaPrimary: string;
  metaSecondary: string;
}[] = [
  {
    id: "sample-meeting-1",
    icon: "video",
    title: "Họp rà soát tiến độ tuần",
    subtitle: "Đồ án tốt nghiệp · #phong-hop-chinh",
    metaPrimary: "15:30",
    metaSecondary: "Hôm nay",
  },
  {
    id: "sample-meeting-2",
    icon: "calendar",
    title: "Demo tính năng SFU & Kanban",
    subtitle: "Đồ án tốt nghiệp · #ky-thuat",
    metaPrimary: "09:00",
    metaSecondary: "07/10",
  },
];

const SAMPLE_NOTIFICATIONS: {
  id: string;
  icon: IconName;
  title: string;
  subtitle: string;
  metaPrimary: string;
  metaSecondary: string;
}[] = [
  {
    id: "sample-notif-1",
    icon: "bell",
    title: "Anh Kiệt đã nhắc đến bạn",
    subtitle: "#tong-quan · Đồ án tốt nghiệp",
    metaPrimary: "Mới",
    metaSecondary: "15:50",
  },
  {
    id: "sample-notif-2",
    icon: "check-square",
    title: "Công việc mới được giao",
    subtitle: "Kiểm thử kết nối WebRTC · Đồ án",
    metaPrimary: "Hôm nay",
    metaSecondary: "10:33",
  },
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
              <>
                <p className="home-priority-empty">Chưa có công việc cần xử lý.</p>
                <ul className="home-priority-list" aria-label="Xem trước danh sách công việc mẫu">
                  {SAMPLE_TASKS.map((item) => (
                    <li key={item.id} className="home-priority-list-item">
                      <ListItem
                        icon={item.icon}
                        title={item.title}
                        subtitle={item.subtitle}
                        metaPrimary={item.metaPrimary}
                        metaSecondary={item.metaSecondary}
                        onClick={() => navigate({ view: "tasks" })}
                      />
                    </li>
                  ))}
                </ul>
              </>
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
              <>
                <p className="home-priority-empty">Chưa có cuộc họp được lên lịch.</p>
                <ul className="home-priority-list" aria-label="Xem trước lịch họp mẫu">
                  {SAMPLE_MEETINGS.map((item) => (
                    <li key={item.id} className="home-priority-list-item">
                      <ListItem
                        icon={item.icon}
                        title={item.title}
                        subtitle={item.subtitle}
                        metaPrimary={item.metaPrimary}
                        metaSecondary={item.metaSecondary}
                        onClick={() => navigate({ view: "meetings" })}
                      />
                    </li>
                  ))}
                </ul>
              </>
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
              <strong className="home-notification-count">{summary.unreadNotifications}</strong>
              <p>
                {summary.unreadNotifications ? "thông báo chưa đọc" : "Bạn đã xem hết thông báo."}
              </p>
            </div>
            <ul className="home-priority-list" aria-label="Xem trước thông báo mẫu">
              {SAMPLE_NOTIFICATIONS.map((item) => (
                <li key={item.id} className="home-priority-list-item">
                  <ListItem
                    icon={item.icon}
                    title={item.title}
                    subtitle={item.subtitle}
                    metaPrimary={item.metaPrimary}
                    metaSecondary={item.metaSecondary}
                    onClick={() => navigate({ view: "notifications" })}
                  />
                </li>
              ))}
            </ul>
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
