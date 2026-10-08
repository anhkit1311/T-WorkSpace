import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  GroupMemberItem,
  WorkspaceFileItem,
  WorkspaceItem,
  WorkspaceOverviewSummary,
} from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { focusFirstInvalid } from "../../shared/lib/interaction";
import {
  isWorkspaceTabView,
  selectWorkspaceRoute,
  switchWorkspaceTabRoute,
  type WorkspaceTabId,
} from "../../app/navigation";
import {
  createWorkspaceApi,
  getAttachmentBlobApi,
  getWorkspaceMembersApi,
   getWorkspacesApi,
} from "../chat/api";
import {
  getWorkspaceFilesApi,
  getWorkspaceOverviewApi,
  governanceApi,
} from "./api";
import { Avatar, Badge, Button, Chip, Field, IconButton, Modal, ConfirmDialog } from "../../shared/ui/Primitives";
import { AnimatePresence, useAnimate } from "motion/react";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import { DURATION, EASE, tabDirection } from "../../shared/motion/tokens";
import { CreateWorkspaceModal, workspaceNameError } from "./CreateWorkspaceModal";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { ChatPage } from "../chat/LiveChatPage";
import { useUserAvatars } from "../chat/useUserAvatars";
import { TaskBoardPage } from "../tasks/TaskBoardPage";
import { MeetingPage } from "../meetings/MeetingPage";
import "./workspace-shell.css";

const WORKSPACE_TABS: { id: WorkspaceTabId; label: string; icon: IconName }[] = [
  { id: "chat", label: "Trao đổi", icon: "message" },
  { id: "tasks", label: "Công việc", icon: "check-square" },
  { id: "meetings", label: "Cuộc họp", icon: "video" },
  { id: "files", label: "Tài liệu", icon: "folder" },
];

