import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import { AnimatePresence } from "motion/react";
import { useApp } from "../providers/AppContext";
import { useSocket } from "../providers/SocketContext";
import { useMenuAccess, type MenuAccess } from "./useMenuAccess";
import { useMeetingStatus } from "../providers/MeetingContext";
import { useGlobalSoftphone } from "../providers/SoftphoneContext";
import { GlobalCallBar } from "../../features/call-center/GlobalCallBar";
import { STATE_LABEL, STATE_TONE } from "../../features/call-center/agent-state";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { TWorkSpaceLogo } from "../../shared/ui/TWorkSpaceLogo";
import { NotionSearchModal } from "../../features/search/NotionSearchModal";
import { LogoutConfirmDialog } from "../../features/auth/LogoutConfirmDialog";
import { PageErrorBoundary } from "../../shared/ui/PageErrorBoundary";
import { governanceApi } from "../../features/workspaces/api";
import type { ViewId } from "../types";

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
const FilesPage = lazyPage(() => import("../../features/files/FilesPage").then((m) => m.FilesPage));
const MeetingPage = lazyPage(() =>
  import("../../features/meetings/MeetingPage").then((m) => m.MeetingPage),
);
const GroupsPage = lazyPage(() =>
  import("../../features/workspaces/GroupsPage").then((m) => m.GroupsPage),
);
const MessagesPage = lazyPage(() =>
  import("../../features/chat/MessagesPage").then((m) => m.MessagesPage),
);
const ProfilePage = lazyPage(() =>
  import("../../features/profile/ProfilePage").then((m) => m.ProfilePage),
);
const WorkspaceAdminPage = lazyPage(() =>
  import("../../features/workspaces/WorkspaceAdminPage").then((m) => m.WorkspaceAdminPage),
);
const InvitationPage = lazyPage(() =>
  import("../../features/workspaces/InvitationPage").then((m) => m.InvitationPage),
);
const NotificationsPage = lazyPage(() =>
  import("../../features/notifications/NotificationsPage").then((m) => m.NotificationsPage),
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
  return (
    <div className="page-suspense-fallback" role="status" aria-label="Đang tải dữ liệu...">
      <div className="page-suspense-line is-title" />
      <div className="page-suspense-line is-body" />
      <div className="page-suspense-card" />
    </div>
  );
}

interface SidebarMenuItem {
  id: string;
  label: string;
  icon: IconName;
  targetView?: ViewId;
  badgeKey?: "notifications" | "messages" | "groups";
  /** Label in the top bar and phone bottom bar, where the full one does not fit (the title keeps it). */
  short?: string;
  adminOnly?: boolean;
}

const SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { id: "home", label: "Trang chủ", icon: "home", targetView: "overview" },
  // Its sub-pages (desk, history, monitoring…) are tabs inside the page, chosen by the user's role.
  { id: "switchboard", label: "Tổng đài", icon: "headset", targetView: "call-center" },
  { id: "messages", label: "Tin nhắn", icon: "message", targetView: "chat", badgeKey: "messages" },
  { id: "meetings", label: "Họp", icon: "video", targetView: "meetings" },
  { id: "elearning", label: "Khóa học", icon: "graduation-cap", targetView: "elearning" },
  { id: "staff", label: "Danh sách nhân sự", short: "Nhân sự", icon: "users", targetView: "staff" },
  // Mục dành riêng cho lãnh đạo đơn vị và Admin (menu "Quản lý"); "Cài đặt" nằm trong menu tài khoản.
  { id: "reports", label: "Báo cáo đơn vị", icon: "dashboard", targetView: "reports" },
  {
    id: "notifications",
    label: "Quản lý thông báo",
    icon: "bell",
    targetView: "notifications",
    badgeKey: "notifications",
    adminOnly: true,
  },
  { id: "access", label: "Quản trị hệ thống", icon: "lock", targetView: "access", adminOnly: true },
];

/** The phone bottom bar shows these; the rest open from "Thêm". */
const BOTTOM_BAR_ITEMS = new Set(["home", "switchboard", "messages", "elearning"]);
/** Administration entries: the "Quản lý" menu on desktop, the "Thêm" sheet on phones. */
const MANAGE_ITEMS = new Set(["reports", "notifications", "access"]);
/**
 * Entries shown only to users with that role (see useMenuAccess). The switchboard and call list
 * are the core of the system and always stay visible; the page itself explains missing access.
 */
const RESTRICTED_MENU_ITEMS: Record<string, keyof MenuAccess> = { reports: "unitReports" };

/** Header popovers close on an outside press or Escape (focus returns to the trigger). */
function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, setOpen]);
}

