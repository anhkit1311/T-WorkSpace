import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { AnimatePresence } from "motion/react";
import { useApp } from "../providers/AppContext";
import { useSocket } from "../providers/SocketContext";
import { useMenuAccess, type MenuAccess } from "./useMenuAccess";
import { useMeetingStatus } from "../providers/MeetingContext";
import { useGlobalSoftphone } from "../providers/SoftphoneContext";
import { GlobalCallBar } from "../../features/call-center/GlobalCallBar";
import { STATE_LABEL, STATE_TONE } from "../../features/call-center/agent-state";
import { Icon } from "../../shared/ui/Icon";
import { Button, PageFallback, STATE_CARD } from "../../shared/ui/Primitives";
import { STRIP_BTN, STRIP_DOT, STRIP_ITEM, TINT } from "../../features/call-center/ui";
import { TWorkSpaceLogo } from "../../shared/ui/TWorkSpaceLogo";
import { NotionSearchModal } from "../../features/search/NotionSearchModal";
import { LogoutConfirmDialog } from "../../features/auth/LogoutConfirmDialog";
import { PageErrorBoundary } from "../../shared/ui/PageErrorBoundary";
import { governanceApi } from "../../features/workspaces/api";
import type { ViewId } from "../types";
import { appRouteUrl } from "../navigation";
import { cn } from "../../shared/lib/utils";
import { useTheme } from "../../shared/hooks/useTheme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui/kit/dropdown-menu";
import { initialsOf } from "../../shared/lib/initials";

/** Page modules, warmed while the browser is idle so a first visit to a tab opens without waiting. */
const pageLoaders: (() => Promise<unknown>)[] = [];
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | undefined;
  const preload = () => load().then((component) => (loaded = component));
  pageLoaders.push(preload);
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  // React.lazy suspends once even for a cached module; a warmed page renders directly (no skeleton flash).
  return function LazyPage(props: P) {
    const Component = useRef<ComponentType<P> | typeof Lazy>(loaded ?? Lazy).current;
    return <Component {...props} />;
  };
}

const WorkspaceHomePage = lazyPage(() =>
  import("../../features/workspaces/WorkspaceHomePage").then((m) => m.WorkspaceHomePage),
);
const MeetingPage = lazyPage(() =>
  import("../../features/meetings/MeetingPage").then((m) => m.MeetingPage),
);
const MessagesPage = lazyPage(() =>
  import("../../features/chat/MessagesPage").then((m) => m.MessagesPage),
);
const ProfilePage = lazyPage(() =>
  import("../../features/profile/ProfilePage").then((m) => m.ProfilePage),
);
const NotificationsPage = lazyPage(() =>
  import("../../features/notifications/NotificationsPage").then((m) => m.NotificationsPage),
);
const BulletinPage = lazyPage(() =>
  import("../../features/announcements/BulletinPage").then((m) => m.BulletinPage),
);
const CallCenterWorkspace = lazyPage(() =>
  import("../../features/call-center/CallCenterWorkspace").then((m) => m.CallCenterWorkspace),
);
const AccessPage = lazyPage(() =>
  import("../../features/admin/AccessPage").then((m) => m.AccessPage),
);
const UnitReportsPage = lazyPage(() =>
  import("../../features/reports/UnitReportsPage").then((m) => m.UnitReportsPage),
);
const ELearningPage = lazyPage(() =>
  import("../../features/elearning/ELearningPage").then((m) => m.ELearningPage),
);
const StaffDirectoryPage = lazyPage(() =>
  import("../../features/staff/StaffDirectoryPage").then((m) => m.StaffDirectoryPage),
);

function ViewFallback() {
  return <PageFallback label="Đang tải dữ liệu..." />;
}

interface SidebarMenuItem {
  id: string;
  label: string;
  group: (typeof MENU_GROUPS)[number]["id"];
  targetView?: ViewId;
  badgeKey?: "notifications" | "messages";
  /** Label in the sidebar and phone bottom bar, where the full one does not fit (the title keeps it). */
  short?: string;
  adminOnly?: boolean;
}

