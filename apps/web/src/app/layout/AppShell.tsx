import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "../providers/AppContext";
import { useSocket } from "../providers/SocketContext";
import { Icon } from "../../shared/ui/Icon";
import { Brand, Button, Field, Modal } from "../../shared/ui/Primitives";
import { NotionSearchModal } from "../../features/search/NotionSearchModal";
import { getWorkspacesApi } from "../../features/chat/api";
import { PageErrorBoundary } from "../../shared/ui/PageErrorBoundary";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";

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
  } = useApp();
  const { connectionStatus, reconnect, unreadCount, socket } = useSocket();
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
  const [profileOpen, setProfileOpen] = useState(false);
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
        <section role="alert">
          <h2>Đường dẫn không hợp lệ</h2>
          <p>Trang hoặc mã tài nguyên trong liên kết không tồn tại.</p>
          <button onClick={() => setActiveView("overview")}>Về trang chủ</button>
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
        <Suspense fallback={<ViewFallback />}>{Component}</Suspense>
      </PageErrorBoundary>
    );
  };

  return (
    <div
      className={`app-shell editorial-workspace-shell ${sidebarCollapsed ? "is-collapsed" : ""}`}
    >
      <div className="editorial-workspace-video-layer" aria-hidden="true">
        <video
          className="editorial-workspace-video"
          src="https://designerstephen.github.io/public-assets/videos/serene-art-hero.mp4"
          poster="https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2000&q=80"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
        <div className="editorial-workspace-overlay" />
      </div>
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
            aria-label="Thông báo"
            onClick={() => setActiveView("notifications")}
          >
            <Icon name="bell" size={17} />
            <span className="topbar-bell-dot" aria-hidden="true" />
          </button>
          <button
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
                <button type="button" onClick={() => void logout()}>
                  <Icon name="logout" size={15} /> Đăng xuất
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Main Workspace Body: Left Dock + Stage */}
      <div className="editorial-workspace-body">
        {/* Left Vertical Dock */}
        <aside
          ref={mobileNavRef}
          className={`editorial-dock ${mobileNavOpen ? "is-mobile-open" : ""}`}
          aria-label="Điều hướng chính"
        >
          <button
            type="button"
            className={`dock-btn ${activeView === "overview" ? "is-active" : ""}`}
            onClick={() => {
              setActiveView("overview");
              setMobileNavOpen(false);
            }}
            title="Trang chủ"
          >
            {activeView === "overview" && (
              <motion.span
                layoutId="dock-active-pill"
                className="dock-active-pill"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Icon name="home" size={20} />
            <span className="dock-label">Trang chủ</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeView === "chat" ? "is-active" : ""}`}
            onClick={() => {
              setActiveView("chat");
              setMobileNavOpen(false);
            }}
            title="Tin nhắn"
          >
            {activeView === "chat" && (
              <motion.span
                layoutId="dock-active-pill"
                className="dock-active-pill"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Icon name="message" size={20} />
            <span className="dock-label">Tin nhắn</span>
            {unreadCount > 0 && <span className="dock-badge-dot" />}
          </button>

          <button
            type="button"
            className={`dock-btn ${activeView === "meetings" ? "is-active" : ""}`}
            onClick={() => {
              setActiveView("meetings");
              setMobileNavOpen(false);
            }}
            title="Danh bạ / Hội nghị"
          >
            {activeView === "meetings" && (
              <motion.span
                layoutId="dock-active-pill"
                className="dock-active-pill"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Icon name="users" size={20} />
            <span className="dock-label">Danh bạ</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeView === "tasks" ? "is-active" : ""}`}
            onClick={() => {
              setActiveView("tasks");
              setMobileNavOpen(false);
            }}
            title="Tệp tin / Nhiệm vụ"
          >
            {activeView === "tasks" && (
              <motion.span
                layoutId="dock-active-pill"
                className="dock-active-pill"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Icon name="file" size={20} />
            <span className="dock-label">Tệp tin</span>
          </button>

          <button
            type="button"
            className={`dock-btn ${activeView === "admin" || activeView === "profile" ? "is-active" : ""}`}
            onClick={() => {
              setActiveView(canManage ? "admin" : "profile");
              setMobileNavOpen(false);
            }}
            title="Cài đặt hệ thống"
          >
            {(activeView === "admin" || activeView === "profile") && (
              <motion.span
                layoutId="dock-active-pill"
                className="dock-active-pill"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Icon name="settings" size={20} />
            <span className="dock-label">Cài đặt</span>
          </button>
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.08, ease: "easeOut" } }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}
              >
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
                <div style={{ display: "flex", gap: "8px" }}>
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "12px 14px",
                  background: "var(--bg-subtle, #f5f5f7)",
                  borderRadius: "10px",
                  marginBottom: "18px",
                  border: "1px solid var(--border)",
                }}
              >
                <span
                  className="notion-profile-square"
                  style={{
                    width: "48px",
                    height: "48px",
                    fontSize: "1.1rem",
                    borderRadius: "8px",
                    flexShrink: 0,
                  }}
                >
                  {editName
                    .trim()
                    .split(/\s+/)
                    .slice(-2)
                    .map((p) => p[0]?.toUpperCase())
                    .join("") || initials}
                </span>
                <div style={{ overflow: "hidden" }}>
                  <strong style={{ display: "block", fontSize: "0.95rem" }}>
                    {editName.trim() || displayName}
                  </strong>
                  <small style={{ color: "var(--muted, #868e96)", wordBreak: "break-all" }}>
                    {userEmail}
                  </small>
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
                <input
                  type="email"
                  value={userEmail}
                  disabled
                  readOnly
                  style={{ opacity: 0.7, cursor: "not-allowed" }}
                />
              </Field>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