const TASK_STATUS_LABEL: Record<"todo" | "doing" | "done", string> = {
  todo: "Cần làm",
  doing: "Đang làm",
  done: "Hoàn thành",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function roleLabel(role?: WorkspaceItem["role"]): string {
  if (role === "owner") return "Chủ nhóm";
  if (role === "admin") return "Quản trị viên";
  return "Thành viên";
}

export function WorkspaceShell() {
  const {
    accessToken,
    user,
    route,
    navigate,
    openChannel,
    setActiveView,
    notify,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useApp();
  const { socket, isConnected, onlineUserIds } = useSocket();

  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");

  const [overview, setOverview] = useState<WorkspaceOverviewSummary | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  const [members, setMembers] = useState<GroupMemberItem[]>([]);
  const memberAvatarOf = useUserAvatars(useMemo(() => members.map((m) => m.userId), [members]));
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [inviteTokenInput, setInviteTokenInput] = useState("");
  const [memberEmailInput, setMemberEmailInput] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [generatedInviteLink, setGeneratedInviteLink] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [leavingWorkspace, setLeavingWorkspace] = useState(false);

  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const mobileDrawerRef = usePanelDialog(() => setMobileDrawerOpen(false), mobileDrawerOpen);

  const activeTab: WorkspaceTabId = (
    isWorkspaceTabView(route.view) && route.view !== "workspace" ? route.view : "chat"
  ) as WorkspaceTabId;
  const safe = useMotionSafe();
  const [bodyRef, animateBody] = useAnimate<HTMLDivElement>();
  const previousTab = useRef(activeTab);
  useLayoutEffect(() => {
    const direction = tabDirection(WORKSPACE_TABS.findIndex(tab => tab.id === previousTab.current), WORKSPACE_TABS.findIndex(tab => tab.id === activeTab));
    previousTab.current = activeTab;
    if (!bodyRef.current) return;
    if (!direction || safe.reduced) { void animateBody(bodyRef.current, {opacity:1,x:0}, {duration:0}); return; }
    // Only the incoming panel exists. Cancel a superseded entry before a rapid tab change.
    const animation = animateBody(bodyRef.current, { opacity: [0, 1], x: [direction * 6, 0] }, { duration:DURATION.overlay, ease:EASE.out });
    return () => animation.stop();
  }, [activeTab, safe.reduced, animateBody, bodyRef]);

  const refreshWorkspaces = useCallback(
    async (signal?: AbortSignal) => {
      if (!accessToken) return;
      try {
        const list = await getWorkspacesApi(accessToken);
        if (signal?.aborted) return;
        setWorkspaces(list);
        setWorkspacesError("");
      } catch (err) {
        if (signal?.aborted) return;
        setWorkspacesError(err instanceof Error ? err.message : "Không thể tải danh sách nhóm.");
      } finally {
        if (!signal?.aborted) setWorkspacesLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    setWorkspacesLoading(true);
    void refreshWorkspaces(controller.signal);
    return () => controller.abort();
  }, [refreshWorkspaces]);

  // Ensure route.workspaceId defaults to the first workspace when none is specified in URL
  useEffect(() => {
    if (workspacesLoading || workspaces.length === 0) return;
    if (!route.workspaceId) {
      navigate({ ...route, workspaceId: workspaces[0].id }, true);
    }
  }, [workspacesLoading, workspaces, route, navigate]);

  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null;
    if (route.workspaceId) {
      return workspaces.find((w) => w.id === route.workspaceId) ?? null;
    }
    return workspaces[0] ?? null;
  }, [workspaces, route.workspaceId]);

  const invalidWorkspaceLink = Boolean(
    !workspacesLoading &&
      workspaces.length > 0 &&
      route.workspaceId &&
      !workspaces.some((w) => w.id === route.workspaceId),
  );

  const activeWorkspaceId = activeWorkspace?.id ?? "";

  const loadWorkspaceContext = useCallback(
    async (wsId: string, signal: AbortSignal) => {
      if (!accessToken || !wsId) return;
      setOverviewLoading(true);
      setOverviewError("");
      try {
        const [overviewData, memberList] = await Promise.all([
          getWorkspaceOverviewApi(accessToken, wsId, signal),
          getWorkspaceMembersApi(accessToken, wsId),
        ]);
        if (signal.aborted) return;
        setOverview(overviewData);
        setMembers(memberList);
        // Sync accurate member count back to sidebar item
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === wsId
              ? {
                  ...w,
                  memberCount: memberList.length || w.memberCount,
                }
              : w,
          ),
        );
      } catch (err) {
        if (signal.aborted) return;
        setOverviewError(
          err instanceof Error ? err.message : "Không thể tải thông tin tổng quan nhóm.",
        );
      } finally {
        if (!signal.aborted) setOverviewLoading(false);
      }
    },
    [accessToken],
  );

  // Clear stale workspace overview immediately on workspace switch and abort previous request
  useEffect(() => {
    if (!activeWorkspaceId) {
      setOverview(null);
      setMembers([]);
      return;
    }
    setOverview(null);
    setMembers([]);
    setGeneratedInviteLink("");
    const controller = new AbortController();
    void loadWorkspaceContext(activeWorkspaceId, controller.signal);
    return () => controller.abort();
  }, [activeWorkspaceId, loadWorkspaceContext]);

  // Refresh overview when switching back to the "workspace" (Tổng quan) tab
  useEffect(() => {
    if (activeTab !== "workspace" || !activeWorkspaceId) return;
    const controller = new AbortController();
    void loadWorkspaceContext(activeWorkspaceId, controller.signal);
    void refreshWorkspaces(controller.signal);
    return () => controller.abort();
  }, [activeTab, activeWorkspaceId, loadWorkspaceContext, refreshWorkspaces]);

  // Keep workspace unread badges and overview updated on socket events
  useEffect(() => {
    if (!socket || !accessToken) return;
    const handleRealtimeUpdate = () => {
      void refreshWorkspaces();
      if (activeTab === "workspace" && activeWorkspaceId) {
        const controller = new AbortController();
        void loadWorkspaceContext(activeWorkspaceId, controller.signal);
      }
    };
    socket.on("new_message", handleRealtimeUpdate);
    socket.on("message_deleted", handleRealtimeUpdate);
    socket.on("notification_new", handleRealtimeUpdate);
    return () => {
      socket.off("new_message", handleRealtimeUpdate);
      socket.off("message_deleted", handleRealtimeUpdate);
      socket.off("notification_new", handleRealtimeUpdate);
    };
  }, [socket, accessToken, activeTab, activeWorkspaceId, refreshWorkspaces, loadWorkspaceContext]);

  // Close actions menu on outside click or Escape
  useEffect(() => {
    if (!showActionsMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!actionsMenuRef.current?.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setShowActionsMenu(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showActionsMenu]);

  const filteredWorkspaces = useMemo(() => {
    const q = workspaceSearch.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q));
  }, [workspaces, workspaceSearch]);

  const onlineMemberCount = useMemo(
    () => members.filter((m) => onlineUserIds.includes(m.userId)).length,
    [members, onlineUserIds],
  );

  const memberCount = members.length || activeWorkspace?.memberCount || 1;

  const isAdmin =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const isOwner = activeWorkspace?.role === "owner";
  const isArchived = Boolean(activeWorkspace?.archivedAt);

  const handleSelectWorkspace = (workspaceId: string) => {
    setMobileDrawerOpen(false);
    setShowActionsMenu(false);
    // Selecting a workspace from the sidebar opens its "Trao đổi" tab by default and clears old channel/task IDs
    navigate(selectWorkspaceRoute(workspaceId, "chat"));
  };

  const handleSelectTab = (tabId: WorkspaceTabId) => {
    if (!activeWorkspaceId) return;
    navigate(switchWorkspaceTabRoute(route, tabId, activeWorkspaceId));
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % WORKSPACE_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = WORKSPACE_TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const targetTab = WORKSPACE_TABS[nextIndex];
    tabRefs.current[targetTab.id]?.focus();
    handleSelectTab(targetTab.id);
  };

  const handleQuickMeeting = () => {
    if (!activeWorkspaceId) return;
    const defaultRoomId = overview?.rooms[0]?.id;
    openChannel(activeWorkspaceId, defaultRoomId, true);
  };

  const handleCreateWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !newWorkspaceName.trim() || creatingWorkspace) return;
    const validation = workspaceNameError(newWorkspaceName);
    if (validation) {
      setCreateError(validation);
      focusFirstInvalid(e.currentTarget.closest(".modal") ?? e.currentTarget);
      return;
    }
    setCreateError("");
    setCreatingWorkspace(true);
    try {
      const created = await createWorkspaceApi(accessToken, newWorkspaceName.trim());
      setWorkspaces((prev) => [...prev, { ...created, memberCount: 1, unreadCount: 0 }]);
      setNewWorkspaceName("");
      setShowCreateModal(false);
      notify("Đã tạo nhóm làm việc", `Nhóm "${created.name}" đã sẵn sàng.`);
      navigate(selectWorkspaceRoute(created.id, "chat"));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Vui lòng thử lại.");
      notify(
        "Không thể tạo nhóm",
        err instanceof Error ? err.message : "Vui lòng thử lại.",
        "warning",
      );
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const handleJoinByInvite = (e: FormEvent) => {
    e.preventDefault();
    const raw = inviteTokenInput.trim();
    if (!raw) return;
    // Extract token if user pasted full URL or token
    const tokenMatch = raw.match(/token=([^&#]+)/);
    const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : raw;
    setInviteTokenInput("");
    setShowJoinModal(false);
    navigate({ view: "invitation", invitationToken: token });
  };

  const handleAddMemberByEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !activeWorkspaceId || !memberEmailInput.trim() || addingMember) return;
    setAddingMember(true);
    try {
      await governanceApi(accessToken, `workspaces/${activeWorkspaceId}/members/add`, "POST", {
        email: memberEmailInput.trim(),
      });
      const updated = await getWorkspaceMembersApi(accessToken, activeWorkspaceId);
      setMembers(updated);
      setMemberEmailInput("");
      notify("Đã thêm thành viên", "Thành viên mới đã được thêm vào nhóm.");
    } catch (err) {
      notify(
        "Không thể thêm thành viên",
        err instanceof Error ? err.message : "Vui lòng kiểm tra lại email.",
        "warning",
      );
    } finally {
      setAddingMember(false);
    }
  };

  const handleCreateInviteLink = async () => {
    if (!accessToken || !activeWorkspaceId || creatingInvite) return;
    setCreatingInvite(true);
    try {
      const res = await governanceApi<{ link: string; token: string }>(
        accessToken,
        `workspaces/${activeWorkspaceId}/invitations`,
        "POST",
        {},
      );
      setGeneratedInviteLink(res.link);
      try {
        if(!navigator.clipboard) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(res.link);
        notify("Đã tạo liên kết mời", "Liên kết mời đã được sao chép vào bộ nhớ tạm.");
      } catch {
        notify("Đã tạo liên kết mời", "Không thể sao chép tự động. Bạn có thể sao chép liên kết đang hiển thị.", "warning");
      }
    } catch (err) {
      notify(
        "Không thể tạo lời mời",
        err instanceof Error ? err.message : "Vui lòng thử lại.",
        "warning",
      );
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!accessToken || !activeWorkspaceId || isOwner || leavingWorkspace) return;
    setLeavingWorkspace(true);
    try {
      await governanceApi(accessToken, `workspaces/${activeWorkspaceId}/leave`, "POST");
      const remaining = workspaces.filter((w) => w.id !== activeWorkspaceId);
      setWorkspaces(remaining);
      setShowActionsMenu(false);
      notify("Đã rời nhóm", `Bạn đã rời khỏi nhóm "${activeWorkspace?.name ?? ""}".`, "info");
      if (remaining[0]) {
        navigate(selectWorkspaceRoute(remaining[0].id, "chat"));
      } else {
        setActiveView("overview");
      }
    } catch (err) {
      notify(
        "Không thể rời nhóm",
        err instanceof Error ? err.message : "Vui lòng thử lại.",
        "warning",
      );
    } finally {
      setLeavingWorkspace(false);
    }
  };

  const handleUpdateTaskStatus = async (
    taskId: string,
    version: number,
    status: "todo" | "doing" | "done",
  ) => {
    if (!accessToken || isArchived) return;
    setOverview((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === taskId ? { ...t, status, version: t.version + 1 } : t,
            ),
          }
        : prev,
    );
    try {
      await governanceApi(accessToken, `tasks/${taskId}`, "PATCH", { version, status });
      notify("Đã cập nhật tiến độ", `Trạng thái công việc: ${TASK_STATUS_LABEL[status]}.`);
    } catch (err) {
      if (activeWorkspaceId) {
        const controller = new AbortController();
        void loadWorkspaceContext(activeWorkspaceId, controller.signal);
      }
      notify(
        "Không thể cập nhật công việc",
        err instanceof Error ? err.message : "Vui lòng thử lại.",
        "warning",
      );
    }
  };

  const handleOpenAttachment = async (file: { id: string; fileName: string; mimeType: string }) => {
    if (!accessToken) return;
    try {
      const blob = await getAttachmentBlobApi(accessToken, file.id);
      const url = URL.createObjectURL(blob);
      if (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      notify(
        "Không tải được tài liệu",
        err instanceof Error ? err.message : "Vui lòng thử lại.",
        "warning",
      );
    }
  };

  const renderSidebarContent = (isMobileDrawer = false) => (
    <>
      <div className="ws-sidebar__head">
        <div className="ws-sidebar__title-wrap">
          <span className="ws-sidebar__eyebrow">KHÔNG GIAN NHÓM</span>
          <div className="ws-sidebar__title-row">
            <h2 className="ws-sidebar__title">Nhóm của bạn</h2>
            <span className="ws-sidebar__count" aria-label={`${workspaces.length} nhóm`}>
              {workspaces.length}
            </span>
          </div>
        </div>
        {isMobileDrawer ? (
          <IconButton
            icon="x"
            label="Đóng danh sách nhóm"
            onClick={() => setMobileDrawerOpen(false)}
          />
        ) : (
          <IconButton
            icon={sidebarCollapsed ? "chevron-right" : "chevron-left"}
            label={sidebarCollapsed ? "Mở rộng danh sách nhóm" : "Thu gọn danh sách nhóm"}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        )}
      </div>

      {(!sidebarCollapsed || isMobileDrawer) && workspaces.length > 3 && (
        <div className="ws-sidebar__search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={workspaceSearch}
            onChange={(e) => setWorkspaceSearch(e.target.value)}
            placeholder="Tìm nhóm làm việc…"
            aria-label="Tìm nhóm làm việc"
          />
        </div>
      )}

      <div className="ws-sidebar__list" role="list" aria-label="Danh sách nhóm làm việc">
        {workspacesLoading ? (
          <div className="ws-sidebar__skeleton" aria-busy="true">
            <div className="ws-skeleton-row" />
            <div className="ws-skeleton-row" />
            <div className="ws-skeleton-row" />
          </div>
        ) : workspacesError ? (
          <div className="ws-sidebar__empty" role="alert">
            <p>{workspacesError}</p>
            <Button size="sm" variant="secondary" onClick={() => void refreshWorkspaces()}>
              Thử lại
            </Button>
          </div>
        ) : filteredWorkspaces.length === 0 ? (
          <div className="ws-sidebar__empty">
            <p>
              {workspaces.length === 0
                ? "Bạn chưa tham gia nhóm làm việc nào."
                : "Không tìm thấy nhóm phù hợp."}
            </p>
          </div>
        ) : (
          filteredWorkspaces.map((ws) => {
            const isSelected = ws.id === activeWorkspaceId;
            const wsUnread = ws.unreadCount ?? 0;
            const wsMembers = ws.memberCount ?? 1;
            return (
              <button
                key={ws.id}
                type="button"
                role="listitem"
                className={`ws-sidebar__item ${isSelected ? "is-active" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                title={ws.name}
                onClick={() => handleSelectWorkspace(ws.id)}
              >
                <div className="ws-sidebar__avatar">
                  <Avatar name={ws.name} size="md" />
                </div>
                {(!sidebarCollapsed || isMobileDrawer) && (
                  <div className="ws-sidebar__item-body">
                    <div className="ws-sidebar__item-top">
                      <strong className="ws-sidebar__name">{ws.name}</strong>
                      {wsUnread > 0 && (
                        <span
                          className="ws-sidebar__unread"
                          aria-label={`${wsUnread} tin nhắn chưa đọc`}
                        >
                          {wsUnread > 99 ? "99+" : wsUnread}
                        </span>
                      )}
                    </div>
                    <div className="ws-sidebar__item-meta">
                      <span>{wsMembers} thành viên</span>
                      <span aria-hidden="true">•</span>
                      <span>{roleLabel(ws.role)}</span>
                      {ws.archivedAt && (
                        <>
                          <span aria-hidden="true">•</span>
                          <span className="ws-sidebar__archived-tag">Lưu trữ</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {sidebarCollapsed && !isMobileDrawer && wsUnread > 0 && (
                  <span
                    className="ws-sidebar__unread ws-sidebar__unread--dot"
                    aria-label={`${wsUnread} tin nhắn chưa đọc`}
                  >
                    {wsUnread > 9 ? "9+" : wsUnread}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="ws-sidebar__footer">
        <button
          type="button"
          className="ws-sidebar__create-btn"
          title="Tạo nhóm mới"
          onClick={() => {
            setMobileDrawerOpen(false);
            setShowCreateModal(true);
          }}
        >
          <Icon name="plus" size={16} />
          {(!sidebarCollapsed || isMobileDrawer) && <span>Tạo nhóm mới</span>}
        </button>
        {(!sidebarCollapsed || isMobileDrawer) && (
          <button
            type="button"
            className="ws-sidebar__invite-btn"
            onClick={() => {
              setMobileDrawerOpen(false);
              setShowJoinModal(true);
            }}
          >
            <Icon name="mail" size={14} />
            <span>Tham gia bằng lời mời</span>
          </button>
        )}
      </div>
    </>
  );

  const openTaskCount = useMemo(
    () => (overview?.tasks ?? []).filter((t) => t.status !== "done").length,
    [overview?.tasks],
  );

  return (
    <div
      className={`ws-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
      data-active-tab={activeTab}
    >
      {/* Desktop Persistent Workspace Sidebar */}
      <aside className="ws-sidebar" aria-label="Nhóm của bạn">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile / Tablet Workspace Drawer */}
      {mobileDrawerOpen && (
        <div
          className="ws-mobile-drawer-backdrop"
          role="presentation"
          onClick={() => setMobileDrawerOpen(false)}
        >
          <aside
            ref={mobileDrawerRef}
            className="ws-sidebar ws-sidebar--drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Nhóm của bạn"
            onClick={(e) => e.stopPropagation()}
          >
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Active Workspace Container */}
      <div className="ws-stage">
        {invalidWorkspaceLink ? (
          <section className="ws-empty-stage" role="alert">
            <div className="ws-empty-stage__card">
              <Badge tone="amber">Liên kết không khả dụng</Badge>
              <h1>Nhóm không tồn tại hoặc bạn không có quyền truy cập</h1>
              <p>
                Liên kết nhóm bạn vừa mở không còn hiệu lực hoặc tài khoản của bạn chưa tham gia
                nhóm này. Hãy chọn một nhóm từ danh sách bên trái.
              </p>
              <div className="ws-empty-stage__actions">
                {workspaces[0] && (
                  <Button
                    variant="primary"
                    onClick={() => handleSelectWorkspace(workspaces[0].id)}
                  >
                    Mở nhóm {workspaces[0].name}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setActiveView("overview")}>
                  Về Trang chủ
                </Button>
              </div>
            </div>
          </section>
        ) : !workspacesLoading && !activeWorkspace ? (
          <section className="ws-empty-stage">
            <div className="ws-empty-stage__card">
              <Badge tone="blue">Bắt đầu cùng nexo</Badge>
              <h1>Khởi tạo nhóm làm việc đầu tiên của bạn</h1>
              <p>
                Tổ chức các kênh trao đổi, bảng công việc Kanban, phòng họp truyền hình đa điểm và
                tài liệu chung trong một không gian nhóm thống nhất.
              </p>
              <div className="ws-empty-stage__actions">
                <Button variant="primary" icon="plus" onClick={() => setShowCreateModal(true)}>
                  Tạo nhóm mới
                </Button>
                <Button variant="secondary" icon="mail" onClick={() => setShowJoinModal(true)}>
                  Tham gia bằng lời mời
                </Button>
              </div>
            </div>
          </section>
        ) : activeWorkspace ? (
          <>
            {/* Workspace Header + Function Tabs */}
            <header className="ws-header">
              <div className="ws-header__top">
                <div className="ws-header__identity">
                  <div className="ws-header__avatar">
                    <Avatar name={activeWorkspace.name} size="lg" />
                  </div>
                  <div className="ws-header__titles">
                    <div className="ws-header__title-row">
                      <h1 className="ws-header__title">{activeWorkspace.name}</h1>
                      <Chip icon={isAdmin ? "admin" : "users"}>
                        {roleLabel(activeWorkspace.role)}
                      </Chip>
                      {isArchived && <Chip icon="folder">Đã lưu trữ</Chip>}
                    </div>
                    <div className="ws-header__meta">
                      {activeWorkspace.description?.trim() && (
                        <>
                          <span className="ws-header__desc">
                            {activeWorkspace.description}
                          </span>
                          <span aria-hidden="true">•</span>
                        </>
                      )}
                      <span>{memberCount} thành viên</span>
                      <span aria-hidden="true">•</span>
                      <span className="ws-header__online">
                        <i className={isConnected ? "is-online" : ""} aria-hidden="true" />
                        {isConnected ? `${onlineMemberCount} đang trực tuyến` : "Đang kết nối…"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="ws-header__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="video"
                    onClick={handleQuickMeeting}
                  >
                    Họp nhanh
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="users"
                    onClick={() => setShowMembersModal(true)}
                  >
                    Thành viên ({memberCount})
                  </Button>

                  <div className="ws-header__menu-wrap" ref={actionsMenuRef}>
                    <IconButton
                      icon="more"
                      label="Tùy chọn nhóm làm việc"
                      aria-expanded={showActionsMenu}
                      onClick={() => setShowActionsMenu((prev) => !prev)}
                    />
                    {showActionsMenu && (
                      <div className="ws-actions-menu" role="menu" aria-label="Thao tác nhóm">
                        <button
                          type="button"
                          role="menuitem"
                          className="ws-actions-menu__item"
                          onClick={() => {
                            setShowActionsMenu(false);
                            navigate({ view: "admin", workspaceId: activeWorkspace.id });
                          }}
                        >
                          <Icon name="settings" size={16} />
                          <span>
                            {isAdmin ? "Quản trị & Cài đặt nhóm" : "Thông tin & Cài đặt nhóm"}
                          </span>
                        </button>
                        {isAdmin && !isArchived && (
                          <button
                            type="button"
                            role="menuitem"
                            className="ws-actions-menu__item"
                            onClick={() => {
                              setShowActionsMenu(false);
                              setShowMembersModal(true);
                              void handleCreateInviteLink();
                            }}
                          >
                            <Icon name="user-plus" size={16} />
                            <span>Tạo liên kết mời thành viên</span>
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className="ws-actions-menu__item"
                          onClick={() => {
                            setShowActionsMenu(false);
                            setShowJoinModal(true);
                          }}
                        >
                          <Icon name="mail" size={16} />
                          <span>Nhập mã mời nhóm khác</span>
                        </button>
                        {!isOwner && (
                          <button
                            type="button"
                            role="menuitem"
                            className="ws-actions-menu__item is-danger"
                            disabled={leavingWorkspace}
                            onClick={() => { setShowActionsMenu(false); setLeaveConfirmOpen(true); }}
                          >
                            <Icon name="logout" size={16} />
                            <span>{leavingWorkspace ? "Đang rời nhóm…" : "Rời khỏi nhóm"}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Workspace Function Tabs */}
              <div
                className="ws-tabs"
                role="tablist"
                aria-label={`Chức năng của nhóm ${activeWorkspace.name}`}
              >
                {WORKSPACE_TABS.map((tab, index) => {
                  const isActive = activeTab === tab.id;
                  const unread =
                    tab.id === "chat" ? (activeWorkspace.unreadCount ?? 0) : 0;
                  const taskBadge =
                    tab.id === "tasks" && openTaskCount > 0 ? openTaskCount : 0;
                  const meetingBadge =
                    tab.id === "meetings" && (overview?.meetings.length ?? 0) > 0
                      ? overview!.meetings.length
                      : 0;
                  const badgeCount = unread || taskBadge || meetingBadge;

                  return (
                    <button
                      key={tab.id}
                      ref={(el) => {
                        tabRefs.current[tab.id] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`ws-tab-${tab.id}`}
                      aria-selected={isActive}
                      aria-controls={`ws-panel-${tab.id}`}
                      tabIndex={isActive ? 0 : -1}
                      className={`ws-tab ${isActive ? "is-active" : ""}`}
                      onClick={() => handleSelectTab(tab.id)}
                      onKeyDown={(e) => handleTabKeyDown(e, index)}
                    >
                      <Icon name={tab.icon} size={15} />
                      <span>{tab.label}</span>
                      {badgeCount > 0 && (
                        <span
                          className={`ws-tab__badge ${unread > 0 ? "is-unread" : ""}`}
                        >
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* Tab Panel Body */}
            <div
              ref={bodyRef}
              className={`ws-body ws-body--${activeTab}`}
              id={`ws-panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`ws-tab-${activeTab}`}
            >
              {activeTab === "workspace" && (
                <WorkspaceOverviewTab
                  workspace={activeWorkspace}
                  overview={overview}
                  loading={overviewLoading}
                  error={overviewError}
                  readOnly={isArchived}
                  onRetry={() => {
                    const controller = new AbortController();
                    void loadWorkspaceContext(activeWorkspace.id, controller.signal);
                  }}
                  onSelectTab={handleSelectTab}
                  onOpenTask={(channelId, taskId) =>
                    navigate({
                      view: "tasks",
                      workspaceId: activeWorkspace.id,
                      channelId,
                      taskId,
                    })
                  }
                  onUpdateTaskStatus={handleUpdateTaskStatus}
                  onOpenMessage={(channelId, messageId) =>
                    navigate({
                      view: "chat",
                      workspaceId: activeWorkspace.id,
                      channelId,
                      messageId,
                    })
                  }
                  onJoinMeetingRoom={(channelId) =>
                    openChannel(activeWorkspace.id, channelId, true)
                  }
                  onOpenAttachment={handleOpenAttachment}
                />
              )}

              {activeTab === "tasks" && <TaskBoardPage />}

              {activeTab === "chat" && <ChatPage />}

              {activeTab === "meetings" && <MeetingPage />}

              {activeTab === "files" && (
                <WorkspaceFilesTab
                  accessToken={accessToken}
                  workspace={activeWorkspace}
                  onOpenAttachment={handleOpenAttachment}
                  onOpenInChannel={(channelId, messageId) =>
                    navigate({
                      view: "chat",
                      workspaceId: activeWorkspace.id,
                      channelId,
                      messageId: messageId ?? undefined,
                    })
                  }
                />
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Modal: Tạo nhóm mới */}
      <AnimatePresence>
      {leaveConfirmOpen && <ConfirmDialog title="Rời nhóm" description={`Bạn sẽ mất quyền đọc nội dung và mọi kênh riêng tư trong ${activeWorkspace?.name ?? "nhóm này"}. Muốn tham gia lại, bạn cần lời mời mới.`} confirmLabel="Rời nhóm" loading={leavingWorkspace} onClose={() => setLeaveConfirmOpen(false)} onConfirm={() => void handleLeaveWorkspace().then(() => setLeaveConfirmOpen(false))} />}
      {showCreateModal && (
        <CreateWorkspaceModal
          title="Tạo nhóm làm việc mới"
          eyebrow="KHÔNG GIAN NHÓM"
          onClose={() => {
            if (!creatingWorkspace) setShowCreateModal(false);
          }}
          footer={
            <div className="modal-footer-actions">
              <Button
                variant="ghost"
                disabled={creatingWorkspace}
                onClick={() => setShowCreateModal(false)}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                icon="plus"
                loading={creatingWorkspace}
                disabled={!newWorkspaceName.trim()}
                onClick={(e) => void handleCreateWorkspace(e as unknown as FormEvent)}
              >
                Tạo nhóm
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateWorkspace} className="ws-modal-form">
            <p className="modal-lead">
              Mỗi nhóm làm việc sẽ tự động khởi tạo kênh trao đổi mặc định, bảng công việc và phòng
              họp truyền hình cho các thành viên.
            </p>
            <Field label="Tên nhóm làm việc" error={createError}>
              <input
                type="text"
                placeholder="Ví dụ: Đồ án tốt nghiệp, Nhóm Thiết kế sản phẩm…"
                value={newWorkspaceName}
                onChange={(e) => { setNewWorkspaceName(e.target.value); setCreateError(""); }}
                maxLength={80}
                required
              />
            </Field>
          </form>
        </CreateWorkspaceModal>
      )}

      {/* Modal: Tham gia bằng lời mời */}
      </AnimatePresence>
      <AnimatePresence>
      {showJoinModal && (
        <Modal
          title="Tham gia nhóm bằng lời mời"
          initialFocus="input:not(:disabled)"
          eyebrow="LỜI MỜI NHÓM"
          onClose={() => setShowJoinModal(false)}
          footer={
            <div className="modal-footer-actions">
              <Button variant="ghost" onClick={() => setShowJoinModal(false)}>
                Đóng
              </Button>
              <Button
                variant="primary"
                icon="check"
                disabled={!inviteTokenInput.trim()}
                onClick={(e) => handleJoinByInvite(e as unknown as FormEvent)}
              >
                Tiếp tục xác nhận
              </Button>
            </div>
          }
        >
          <form onSubmit={handleJoinByInvite} className="ws-modal-form">
            <p className="modal-lead">
              Dán đường dẫn lời mời hoặc mã token mà quản trị viên nhóm đã gửi cho bạn.
            </p>
            <Field label="Liên kết hoặc mã lời mời">
              <input
                type="text"
                placeholder="Ví dụ: https://.../app/invitation#token=... hoặc mã token"
                value={inviteTokenInput}
                onChange={(e) => setInviteTokenInput(e.target.value)}
                required
              />
            </Field>
          </form>
        </Modal>
      )}

      {/* Modal: Thành viên nhóm */}
      </AnimatePresence>
      <AnimatePresence>
      {showMembersModal && activeWorkspace && (
        <Modal
          title={`Thành viên — ${activeWorkspace.name}`}
          eyebrow="THÀNH VIÊN NHÓM"
          onClose={() => setShowMembersModal(false)}
          footer={
            <div className="modal-footer-actions">
              {isAdmin && (
                <Button
                  variant="secondary"
                  icon="settings"
                  onClick={() => {
                    setShowMembersModal(false);
                    navigate({ view: "admin", workspaceId: activeWorkspace.id });
                  }}
                >
                  Phân quyền & Quản trị
                </Button>
              )}
              <Button variant="ghost" onClick={() => setShowMembersModal(false)}>
                Đóng
              </Button>
            </div>
          }
        >
          <div className="ws-members-modal">
            {isAdmin && !isArchived && (
              <div className="ws-members-modal__invite-box">
                <form onSubmit={handleAddMemberByEmail} className="ws-members-modal__add-form">
                  <input
                    type="email"
                    value={memberEmailInput}
                    onChange={(e) => setMemberEmailInput(e.target.value)}
                    placeholder="Nhập email tài khoản để thêm trực tiếp…"
                    aria-label="Email thành viên"
                    required
                  />
                  <Button type="submit" size="sm" loading={addingMember}>
                    Thêm vào nhóm
                  </Button>
                </form>
                <div className="ws-members-modal__link-row">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon="link"
                    loading={creatingInvite}
                    onClick={() => void handleCreateInviteLink()}
                  >
                    Tạo liên kết mời
                  </Button>
                  {generatedInviteLink && (
                    <input
                      type="text"
                      readOnly
                      value={generatedInviteLink}
                      aria-label="Liên kết mời"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  )}
                </div>
              </div>
            )}

            <div className="ws-members-modal__list" role="list">
              {members.map((m) => {
                const online = onlineUserIds.includes(m.userId);
                return (
                  <div key={m.userId} className="ws-members-modal__item" role="listitem">
                    <Avatar name={m.displayName} image={memberAvatarOf(m.userId)} size="md" />
                    <div className="ws-members-modal__info">
                      <strong>
                        {m.displayName}
                        {m.userId === user?.id ? " (Bạn)" : ""}
                      </strong>
                      <span>{m.email}</span>
                    </div>
                    <Badge tone={m.role === "owner" || m.role === "admin" ? "blue" : "neutral"}>
                      {roleLabel(m.role)}
                    </Badge>
                    <span className={`ws-members-modal__presence ${online ? "is-online" : ""}`}>
                      <i aria-hidden="true" />
                      {online ? "Trực tuyến" : "Ngoại tuyến"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
      </AnimatePresence>
    </div>
  );
}

interface WorkspaceOverviewTabProps {
  workspace: WorkspaceItem;
  overview: WorkspaceOverviewSummary | null;
  loading: boolean;
  error: string;
  readOnly: boolean;
  onRetry: () => void;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onOpenTask: (channelId: string, taskId: string) => void;
  onUpdateTaskStatus: (
    taskId: string,
    version: number,
    status: "todo" | "doing" | "done",
  ) => void;
  onOpenMessage: (channelId: string, messageId: string) => void;
  onJoinMeetingRoom: (channelId?: string) => void;
  onOpenAttachment: (file: { id: string; fileName: string; mimeType: string }) => void;
}

function WorkspaceOverviewTab({
  workspace,
  overview,
  loading,
  error,
  readOnly,
  onRetry,
  onSelectTab,
  onOpenTask,
  onUpdateTaskStatus,
  onOpenMessage,
  onJoinMeetingRoom,
  onOpenAttachment,
}: WorkspaceOverviewTabProps) {
  const avatarOf = useUserAvatars(
    useMemo(() => overview?.recentMessages.map((m) => m.authorId) ?? [], [overview]),
  );
  if (loading && !overview) {
    return (
      <div className="ws-overview" aria-busy="true">
        <div className="ws-overview-grid">
          <div className="ws-overview-main">
            <div className="ws-overview-card ws-overview-card--skeleton" />
            <div className="ws-overview-card ws-overview-card--skeleton" />
          </div>
          <div className="ws-overview-side">
            <div className="ws-overview-card ws-overview-card--skeleton" />
            <div className="ws-overview-card ws-overview-card--skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="ws-overview">
        <div className="ws-overview-card ws-overview-card--error" role="alert">
          <h3>Không thể tải tổng quan nhóm</h3>
          <p>{error}</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Tải lại
          </Button>
        </div>
      </div>
    );
  }

  const tasks = overview?.tasks ?? [];
  const recentMessages = overview?.recentMessages ?? [];
  const meetings = overview?.meetings ?? [];
  const rooms = overview?.rooms ?? [];
  const files = overview?.files ?? [];
  const hasPinnedFiles = files.some((f) => f.pinned);

  return (
    <div className="ws-overview">
      <div className="ws-overview-grid">
        {/* Main Column: Việc cần làm + Trao đổi gần đây */}
        <div className="ws-overview-main">
          {/* 1. Việc cần làm */}
          <section className="ws-overview-card" aria-labelledby="ws-ov-tasks-title">
            <header className="ws-overview-card__head">
              <div className="ws-overview-card__title-group">
                <span className="ws-overview-card__icon">
                  <Icon name="check-square" size={17} />
                </span>
                <div>
                  <h2 id="ws-ov-tasks-title">Việc cần làm</h2>
                  <p>Công việc đang triển khai trong nhóm {workspace.name}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon="arrow-right"
                onClick={() => onSelectTab("tasks")}
              >
                Xem tất cả
              </Button>
            </header>

            {tasks.length === 0 ? (
              <div className="ws-overview-empty">
                <p>Nhóm chưa có công việc nào được tạo trên bảng Kanban.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() => onSelectTab("tasks")}
                >
                  Mở bảng Công việc
                </Button>
              </div>
            ) : (
              <div className="ws-overview-list" role="list">
                {tasks.map((task) => {
                  const overdue =
                    Boolean(task.dueAt) &&
                    task.status !== "done" &&
                    new Date(task.dueAt!).getTime() < Date.now();
                  return (
                    <div key={task.id} className="ws-task-item" role="listitem">
                      <button
                        type="button"
                        className="ws-task-item__main"
                        onClick={() => onOpenTask(task.channelId, task.id)}
                      >
                        <div className="ws-task-item__top">
                          <strong className="ws-task-item__title">{task.title}</strong>
                          <span className="ws-channel-pill">#{task.channelName}</span>
                        </div>
                        <div className="ws-task-item__meta">
                          <span>
                            Phụ trách: <b>{task.assigneeName || "Chưa giao"}</b>
                          </span>
                          {task.dueAt && (
                            <>
                              <span aria-hidden="true">•</span>
                              <span className={overdue ? "is-overdue" : ""}>
                                Hạn: {new Date(task.dueAt).toLocaleDateString("vi-VN")}
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="ws-task-item__status">
                        <select
                          aria-label={`Trạng thái: ${task.title}`}
                          value={task.status}
                          disabled={readOnly}
                          className={`ws-task-status-select is-${task.status === "doing" ? "in_progress" : task.status}`}
                          onChange={(e) =>
                            onUpdateTaskStatus(
                              task.id,
                              task.version,
                              e.target.value as "todo" | "doing" | "done",
                            )
                          }
                        >
                          <option value="todo">Cần làm</option>
                          <option value="doing">Đang làm</option>
                          <option value="done">Hoàn thành</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Trao đổi gần đây */}
          <section className="ws-overview-card" aria-labelledby="ws-ov-messages-title">
            <header className="ws-overview-card__head">
              <div className="ws-overview-card__title-group">
                <span className="ws-overview-card__icon">
                  <Icon name="message" size={17} />
                </span>
                <div>
                  <h2 id="ws-ov-messages-title">Trao đổi gần đây</h2>
                  <p>Tóm tắt tin nhắn mới từ các kênh văn bản trong nhóm</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon="arrow-right"
                onClick={() => onSelectTab("chat")}
              >
                Mở Trao đổi
              </Button>
            </header>

            {recentMessages.length === 0 ? (
              <div className="ws-overview-empty">
                <p>Chưa có tin nhắn nào trong các kênh của nhóm.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="message"
                  onClick={() => onSelectTab("chat")}
                >
                  Bắt đầu trao đổi
                </Button>
              </div>
            ) : (
              <div className="ws-overview-list" role="list">
                {recentMessages.map((msg) => (
                  <button
                    key={msg.id}
                    type="button"
                    role="listitem"
                    className="ws-message-item"
                    onClick={() => onOpenMessage(msg.channelId, msg.id)}
                  >
                    <Avatar name={msg.authorName} image={avatarOf(msg.authorId)} size="sm" />
                    <div className="ws-message-item__body">
                      <div className="ws-message-item__top">
                        <strong>{msg.authorName}</strong>
                        <span className="ws-channel-pill">#{msg.channelName}</span>
                        <time dateTime={msg.createdAt}>{formatShortTime(msg.createdAt)}</time>
                      </div>
                      <p className="ws-message-item__excerpt">
                        {msg.content || (msg.attachmentName ? `📎 ${msg.attachmentName}` : "")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Side Column: Cuộc họp sắp tới + Tài liệu */}
        <div className="ws-overview-side">
          {/* 3. Cuộc họp sắp tới & Phòng họp */}
          <section className="ws-overview-card" aria-labelledby="ws-ov-meetings-title">
            <header className="ws-overview-card__head">
              <div className="ws-overview-card__title-group">
                <span className="ws-overview-card__icon">
                  <Icon name="video" size={17} />
                </span>
                <div>
                  <h2 id="ws-ov-meetings-title">Cuộc họp sắp tới</h2>
                  <p>Lịch họp và phòng truyền hình của nhóm</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon="arrow-right"
                onClick={() => onSelectTab("meetings")}
              >
                Mở Cuộc họp
              </Button>
            </header>

            {meetings.length === 0 && rooms.length === 0 ? (
              <div className="ws-overview-empty">
                <p>Chưa có lịch họp sắp tới trong nhóm này.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="calendar"
                  onClick={() => onSelectTab("meetings")}
                >
                  Lên lịch họp
                </Button>
              </div>
            ) : (
              <div className="ws-overview-list" role="list">
                {meetings.map((m) => (
                  <div key={m.id} className="ws-meeting-item" role="listitem">
                    <div className="ws-meeting-item__body">
                      <div className="ws-meeting-item__top">
                        <strong>{m.title}</strong>
                        <Badge tone="blue">Sắp diễn ra</Badge>
                      </div>
                      <div className="ws-meeting-item__meta">
                        <span>#{m.roomName}</span>
                        <span aria-hidden="true">•</span>
                        <time dateTime={m.startsAt}>
                          {new Date(m.startsAt).toLocaleString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                          })}
                        </time>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="video"
                      onClick={() => onJoinMeetingRoom(m.roomId)}
                    >
                      Phòng chờ
                    </Button>
                  </div>
                ))}

                {rooms.map((room) => (
                  <div key={room.id} className="ws-meeting-item ws-meeting-item--room" role="listitem">
                    <div className="ws-meeting-item__body">
                      <div className="ws-meeting-item__top">
                        <strong>Phòng #{room.name}</strong>
                        <Badge tone="neutral">Phòng họp nhóm</Badge>
                      </div>
                      <div className="ws-meeting-item__meta">
                        <span>Sẵn sàng kiểm tra thiết bị và tham gia</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="video"
                      onClick={() => onJoinMeetingRoom(room.id)}
                    >
                      Mở phòng
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 4. Tài liệu đã ghim hoặc gần đây */}
          <section className="ws-overview-card" aria-labelledby="ws-ov-files-title">
            <header className="ws-overview-card__head">
              <div className="ws-overview-card__title-group">
                <span className="ws-overview-card__icon">
                  <Icon name="folder" size={17} />
                </span>
                <div>
                  <h2 id="ws-ov-files-title">
                    {hasPinnedFiles ? "Tài liệu đã ghim & gần đây" : "Tài liệu gần đây"}
                  </h2>
                  <p>Tệp đính kèm chia sẻ trong các kênh và công việc</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon="arrow-right"
                onClick={() => onSelectTab("files")}
              >
                Xem tất cả
              </Button>
            </header>

            {files.length === 0 ? (
              <div className="ws-overview-empty">
                <p>Nhóm chưa có tệp đính kèm nào được chia sẻ.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="paperclip"
                  onClick={() => onSelectTab("chat")}
                >
                  Chia sẻ tệp trong kênh
                </Button>
              </div>
            ) : (
              <div className="ws-overview-list" role="list">
                {files.map((file) => (
                  <div key={file.id} className="ws-file-item" role="listitem">
                    <div className="ws-file-item__icon" aria-hidden="true">
                      <Icon
                        name={file.mimeType.startsWith("image/") ? "image" : "file"}
                        size={16}
                      />
                    </div>
                    <div className="ws-file-item__body">
                      <div className="ws-file-item__top">
                        <strong title={file.fileName}>{file.fileName}</strong>
                        {file.pinned ? (
                          <span className="ws-file-tag is-pinned">
                            <Icon name="pin" size={11} /> Đã ghim
                          </span>
                        ) : (
                          <span className="ws-file-tag">Gần đây</span>
                        )}
                      </div>
                      <div className="ws-file-item__meta">
                        <span className="ws-channel-pill">#{file.channelName}</span>
                        <span aria-hidden="true">•</span>
                        <span>{file.uploaderName}</span>
                        <span aria-hidden="true">•</span>
                        <span>{formatBytes(file.fileSize)}</span>
                      </div>
                    </div>
                    <IconButton
                      icon="download"
                      label={`Mở tệp ${file.fileName}`}
                      onClick={() => onOpenAttachment(file)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

interface WorkspaceFilesTabProps {
  accessToken: string | null;
  workspace: WorkspaceItem;
  onOpenAttachment: (file: { id: string; fileName: string; mimeType: string }) => void;
  onOpenInChannel: (channelId: string, messageId: string | null) => void;
}

function WorkspaceFilesTab({
  accessToken,
  workspace,
  onOpenAttachment,
  onOpenInChannel,
}: WorkspaceFilesTabProps) {
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pinned" | "images" | "docs">("all");

  const loadInitialFiles = useCallback(
    async (signal: AbortSignal) => {
      if (!accessToken) return;
      setLoading(true);
      setError("");
      try {
        const res = await getWorkspaceFilesApi(accessToken, workspace.id, {
          limit: 30,
          signal,
        });
        if (signal.aborted) return;
        setFiles(res.files);
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : "Không thể tải danh sách tài liệu.");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [accessToken, workspace.id],
  );

  useEffect(() => {
    setFiles([]);
    setNextCursor(null);
    const controller = new AbortController();
    void loadInitialFiles(controller.signal);
    return () => controller.abort();
  }, [loadInitialFiles]);

  const handleLoadMore = async () => {
    if (!accessToken || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getWorkspaceFilesApi(accessToken, workspace.id, {
        before: nextCursor,
        limit: 30,
      });
      setFiles((prev) => [...prev, ...res.files]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải thêm tài liệu.");
    } finally {
      setLoadingMore(false);
    }
  };

  const visibleFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (filter === "pinned" && !f.pinned) return false;
      if (filter === "images" && !f.mimeType.startsWith("image/")) return false;
      if (filter === "docs" && f.mimeType.startsWith("image/")) return false;
      if (!q) return true;
      return (
        f.fileName.toLowerCase().includes(q) ||
        f.channelName.toLowerCase().includes(q) ||
        f.uploaderName.toLowerCase().includes(q)
      );
    });
  }, [files, search, filter]);

  return (
    <section className="ws-files-tab" aria-label={`Tài liệu của nhóm ${workspace.name}`}>
      <div className="ws-files-toolbar">
        <div className="ws-files-toolbar__left">
          <h2>Kho tài liệu chung</h2>
          <p>
            Toàn bộ tệp đính kèm trong các kênh trao đổi và công việc của nhóm{" "}
            <strong>{workspace.name}</strong> mà bạn có quyền truy cập.
          </p>
        </div>

        <div className="ws-files-toolbar__controls">
          <div className="ws-files-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên tệp, #kênh, người tải lên…"
              aria-label="Tìm kiếm tài liệu"
            />
          </div>

          <div className="ws-files-filters" role="group" aria-label="Bộ lọc loại tài liệu">
            {(
              [
                ["all", "Tất cả"],
                ["pinned", "Đã ghim"],
                ["docs", "Tài liệu"],
                ["images", "Hình ảnh"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`ws-files-filter-btn ${filter === key ? "is-active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ws-files-grid" aria-busy="true">
          <div className="ws-overview-card ws-overview-card--skeleton" />
          <div className="ws-overview-card ws-overview-card--skeleton" />
        </div>
      ) : error ? (
        <div className="ws-overview-card ws-overview-card--error" role="alert">
          <p>{error}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const controller = new AbortController();
              void loadInitialFiles(controller.signal);
            }}
          >
            Thử lại
          </Button>
        </div>
      ) : visibleFiles.length === 0 ? (
        <div className="ws-files-empty-wrap">
          <div className="ws-files-empty">
            <Icon name="folder" size={28} />
            <h3>
              {files.length === 0
                ? "Chưa có tài liệu nào trong nhóm này"
                : "Không tìm thấy tài liệu phù hợp bộ lọc"}
            </h3>
            <p>
              Khi thành viên đính kèm tệp trong kênh Trao đổi hoặc thẻ Công việc, tài liệu sẽ tự động
              tập hợp tại đây.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="ws-files-table" role="list">
            {visibleFiles.map((file) => (
              <article key={file.id} className="ws-file-row" role="listitem">
                <div className="ws-file-row__icon" aria-hidden="true">
                  <Icon
                    name={file.mimeType.startsWith("image/") ? "image" : "file"}
                    size={18}
                  />
                </div>
                <div className="ws-file-row__main">
                  <div className="ws-file-row__title-line">
                    <strong className="ws-file-row__name" title={file.fileName}>
                      {file.fileName}
                    </strong>
                    {file.pinned && (
                      <span className="ws-file-tag is-pinned">
                        <Icon name="pin" size={11} /> Đã ghim
                      </span>
                    )}
                    {file.taskId && <span className="ws-file-tag">Đính kèm công việc</span>}
                  </div>
                  <div className="ws-file-row__meta">
                    <span className="ws-channel-pill">#{file.channelName}</span>
                    <span aria-hidden="true">•</span>
                    <span>Người tải: {file.uploaderName}</span>
                    <span aria-hidden="true">•</span>
                    <span>{formatBytes(file.fileSize)}</span>
                    <span aria-hidden="true">•</span>
                    <time dateTime={file.createdAt}>
                      {new Date(file.createdAt).toLocaleString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </time>
                  </div>
                </div>
                <div className="ws-file-row__actions">
                  <Button
                    size="sm"
                    variant="text"
                    icon="message"
                    onClick={() => onOpenInChannel(file.channelId, file.messageId)}
                  >
                    Mở kênh
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="download"
                    onClick={() => onOpenAttachment(file)}
                  >
                    Mở / Tải
                  </Button>
                </div>
              </article>
            ))}
          </div>

          {nextCursor && (
            <div className="ws-files-more">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={() => void handleLoadMore()}
              >
                Tải thêm tài liệu
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