const MENU_GROUPS = [
  { id: "work", label: "Làm việc" },
  { id: "desk", label: "Tổng đài" },
  // Mục dành riêng cho lãnh đạo đơn vị và Admin; "Cài đặt" nằm trong menu tài khoản.
  { id: "manage", label: "Quản lý" },
] as const;

const SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { id: "home", group: "work", label: "Trang chủ", targetView: "overview" },
  {
    id: "messages",
    group: "work",
    label: "Tin nhắn",
    targetView: "chat",
    badgeKey: "messages",
  },
  { id: "meetings", group: "work", label: "Họp", targetView: "meetings" },
  {
    id: "elearning",
    group: "work",
    label: "Khóa học",
    targetView: "elearning",
  },
  {
    id: "notifications",
    group: "work",
    label: "Thông báo",
    targetView: "notifications",
    badgeKey: "notifications",
  },
  // Its sub-pages (desk, history, monitoring…) are tabs inside the page, chosen by the user's role.
  {
    id: "switchboard",
    group: "desk",
    label: "Tổng đài",
    targetView: "call-center",
  },
  {
    id: "staff",
    group: "desk",
    label: "Danh sách nhân sự",
    short: "Nhân sự",
    targetView: "staff",
  },
  {
    id: "reports",
    group: "manage",
    label: "Báo cáo đơn vị",
    targetView: "reports",
  },
  {
    id: "bulletin",
    group: "manage",
    label: "Quản lý bảng tin",
    targetView: "bulletin",
  },
  {
    id: "access",
    group: "manage",
    label: "Quản trị hệ thống",
    targetView: "access",
    adminOnly: true,
  },
];

/** The phone bottom bar shows these; the rest open from "Thêm". */
const BOTTOM_BAR_ITEMS = new Set(["home", "switchboard", "messages", "elearning"]);
/**
 * Entries shown only to users with that role (see useMenuAccess). The switchboard and call list
 * are the core of the system and always stay visible; the page itself explains missing access.
 */
const RESTRICTED_MENU_ITEMS: Record<string, keyof MenuAccess> = {
  reports: "unitReports",
  bulletin: "bulletin",
};

const ICON_BUTTON =
  "relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
const COUNT_BADGE =
  "rounded-full bg-brand px-1.5 text-[11px] leading-[18px] font-semibold text-white";
const PRESENCE_DOT = {
  online: "bg-emerald-500",
  connecting: "bg-amber-500",
  offline: "bg-muted-foreground",
};
const PRESENCE_LABEL = {
  online: "Đang trực tuyến",
  connecting: "Đang kết nối lại",
  offline: "Ngoại tuyến",
};

/** The section icons of the approved mockup (24px grid, drawn at the given size). */
const NAV_ICONS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  messages: <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" />,
  meetings: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </>
  ),
  elearning: (
    <>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c3 3 9 3 12 0v-5" />
    </>
  ),
  switchboard: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2" y="13" width="5" height="7" rx="2" />
      <rect x="17" y="13" width="5" height="7" rx="2" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a6 6 0 0 0-4-5.6" />
    </>
  ),
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  notifications: <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  bulletin: <path d="M3 11v2l11 5V6zM14 8a4 4 0 0 1 0 8M7 15v4h3v-3" />,
  access: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
};

function NavIcon({ id, size = 18 }: { id: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[id]}
    </svg>
  );
}