export function AppShell() {
  const { activeView, route, setActiveView, user, accessToken, openChatSearchResult, openChannel } =
    useApp();
  const { connectionStatus, reconnect, unreadCount, groupUnreadCount, socket } = useSocket();
  const meeting = useMeetingStatus();
  const phone = useGlobalSoftphone();
  const menuAccess = useMenuAccess(accessToken);

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

  // Always enforce Light theme across the website
  useEffect(() => {
    try {
      localStorage.removeItem("theme");
    } catch {
      // ignore storage errors
    }
    document.documentElement.setAttribute("data-theme", "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#F4F6F9");
    return () => {
      document.documentElement.removeAttribute("data-theme");
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#F4F6F9");
    };
  }, []);

  const [moreOpen, setMoreOpen] = useState(false);

  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

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

  const [manageOpen, setManageOpen] = useState(false);
  const manageRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useDismiss(profileOpen, accountRef, setProfileOpen);
  useDismiss(manageOpen, manageRef, setManageOpen);
  useDismiss(moreOpen, navRef, setMoreOpen);

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
        : item.badgeKey === "groups"
          ? groupUnreadCount
          : 0;
  const manageItems = visibleItems.filter((item) => MANAGE_ITEMS.has(item.id));
  const manageBadge = manageItems.reduce((sum, item) => sum + badgeFor(item), 0);

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
  const isWorkspaceScope = activeView === "chat" || activeView === "meetings";

  const renderPage = () => {
    if (route.invalid)
      return (
        <section
          className="page-load-error"
          role="alert"
          style={{ padding: 40, textAlign: "center" }}
        >
          <h2>Đường dẫn không hợp lệ</h2>
          <p>Trang hoặc mã tài nguyên trong liên kết không tồn tại.</p>
          <button className="button button--primary" onClick={() => setActiveView("overview")}>
            Về trang chủ
          </button>
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
    else if (activeView === "files") Component = <FilesPage />;
    else if (activeView === "meetings") Component = <MeetingPage />;
    else if (activeView === "elearning") Component = <ELearningPage />;
    else if (activeView === "staff") Component = <StaffDirectoryPage />;
    else if (activeView === "groups") Component = <GroupsPage />;
    else if (activeView === "profile") Component = <ProfilePage />;
    else if (activeView === "admin") Component = <WorkspaceAdminPage />;
    else if (activeView === "invitation") Component = <InvitationPage />;
    else if (activeView === "notifications") Component = <NotificationsPage />;
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

  return (
    <div className="app-shell">
      <header className="tdtu-header">
        <button
          type="button"
          className="tdtu-header__brand-btn"
          onClick={() => setActiveView("overview")}
          title="Về trang chủ"
          aria-label="T-WorkSpace · Về trang chủ"
        >
          <TWorkSpaceLogo size="sm" />
        </button>

        {/* Top tabs on desktop; on phones the same list is a bottom bar whose "Thêm" opens the rest. */}
        <nav
          ref={navRef}
          className={`tdtu-nav ${moreOpen ? "is-more-open" : ""}`}
          aria-label="Menu chức năng chính"
        >
          {visibleItems.map((item) => {
            const isSelected = isItemActive(item);
            const badgeCount = badgeFor(item);
            const live =
              (item.id === "switchboard" && phone.phase !== "none") ||
              (item.id === "meetings" && meeting.inCall);
            return (
              <button
                key={item.id}
                type="button"
                className={`tdtu-nav__item ${isSelected ? "is-active" : ""} ${BOTTOM_BAR_ITEMS.has(item.id) ? "" : "is-secondary"} ${MANAGE_ITEMS.has(item.id) ? "is-manage" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                title={item.label}
                onClick={() => {
                  // The switchboard tab keeps its current sub-page; everything else opens its page.
                  if (item.targetView && !(item.id === "switchboard" && isSelected))
                    setActiveView(item.targetView);
                  setMoreOpen(false);
                }}
              >
                <Icon name={item.icon} size={17} strokeWidth={isSelected ? 2.1 : 1.8} />
                <span className="tdtu-nav__label">{item.short ?? item.label}</span>
                {live && <span className="tdtu-nav__live" role="img" aria-label="đang diễn ra" />}
                {badgeCount > 0 && (
                  <span className="tdtu-nav__badge">{badgeCount > 99 ? "99+" : badgeCount}</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className={`tdtu-nav__item tdtu-nav__more ${visibleItems.some((item) => !BOTTOM_BAR_ITEMS.has(item.id) && isItemActive(item)) ? "is-active" : ""}`}
            aria-haspopup="true"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <Icon name={moreOpen ? "x" : "menu"} size={17} />
            <span className="tdtu-nav__label">{moreOpen ? "Đóng" : "Thêm"}</span>
          </button>
        </nav>

        <div className="tdtu-header__right">
          {manageItems.length > 0 && (
            <div className="tdtu-menu" ref={manageRef}>
              <button
                type="button"
                className={`tdtu-menu__trigger ${manageItems.some(isItemActive) ? "is-active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={manageOpen}
                aria-label="Quản lý"
                title="Quản lý"
                onClick={() => setManageOpen(!manageOpen)}
              >
                <Icon name="dashboard" size={16} />
                <span className="tdtu-menu__label">Quản lý</span>
                {manageBadge > 0 && (
                  <span className="tdtu-nav__badge">{manageBadge > 99 ? "99+" : manageBadge}</span>
                )}
                <Icon name="chevron-down" size={14} className="tdtu-menu__chevron" />
              </button>
              {manageOpen && (
                <div className="tdtu-popover tdtu-menu__panel" role="menu" aria-label="Quản lý">
                  {manageItems.map((item) => {
                    const badgeCount = badgeFor(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className={isItemActive(item) ? "is-active" : ""}
                        onClick={() => {
                          if (item.targetView) setActiveView(item.targetView);
                          setManageOpen(false);
                        }}
                      >
                        <Icon name={item.icon} size={15} />
                        <span>{item.label}</span>
                        {badgeCount > 0 && (
                          <span className="tdtu-nav__badge">
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="tdtu-search-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Tìm kiếm (Ctrl+K)"
            title="Tìm kiếm (Ctrl+K)"
          >
            <Icon name="search" size={15} />
            <span className="tdtu-search-btn__label">Tìm kiếm</span>
            <kbd className="tdtu-search-btn__kbd" aria-hidden="true">
              Ctrl K
            </kbd>
          </button>

          {phone.agentState && (
            <button
              type="button"
              className={`tdtu-agent-pill tone-${STATE_TONE[phone.agentState]}`}
              title="Trạng thái nhận cuộc gọi · mở bàn làm việc"
              onClick={() => setActiveView("call-center")}
            >
              <span className="tdtu-agent-pill__dot" aria-hidden="true" />
              <span className="tdtu-agent-pill__label">{STATE_LABEL[phone.agentState]}</span>
            </button>
          )}

          <button
            type="button"
            className="tdtu-icon-btn"
            title="Thông báo"
            aria-label={
              unreadNotifications ? `Thông báo (${unreadNotifications} chưa đọc)` : "Thông báo"
            }
            onClick={() => setActiveView("notifications")}
          >
            <Icon name="bell" size={17} />
            {unreadNotifications > 0 && (
              <span className="tdtu-badge-num">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </button>

          <div className="tdtu-avatar-wrap" ref={accountRef}>
            <button
              ref={avatarButtonRef}
              type="button"
              className="tdtu-avatar-btn"
              title={`Tài khoản: ${displayName}`}
              aria-label={`Tài khoản: ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen(!profileOpen)}
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="tdtu-avatar-img" />
              ) : (
                <span className="tdtu-avatar-img">{displayName.charAt(0).toUpperCase()}</span>
              )}
              <span
                className={`tdtu-online-dot is-${presence}`}
                title={
                  presence === "online"
                    ? "Đang trực tuyến"
                    : presence === "connecting"
                      ? "Đang kết nối lại"
                      : "Ngoại tuyến"
                }
              />
            </button>

            {profileOpen && (
              <div className="tdtu-popover tdtu-account-popover" role="menu" aria-label="Tài khoản">
                <div className="tdtu-account-header">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="tdtu-avatar-img is-lg" />
                  ) : (
                    <span className="tdtu-avatar-img is-lg">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <strong>{displayName}</strong>
                    <small>{userEmail}</small>
                  </div>
                </div>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className={activeView === "profile" ? "is-active" : ""}
                  onClick={() => {
                    setActiveView("profile");
                    setProfileOpen(false);
                  }}
                >
                  <Icon name="settings" size={15} /> Hồ sơ &amp; cài đặt
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-logout"
                  onClick={() => {
                    setProfileOpen(false);
                    setLogoutConfirmOpen(true);
                  }}
                >
                  <Icon name="logout" size={15} /> Đăng xuất
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Calls and meetings in progress, on every page but their own. An empty strip collapses in CSS. */}
      <div className="live-strip">
        <GlobalCallBar />
        {showMeetingStrip && (
          <div className="live-strip__item" role="status">
            <span className="live-strip__dot" aria-hidden="true" />
            <strong>Đang họp</strong>
            <span className="live-strip__who">Bạn vẫn đang trong phòng họp</span>
            <button
              type="button"
              className="live-strip__btn is-quiet"
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

      <div className="tdtu-body">
        {/* Content Viewport */}
        <div className="tdtu-stage">
          {connectionStatus !== "connected" && (
            <div
              className={`network-reconnect-bar status-${connectionStatus}`}
              role="status"
              aria-live="polite"
            >
              <span className="network-reconnect-dot" />
              <span className="network-reconnect-text">
                {connectionStatus === "connecting" && "Đang kết nối tới máy chủ thời gian thực..."}
                {connectionStatus === "reconnecting" &&
                  "Mất kết nối mạng. Đang tự động kết nối lại..."}
                {connectionStatus === "disconnected" &&
                  "Mất kết nối với máy chủ. Vui lòng kiểm tra mạng."}
              </span>
              <button
                type="button"
                className="network-reconnect-btn"
                onClick={() => reconnect()}
                title="Thử kết nối lại ngay"
              >
                Thử lại ngay
              </button>
            </div>
          )}

          <main
            id="main-content"
            className={`editorial-main-content view-${activeView} ${isWorkspaceScope ? "is-workspace-scope" : ""}`}
          >
            <div className="view-transition-wrapper">{renderPage()}</div>
          </main>
        </div>
      </div>

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
  );
}
