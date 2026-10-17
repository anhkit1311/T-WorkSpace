import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useApp } from "../providers/AppContext";
import { useSocket } from "../providers/SocketContext";
import { useMeeting } from "../providers/MeetingContext";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { TdtuLogo } from "../../shared/ui/TdtuLogo";
import { NotionSearchModal } from "../../features/search/NotionSearchModal";
import { LogoutConfirmDialog } from "../../features/auth/LogoutConfirmDialog";
import { PageErrorBoundary } from "../../shared/ui/PageErrorBoundary";
import { governanceApi } from "../../features/workspaces/api";
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
const CallCenterWorkspace = lazy(() =>
  import("../../features/call-center/CallCenterWorkspace").then((m) => ({
    default: m.CallCenterWorkspace,
  })),
);
const CallDirectoryPage = lazy(() =>
  import("../../features/call-center/CallDirectoryPage").then((m) => ({
    default: m.CallDirectoryPage,
  })),
);
const ELearningPage = lazy(() =>
  import("../../features/elearning/ELearningPage").then((m) => ({
    default: m.ELearningPage,
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

interface SidebarMenuItem {
  id: string;
  label: string;
  icon: IconName;
  targetView: ViewId;
  badgeKey?: "notifications" | "messages";
}

const SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { id: "home", label: "Trang chủ", icon: "home", targetView: "overview" },
  { id: "schedule", label: "Thời khóa biểu", icon: "calendar", targetView: "thesis" },
  { id: "tasks", label: "Bảng phân công", icon: "table", targetView: "tasks" },
  { id: "switchboard", label: "Tổng đài", icon: "grid", targetView: "call-center" },
  { id: "call-list", label: "Danh sách cuộc gọi", icon: "phone-call", targetView: "call-directory" },
  { id: "messages", label: "Nhắn tin", icon: "message", targetView: "chat", badgeKey: "messages" },
  { id: "meetings", label: "Hội nghị", icon: "video", targetView: "meetings" },
  { id: "elearning", label: "Đào tạo (E-Learning)", icon: "graduation-cap", targetView: "elearning" },
  { id: "staff", label: "Danh sách nhân sự", icon: "users", targetView: "workspace" },
  { id: "departments", label: "Khoa / Phòng ban", icon: "building", targetView: "admin" },
  { id: "notifications", label: "Quản lý thông báo", icon: "bell", targetView: "notifications", badgeKey: "notifications" },
  { id: "roles", label: "Tài khoản & phân quyền", icon: "shield", targetView: "admin" },
  { id: "profile", label: "Trang cá nhân", icon: "profile", targetView: "profile" },
  { id: "settings", label: "Cài đặt", icon: "settings", targetView: "profile" },
];

export function AppShell() {
  const {
    activeView,
    route,
    setActiveView,
    user,
    accessToken,
    openChatSearchResult,
    openChannel,
  } = useApp();
  const { connectionStatus, reconnect, unreadCount, socket } = useSocket();
  const meeting = useMeeting();

  const [activeMenuId, setActiveMenuId] = useState<string>("home");
  const [meetingWorkspaceId, setMeetingWorkspaceId] = useState("");
  useEffect(() => {
    if (!meeting.inCall) setMeetingWorkspaceId("");
    else if (activeView === "meetings" && route.workspaceId) setMeetingWorkspaceId(route.workspaceId);
  }, [meeting.inCall, activeView, route.workspaceId]);
  const showMeetingChip = meeting.inCall && activeView !== "meetings";

  const [unreadNotifications, setUnreadNotifications] = useState(1);
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

  // Keep activeMenuId synced with current view
  useEffect(() => {
    if (activeView === "overview") setActiveMenuId("home");
    else if (activeView === "call-center") setActiveMenuId("switchboard");
    else if (activeView === "call-directory") setActiveMenuId("call-list");
    else if (activeView === "chat") setActiveMenuId("messages");
    else if (activeView === "tasks") setActiveMenuId("tasks");
    else if (activeView === "meetings") setActiveMenuId("meetings");
    else if (activeView === "notifications") setActiveMenuId("notifications");
    else if (activeView === "elearning") setActiveMenuId("elearning");
    else if (activeView === "thesis") setActiveMenuId("schedule");
    else if (activeView === "admin") setActiveMenuId("roles");
    else if (activeView === "profile") setActiveMenuId("profile");
    else if (activeView === "workspace") setActiveMenuId("staff");
  }, [activeView]);

  const [lang, setLang] = useState<"VI" | "EN">("VI");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  });

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

  const displayName = user?.displayName?.trim() || "Nguyễn Đăng Khoa";
  const userEmail = user?.email || "";
  const presence =
    user?.showActivity === false || connectionStatus === "disconnected"
      ? "offline"
      : connectionStatus === "connected"
        ? "online"
        : "connecting";

  // Account popover closes on outside click or Escape
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

  const isWorkspaceScope = isWorkspaceTabView(activeView);
  const shellViewKey = isWorkspaceScope ? "workspace-shell" : activeView;

  const renderPage = () => {
    if (route.invalid)
      return (
        <section className="page-load-error" role="alert" style={{ padding: 40, textAlign: "center" }}>
          <h2>Đường dẫn không hợp lệ</h2>
          <p>Trang hoặc mã tài nguyên trong liên kết không tồn tại.</p>
          <button className="button button--primary" onClick={() => setActiveView("overview")}>
            Về trang chủ
          </button>
        </section>
      );
    let Component;
    if (activeView === "overview") Component = <WorkspaceHomePage />;
    else if (activeView === "call-center") Component = <CallCenterWorkspace />;
    else if (activeView === "call-directory") Component = <CallDirectoryPage />;
    else if (isWorkspaceScope) Component = <WorkspaceShell />;
    else if (activeView === "profile") Component = <ProfilePage />;
    else if (activeView === "admin") Component = <WorkspaceAdminPage />;
    else if (activeView === "invitation") Component = <InvitationPage />;
    else if (activeView === "notifications") Component = <NotificationsPage />;
    else if (activeView === "elearning") Component = <ELearningPage />;
    else if (activeView === "thesis") Component = <ThesisPage />;
    else Component = <WorkspaceHomePage />;

    return (
      <PageErrorBoundary key={shellViewKey}>
        <Suspense fallback={<ViewFallback />}>
          {Component}
        </Suspense>
      </PageErrorBoundary>
    );
  };

  return (
    <div className="app-shell">
      {/* 56px Top Header */}
      <header className="editorial-master-topbar tdtu-header">
        <div className="tdtu-header__left">
          <button
            type="button"
            className="tdtu-header__brand-btn"
            onClick={() => {
              setActiveMenuId("home");
              setActiveView("overview");
            }}
            title="Cổng nội bộ TDTU"
          >
            <TdtuLogo />
          </button>

          <button
            type="button"
            className="tdtu-header__home-btn"
            title="Trang chủ"
            onClick={() => {
              setActiveMenuId("home");
              setActiveView("overview");
            }}
          >
            <Icon name="home" size={17} />
          </button>

          <div
            className="tdtu-header__search"
            onClick={() => setSearchOpen(true)}
            role="search"
          >
            <Icon name="search" size={14} className="tdtu-header__search-icon" />
            <input
              type="text"
              readOnly
              placeholder="Tìm kiếm"
              className="tdtu-header__search-input"
              onClick={() => setSearchOpen(true)}
            />
          </div>
        </div>

        <div className="tdtu-header__right">
          {showMeetingChip && (
            <button
              type="button"
              className="button button--sm button--primary"
              style={{ gap: 6, borderRadius: 9999 }}
              title="Quay lại cuộc họp"
              onClick={() =>
                meetingWorkspaceId
                  ? openChannel(meetingWorkspaceId, meeting.roomId, true)
                  : setActiveView("meetings")
              }
            >
              <Icon name="video" size={14} />
              <span>Đang họp</span>
            </button>
          )}

          {/* Language Switcher VI | EN */}
          <div className="tdtu-lang-switcher" aria-label="Chuyển đổi ngôn ngữ">
            <Icon name="languages" size={13} className="tdtu-lang-switcher__icon" />
            <button
              type="button"
              className={`tdtu-lang-switcher__btn ${lang === "VI" ? "is-active" : ""}`}
              onClick={() => setLang("VI")}
            >
              VI
            </button>
            <button
              type="button"
              className={`tdtu-lang-switcher__btn ${lang === "EN" ? "is-active" : ""}`}
              onClick={() => setLang("EN")}
            >
              EN
            </button>
          </div>

          {/* Dark Mode Toggle */}
          <button
            type="button"
            className="tdtu-icon-btn"
            title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
            aria-label="Chế độ giao diện"
            onClick={toggleTheme}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>

          {/* Notifications Bell with Red Badge */}
          <button
            type="button"
            className="tdtu-icon-btn"
            title="Quản lý thông báo"
            aria-label={`Thông báo (${unreadNotifications || 1} chưa đọc)`}
            onClick={() => {
              setActiveMenuId("notifications");
              setActiveView("notifications");
            }}
          >
            <Icon name="bell" size={16} />
            <span className="tdtu-badge-num">
              {unreadNotifications > 0 ? (unreadNotifications > 99 ? "99+" : unreadNotifications) : 1}
            </span>
          </button>

          {/* User Profile Avatar */}
          <div className="tdtu-avatar-wrap" ref={accountRef}>
            <button
              ref={avatarButtonRef}
              type="button"
              className="tdtu-avatar-btn"
              title={`Tài khoản: ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen(!profileOpen)}
            >
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={displayName}
                  className="tdtu-avatar-img"
                />
              ) : (
                <div className="tdtu-avatar-img">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="tdtu-online-dot" />
            </button>

            <AnimatePresence>
              {profileOpen && (
                <div className="tdtu-account-popover">
                  <div className="tdtu-account-header">
                    <div className="tdtu-avatar-img" style={{ width: 36, height: 36 }}>
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <strong>{displayName}</strong>
                      <small>{userEmail || "Quản trị hệ thống · Tài khoản khoa"}</small>
                    </div>
                  </div>
                  <hr />
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenuId("profile");
                      setActiveView("profile");
                      setProfileOpen(false);
                    }}
                  >
                    <Icon name="profile" size={15} /> Trang cá nhân
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenuId("settings");
                      setActiveView("profile");
                      setProfileOpen(false);
                    }}
                  >
                    <Icon name="settings" size={15} /> Cài đặt hệ thống
                  </button>
                  <button
                    type="button"
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
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Workspace Body: Left 240px Sidebar + Stage Viewport */}
      <div className="editorial-workspace-body tdtu-body">
        {/* Left Sidebar (240px) with exactly 14 items */}
        <aside className="editorial-dock tdtu-sidebar" aria-label="Menu chức năng chính">
          {SIDEBAR_MENU_ITEMS.map((item) => {
            const isSelected = activeMenuId === item.id;
            const badgeCount =
              item.badgeKey === "notifications"
                ? (unreadNotifications > 0 ? unreadNotifications : 1)
                : item.badgeKey === "messages" && unreadCount > 0
                  ? unreadCount
                  : undefined;

            return (
              <button
                key={item.id}
                type="button"
                className={`tdtu-sidebar__item ${isSelected ? "is-active" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                onClick={() => {
                  setActiveMenuId(item.id);
                  setActiveView(item.targetView);
                }}
                title={item.label}
              >
                <Icon name={item.icon} size={18} strokeWidth={isSelected ? 2 : 1.7} />
                <span>{item.label}</span>
                {badgeCount !== undefined && badgeCount > 0 && (
                  <span className="tdtu-sidebar__item-badge">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Content Viewport */}
        <div className="editorial-stage-viewport tdtu-stage">
          {connectionStatus !== "connected" && (
            <div
              className={`network-reconnect-bar status-${connectionStatus}`}
              role="status"
              aria-live="polite"
            >
              <span className="network-reconnect-dot" />
              <span className="network-reconnect-text">
                {connectionStatus === "connecting" && "Đang kết nối tới máy chủ thời gian thực..."}
                {connectionStatus === "reconnecting" && "Mất kết nối mạng. Đang tự động kết nối lại..."}
                {connectionStatus === "disconnected" && "Mất kết nối với máy chủ. Vui lòng kiểm tra mạng."}
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
            <div className="view-transition-wrapper">
              {renderPage()}
            </div>
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
