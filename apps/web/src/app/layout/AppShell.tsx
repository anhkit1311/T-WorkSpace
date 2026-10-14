import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "../providers/AppContext";
import { useSocket } from "../providers/SocketContext";
import { useMeeting } from "../providers/MeetingContext";
import { Icon } from "../../shared/ui/Icon";
import { Brand, Button } from "../../shared/ui/Primitives";
import { NotionSearchModal } from "../../features/search/NotionSearchModal";
import { LogoutConfirmDialog } from "../../features/auth/LogoutConfirmDialog";
import { PageErrorBoundary } from "../../shared/ui/PageErrorBoundary";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { governanceApi } from "../../features/workspaces/api";
import { ViewReveal } from "../../shared/motion/ViewReveal";
import { SPRING, DURATION } from "../../shared/motion/tokens";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import type { IconName } from "../../shared/ui/Icon";
import type { ViewId } from "../types";
import { isWorkspaceTabView } from "../navigation";

const WorkspaceHomePage = lazy(() =>
  import("../../features/workspaces/WorkspaceHomePage").then((m) => ({
    default: m.WorkspaceHomePage,
  })),
);
const WorkspaceShell = lazy(() =>
  import("../../features/workspaces/WorkspaceShell").then((m) => ({
    default: m.WorkspaceShell,
  })),
);
const ProfilePage = lazy(() =>
  import("../../features/profile/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const WorkspaceAdminPage = lazy(() =>
  import("../../features/workspaces/WorkspaceAdminPage").then((m) => ({
    default: m.WorkspaceAdminPage,
  })),
);
const InvitationPage = lazy(() =>
  import("../../features/workspaces/InvitationPage").then((m) => ({ default: m.InvitationPage })),
);
const ThesisPage = lazy(() =>
  import("../../features/thesis/ThesisPage").then((m) => ({ default: m.ThesisPage })),
);
const NotificationsPage = lazy(() =>
  import("../../features/notifications/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
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

const dockItems: { id: ViewId; label: string; title?: string; icon: IconName; also?: ViewId[] }[] = [
  { id: "overview", label: "Trang chủ", icon: "home" },
  {
    id: "workspace",
    label: "Nhóm",
    title: "Nhóm làm việc",
    icon: "users",
    also: ["chat", "tasks", "meetings", "files"],
  },
  { id: "thesis", label: "Đồ án", title: "Quản lý đồ án tốt nghiệp", icon: "book" },
  { id: "notifications", label: "Thông báo", icon: "bell" },
  {
    id: "profile",
    label: "Cài đặt",
    title: "Cài đặt trang cá nhân",
    icon: "settings",
    also: ["admin"],
  },
];

export function AppShell() {
  const safe = useMotionSafe();
  const {
    activeView,
    route,
    setActiveView,
    sidebarCollapsed,
    mobileNavOpen,
    setMobileNavOpen,
    user,
    accessToken,
    openChatSearchResult,
    openChannel,
  } = useApp();
  const { connectionStatus, reconnect, unreadCount, socket } = useSocket();
  const meeting = useMeeting();
  // The call keeps running off the meetings view; remember its workspace for the way back.
  const [meetingWorkspaceId, setMeetingWorkspaceId] = useState("");
  useEffect(() => {
    if (!meeting.inCall) setMeetingWorkspaceId("");
    else if (activeView === "meetings" && route.workspaceId) setMeetingWorkspaceId(route.workspaceId);
  }, [meeting.inCall, activeView, route.workspaceId]);
  const showMeetingChip = meeting.inCall && activeView !== "meetings";
  const mobileNavRef = usePanelDialog(
    () => setMobileNavOpen(false),
    mobileNavOpen,
    ".mobile-overlay",
  );
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const refresh = () =>
      void governanceApi<{ unreadCount: number }>(accessToken, "notifications?unread=true")
        .then((page) => {
          if (active) setUnreadNotifications(page.unreadCount);
        })
        .catch(() => { /* The bell badge is advisory; reconnect/event refresh retries. The full inbox has a visible error state. */ });
    refresh();
    socket?.on("notifications_changed", refresh);
    socket?.on("connect", refresh);
    return () => {
      active = false;
      socket?.off("notifications_changed", refresh);
      socket?.off("connect", refresh);
    };
  }, [accessToken, socket]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

  const displayName = user?.displayName?.trim() || "Chưa cập nhật hồ sơ";
  const userEmail = user?.email || "";
  // Presence mirrors what teammates see: hidden activity always reads as offline.
  const presence =
    user?.showActivity === false || connectionStatus === "disconnected"
      ? "offline"
      : connectionStatus === "connected"
        ? "online"
        : "connecting";
  const presenceLabel = {
    online: "Đang trực tuyến",
    connecting: "Đang kết nối",
    offline: user?.showActivity === false ? "Đang ẩn hoạt động" : "Ngoại tuyến",
  }[presence];

  // Account popover closes on outside click or Escape.
  useEffect(() => {
    if (!profileOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setProfileOpen(false);
        return;
      }
      if (!accountRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [profileOpen]);

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

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 961px)");
    const closeMobileNav = () => {
      if (desktop.matches) setMobileNavOpen(false);
    };
    desktop.addEventListener("change", closeMobileNav);
    closeMobileNav();
    return () => desktop.removeEventListener("change", closeMobileNav);
  }, [setMobileNavOpen]);

  const isWorkspaceScope = isWorkspaceTabView(activeView);
  const shellViewKey = isWorkspaceScope ? "workspace-shell" : activeView;

  const renderPage = () => {
    if (route.invalid)
      return (
        <section className="page-load-error" role="alert">
          <h2>Đường dẫn không hợp lệ</h2>
          <p>Trang hoặc mã tài nguyên trong liên kết không tồn tại.</p>
          <Button icon="home" onClick={() => setActiveView("overview")}>
            Về trang chủ
          </Button>
        </section>
      );
    let Component;
    if (activeView === "overview") Component = <WorkspaceHomePage />;
    else if (isWorkspaceScope) Component = <WorkspaceShell />;
    else if (activeView === "profile") Component = <ProfilePage />;
    else if (activeView === "admin") Component = <WorkspaceAdminPage />;
    else if (activeView === "invitation") Component = <InvitationPage />;
    else if (activeView === "notifications") Component = <NotificationsPage />;
    else if (activeView === "thesis") Component = <ThesisPage />;
    else Component = <WorkspaceHomePage />;

    return (
      <PageErrorBoundary key={shellViewKey}>
        <Suspense fallback={<ViewFallback />}>
          <ViewReveal>{Component}</ViewReveal>
        </Suspense>
      </PageErrorBoundary>
    );
  };

  return (
    <div
      className={`app-shell editorial-workspace-shell ${sidebarCollapsed ? "is-collapsed" : ""}`}
    >
      {mobileNavOpen && (
        <button
          aria-label="Đóng thanh điều hướng"
          className="mobile-overlay"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Top Master Floating Bar matching reference */}
      <header className="editorial-master-topbar">
        <div className="editorial-master-topbar__left">
          <Brand onClick={() => setActiveView("overview")} />
        </div>

        <div className="editorial-master-topbar__right">
          {showMeetingChip && (
            <button
              type="button"
              className="topbar-meeting-chip"
              title="Quay lại cuộc họp"
              aria-label={`Quay lại cuộc họp đang diễn ra${meeting.mic ? "" : " (micro đang tắt)"}`}
              onClick={() =>
                meetingWorkspaceId
                  ? openChannel(meetingWorkspaceId, meeting.roomId, true)
                  : setActiveView("meetings")
              }
            >
              <span className="topbar-meeting-chip__dot" aria-hidden="true" />
              <Icon name="video" size={15} className="topbar-meeting-chip__icon" />
              <span className="topbar-meeting-chip__label">Đang họp</span>
              {!meeting.mic && <Icon name="mic-off" size={14} className="topbar-meeting-chip__mic" />}
            </button>
          )}
          <Button
            type="button"
            variant="icon"
            icon="search"
            className="topbar-action-icon-btn"
            title="Tìm kiếm (Ctrl + K)"
            aria-label="Tìm kiếm"
            onClick={() => setSearchOpen(true)}
          />
          <Button
            type="button"
            variant="icon"
            icon="bell"
            className="topbar-action-icon-btn topbar-bell-btn"
            title="Thông báo"
            aria-label={
              unreadNotifications ? `Thông báo (${unreadNotifications} chưa đọc)` : "Thông báo"
            }
            onClick={() => setActiveView("notifications")}
          >
            <AnimatePresence>
              {unreadNotifications > 0 && (
                <motion.span
                  className="topbar-bell-dot"
                  aria-hidden="true"
                  initial={safe.reduced ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: safe.reduced ? 1 : 0 }}
                  transition={safe.reduced ? {duration:0} : SPRING.bouncy}
                />
              )}
            </AnimatePresence>
          </Button>
          <div className="topbar-account" ref={accountRef}>
            <button
              ref={avatarButtonRef}
              type="button"
              className="topbar-avatar-btn"
              title={`Tài khoản: ${displayName} · ${presenceLabel}`}
              aria-label={`Tài khoản: ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen(!profileOpen)}
            >
              <img
                src={user?.avatarUrl || "/avatar-fallback.svg"}
                alt=""
                className="topbar-avatar-img"
              />
              <span className={`topbar-online-dot is-${presence}`} aria-label={presenceLabel} />
            </button>

            <AnimatePresence>
              {profileOpen && (
                <motion.div
                  className="sidebar-account-menu topbar-account-popover"
                  initial={safe.reduced ? false : { opacity: 0, scale: 0.95, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: safe.reduced ? 1 : 0, scale: safe.reduced ? 1 : 0.95, y: safe.reduced ? 0 : 6, transition: {duration:safe.duration(DURATION.panelExit)} }}
                  transition={safe.reduced ? {duration:0} : SPRING.gentle}
                >
                  <div className="sidebar-account-header">
                    <img
                      src={user?.avatarUrl || "/avatar-fallback.svg"}
                      alt=""
                      className="topbar-account-avatar"
                    />
                    <div>
                      <strong>{displayName}</strong>
                      <small>{userEmail}</small>
                      <span className={`topbar-presence-label is-${presence}`}>
                        <i /> {presenceLabel}
                      </span>
                    </div>
                  </div>
                  <hr />
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("profile");
                      setProfileOpen(false);
                    }}
                  >
                    <Icon name="profile" size={15} /> Hồ sơ & Cài đặt cá nhân
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      setLogoutConfirmOpen(true);
                    }}
                  >
                    <Icon name="logout" size={15} /> Đăng xuất
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>
      <AnimatePresence>
        {logoutConfirmOpen && (
          <LogoutConfirmDialog
            onClose={() => {
              setLogoutConfirmOpen(false);
              // The menu item that opened the dialog is gone; return to the avatar button.
              requestAnimationFrame(() => avatarButtonRef.current?.focus());
            }}
          />
        )}
      </AnimatePresence>

      {/* Main Workspace Body: Left Dock + Stage */}
      <div className="editorial-workspace-body">
        {/* Left Vertical Dock */}
        <aside
          ref={mobileNavRef}
          className={`editorial-dock ${mobileNavOpen ? "is-mobile-open" : ""}`}
          aria-label="Điều hướng chính"
        >
          {dockItems.map((item) => {
            const selected = activeView === item.id || Boolean(item.also?.includes(activeView));
            return (
              <motion.button
                key={item.id}
                type="button"
                className={`dock-btn ${selected ? "is-active" : ""}`}
                aria-current={selected ? "page" : undefined}
                whileTap={safe.reduced ? undefined : { scale: 0.97 }}
                onClick={() => {
                  setActiveView(item.id);
                  setMobileNavOpen(false);
                }}
                title={item.title ?? item.label}
              >
                {selected && (
                  <motion.span
                    layoutId="dock-active-pill"
                    className="dock-active-pill"
                    transition={safe.reduced ? {duration:0} : SPRING.snappy}
                  />
                )}
                <Icon name={item.icon} size={20} />
                <span className="dock-label">{item.label}</span>
                {item.id === "workspace" && unreadCount > 0 && <span className="dock-badge-dot" />}
                {item.id === "notifications" && unreadNotifications > 0 && (
                  <span className="dock-badge-dot" />
                )}
              </motion.button>
            );
          })}
        </aside>

        {/* Content Viewport */}
        <div className="editorial-stage-viewport">
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={shellViewKey}
                className="view-transition-wrapper"
                initial={safe.view.initial}
                animate={safe.view.animate}
                exit={safe.view.exit}
              >
                {renderPage()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <NotionSearchModal
        isOpen={searchOpen}
        accessToken={accessToken}
        onClose={() => setSearchOpen(false)}
        onSelectMessage={(message, query) => {
          openChatSearchResult({
            workspaceId: message.workspaceId,
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
    </div>
  );
}
