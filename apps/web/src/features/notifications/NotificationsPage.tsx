import { useEffect, useRef, useState } from "react";
import type { WorkspaceItem } from "@doan/shared";
import { governanceApi } from "../workspaces/api";
import { getWorkspacesApi } from "../chat/api";
import { Button, Chip, ListItem } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import "../workspaces/workspace-admin.css";
import "./notifications.css";

export interface NotificationItem {
  id: string;
  kind: "mention" | "thread";
  readAt: string | null;
  createdAt: string;
  messageId: string;
  content: string;
  threadRootId: string | null;
  channelId: string;
  channelName: string;
  workspaceId: string;
  authorName: string;
}
export interface NotificationPage {
  items: NotificationItem[];
  unreadCount: number;
  hasMore: boolean;
}

function formatNotificationTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { time: "—", day: "" };
  return {
    time: date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    day: date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}

export function NotificationsPage() {
  const { accessToken, navigate } = useApp();
  const { socket } = useSocket();
  const [page, setPage] = useState<NotificationPage>({ items: [], unreadCount: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(false);
  // The list sits under the header and group options; offer a jump when there is news.
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const { reduced } = useMotionSafe();
  const jumpToList = () => {
    const heading = listHeadingRef.current;
    if (!heading) return;
    heading.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
  };
  const [groups, setGroups] = useState<WorkspaceItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const refresh = () => {
      setLoading(true);
      void governanceApi<NotificationPage>(
        accessToken,
        `notifications${unread ? "?unread=true" : ""}`,
      )
        .then((data) => {
          if (active) {
            setPage(data);
            setError("");
          }
        })
        .catch((reason) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "Không tải được thông báo.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    refresh();
    socket?.on("notifications_changed", refresh);
    socket?.on("connect", refresh);
    socket?.on("access_revoked", refresh);
    void getWorkspacesApi(accessToken)
      .then((items) => {
        if (active) {
          setGroups(items);
          setWorkspaceId((old) =>
            items.some((item) => item.id === old) ? old : (items[0]?.id ?? ""),
          );
        }
      })
      .catch(reason => { if(active) setError(reason instanceof Error ? reason.message : "Không tải được nhóm."); });
    return () => {
      active = false;
      socket?.off("notifications_changed", refresh);
      socket?.off("connect", refresh);
      socket?.off("access_revoked", refresh);
    };
  }, [accessToken, unread, socket]);
  useEffect(() => {
    if (!accessToken || !workspaceId) return;
    let active = true;
    void governanceApi<{ muted: boolean }>(accessToken, `workspaces/${workspaceId}/notifications`)
      .then((data) => {
        if (active) setMuted(data.muted);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [accessToken, workspaceId]);
  const mark = async (id?: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await governanceApi(accessToken, "notifications/read", "POST", id ? { id } : {});
      setPage((old) => ({
        ...old,
        items: old.items.map((item) =>
          !id || item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
        unreadCount: id ? Math.max(0, old.unreadCount - 1) : 0,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không cập nhật được.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workspace-admin notifications-page" aria-label="Thông báo">
      <header>
        <div className="notifications-page__title-row">
          <h1>Thông báo</h1>
          <Chip icon="bell">
            {page.unreadCount > 0 ? `${page.unreadCount} chưa đọc` : "Đã xem hết"}
          </Chip>
        </div>
        <p>
          Nhắc tên và phản hồi trong chủ đề bạn tham gia. Nội dung chỉ hiển thị khi bạn còn quyền
          đọc kênh.
        </p>
        <div className="admin-actions">
          <Button
            variant="primary"
            icon="check"
            disabled={busy || !page.unreadCount}
            onClick={() => void mark()}
          >
            Đánh dấu tất cả đã đọc
          </Button>
          <Button
            variant="secondary"
            icon="filter"
            aria-pressed={unread}
            onClick={() => setUnread((value) => !value)}
          >
            {unread ? "Xem tất cả" : "Chỉ chưa đọc"}
          </Button>
          {page.unreadCount > 0 && page.items.length > 0 && (
            <Button
              variant="text"
              icon="chevron-down"
              aria-controls="notification-list"
              onClick={jumpToList}
            >
              Xem danh sách
            </Button>
          )}
        </div>
      </header>
      {error && (
        <p className="inline-alert" role="alert">
          {error}
        </p>
      )}
      <section>
        <div className="notifications-section-head">
          <h2>Tùy chọn theo nhóm</h2>
          {groups.length > 0 && (
            <Chip icon="users">{groups.length} nhóm đang tham gia</Chip>
          )}
        </div>
        <label>
          Nhóm
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {!groups.length && <option value="">Chưa có nhóm</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={muted}
            disabled={!workspaceId || busy}
            onChange={(event) => {
              const value = event.target.checked;
              setBusy(true);
              void governanceApi(accessToken!, `workspaces/${workspaceId}/notifications`, "POST", {
                muted: value,
              })
                .then(() => setMuted(value))
                .catch((reason) => setError(reason.message))
                .finally(() => setBusy(false));
            }}
          />
          <span>Tắt thông báo mới của nhóm này</span>
        </label>
      </section>
      <section id="notification-list" aria-label="Danh sách thông báo">
        <div className="notifications-section-head">
          <h2 ref={listHeadingRef} tabIndex={-1}>
            {unread ? "Thông báo chưa đọc" : "Tất cả thông báo"}
          </h2>
          <Button
            variant="text"
            onClick={() => setUnread(false)}
          >
            Xem tất cả
          </Button>
        </div>
        {loading && (
          <p role="status" className="loading-note">
            Đang tải thông báo…
          </p>
        )}
        {!loading && !page.items.length && (
          <div className="state-card state-card--compact notifications-empty-card">
            <span className="state-card__icon">
              <Icon name="bell" size={22} />
            </span>
            <h3>{unread ? "Không còn thông báo chưa đọc" : "Chưa có thông báo"}</h3>
            <p>
              Khi ai đó nhắc tên bạn hoặc phản hồi trong chủ đề bạn tham gia, thông báo sẽ ở đây.
            </p>
          </div>
        )}
        {page.items.length > 0 && (
          <div className="nexo-list-group notification-list" role="list">
            {page.items.map((item) => {
              const { time, day } = formatNotificationTime(item.createdAt);
              return (
                <div
                  key={item.id}
                  role="listitem"
                  className={`notification-row ${item.readAt ? "" : "is-unread"}`}
                >
                  <ListItem
                    icon={item.kind === "mention" ? "at-sign" : "messages"}
                    title={
                      <>
                        {item.authorName}{" "}
                        <span className="notification-kind">
                          {item.kind === "mention" ? "đã nhắc tên bạn" : "đã phản hồi trong chủ đề"}
                        </span>
                        {!item.readAt && <span className="sr-only"> (chưa đọc)</span>}
                      </>
                    }
                    subtitle={
                      <>
                        <b>#{item.channelName}</b> · {item.content}
                      </>
                    }
                    metaPrimary={time}
                    metaSecondary={day}
                    onClick={() => {
                      void mark(item.id);
                      navigate({
                        view: "chat",
                        workspaceId: item.workspaceId,
                        channelId: item.channelId,
                        messageId: item.threadRootId ?? item.messageId,
                        threadId: item.threadRootId ?? undefined,
                      });
                    }}
                  />
                  {!item.readAt && (
                    <Button
                      variant="text"
                      icon="check"
                      disabled={busy}
                      onClick={() => void mark(item.id)}
                    >
                      Đã đọc
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {page.hasMore && (
          <div className="notifications-more">
            <Button
              disabled={loading}
              variant="secondary"
              onClick={() => {
                setLoading(true);
                void governanceApi<NotificationPage>(
                  accessToken!,
                  `notifications?before=${page.items.at(-1)!.id}${unread ? "&unread=true" : ""}`,
                )
                  .then((next) =>
                    setPage((old) => ({
                      ...next,
                      items: [
                        ...old.items,
                        ...next.items.filter(
                          (item) => !old.items.some((other) => other.id === item.id),
                        ),
                      ],
                    })),
                  )
                  .catch((reason) => setError(reason.message))
                  .finally(() => setLoading(false));
              }}
            >
              Tải thông báo cũ
            </Button>
          </div>
        )}
      </section>
    </section>
  );
}
