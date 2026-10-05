import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "../providers/AppContext";
import { useSocket } from "../providers/SocketContext";
import { useMeeting } from "../providers/MeetingContext";
import { Icon } from "../../shared/ui/Icon";
import { Brand, Button, Field, Modal } from "../../shared/ui/Primitives";
import { NotionSearchModal } from "../../features/search/NotionSearchModal";
import { LogoutConfirmDialog } from "../../features/auth/LogoutConfirmDialog";
import { getWorkspacesApi } from "../../features/chat/api";
import { PageErrorBoundary } from "../../shared/ui/PageErrorBoundary";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { governanceApi } from "../../features/workspaces/api";
import { ViewReveal } from "../../shared/motion/ViewReveal";
import { viewTransition } from "../../shared/motion/tokens";
import type { IconName } from "../../shared/ui/Icon";
import type { ViewId } from "../types";

const WorkspaceHomePage = lazy(() =>
  import("../../features/workspaces/WorkspaceHomePage").then((m) => ({
    default: m.WorkspaceHomePage,
  })),
);
const ChatPage = lazy(() =>
  import("../../features/chat/LiveChatPage").then((m) => ({ default: m.ChatPage })),
);
const MeetingPage = lazy(() =>
  import("../../features/meetings/MeetingPage").then((m) => ({ default: m.MeetingPage })),
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
const NotificationsPage = lazy(() =>
  import("../../features/notifications/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const TaskBoardPage = lazy(() =>
  import("../../features/tasks/TaskBoardPage").then((m) => ({ default: m.TaskBoardPage })),
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

const dockItems: { id: ViewId; label: string; icon: IconName; also?: ViewId[] }[] = [
  { id: "overview", label: "Trang chủ", icon: "home" },
  { id: "chat", label: "Tin nhắn", icon: "message" },
  { id: "meetings", label: "Cuộc họp", icon: "video" },
  { id: "tasks", label: "Công việc", icon: "tasks" },
  { id: "notifications", label: "Thông báo", icon: "bell" },
  { id: "admin", label: "Cài đặt", icon: "settings", also: ["profile"] },
];

export function AppShell() {
  const {
    activeView,
    route,
    setActiveView,
    sidebarCollapsed,
    mobileNavOpen,
    setMobileNavOpen,
    notify,
    logout,
    user,
    updateUser,
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
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const refresh = () =>
      void getWorkspacesApi(accessToken)
        .then((items) => {
          if (active) setCanManage(items.some((item) => item.role !== "member"));
        })
        .catch(() => {
          if (active) setCanManage(false);
        });
    refresh();
    socket?.on("connect", refresh);
    socket?.on("access_revoked", refresh);
    return () => {
      active = false;
      socket?.off("connect", refresh);
      socket?.off("access_revoked", refresh);
    };
  }, [accessToken, socket, activeView]);
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
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editName, setEditName] = useState("");

  const displayName = user?.displayName?.trim() || "Chưa cập nhật hồ sơ";
  const userEmail = user?.email || "";
  const initials =
    (user?.displayName || user?.email || "")
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";

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

  const submitEditProfile = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await updateUser({ displayName: trimmed });
      notify("Thành công", "Đã cập nhật thông tin cá nhân.");
      setEditProfileOpen(false);
    } catch (error) {
      notify(
        "Không thể cập nhật",
        error instanceof Error ? error.message : "Vui lòng thử lại.",
        "warning",
      );
    }
  };

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
    else if (activeView === "chat") Component = <ChatPage />;
    else if (activeView === "meetings") Component = <MeetingPage />;
    else if (activeView === "profile") Component = <ProfilePage />;
    else if (activeView === "admin") Component = <WorkspaceAdminPage />;
    else if (activeView === "invitation") Component = <InvitationPage />;
    else if (activeView === "notifications") Component = <NotificationsPage />;
    else if (activeView === "tasks") Component = <TaskBoardPage />;
    else Component = <WorkspaceHomePage />;

    return (
      <PageErrorBoundary key={activeView}>
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
          <button
            type="button"
            className="topbar-action-icon-btn"
            title="Tìm kiếm (Ctrl + K)"
            aria-label="Tìm kiếm"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="search" size={17} />
          </button>
          <button
            type="button"
            className="topbar-action-icon-btn topbar-bell-btn"
            title="Thông báo"
            aria-label={
              unreadNotifications ? `Thông báo (${unreadNotifications} chưa đọc)` : "Thông báo"
            }
            onClick={() => setActiveView("notifications")}
          >
            <Icon name="bell" size={17} />
            <AnimatePresence>
              {unreadNotifications > 0 && (
                <motion.span
                  className="topbar-bell-dot"
                  aria-hidden="true"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: "spring", stiffness: 520, damping: 26 }}
                />
              )}
            </AnimatePresence>
          </button>
          <button
            ref={avatarButtonRef}
            type="button"
            className="topbar-avatar-btn"
            title={`Tài khoản: ${displayName}`}
            aria-label="Hồ sơ cá nhân"
            onClick={() => setProfileOpen(!profileOpen)}
          >
            <img
              src={user?.avatarUrl || "/avatar-fallback.svg"}
              alt={displayName}
              className="topbar-avatar-img"
            />
            <span className="topbar-online-dot" aria-label="Đang trực tuyến" />
          </button>

          <AnimatePresence>
            {profileOpen && (
              <motion.div
                className="sidebar-account-menu topbar-account-popover"
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 6 }}
                transition={{ type: "spring", damping: 26, stiffness: 360 }}
              >
                <div className="sidebar-account-header">
                  <span className="notion-profile-square">{initials}</span>
                  <div>
                    <strong>{displayName}</strong>
                    <small>{userEmail}</small>
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
                  <Icon name="profile" size={15} /> Xem hồ sơ cá nhân
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditName(displayName);
                    setEditProfileOpen(true);
                    setProfileOpen(false);
                  }}
                >
                  <Icon name="settings" size={15} /> Cài đặt nhanh
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
            const target = item.id === "admin" && !canManage ? "profile" : item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                className={`dock-btn ${selected ? "is-active" : ""}`}
                aria-current={selected ? "page" : undefined}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  setActiveView(target);
                  setMobileNavOpen(false);
                }}
                title={item.label}
              >
                {selected && (
                  <motion.span
                    layoutId="dock-active-pill"
                    className="dock-active-pill"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <Icon name={item.icon} size={20} />
                <span className="dock-label">{item.label}</span>
                {item.id === "chat" && unreadCount > 0 && <span className="dock-badge-dot" />}
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

          <main id="main-content" className={`editorial-main-content view-${activeView}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeView}
                className="view-transition-wrapper"
                initial={viewTransition.initial}
                animate={viewTransition.animate}
                exit={viewTransition.exit}
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

      <AnimatePresence>
        {editProfileOpen && (
          <Modal
            title="Cài đặt thông tin cá nhân"
            eyebrow="TÀI KHOẢN"
            onClose={() => setEditProfileOpen(false)}
            footer={
              <div className="modal-footer-split">
                <Button
                  variant="danger"
                  type="button"
                  icon="logout"
                  onClick={() => {
                    setEditProfileOpen(false);
                    void logout();
                  }}
                >
                  Đăng xuất
                </Button>
                <div className="modal-footer-actions">
                  <Button variant="ghost" type="button" onClick={() => setEditProfileOpen(false)}>
                    Hủy
                  </Button>
                  <Button type="submit" form="edit-profile-form">
                    Lưu thay đổi
                  </Button>
                </div>
              </div>
            }
          >
            <form id="edit-profile-form" onSubmit={submitEditProfile}>
              <div className="identity-summary">
                <span className="notion-profile-square identity-summary__avatar">
                  {editName
                    .trim()
                    .split(/\s+/)
                    .slice(-2)
                    .map((p) => p[0]?.toUpperCase())
                    .join("") || initials}
                </span>
                <div className="identity-summary__text">
                  <strong>{editName.trim() || displayName}</strong>
                  <small>{userEmail}</small>
                </div>
              </div>

              <Field
                label="Họ và tên hiển thị"
                hint="Tên đại diện trong các cuộc họp trực tuyến và kênh trao đổi"
              >
                <input
                  autoFocus
                  required
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder="Nhập họ và tên..."
                />
              </Field>

              <Field label="Địa chỉ Email" hint="Tài khoản email dùng để đăng nhập hệ thống">
                <input type="email" value={userEmail} disabled readOnly />
              </Field>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
