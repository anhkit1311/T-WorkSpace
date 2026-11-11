import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AnnouncementCategory,
  CreateAnnouncementInput,
  HomeSummary,
  PortalAnnouncement,
} from "@doan/shared";
import { governanceApi } from "../workspaces/api";
import { Avatar, ConfirmDialog, PageHeader } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import type { AppRoute } from "../../app/navigation";
import { useSocket } from "../../app/providers/SocketContext";
import {
  getAnnouncementsApi,
  createAnnouncementApi,
  updateAnnouncementApi,
  deleteAnnouncementApi,
  getPublishersApi,
} from "../announcements/api";
import { AnnouncementDetailModal } from "../announcements/AnnouncementDetailModal";
import {
  AnnouncementComposer,
  CATEGORIES,
  CATEGORY_META,
  distinctBadge,
  formatStamp,
} from "../announcements/AnnouncementComposer";
import { PublisherManagementModal } from "../announcements/PublisherManagementModal";
import "./notifications.css";

export interface NotificationItem {
  id: string;
  kind: "mention" | "thread" | "direct" | "meeting" | "course";
  readAt: string | null;
  createdAt: string;
  /** Chat notifications point at a message; meeting and course ones carry title + link instead. */
  messageId: string | null;
  content: string;
  threadRootId: string | null;
  channelId: string | null;
  channelName: string | null;
  workspaceId: string | null;
  authorName: string | null;
  title: string | null;
  link: AppRoute | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  unreadCount: number;
  hasMore: boolean;
}

type Kind = NotificationItem["kind"];
type InboxFilter = "all" | "unread" | Kind;

const KINDS: { key: Kind; label: string; icon: IconName; action: string }[] = [
  { key: "mention", label: "Nhắc tên", icon: "at-sign", action: "Trả lời" },
  { key: "thread", label: "Trả lời luồng", icon: "messages", action: "Trả lời" },
  { key: "direct", label: "Tin nhắn riêng", icon: "message", action: "Mở" },
  { key: "meeting", label: "Họp", icon: "video", action: "Mở họp" },
  { key: "course", label: "Khóa học", icon: "graduation-cap", action: "Mở khóa học" },
];
const KIND = Object.fromEntries(KINDS.map((kind) => [kind.key, kind])) as Record<
  Kind,
  (typeof KINDS)[number]
>;

const ROLE_LABEL: Record<string, string> = {
  system_admin: "Quản trị hệ thống",
  unit_admin: "Quản trị đơn vị",
  unit_head: "Trưởng đơn vị",
  lecturer: "Giảng viên",
  publisher: "Được cấp quyền đăng",
  workspace_admin: "Quản trị nhóm",
};

const DAY = 86_400_000;

function dayGroup(iso: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  return at >= start.getTime() ? "Hôm nay" : at >= start.getTime() - DAY ? "Hôm qua" : "Trước đó";
}