function readCollapsed() {
  try {
    return localStorage.getItem("sidebar-collapsed") === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const { activeView, route, setActiveView, user, accessToken, openChatSearchResult, openChannel } =
    useApp();
  const { connectionStatus, reconnect, unreadCount, socket } = useSocket();
  const meeting = useMeetingStatus();
  const phone = useGlobalSoftphone();
  const menuAccess = useMenuAccess(accessToken);
  const { theme, toggleTheme } = useTheme();

  const [meetingWorkspaceId, setMeetingWorkspaceId] = useState("");
  useEffect(() => {
    if (!meeting.inCall) setMeetingWorkspaceId("");
    else if (activeView === "meetings" && route.workspaceId)
      setMeetingWorkspaceId(route.workspaceId);
  }, [meeting.inCall, activeView, route.workspaceId]);
  const showMeetingStrip = meeting.inCall && activeView !== "meetings";

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const refresh = () =>
      void governanceApi<{ unreadCount: number }>(accessToken, "notifications?unread=true")
        .then((page) => {
          if (active) setUnreadNotifications(page.unreadCount);
        })
        .catch(() => {});
    refresh();
    socket?.on("notifications_changed", refresh);
    socket?.on("connect", refresh);
    return () => {
      active = false;
      socket?.off("notifications_changed", refresh);
      socket?.off("connect", refresh);
    };
  }, [accessToken, socket]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  // Every page shares one scroll container: a new page would open at the last page's offset.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeView]);

  const [collapsedPref, setCollapsedPref] = useState(readCollapsed);
  const collapsed = collapsedPref;
  const toggleCollapsed = () => {
    try {
      localStorage.setItem("sidebar-collapsed", collapsedPref ? "0" : "1");
    } catch {
      // not persisted; the choice still applies to this visit
    }
    setCollapsedPref(!collapsedPref);
  };

  const displayName = user?.displayName?.trim() || user?.email || "Tài khoản";
  const userEmail = user?.email || "";
  // Only a real grant (academic_role_grants system_admin) shows the administration entries.
  const isUserAdmin = Boolean(menuAccess?.systemAdmin);
  const presence =
    user?.showActivity === false || connectionStatus === "disconnected"
      ? "offline"
      : connectionStatus === "connected"
        ? "online"
        : "connecting";

  const visibleItems = SIDEBAR_MENU_ITEMS.filter((item) => {
    if (item.adminOnly && !isUserAdmin) return false;
    if (RESTRICTED_MENU_ITEMS[item.id] && !menuAccess?.[RESTRICTED_MENU_ITEMS[item.id]])
      return false;
    return true;
  });
  const isCallView = activeView.startsWith("call-");
  const isItemActive = (item: SidebarMenuItem) =>
    item.targetView === activeView || (item.id === "switchboard" && isCallView);
  const badgeFor = (item: SidebarMenuItem) =>
    item.badgeKey === "notifications"
      ? unreadNotifications
      : item.badgeKey === "messages"
        ? unreadCount
        : 0;
  const isLive = (item: SidebarMenuItem) =>
    (item.id === "switchboard" && phone.phase !== "none") ||
    (item.id === "meetings" && meeting.inCall);
  /** The switchboard entry keeps its current sub-page; everything else opens its page. */
  const openItem = (item: SidebarMenuItem) => {
    if (item.targetView && !(item.id === "switchboard" && isItemActive(item)))
      setActiveView(item.targetView);
  };
  const moreItems = visibleItems.filter((item) => !BOTTOM_BAR_ITEMS.has(item.id));

  // Warm every page module once the shell is idle; a failed load is retried by the page itself.
  useEffect(() => {
    const warm = () => pageLoaders.forEach((load) => void load().catch(() => {}));
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  // Global Ctrl + K search shortcut
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  /** Pages that fill the viewport edge to edge (their own columns scroll). */

  const renderPage = () => {
    if (route.invalid)
      return (
        <section className={STATE_CARD} role="alert">
          <h2>Đường dẫn không hợp lệ</h2>
          <p>Trang hoặc mã tài nguyên trong liên kết không tồn tại.</p>
          <Button onClick={() => setActiveView("overview")}>Về trang chủ</Button>
        </section>
      );
    let Component;
    if (activeView === "overview") Component = <WorkspaceHomePage />;
    else if (activeView === "call-center") Component = <CallCenterWorkspace initialTab="desk" />;
    else if (activeView === "call-directory")
      Component = <CallCenterWorkspace initialTab="history" />;
    else if (activeView === "call-monitoring")
      Component = <CallCenterWorkspace initialTab="live" />;
    else if (activeView === "chat") Component = <MessagesPage />;
    else if (activeView === "meetings") Component = <MeetingPage />;
    else if (activeView === "elearning") Component = <ELearningPage />;
    else if (activeView === "staff") Component = <StaffDirectoryPage />;
    else if (activeView === "profile") Component = <ProfilePage />;
    else if (activeView === "notifications") Component = <NotificationsPage />;
    else if (activeView === "bulletin") Component = <BulletinPage />;
    else if (activeView === "access") Component = <AccessPage />;
    else if (activeView === "reports") Component = <UnitReportsPage />;
    else Component = <WorkspaceHomePage />;

    return (
      // The call views share one instance: the desk's wrap-up and a browser call survive switching tabs.
      <PageErrorBoundary key={isCallView ? "call-center" : activeView}>
        <Suspense fallback={<ViewFallback />}>{Component}</Suspense>
      </PageErrorBoundary>
    );
  };

  const avatar = (size: string) =>
    user?.avatarUrl ? (
      <img src={user.avatarUrl} alt="" className={cn("rounded-full object-cover", size)} />
    ) : (
      <span
        className={cn(
          "grid place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand",
          size,
        )}
      >
        {initialsOf(displayName) || "?"}
      </span>
    );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Desktop: sections in a sidebar that collapses to icons. Phones use the bottom bar below. */}
      <aside
        className={cn(
          "tw hidden shrink-0 flex-col gap-1 border-r bg-background px-3 py-4 transition-[width] duration-200 md:flex",
          collapsed ? "w-[60px]" : "w-[248px]",
        )}
      >
        <button
          type="button"
          className={cn(
            "flex cursor-pointer items-center rounded-md pt-1 pb-3.5",
            collapsed ? "justify-center" : "px-2",
          )}
          onClick={() => setActiveView("overview")}
          title="Về trang chủ"
          aria-label="T-WorkSpace · Về trang chủ"
        >
          {/* Collapsed, the 35px rail is narrower than the 43px mark: shrink it to fit. */}
          <TWorkSpaceLogo
            size="sm"
            showText={!collapsed}
            className={cn(collapsed && "[&_img]:h-auto [&_img]:w-8")}
          />
        </button>

        <button
          type="button"
          className={cn(
            "mb-2 flex cursor-pointer items-center gap-2 rounded-md border bg-card py-2 text-[14.5px] leading-[1.5] whitespace-nowrap text-muted-foreground hover:text-foreground",
            collapsed ? "justify-center" : "px-2.5",
          )}
          onClick={() => setSearchOpen(true)}
          aria-label="Tìm kiếm (Ctrl+K)"
          title="Tìm kiếm (Ctrl+K)"
        >
          {collapsed && <Icon name="search" size={18} />}
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Tìm kiếm, đi nhanh…</span>
              <kbd className="rounded-md border px-1.5 text-[11.5px]" aria-hidden="true">
                Ctrl K
              </kbd>
            </>
          )}
        </button>

        <nav className="flex flex-col gap-1 overflow-y-auto" aria-label="Menu chức năng chính">
          {MENU_GROUPS.map((group) => {
            const items = visibleItems.filter((item) => item.group === group.id);
            if (items.length === 0) return null;
            return (
              <div key={group.id} role="group" aria-label={group.label} className="contents">
                {collapsed ? (
                  <hr className="mx-2 my-2 border-t" />
                ) : (
                  <div className="px-2.5 pt-3.5 pb-1 text-[11.5px] leading-[1.5] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                    {group.label}
                  </div>
                )}
                {items.map((item) => {
                  const selected = isItemActive(item);
                  const badge = badgeFor(item);
                  return (
                    // A real link: Ctrl/middle-click opens the page in a new tab.
                    <a
                      key={item.id}
                      href={item.targetView && appRouteUrl({ view: item.targetView })}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md py-2 text-[14.5px] leading-[1.5] font-medium transition-colors",
                        collapsed ? "justify-center" : "px-2.5",
                        selected
                          ? "bg-accent font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      aria-current={selected ? "page" : undefined}
                      title={item.label}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                        event.preventDefault();
                        openItem(item);
                      }}
                    >
                      <NavIcon id={item.id} />
                      <span className={collapsed ? "sr-only" : "flex-1 truncate"}>
                        {item.short ?? item.label}
                      </span>
                      {isLive(item) && (
                        <span
                          className={cn(
                            "size-2 rounded-full bg-red-500 ring-4 ring-red-500/20",
                            collapsed && "absolute top-1.5 right-1.5",
                          )}
                          role="img"
                          aria-label="đang diễn ra"
                        />
                      )}
                      {badge > 0 && (
                        <span className={cn(COUNT_BADGE, collapsed && "absolute -top-1 -right-1")}>
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="tw flex h-14 shrink-0 items-center gap-1.5 border-b bg-background px-3 md:px-4">
          <button
            type="button"
            className={cn(ICON_BUTTON, "hidden md:grid")}
            onClick={toggleCollapsed}
            aria-pressed={collapsedPref}
            aria-label="Thu gọn thanh bên"
            title={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
          >
            <Icon name="split" size={18} />
          </button>
          <button
            type="button"
            className="cursor-pointer md:hidden"
            onClick={() => setActiveView("overview")}
            aria-label="T-WorkSpace · Về trang chủ"
          >
            {/* On a phone the agent's status chip needs the room the wordmark takes. */}
            <TWorkSpaceLogo
              size="sm"
              className={cn(phone.agentState && "max-sm:[&>span]:hidden")}
            />
          </button>
          <span className="flex-1" />

          {phone.agentState && (
            <button
              type="button"
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-10",
                TINT[STATE_TONE[phone.agentState]],
              )}
              title="Trạng thái nhận cuộc gọi · mở bàn làm việc"
              onClick={() => setActiveView("call-center")}
            >
              <span className="size-[7px] rounded-full bg-current" aria-hidden="true" />
              <span>{STATE_LABEL[phone.agentState]}</span>
            </button>
          )}

          <button
            type="button"
            className={cn(ICON_BUTTON, "md:hidden")}
            onClick={() => setSearchOpen(true)}
            aria-label="Tìm kiếm"
          >
            <Icon name="search" size={18} />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={toggleTheme}
            aria-pressed={theme === "dark"}
            aria-label="Giao diện tối"
            title={theme === "dark" ? "Chuyển sang nền sáng" : "Chuyển sang nền tối"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            title="Thông báo"
            aria-label={
              unreadNotifications ? `Thông báo (${unreadNotifications} chưa đọc)` : "Thông báo"
            }
            onClick={() => setActiveView("notifications")}
          >
            <Icon name="bell" size={18} />
            {unreadNotifications > 0 && (
              <span className="absolute top-2 right-2 size-2 rounded-full bg-brand ring-2 ring-background" />
            )}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={avatarButtonRef}
                type="button"
                className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md py-1 pr-2 pl-1 text-left max-sm:pr-1 hover:bg-accent"
                title={`Tài khoản: ${displayName}`}
                aria-label={`Tài khoản: ${displayName}`}
              >
                <span className="relative">
                  {avatar("size-8")}
                  <span
                    className={cn(
                      "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background",
                      PRESENCE_DOT[presence],
                    )}
                    title={PRESENCE_LABEL[presence]}
                  />
                </span>
                <span className="hidden max-w-[180px] min-w-0 leading-tight sm:block">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {displayName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
                </span>
                <Icon
                  name="chevron-down"
                  size={16}
                  className="text-muted-foreground max-sm:hidden"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100] min-w-[220px]">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-semibold">{displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setActiveView("profile")}>
                <Icon name="profile" size={16} /> Trang cá nhân
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTheme}>
                <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
                {theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setLogoutConfirmOpen(true)}>
                <Icon name="logout" size={16} /> Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Calls and meetings in progress, on every page but their own. An empty strip collapses in CSS. */}
        <div className="tw flex shrink-0 flex-wrap items-center gap-2 border-b px-[var(--shell-gutter)] py-1.5 empty:hidden max-md:px-3">
          <GlobalCallBar />
          {showMeetingStrip && (
            <div className={cn(STRIP_ITEM, TINT.red)} role="status">
              <span className={STRIP_DOT} aria-hidden="true" />
              <strong className="font-semibold">Đang họp</strong>
              <span className="min-w-0 truncate text-foreground">Bạn vẫn đang trong phòng họp</span>
              <button
                type="button"
                className={STRIP_BTN}
                onClick={() =>
                  meetingWorkspaceId
                    ? openChannel(meetingWorkspaceId, meeting.roomId, true)
                    : setActiveView("meetings")
                }
              >
                Quay lại phòng
              </button>
            </div>
          )}
        </div>

        <div
          className={cn(
            "relative flex min-h-0 flex-1 overflow-hidden max-md:pb-[calc(60px+env(safe-area-inset-bottom,0px))]",
          )}
        >
          <div
            ref={scrollRef}
            className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background"
          >
            {connectionStatus !== "connected" && (
              <div
                className="tw relative z-[45] flex items-center justify-center gap-2.5 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                role="status"
                aria-live="polite"
              >
                <span className="size-2 rounded-full bg-current" />
                <span>
                  {connectionStatus === "connecting" &&
                    "Đang kết nối tới máy chủ thời gian thực..."}
                  {connectionStatus === "reconnecting" &&
                    "Mất kết nối mạng. Đang tự động kết nối lại..."}
                  {connectionStatus === "disconnected" &&
                    "Mất kết nối với máy chủ. Vui lòng kiểm tra mạng."}
                </span>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-current px-2 py-0.5 text-[11px] font-semibold"
                  onClick={() => reconnect()}
                  title="Thử kết nối lại ngay"
                >
                  Thử lại ngay
                </button>
              </div>
            )}

            <main id="main-content" className="flex h-full min-h-0 flex-1 flex-col">
              <div className="page-blocks flex h-full min-h-0 flex-1 flex-col">{renderPage()}</div>
            </main>
          </div>
        </div>
      </div>

      {/* Phones: the four services and "Thêm" for the rest. */}
      <nav
        className="tw fixed inset-x-0 bottom-0 z-[60] grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Menu nhanh"
      >
        {visibleItems
          .filter((item) => BOTTOM_BAR_ITEMS.has(item.id))
          .map((item) => {
            const selected = isItemActive(item);
            const badge = badgeFor(item);
            return (
              <a
                key={item.id}
                href={item.targetView && appRouteUrl({ view: item.targetView })}
                className={cn(
                  "relative flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
                aria-current={selected ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  openItem(item);
                }}
              >
                <NavIcon id={item.id} size={20} />
                <span className="max-w-full truncate px-1">{item.short ?? item.label}</span>
                {isLive(item) && (
                  <span className="absolute top-2 right-[calc(50%-18px)] size-2 rounded-full bg-red-500" />
                )}
                {badge > 0 && (
                  <span className={cn(COUNT_BADGE, "absolute top-1.5 right-[calc(50%-24px)]")}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </a>
            );
          })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-[60px] cursor-pointer flex-col items-center justify-center gap-1 text-[11px] font-medium",
                moreItems.some(isItemActive) ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon name="menu" size={20} />
              Thêm
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="z-[100] min-w-[220px]">
            {moreItems.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => openItem(item)}>
                <NavIcon id={item.id} size={16} /> {item.label}
                {badgeFor(item) > 0 && (
                  <span className={cn(COUNT_BADGE, "ml-auto")}>{badgeFor(item)}</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* Dialogs, outside the page area. */}
      <div className="contents">
        <NotionSearchModal
          isOpen={searchOpen}
          accessToken={accessToken}
          onClose={() => setSearchOpen(false)}
          onSelectMessage={(message, query) => {
            openChatSearchResult({
              workspaceId: message.workspaceId ?? undefined,
              channelId: message.channelId,
              messageId: message.id,
              query,
            });
            setSearchOpen(false);
          }}
          onSelectView={(view) => {
            setActiveView(view);
            setSearchOpen(false);
          }}
        />

        <AnimatePresence>
          {logoutConfirmOpen && (
            <LogoutConfirmDialog
              onClose={() => {
                setLogoutConfirmOpen(false);
                requestAnimationFrame(() => avatarButtonRef.current?.focus());
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
