import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { HomeSummary, PortalAnnouncement } from "@doan/shared";
import { governanceApi } from "../workspaces/api";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../shared/ui/kit/dropdown-menu";
import { cn } from "../../shared/lib/utils";
import { useApp } from "../../app/providers/AppContext";
import type { AppRoute } from "../../app/navigation";
import { useSocket } from "../../app/providers/SocketContext";
import { getAnnouncementsApi } from "../announcements/api";
import { AnnouncementDetailModal } from "../announcements/AnnouncementDetailModal";
import { CATEGORY_DOT, CATEGORY_META } from "../announcements/AnnouncementComposer";
import { byDay, timeLabel } from "../announcements/day";

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

const KINDS: { key: Kind; label: string; icon: IconName; action: string; tint: string }[] = [
  {
    key: "mention",
    label: "Nhắc tên",
    icon: "at-sign",
    action: "Trả lời",
    tint: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  },
  {
    key: "thread",
    label: "Trả lời luồng",
    icon: "messages",
    action: "Trả lời",
    tint: "bg-[var(--tint-violet-bg)] text-[var(--tint-violet-fg)]",
  },
  {
    key: "direct",
    label: "Tin nhắn riêng",
    icon: "message",
    action: "Mở",
    tint: "bg-secondary text-foreground",
  },
  {
    key: "meeting",
    label: "Họp",
    icon: "video",
    action: "Mở họp",
    tint: "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]",
  },
  {
    key: "course",
    label: "Khóa học",
    icon: "graduation-cap",
    action: "Mở khóa học",
    tint: "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]",
  },
];
const KIND = Object.fromEntries(KINDS.map((kind) => [kind.key, kind])) as Record<
  Kind,
  (typeof KINDS)[number]
>;

const BTN =
  "inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border bg-card px-3 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-secondary";
const BADGE =
  "min-w-5 rounded-full px-1.5 py-px text-center text-[11.5px] font-semibold text-white tabular-nums";
const MUTED = "text-[13px] text-muted-foreground";

