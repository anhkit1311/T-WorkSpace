import { useState, useEffect, useCallback } from "react";
import type { AnnouncementMark, PortalAnnouncement } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { RoleHome, useRoleData } from "./RoleHome";
import { getAnnouncementsApi, setAnnouncementMarkApi } from "../announcements/api";
import { initialsOf } from "../../shared/ui/kit/user-avatar";

const CATEGORY_LABELS: Record<string, string> = {
  general: "Thông báo chung",
  training: "Đào tạo",
  event: "Sự kiện",
  urgent: "Khẩn",
};

/** "saved" is the reader's own bookmarks, filtered here; the others are categories the API filters. */
const FILTER_TABS = [
  { key: "all", label: "Tất cả" },
  { key: "general", label: "Thông báo chung" },
  { key: "training", label: "Đào tạo" },
  { key: "event", label: "Sự kiện" },
  { key: "urgent", label: "Khẩn" },
  { key: "saved", label: "Đã lưu" },
];

function formatTimeAgo(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Vừa xong";
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ngày trước`;
    return new Date(isoString).toLocaleDateString("vi-VN");
  } catch {
    return "";
  }
}

/** Unopened announcements younger than this count as unread (older ones are not news any more). */
const UNREAD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The author's badge, minus a plain "Mới" (the unread mark says that, per reader) and minus a repeat of the category chip. */
function authorBadge(item: PortalAnnouncement): string | undefined {
  const badge = item.badge?.trim().toLowerCase();
  return badge && badge !== "mới" && badge !== CATEGORY_LABELS[item.category]?.toLowerCase()
    ? item.badge
    : undefined;
}

// shortcut: read marks live in this browser (per account); move them to a server table to follow the user across devices.
function loadReadIds(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

const initials = (name: string) => initialsOf(name) || "?";

const CARD = "rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const AVATAR =
  "grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand";
const CHIP = "rounded-full px-2.5 py-0.5 text-xs font-semibold";
const ACTION =
  "flex cursor-pointer items-center justify-center gap-2 rounded-md py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

export function WorkspaceHomePage() {
  const { setActiveView, accessToken, user } = useApp();
  const { socket } = useSocket();

  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [canPublish, setCanPublish] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const readKey = `announcements-read:${user?.id ?? "anon"}`;
  const [readIds, setReadIds] = useState(() => loadReadIds(readKey));
  const markRead = (ids: string[]) => {
    const next = new Set(readIds);
    ids.forEach((id) => next.add(id));
    setReadIds(next);
    try {
      localStorage.setItem(readKey, JSON.stringify([...next].slice(-300)));
    } catch {
      // not persisted; the marks still apply to this visit
    }
  };
  const isUnread = (item: PortalAnnouncement) =>
    !readIds.has(item.id) && Date.now() - new Date(item.createdAt).getTime() < UNREAD_WINDOW_MS;
  /** Posts open in place, like a social feed; opening one marks it read. */
  const toggleExpanded = (item: PortalAnnouncement) => {
    const next = new Set(expandedIds);
    if (!next.delete(item.id)) {
      next.add(item.id);
      markRead([item.id]);
    }
    setExpandedIds(next);
  };

  const roleData = useRoleData();

  const category = selectedFilter === "saved" ? "all" : selectedFilter;
  const loadAnnouncements = useCallback(async () => {
    if (!accessToken) return;
    try {
      setLoadingAnnouncements(true);
      const res = await getAnnouncementsApi(accessToken, category);
      setAnnouncements(res.items || []);
      setCanPublish(res.canPublish);
    } catch {
      // Keep existing announcements if error
    } finally {
      setLoadingAnnouncements(false);
    }
  }, [accessToken, category]);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  // Real-time refresh when announcements change via Socket.IO
  useEffect(() => {
    if (!socket) return;
    const handleAnnouncementsChanged = () => {
      void loadAnnouncements();
    };
    socket.on("announcements_changed", handleAnnouncementsChanged);
    return () => {
      socket.off("announcements_changed", handleAnnouncementsChanged);
    };
  }, [socket, loadAnnouncements]);

  /** Heart and bookmark answer at once; the server's count replaces the guess, a failure reloads the truth. */
  const toggleMark = (item: PortalAnnouncement, kind: AnnouncementMark) => {
    if (!accessToken) return;
    const on = !(kind === "like" ? item.liked : item.saved);
    const patch = (change: Partial<PortalAnnouncement>) =>
      setAnnouncements((list) =>
        list.map((post) => (post.id === item.id ? { ...post, ...change } : post)),
      );
    patch(
      kind === "like"
        ? { liked: on, likeCount: Math.max(0, (item.likeCount ?? 0) + (on ? 1 : -1)) }
        : { saved: on },
    );
    setAnnouncementMarkApi(accessToken, item.id, kind, on).then(
      ({ likeCount }) => patch({ likeCount }),
      () => void loadAnnouncements(),
    );
  };

  const posts =
    selectedFilter === "saved" ? announcements.filter((item) => item.saved) : announcements;
  const unreadCount = posts.filter(isUnread).length;

  return (
    <div className="tw mx-auto grid w-full max-w-[1040px] grid-cols-1 items-start justify-center gap-x-7 gap-y-3.5 px-4 py-5 lg:grid-cols-[minmax(0,620px)_300px]">
      <h1 className="sr-only">Trang chủ</h1>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5">
        {canPublish && (
          <button
            type="button"
            className={cn(
              CARD,
              "flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-3 text-left text-muted-foreground",
            )}
            onClick={() => setActiveView("bulletin")}
          >
            <span className={AVATAR}>{initials(user?.displayName ?? "")}</span>
            <span className="flex-1 rounded-full bg-secondary px-3.5 py-2 text-sm">
              Đăng thông báo mới lên bảng tin…
            </span>
            <Icon name="image" size={18} />
            <Icon name="paperclip" size={18} />
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc bảng tin">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={selectedFilter === tab.key}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-[13px] transition-colors",
                  selectedFilter === tab.key
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSelectedFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              className="cursor-pointer text-[12.5px] text-muted-foreground hover:text-foreground"
              onClick={() => markRead(posts.map((item) => item.id))}
            >
              {unreadCount} chưa đọc · Đánh dấu đã đọc hết
            </button>
          )}
        </div>
        <h2 className="sr-only">Bảng tin nội bộ</h2>

        {loadingAnnouncements && announcements.length === 0 && (
          <div className="grid gap-3.5" aria-busy="true" aria-label="Đang tải thông báo">
            {[0, 1, 2].map((key) => (
              <div key={key} className={cn(CARD, "h-36 animate-pulse")} />
            ))}
          </div>
        )}

        {/* Feed: mỗi thông báo là một bài đăng, mở toàn văn tại chỗ */}
        {posts.map((item) => {
          const expanded = expandedIds.has(item.id);
          const body = expanded ? item.content : item.summary;
          const likes = item.likeCount ?? 0;
          return (
            <article key={item.id} className={cn(CARD, "px-4 pt-4 pb-1.5")}>
              <header className="mb-2.5 flex items-center gap-2.5">
                <span className={AVATAR}>{initials(item.authorName)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {item.authorName}
                  </div>
                  <div className="truncate text-[12.5px] text-muted-foreground">
                    {[item.authorTitle, formatTimeAgo(item.createdAt), item.scope]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {isUnread(item) && (
                  <span className={cn(CHIP, "bg-brand-soft text-brand")}>Mới</span>
                )}
              </header>
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={cn(
                    CHIP,
                    item.category === "urgent"
                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                      : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {CATEGORY_LABELS[item.category] || item.category}
                </span>
                {item.audience === "staff" && (
                  <span
                    className={cn(CHIP, "flex items-center gap-1 border text-muted-foreground")}
                  >
                    <Icon name="lock" size={12} /> Chỉ cán bộ, giảng viên
                  </span>
                )}
                {item.pinned && (
                  <span
                    className={cn(CHIP, "flex items-center gap-1 border text-muted-foreground")}
                  >
                    <Icon name="pin" size={12} /> Đã ghim
                  </span>
                )}
                {authorBadge(item) && (
                  <span className={cn(CHIP, "border text-muted-foreground")}>
                    {authorBadge(item)}
                  </span>
                )}
              </div>
              <h3 className="m-0 mt-2 mb-1 text-[15.5px] leading-snug font-semibold text-foreground">
                {item.title}
              </h3>
              {body && body.trim() !== item.title.trim() && (
                <div className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                  {body}
                  {item.content.trim() !== item.summary.trim() && (
                    <>
                      {expanded ? " " : "… "}
                      <button
                        type="button"
                        className="cursor-pointer font-semibold text-foreground"
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(item)}
                      >
                        {expanded ? "Thu gọn" : "Xem thêm"}
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="mt-3 min-h-5 border-b pb-2 text-[12.5px] text-muted-foreground">
                {likes > 0 && `${likes.toLocaleString("vi-VN")} lượt thích`}
              </div>
              <div className="grid grid-cols-2 gap-1 py-1">
                <button
                  type="button"
                  className={cn(
                    ACTION,
                    item.liked && "font-semibold text-red-500 hover:text-red-500",
                  )}
                  aria-pressed={Boolean(item.liked)}
                  onClick={() => toggleMark(item, "like")}
                >
                  <Icon
                    name="heart"
                    size={18}
                    fill={item.liked ? "currentColor" : "none"}
                    className={item.liked ? "motion-safe:animate-[like-pop_0.25s]" : undefined}
                  />
                  Thích
                </button>
                <button
                  type="button"
                  className={cn(ACTION, item.saved && "font-semibold text-brand hover:text-brand")}
                  aria-pressed={Boolean(item.saved)}
                  onClick={() => toggleMark(item, "save")}
                >
                  <Icon name="bookmark" size={18} fill={item.saved ? "currentColor" : "none"} />
                  {item.saved ? "Đã lưu" : "Lưu"}
                </button>
              </div>
            </article>
          );
        })}

        {!loadingAnnouncements && posts.length === 0 && (
          <div className={cn(CARD, "grid justify-items-center gap-2 px-4 py-10 text-center")}>
            <Icon name={selectedFilter === "saved" ? "bookmark" : "bell"} size={26} />
            <div className="text-sm text-muted-foreground">
              {selectedFilter === "saved"
                ? "Bạn chưa lưu thông báo nào. Bấm Lưu dưới một bài để xem lại ở đây."
                : "Chưa có thông báo nào trong chuyên mục này."}
            </div>
          </div>
        )}
      </div>

      {/* Cột phải đứng yên khi cuộn; trên màn hình hẹp nó lên đầu trang. */}
      <aside className="order-first grid grid-cols-[minmax(0,1fr)] gap-3.5 lg:sticky lg:top-5 lg:order-none">
        <RoleHome data={roleData} />
      </aside>
    </div>
  );
}