function timeLabel(iso: string) {
  const date = new Date(iso);
  return dayGroup(iso) === "Hôm nay"
    ? date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Items arrive newest first, so groups come out in Hôm nay → Hôm qua → Trước đó order. */
function byDay<T extends { createdAt: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = dayGroup(item.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups];
}

const badgeTone = (badge: string) =>
  badge === "Khẩn" ? "is-urgent" : badge === "Quan trọng" ? "is-important" : "is-new";

export function NotificationsPage() {
  const { accessToken, navigate, notify, user } = useApp();
  const { socket } = useSocket();

  const [tab, setTab] = useState<"board" | "inbox" | null>(null);

  // Portal announcements
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [annLoaded, setAnnLoaded] = useState(false);
  const [annError, setAnnError] = useState("");
  const [annTick, setAnnTick] = useState(0);
  const [canPublish, setCanPublish] = useState(false);
  const [role, setRole] = useState("student");
  const [publisherCount, setPublisherCount] = useState<number | null>(null);
  const [category, setCategory] = useState<"all" | AnnouncementCategory>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ item: PortalAnnouncement | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<PortalAnnouncement | null>(null);
  const [publishersOpen, setPublishersOpen] = useState(false);
  const [removing, setRemoving] = useState<PortalAnnouncement | null>(null);

  // Personal inbox
  const [page, setPage] = useState<NotificationPage>({ items: [], unreadCount: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [unreadChannels, setUnreadChannels] = useState<HomeSummary["unreadChannels"]>([]);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");

  const reloadAnnouncements = () => setAnnTick((tick) => tick + 1);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    getAnnouncementsApi(accessToken)
      .then((res) => {
        if (!active) return;
        setAnnouncements(res.items);
        setCanPublish(res.canPublish);
        setRole(res.role);
        setAnnError("");
      })
      .catch((reason) => {
        if (active)
          setAnnError(
            reason instanceof Error ? reason.message : "Không thể tải danh sách thông báo.",
          );
      })
      .finally(() => {
        if (active) setAnnLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [accessToken, annTick]);

  useEffect(() => {
    if (!socket) return;
    socket.on("announcements_changed", reloadAnnouncements);
    return () => {
      socket.off("announcements_changed", reloadAnnouncements);
    };
  }, [socket]);

  useEffect(() => {
    if (!accessToken || !canPublish) return;
    let active = true;
    getPublishersApi(accessToken)
      .then((res) => active && setPublisherCount(res.publishers.length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accessToken, canPublish, annTick]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    let timer: number | undefined;
    const load = () =>
      void governanceApi<HomeSummary>(accessToken, "home")
        .then((data) => {
          if (active) setUnreadChannels(data.unreadChannels);
        })
        .catch(() => undefined);
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 200);
    };
    load();
    for (const event of ["new_message", "channel_read", "connect"]) socket?.on(event, refresh);
    return () => {
      active = false;
      window.clearTimeout(timer);
      for (const event of ["new_message", "channel_read", "connect"]) socket?.off(event, refresh);
    };
  }, [accessToken, socket]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const refresh = () => {
      setLoading(true);
      void governanceApi<NotificationPage>(accessToken, "notifications")
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
    return () => {
      active = false;
      socket?.off("notifications_changed", refresh);
      socket?.off("connect", refresh);
      socket?.off("access_revoked", refresh);
    };
  }, [accessToken, socket]);

  // People who cannot publish reach this page from the bell, so they land on their own inbox.
  const view = tab ?? (annLoaded && !canPublish ? "inbox" : "board");
  const canGrant = role === "system_admin" || role === "unit_admin" || canPublish;

  /** Server order (pinned first, then newest) decides the home page's featured slot. */
  const featured = announcements[0] ?? null;
  const sorted = useMemo(
    () => [...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [announcements],
  );
  const filtered = sorted.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (mineOnly && item.authorId !== user?.id) return false;
    const q = query.trim().toLowerCase();
    return (
      !q ||
      [item.title, item.summary, item.authorName, item.authorTitle ?? "", item.scope].some((text) =>
        text.toLowerCase().includes(q),
      )
    );
  });
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const urgent = sorted.filter((item) => item.category === "urgent");
  const weekCount = sorted.filter(
    (item) => Date.now() - new Date(item.createdAt).getTime() < 7 * DAY,
  ).length;
  const pinnedTop = featured?.pinned ? featured : null;

  const save = async (input: CreateAnnouncementInput) => {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      const editing = composing?.item;
      const res = editing
        ? await updateAnnouncementApi(accessToken, editing.id, input)
        : await createAnnouncementApi(accessToken, input);
      notify(
        editing ? "Đã cập nhật thông báo" : "Đã đăng thông báo",
        editing ? res.item.title : "Tin đã lên Bảng tin của mọi tài khoản.",
        "success",
      );
      setComposing(null);
      setSelectedId(res.item.id);
      setCategory("all");
      reloadAnnouncements();
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (item: PortalAnnouncement) => {
    setRemoving(null);
    if (!accessToken) return;
    try {
      await deleteAnnouncementApi(accessToken, item.id);
      notify("Đã xóa thông báo", item.title, "info");
      reloadAnnouncements();
    } catch (reason) {
      notify(
        "Không xóa được",
        reason instanceof Error ? reason.message : "Thử lại sau.",
        "warning",
      );
    }
  };

  const togglePin = async (item: PortalAnnouncement) => {
    if (!accessToken) return;
    try {
      await updateAnnouncementApi(accessToken, item.id, { pinned: !item.pinned });
      notify(item.pinned ? "Đã bỏ ghim" : "Đã ghim lên đầu Trang chủ", item.title, "info");
      reloadAnnouncements();
    } catch (reason) {
      notify(
        "Không cập nhật được ghim",
        reason instanceof Error ? reason.message : "Thử lại sau.",
        "warning",
      );
    }
  };

  const pick = (item: PortalAnnouncement) => {
    setSelectedId(item.id);
    // The preview column is hidden on narrow screens; open the full text instead.
    if (window.matchMedia("(max-width: 1100px)").matches) setDetail(item);
  };

  const markAllRead = async () => {
    if (!accessToken) return;
    await governanceApi(accessToken, "notifications/read", "POST", {});
    setPage((prev) => ({
      ...prev,
      unreadCount: 0,
      items: prev.items.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    }));
  };

  const openNote = (item: NotificationItem) => {
    if (!item.readAt && accessToken) {
      void governanceApi(accessToken, "notifications/read", "POST", { id: item.id }).catch(
        () => undefined,
      );
      setPage((prev) => ({
        ...prev,
        unreadCount: Math.max(0, prev.unreadCount - 1),
        items: prev.items.map((note) =>
          note.id === item.id ? { ...note, readAt: new Date().toISOString() } : note,
        ),
      }));
    }
    if (item.link) navigate(item.link);
    else if (item.workspaceId && item.channelId && item.messageId)
      navigate({
        view: "chat",
        workspaceId: item.workspaceId,
        channelId: item.channelId,
        messageId: item.messageId,
      });
  };

  const loadMore = async () => {
    const last = page.items.at(-1);
    if (!accessToken || !last) return;
    setLoadingMore(true);
    try {
      const next = await governanceApi<NotificationPage>(
        accessToken,
        `notifications?before=${last.id}`,
      );
      setPage((prev) => ({ ...next, items: [...prev.items, ...next.items] }));
    } catch (reason) {
      notify(
        "Không tải thêm được",
        reason instanceof Error ? reason.message : "Thử lại sau.",
        "warning",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  if (composing)
    return (
      <div className="nf-page">
        <AnnouncementComposer
          initial={composing.item}
          featured={featured}
          authorName={user?.displayName ?? ""}
          authorRole={ROLE_LABEL[role] ?? ""}
          submitting={submitting}
          onCancel={() => setComposing(null)}
          onSubmit={save}
        />
      </div>
    );

  const notes = page.items.filter((item) =>
    inboxFilter === "all"
      ? true
      : inboxFilter === "unread"
        ? !item.readAt
        : item.kind === inboxFilter,
  );
  const latestNews = [
    ...urgent.slice(0, 1),
    ...sorted.filter((item) => item.category !== "urgent"),
  ].slice(0, 2);
  const unreadMessages = unreadChannels.reduce((sum, channel) => sum + channel.unreadCount, 0);

  return (
    <div className="nf-page">
      <PageHeader
        className="nf-head"
        title="Thông báo"
        meta={
          view === "board"
            ? "Bảng tin toàn trường, cập nhật tức thì"
            : "Của riêng bạn: nhắc tên, tin riêng, họp, khóa học"
        }
      >
        <div className="nf-seg" role="group" aria-label="Khu vực">
          <button type="button" aria-pressed={view === "board"} onClick={() => setTab("board")}>
            {canPublish ? "Bảng tin đã đăng" : "Bảng tin trường"}{" "}
            <small>{announcements.length}</small>
          </button>
          <button type="button" aria-pressed={view === "inbox"} onClick={() => setTab("inbox")}>
            Hộp thông báo của tôi{" "}
            {page.unreadCount > 0 && <small className="is-hot">{page.unreadCount}</small>}
          </button>
        </div>
        {view === "board" ? (
          <>
            {canGrant && (
              <button type="button" className="nf-btn" onClick={() => setPublishersOpen(true)}>
                <Icon name="users" size={15} />
                Phân quyền đăng
              </button>
            )}
            {canPublish && (
              <button
                type="button"
                className="nf-btn is-primary"
                onClick={() => setComposing({ item: null })}
              >
                <Icon name="plus" size={15} />
                Đăng thông báo
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="nf-btn"
            disabled={!page.unreadCount}
            onClick={() => void markAllRead()}
          >
            <Icon name="check" size={15} />
            Đánh dấu đã đọc tất cả
          </button>
        )}
      </PageHeader>

      {view === "board" ? (
        <>
          <section className="nf-rack nf-summary" aria-label="Tóm tắt bảng tin">
            <div className="nf-unit">
              <span className="nf-unit__label">Đã đăng</span>
              <b className="nf-big">{announcements.length}</b>
              <span className="nf-unit__sub">{weekCount} tin trong 7 ngày qua</span>
            </div>
            <div className={`nf-unit${urgent.length ? " is-alert" : ""}`}>
              <span className="nf-unit__label">
                <span className="nf-led is-red" />
                Tin khẩn
              </span>
              <b className="nf-big">{urgent.length}</b>
              <span className="nf-unit__sub">{urgent[0]?.title ?? "Không có tin khẩn"}</span>
            </div>
            <div className="nf-unit is-wide">
              <span className="nf-unit__label">
                <span className="nf-led is-amber" />
                Đang ghim ở đầu Trang chủ
              </span>
              {pinnedTop ? (
                <div className="nf-pinned">
                  <span className="nf-chip is-dark">{CATEGORY_META[pinnedTop.category].short}</span>
                  <b>{pinnedTop.title}</b>
                  {pinnedTop.canManage && (
                    <button
                      type="button"
                      className="nf-btn is-dark is-sm"
                      onClick={() => void togglePin(pinnedTop)}
                    >
                      Bỏ ghim
                    </button>
                  )}
                </div>
              ) : (
                <b className="nf-pinned is-empty">Chưa ghim tin nào</b>
              )}
              <span className="nf-unit__sub">
                {pinnedTop
                  ? "Tin ghim mới nhất hiện ở ô nổi bật trên Bảng tin của mọi tài khoản"
                  : "Ô nổi bật đang hiện tin mới nhất"}
              </span>
            </div>
            <div className="nf-unit">
              <span className="nf-unit__label">
                {canPublish ? "Được cấp quyền đăng" : "Quyền của bạn"}
              </span>
              <b className="nf-big">{canPublish ? (publisherCount ?? "–") : "Chỉ xem"}</b>
              <span className="nf-unit__sub">
                {canPublish
                  ? "Ngoài Quản trị và Giáo vụ khoa"
                  : "Tài khoản của bạn chỉ xem bảng tin"}
              </span>
            </div>
          </section>

          <div className="nf-board">
            <section className="nf-card nf-list" aria-label="Danh sách thông báo">
              <div className="nf-toolbar">
                <div className="nf-filters" role="group" aria-label="Lọc theo danh mục">
                  <button
                    type="button"
                    className="nf-fchip"
                    aria-pressed={category === "all"}
                    onClick={() => setCategory("all")}
                  >
                    Tất cả <small>{announcements.length}</small>
                  </button>
                  {CATEGORIES.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`nf-fchip is-${key}`}
                      aria-pressed={category === key}
                      onClick={() => setCategory(key)}
                    >
                      <i />
                      {CATEGORY_META[key].short}{" "}
                      <small>{announcements.filter((item) => item.category === key).length}</small>
                    </button>
                  ))}
                  {canPublish && (
                    <>
                      <span className="nf-sep" aria-hidden="true" />
                      <button
                        type="button"
                        className="nf-fchip"
                        aria-pressed={mineOnly}
                        onClick={() => setMineOnly((value) => !value)}
                      >
                        Tôi đăng
                      </button>
                    </>
                  )}
                </div>
                <label className="nf-search">
                  <Icon name="search" size={14} />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Tiêu đề, người đăng, phạm vi…"
                    aria-label="Tìm thông báo"
                  />
                </label>
              </div>

              {!annLoaded ? (
                <p className="nf-state">Đang tải thông báo…</p>
              ) : annError ? (
                <p className="nf-state is-error" role="alert">
                  {annError}
                </p>
              ) : !filtered.length ? (
                <div className="nf-empty">
                  <Icon name="megaphone" size={26} />
                  <b>
                    {announcements.length
                      ? "Không có thông báo khớp bộ lọc"
                      : "Chưa có thông báo nào"}
                  </b>
                  <span>
                    {canPublish
                      ? "Bấm “Đăng thông báo” để gửi tin lên Bảng tin."
                      : "Thông báo mới của Nhà trường sẽ hiện ở đây."}
                  </span>
                </div>
              ) : (
                <div className="nf-rows">
                  {byDay(filtered).map(([label, items]) => (
                    <Fragment key={label}>
                      <div className="nf-group">{label}</div>
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className={`nf-row${selected?.id === item.id ? " is-selected" : ""}`}
                        >
                          <span className={`nf-dot is-${item.category}`} />
                          <button
                            type="button"
                            className="nf-row__main"
                            aria-current={selected?.id === item.id || undefined}
                            onClick={() => pick(item)}
                          >
                            <span className="nf-row__title">
                              {item.pinned && <Icon name="pin" size={13} />}
                              <b>{item.title}</b>
                              <span className={`nf-chip is-${item.category}`}>
                                {CATEGORY_META[item.category].short}
                              </span>
                              {distinctBadge(item) && (
                                <span className={`nf-chip ${badgeTone(item.badge ?? "")}`}>
                                  {item.badge}
                                </span>
                              )}
                            </span>
                            <span className="nf-row__summary">{item.summary}</span>
                            <span className="nf-row__meta">
                              {[item.authorName, item.authorTitle, `Phạm vi: ${item.scope}`]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </button>
                          <div className="nf-row__side">
                            <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
                            {item.canManage && (
                              <div className="nf-row__acts">
                                <IconButton
                                  icon="pin"
                                  label={item.pinned ? "Bỏ ghim" : "Ghim lên đầu Trang chủ"}
                                  active={item.pinned}
                                  onClick={() => void togglePin(item)}
                                />
                                <IconButton
                                  icon="edit"
                                  label="Sửa"
                                  onClick={() => setComposing({ item })}
                                />
                                <IconButton
                                  icon="trash"
                                  label="Xóa"
                                  danger
                                  onClick={() => setRemoving(item)}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>
              )}
            </section>

            {selected && (
              <aside className="nf-side" aria-label="Thông báo đang chọn">
                <section className="nf-card nf-side__card nf-details">
                  <h2>Chi tiết</h2>
                  <dl>
                    <Fact label="Danh mục">
                      {CATEGORY_META[selected.category].label}
                      {selected.badge ? ` · nhãn “${selected.badge}”` : ""}
                    </Fact>
                    <Fact label="Phạm vi">{selected.scope}</Fact>
                    <Fact label="Người đăng">
                      {selected.authorName}
                      {selected.authorTitle && <small>{selected.authorTitle}</small>}
                    </Fact>
                    <Fact label="Đăng lúc" mono>
                      {formatStamp(selected.createdAt)}
                    </Fact>
                    {selected.updatedAt.slice(0, 19) !== selected.createdAt.slice(0, 19) && (
                      <Fact label="Sửa lần cuối" mono>
                        {formatStamp(selected.updatedAt)}
                      </Fact>
                    )}
                  </dl>
                  <div className="nf-details__actions">
                    {selected.canManage && (
                      <button
                        type="button"
                        className="nf-btn is-ink"
                        onClick={() => setComposing({ item: selected })}
                      >
                        <Icon name="edit" size={14} />
                        Sửa
                      </button>
                    )}
                    <button type="button" className="nf-btn" onClick={() => setDetail(selected)}>
                      Xem toàn văn
                    </button>
                    {selected.canManage && (
                      <button
                        type="button"
                        className="nf-btn is-danger"
                        aria-label="Xóa thông báo"
                        title="Xóa thông báo"
                        onClick={() => setRemoving(selected)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </section>
              </aside>
            )}
          </div>
        </>
      ) : (
        <div className="nf-inbox">
          <nav className="nf-kinds" aria-label="Lọc thông báo">
            <KindButton
              icon="bell"
              label="Tất cả"
              count={`${page.items.length}${page.hasMore ? "+" : ""}`}
              active={inboxFilter === "all"}
              onClick={() => setInboxFilter("all")}
            />
            <KindButton
              icon="eye"
              label="Chưa đọc"
              count={page.unreadCount || ""}
              hot
              active={inboxFilter === "unread"}
              onClick={() => setInboxFilter("unread")}
            />
            <div className="nf-kinds__label">Theo loại</div>
            {KINDS.map((kind) => (
              <KindButton
                key={kind.key}
                icon={kind.icon}
                label={kind.label}
                count={page.items.filter((item) => item.kind === kind.key).length || ""}
                active={inboxFilter === kind.key}
                onClick={() => setInboxFilter(kind.key)}
              />
            ))}
            <p className="nf-kinds__note">
              Mở một thông báo sẽ đưa bạn tới đúng tin nhắn, cuộc họp hoặc khóa học và đánh dấu đã
              đọc.
            </p>
          </nav>

          <section className="nf-card nf-feed" aria-label="Danh sách thông báo cá nhân">
            <div className="nf-feed__head">
              <h2>
                {inboxFilter === "all"
                  ? "Tất cả"
                  : inboxFilter === "unread"
                    ? "Chưa đọc"
                    : KIND[inboxFilter].label}
                <span className="nf-mono"> · {page.unreadCount} chưa đọc</span>
              </h2>
            </div>
            {loading && !page.items.length ? (
              <p className="nf-state">Đang tải…</p>
            ) : error ? (
              <p className="nf-state is-error" role="alert">
                {error}
              </p>
            ) : !notes.length ? (
              <div className="nf-empty">
                <Icon name="check" size={26} />
                <b>
                  {inboxFilter === "all"
                    ? "Bạn đã xem hết thông báo"
                    : "Không có thông báo nào ở mục này"}
                </b>
                <span>
                  Khi ai đó nhắc tên, trả lời bạn, mời họp hoặc ghi danh bạn vào khóa học, thông báo
                  sẽ hiện ở đây.
                </span>
              </div>
            ) : (
              <div className="nf-rows">
                {byDay(notes).map(([label, items]) => (
                  <Fragment key={label}>
                    <div className="nf-group">{label}</div>
                    {items.map((item) => {
                      const kind = KIND[item.kind];
                      const chat = !item.title;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`nf-note${item.readAt ? "" : " is-unread"}`}
                          onClick={() => openNote(item)}
                        >
                          <span
                            className="nf-note__dot"
                            aria-label={item.readAt ? undefined : "Chưa đọc"}
                          />
                          <span className={`nf-note__kind is-${item.kind}`}>
                            <Icon name={kind.icon} size={17} />
                            {chat && item.authorName && <Avatar name={item.authorName} size="xs" />}
                          </span>
                          <span className="nf-note__body">
                            <span className="nf-note__line">
                              {item.kind === "mention" ? (
                                <>
                                  <b>{item.authorName}</b> nhắc bạn trong <b>#{item.channelName}</b>
                                </>
                              ) : item.kind === "thread" ? (
                                <>
                                  <b>{item.authorName}</b> trả lời trong luồng ở{" "}
                                  <b>#{item.channelName}</b>
                                </>
                              ) : item.kind === "direct" ? (
                                <>
                                  <b>{item.authorName}</b> gửi bạn tin nhắn riêng
                                </>
                              ) : (
                                <b>{item.title}</b>
                              )}
                            </span>
                            {item.content && (
                              <span className={chat ? "nf-note__quote" : "nf-note__text"}>
                                {item.content}
                              </span>
                            )}
                            <span className="nf-note__meta">
                              {chat && item.channelName && item.kind !== "direct"
                                ? `${kind.label} · #${item.channelName}`
                                : kind.label}
                            </span>
                          </span>
                          <span className="nf-note__side">
                            <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
                            <span
                              className={`nf-btn is-sm${!item.readAt && item.kind === "meeting" ? " is-primary" : ""}`}
                            >
                              {kind.action}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </Fragment>
                ))}
                {page.hasMore && (
                  <button
                    type="button"
                    className="nf-more"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore ? "Đang tải…" : "Tải thêm thông báo cũ hơn"}
                  </button>
                )}
              </div>
            )}
          </section>

          <aside className="nf-rail" aria-label="Tóm tắt">
            <section className="nf-rack nf-channels" aria-label="Kênh còn tin chưa đọc">
              <div className="nf-rack__label">
                <span className="nf-led" />
                Kênh còn tin chưa đọc
                <span className="nf-rack__count">{unreadMessages} tin</span>
              </div>
              {unreadChannels.length ? (
                unreadChannels.slice(0, 6).map((channel) => (
                  <button
                    key={channel.channelId}
                    type="button"
                    className="nf-channel"
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
                    <b>{channel.unreadCount}</b>
                  </button>
                ))
              ) : (
                <p className="nf-rack__empty">Không còn tin nhắn nhóm chưa đọc.</p>
              )}
              <button
                type="button"
                className="nf-btn is-dark is-sm"
                onClick={() => navigate({ view: "chat" })}
              >
                Mở Tin nhắn →
              </button>
            </section>

            <section className="nf-card nf-news" aria-label="Từ bảng tin trường">
              <div className="nf-side__head">
                <h2>Từ bảng tin trường</h2>
                <span className="nf-mono">{announcements.length} tin</span>
              </div>
              {latestNews.length ? (
                latestNews.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`nf-news__item is-${item.category}`}
                    onClick={() => setDetail(item)}
                  >
                    <span className={`nf-led is-${item.category}`} />
                    <span>
                      <b>
                        {CATEGORY_META[item.category].short} · {item.title}
                      </b>
                      <small>
                        {item.authorName} · {timeLabel(item.createdAt)}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="nf-state">Chưa có thông báo nào.</p>
              )}
              <button type="button" className="nf-link" onClick={() => setTab("board")}>
                Xem bảng tin →
              </button>
            </section>
          </aside>
        </div>
      )}

      {detail && <AnnouncementDetailModal announcement={detail} onClose={() => setDetail(null)} />}

      {publishersOpen && accessToken && (
        <PublisherManagementModal
          accessToken={accessToken}
          onClose={() => setPublishersOpen(false)}
          onChanged={reloadAnnouncements}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Xóa thông báo"
          description={`Xóa thông báo “${removing.title}”? Không thể hoàn tác.`}
          confirmLabel="Xóa"
          onClose={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
    </div>
  );
}

function IconButton({
  icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nf-icon-btn${active ? " is-active" : ""}${danger ? " is-danger" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function KindButton({
  icon,
  label,
  count,
  hot,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  count: ReactNode;
  hot?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {count !== "" && <small className={hot ? "is-hot" : undefined}>{count}</small>}
    </button>
  );
}

function Fact({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="nf-fact">
      <dt>{label}</dt>
      <dd className={mono ? "nf-mono-value" : undefined}>{children}</dd>
    </div>
  );
}