/** The signed-in user's own inbox: mentions, thread replies, direct messages, meetings, courses. */
export function NotificationsPage() {
  const { accessToken, navigate, notify } = useApp();
  const { socket } = useSocket();

  const [page, setPage] = useState<NotificationPage>({ items: [], unreadCount: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [unreadChannels, setUnreadChannels] = useState<HomeSummary["unreadChannels"]>([]);
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [detail, setDetail] = useState<PortalAnnouncement | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const load = () =>
      void getAnnouncementsApi(accessToken)
        .then((res) => active && setAnnouncements(res.items))
        .catch(() => undefined);
    load();
    socket?.on("announcements_changed", load);
    return () => {
      active = false;
      socket?.off("announcements_changed", load);
    };
  }, [accessToken, socket]);

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

  const notes = page.items.filter((item) =>
    filter === "all" ? true : filter === "unread" ? !item.readAt : item.kind === filter,
  );
  const unreadMessages = unreadChannels.reduce((sum, channel) => sum + channel.unreadCount, 0);
  const latestNews = useMemo(() => {
    const sorted = [...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return [
      ...sorted.filter((item) => item.category === "urgent").slice(0, 1),
      ...sorted.filter((item) => item.category !== "urgent"),
    ].slice(0, 4);
  }, [announcements]);
  const urgentCount = announcements.filter((item) => item.category === "urgent").length;

  return (
    <div className="tw grid min-w-0 gap-4 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="grid gap-0.5">
          <h1 className="text-[22px] font-bold">Thông báo</h1>
          <p className={MUTED}>Của riêng bạn: nhắc tên, tin riêng, họp, khóa học</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0">
          <DropdownMenu>
            <DropdownMenuTrigger className={BTN}>
              <Icon name="message" size={15} className="text-muted-foreground" />
              Kênh
              {unreadMessages > 0 && (
                <span className={cn(BADGE, "bg-[#2f6bff]")}>{unreadMessages}</span>
              )}
              <Icon name="chevron-down" size={12} className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100] w-80 p-1.5">
              <PopHead title="Kênh còn tin chưa đọc" count={`${unreadMessages} tin`} />
              {unreadChannels.length ? (
                unreadChannels.slice(0, 8).map((channel) => (
                  <DropdownMenuItem
                    key={channel.channelId}
                    className="gap-2.5 p-2"
                    onSelect={() =>
                      navigate({
                        view: "chat",
                        workspaceId: channel.workspaceId,
                        channelId: channel.channelId,
                      })
                    }
                  >
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-secondary font-bold text-muted-foreground">
                      #
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate font-semibold">{channel.channelName}</b>
                      <small className="block truncate text-xs text-muted-foreground">
                        {channel.workspaceName}
                      </small>
                    </span>
                    <span className={cn(BADGE, "bg-[#2f6bff]")}>{channel.unreadCount}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <p className={cn(MUTED, "px-2 py-3")}>Không còn tin nhắn nhóm chưa đọc.</p>
              )}
              <PopLink onSelect={() => navigate({ view: "chat" })}>Mở Tin nhắn →</PopLink>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={BTN}>
              <Icon name="megaphone" size={15} className="text-muted-foreground" />
              Bảng tin
              {urgentCount > 0 && (
                <span className={cn(BADGE, "bg-red-500")}>{urgentCount} khẩn</span>
              )}
              <Icon name="chevron-down" size={12} className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100] w-80 p-1.5">
              <PopHead title="Từ bảng tin trường" count={`${announcements.length} tin`} />
              {latestNews.length ? (
                latestNews.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    className="items-start gap-2.5 p-2"
                    onSelect={() => setDetail(item)}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        CATEGORY_DOT[item.category],
                      )}
                    />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-[11px] font-semibold tracking-wide uppercase",
                          item.category === "urgent" ? "text-red-600" : "text-muted-foreground",
                        )}
                      >
                        {CATEGORY_META[item.category].short}
                      </span>
                      <b className="block leading-snug font-semibold">{item.title}</b>
                      <small className="text-xs text-muted-foreground">
                        {item.authorName} · {timeLabel(item.createdAt)}
                      </small>
                    </span>
                  </DropdownMenuItem>
                ))
              ) : (
                <p className={cn(MUTED, "px-2 py-3")}>Chưa có thông báo nào.</p>
              )}
              <PopLink onSelect={() => navigate({ view: "overview" })}>
                Xem Bảng tin trên Trang chủ →
              </PopLink>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            className={BTN}
            disabled={!page.unreadCount}
            title="Đánh dấu đã đọc tất cả"
            onClick={() => void markAllRead()}
          >
            <Icon name="check" size={15} />
            Đọc hết
          </button>
        </div>
      </div>

      <div className="grid min-w-0 items-start gap-4 min-[761px]:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          className="grid gap-0.5 min-[761px]:sticky min-[761px]:top-2 max-md:flex max-md:overflow-x-auto"
          aria-label="Lọc thông báo"
        >
          <KindButton
            icon="bell"
            label="Tất cả"
            count={`${page.items.length}${page.hasMore ? "+" : ""}`}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <KindButton
            icon="eye"
            label="Chưa đọc"
            count={page.unreadCount || ""}
            hot
            active={filter === "unread"}
            onClick={() => setFilter("unread")}
          />
          <div className="px-2.5 pt-3 pb-1 text-[11.5px] font-semibold tracking-wider text-muted-foreground uppercase max-md:hidden">
            Theo loại
          </div>
          {KINDS.map((kind) => (
            <KindButton
              key={kind.key}
              icon={kind.icon}
              label={kind.label}
              count={page.items.filter((item) => item.kind === kind.key).length || ""}
              active={filter === kind.key}
              onClick={() => setFilter(kind.key)}
            />
          ))}
          <p className="px-2.5 pt-3 text-xs text-muted-foreground max-md:hidden">
            Mở một thông báo sẽ đưa bạn tới đúng tin nhắn, cuộc họp hoặc khóa học và đánh dấu đã
            đọc.
          </p>
        </nav>

        <section
          className="min-w-0 rounded-[10px] border bg-card p-2"
          aria-label="Danh sách thông báo cá nhân"
        >
          <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
            <h2 className="text-[15px] font-semibold">
              {filter === "all" ? "Tất cả" : filter === "unread" ? "Chưa đọc" : KIND[filter].label}
            </h2>
            <small className={MUTED}>· {page.unreadCount} chưa đọc</small>
          </div>
          {loading && !page.items.length ? (
            <p className={cn(MUTED, "p-4")}>Đang tải…</p>
          ) : error ? (
            <p
              className="m-2 rounded-lg bg-[var(--tint-red-bg)] px-3 py-2 text-[13px] text-[var(--tint-red-fg)]"
              role="alert"
            >
              {error}
            </p>
          ) : !notes.length ? (
            <div className="grid justify-items-center gap-1.5 px-4 py-10 text-center">
              <Icon name="check" size={26} className="text-muted-foreground" />
              <b className="font-semibold">
                {filter === "all" ? "Bạn đã xem hết thông báo" : "Không có thông báo nào ở mục này"}
              </b>
              <span className={cn(MUTED, "max-w-md")}>
                Khi ai đó nhắc tên, trả lời bạn, mời họp hoặc ghi danh bạn vào khóa học, thông báo
                sẽ hiện ở đây.
              </span>
            </div>
          ) : (
            <div>
              {byDay(notes).map(([label, items]) => (
                <Fragment key={label}>
                  <div className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {label}
                  </div>
                  {items.map((item) => (
                    <Note key={item.id} item={item} onOpen={() => openNote(item)} />
                  ))}
                </Fragment>
              ))}
              {page.hasMore && (
                <button
                  type="button"
                  className={cn(BTN, "mt-2 w-full")}
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Đang tải…" : "Tải thêm thông báo cũ hơn"}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {detail && <AnnouncementDetailModal announcement={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Note({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const kind = KIND[item.kind];
  const chat = !item.title;
  const unread = !item.readAt;
  return (
    <button
      type="button"
      className="grid w-full cursor-pointer grid-cols-[8px_36px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border-b px-2.5 py-3 text-left last:border-b-0 hover:bg-secondary"
      onClick={onOpen}
    >
      <span
        className={cn("mt-3.5 size-2 rounded-full", unread && "bg-[#2f6bff]")}
        aria-label={unread ? "Chưa đọc" : undefined}
      />
      <span className={cn("relative grid size-9 place-items-center rounded-[10px]", kind.tint)}>
        <Icon name={kind.icon} size={17} />
        {chat && item.authorName && (
          <UserAvatar
            name={item.authorName}
            className="absolute -right-1.5 -bottom-1.5 size-[18px] text-[8px] ring-2 ring-card"
          />
        )}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-[13.5px]", unread && "font-semibold")}>
          {item.kind === "mention" ? (
            <>
              <b className="font-semibold">{item.authorName}</b> nhắc bạn trong{" "}
              <b className="font-semibold">#{item.channelName}</b>
            </>
          ) : item.kind === "thread" ? (
            <>
              <b className="font-semibold">{item.authorName}</b> trả lời trong luồng ở{" "}
              <b className="font-semibold">#{item.channelName}</b>
            </>
          ) : item.kind === "direct" ? (
            <>
              <b className="font-semibold">{item.authorName}</b> gửi bạn tin nhắn riêng
            </>
          ) : (
            <b className="font-semibold">{item.title}</b>
          )}
        </span>
        {item.content && (
          <span
            className={cn(
              "mt-1 block text-[13px] text-muted-foreground",
              chat && "line-clamp-2 border-l-2 pl-2",
            )}
          >
            {item.content}
          </span>
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          {chat && item.channelName && item.kind !== "direct"
            ? `${kind.label} · #${item.channelName}`
            : kind.label}
        </span>
      </span>
      <span className="grid justify-items-end gap-1.5 text-xs text-muted-foreground">
        <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
        <span
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium text-foreground",
            unread &&
              item.kind === "meeting" &&
              "border-primary bg-primary text-primary-foreground",
          )}
        >
          {kind.action}
        </span>
      </span>
    </button>
  );
}

function PopHead({ title, count }: { title: string; count: string }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-2 pb-1.5">
      <b className="text-sm font-semibold">{title}</b>
      <span className="ml-auto rounded-full bg-secondary px-2 py-px text-xs font-semibold text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

function PopLink({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenuItem
      className="mt-1 rounded-none rounded-b-md border-t p-2 text-[13px] font-semibold text-[#2f6bff]"
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuItem>
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
    <button
      type="button"
      className={cn(
        "flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left font-medium whitespace-nowrap text-muted-foreground hover:bg-secondary hover:text-foreground",
        active && "bg-secondary font-semibold text-foreground",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {count !== "" && (
        <small
          className={cn(
            "ml-auto text-xs tabular-nums",
            hot && "rounded-full bg-red-500 px-1.5 font-semibold text-white",
          )}
        >
          {count}
        </small>
      )}
    </button>
  );
}
