import { useEffect, useState } from "react";
import type { WorkspaceItem } from "@doan/shared";
import { governanceApi } from "../workspaces/api";
import { getWorkspacesApi } from "../chat/api";
import { Button } from "../../shared/ui/Primitives";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import "../workspaces/workspace-admin.css";

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

export function NotificationsPage() {
  const { accessToken, navigate } = useApp();
  const { socket } = useSocket();
  const [page, setPage] = useState<NotificationPage>({ items: [], unreadCount: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(false);
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
    <section className="workspace-admin">
      <header>
        <h1>Thông báo ({page.unreadCount} chưa đọc)</h1>
        <p>
          Nhắc tên và phản hồi trong chủ đề bạn tham gia. Nội dung chỉ hiển thị khi bạn còn quyền
          đọc kênh.
        </p>
        <div className="admin-actions">
          <Button variant="secondary" onClick={() => setUnread((value) => !value)}>
            {unread ? "Xem tất cả" : "Chỉ chưa đọc"}
          </Button>
          <Button disabled={busy || !page.unreadCount} onClick={() => void mark()}>
            Đánh dấu tất cả đã đọc
          </Button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <section>
        <h2>Tùy chọn theo nhóm</h2>
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
          Tắt thông báo mới của nhóm này
        </label>
      </section>
      <section>
        {loading && <p role="status">Đang tải thông báo…</p>}
        {!loading && !page.items.length && <p>Không có thông báo phù hợp.</p>}
        <ul>
          {page.items.map((item) => (
            <li key={item.id}>
              <button
                className="notification-item"
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
              >
                <strong>
                  {!item.readAt ? "Chưa đọc · " : ""}
                  {item.kind === "mention" ? "Nhắc tên" : "Phản hồi chủ đề"} · {item.authorName}
                </strong>
                <span>
                  #{item.channelName} · {item.content}
                </span>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString("vi-VN")}
                </time>
              </button>
              {!item.readAt && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void mark(item.id)}
                >
                  Đã đọc
                </Button>
              )}
            </li>
          ))}
        </ul>
        {page.hasMore && (
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
        )}
      </section>
    </section>
  );
}
