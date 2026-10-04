import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChannelItem, WorkspaceItem } from "@doan/shared";
import { createWorkspaceApi, getChannelsApi, getWorkspacesApi } from "../chat/api";
import { governanceApi } from "./api";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button, Field, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import "./workspace-home.css";
import { HomePriorities } from "./HomePriorities";
import { CreateWorkspaceModal, workspaceNameError } from "./CreateWorkspaceModal";
import { focusFirstInvalid } from "../../shared/lib/interaction";

type Group = WorkspaceItem & { channels: ChannelItem[] };

export function WorkspaceHomePage() {
  const { accessToken, setActiveView, openChannel, navigate, user, notify } = useApp();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leavingGroup, setLeavingGroup] = useState<Group | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Modal tạo nhóm mới
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const formattedDate = useMemo(() => {
    try {
      const raw = new Intl.DateTimeFormat("vi-VN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date());
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    } catch {
      return "Hôm nay";
    }
  }, []);

  const stats = useMemo(() => {
    const totalGroups = groups.length;
    const totalChannels = groups.reduce((acc, g) => acc + (g.channels?.length || 0), 0);
    const videoRooms = groups.reduce(
      (acc, g) => acc + g.channels.filter((channel) => channel.type !== "text").length,
      0,
    );
    const adminGroups = groups.filter((g) => g.role === "owner" || g.role === "admin").length;
    return {
      totalGroups,
      totalChannels,
      videoRooms,
      adminGroups,
    };
  }, [groups]);

  const loadWorkspaces = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const workspaces = await getWorkspacesApi(accessToken);
      const groupsWithChannels = await Promise.all(
        workspaces.map(async (workspace) => ({
          ...workspace,
          channels: await getChannelsApi(accessToken, workspace.id),
        })),
      );
      setGroups(groupsWithChannels);
      setError("");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Không tải được danh sách nhóm làm việc.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspaces();
  }, [accessToken]);

  const handleCreateWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newWorkspaceName.trim();
    const validation = workspaceNameError(trimmed);
    if (validation) {
      setCreateError(validation);
      focusFirstInvalid(event.currentTarget.closest(".modal") ?? event.currentTarget);
      return;
    }
    if (!accessToken) return;

    setCreating(true);
    setCreateError("");
    try {
      const created = await createWorkspaceApi(accessToken, trimmed);
      let initialChannels: ChannelItem[] = [];
      try {
        initialChannels = await getChannelsApi(accessToken, created.id);
      } catch {
        setError("Đã tạo nhóm nhưng chưa tải được danh sách kênh. Hãy thử tải lại.");
      }
      setGroups((prev) => [{ ...created, channels: initialChannels }, ...prev]);
      notify("Thành công", `Đã tạo nhóm "${created.name}".`, "success");
      setCreateModalOpen(false);
      setNewWorkspaceName("");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Không thể tạo nhóm làm việc.");
    } finally {
      setCreating(false);
    }
  };

  const renderRoleBadge = (role: Group["role"]) => {
    if (role === "owner") {
      return (
        <Badge tone="amber">
          <Icon name="admin" size={12} /> Chủ nhóm
        </Badge>
      );
    }
    if (role === "admin") {
      return (
        <Badge tone="blue">
          <Icon name="admin" size={12} /> Quản trị viên
        </Badge>
      );
    }
    return (
      <Badge tone="neutral">
        <Icon name="users" size={12} /> Thành viên
      </Badge>
    );
  };

  return (
    <div className="workspace-home">
      {/* Hero Greeting Section */}
      <section className="workspace-home__hero">
        <div className="workspace-home__greeting">
          <div className="workspace-home__date-pill">
            <Icon name="calendar" size={12} />
            <span>{formattedDate}</span>
          </div>
          <h1>Xin chào, {user?.displayName ?? "bạn"}</h1>
          <p>
            Đây là trạm điều khiển của bạn. Tiếp tục cuộc trò chuyện, vào phòng họp hoặc mở nhóm
            đang làm việc.
          </p>

          {/* Dải thống kê hữu cơ tinh tế, mềm mại theo luồng sử dụng */}
          <div className="workspace-home__metrics-strip" aria-label="Thống kê tóm tắt">
            <div className="workspace-metric-chip" title="Số nhóm làm việc bạn đang tham gia">
              <span className="workspace-metric-chip__indicator workspace-metric-chip__indicator--blue" />
              <strong className="workspace-metric-chip__count">
                {loading ? "…" : stats.totalGroups}
              </strong>
              <span className="workspace-metric-chip__text">nhóm làm việc</span>
            </div>
            <span className="workspace-metric-chip__sep" aria-hidden="true">
              •
            </span>
            <div className="workspace-metric-chip" title="Tổng số kênh trao đổi và thảo luận">
              <span className="workspace-metric-chip__indicator workspace-metric-chip__indicator--violet" />
              <strong className="workspace-metric-chip__count">
                {loading ? "…" : stats.totalChannels}
              </strong>
              <span className="workspace-metric-chip__text">kênh trao đổi</span>
            </div>
            <span className="workspace-metric-chip__sep" aria-hidden="true">
              •
            </span>
            <div className="workspace-metric-chip" title="Phòng họp video SFU trực tuyến">
              <span className="workspace-metric-chip__indicator workspace-metric-chip__indicator--emerald" />
              <strong className="workspace-metric-chip__count">
                {loading ? "…" : stats.videoRooms}
              </strong>
              <span className="workspace-metric-chip__text">phòng họp khả dụng</span>
            </div>
            {stats.adminGroups > 0 && (
              <>
                <span className="workspace-metric-chip__sep" aria-hidden="true">
                  •
                </span>
                <div
                  className="workspace-metric-chip workspace-metric-chip--admin"
                  title="Nhóm bạn giữ quyền Quản trị viên hoặc Chủ nhóm"
                >
                  <span className="workspace-metric-chip__indicator workspace-metric-chip__indicator--amber" />
                  <strong className="workspace-metric-chip__count">
                    {loading ? "…" : stats.adminGroups}
                  </strong>
                  <span className="workspace-metric-chip__text">vai trò quản trị</span>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="workspace-home__quick-actions">
          <Button icon="plus" onClick={() => setCreateModalOpen(true)}>
            Tạo nhóm mới
          </Button>
          <Button variant="secondary" icon="video" onClick={() => setActiveView("meetings")}>
            Mở phòng họp
          </Button>
          <Button variant="secondary" icon="messages" onClick={() => setActiveView("chat")}>
            Mở tin nhắn
          </Button>
        </div>
      </section>

      <HomePriorities />
      {/* Error Alert */}
      {error && (
        <div role="alert" className="inline-alert inline-alert--spaced">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => void loadWorkspaces()}>
            Thử lại
          </Button>
        </div>
      )}

      {/* Group and Channels List */}
      <section aria-label="Danh sách nhóm làm việc">
        <div className="workspace-home__section-head">
          <div className="workspace-home__section-title">
            <div>
              <span className="editorial-tag editorial-tag--stacked">Hệ sinh thái làm việc</span>
              <h2>Nhóm làm việc của bạn</h2>
            </div>
            {!loading && <span className="workspace-home__count-badge">{groups.length} nhóm</span>}
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => setCreateModalOpen(true)}
          >
            Tạo nhóm
          </Button>
        </div>

        {loading ? (
          <div className="workspace-skeleton-cards">
            <div className="workspace-skeleton-card skeleton-pulse" />
            <div className="workspace-skeleton-card skeleton-pulse" />
          </div>
        ) : groups.length === 0 ? (
          <div className="workspace-empty-state">
            <div className="workspace-empty-state__icon">
              <Icon name="users" size={32} />
            </div>
            <h3>Chưa có nhóm làm việc nào</h3>
            <p>
              Tạo nhóm mới để bắt đầu trao đổi với đội ngũ hoặc nhờ Quản trị viên thêm bạn vào nhóm
              hiện có.
            </p>
            <div className="workspace-empty-state__actions">
              <Button icon="plus" onClick={() => setCreateModalOpen(true)}>
                Tạo nhóm mới ngay
              </Button>
              <Button variant="secondary" icon="message" onClick={() => setActiveView("chat")}>
                Mở kênh tin nhắn
              </Button>
            </div>
          </div>
        ) : (
          <div className="workspace-groups-list">
            {groups.map((group, idx) => {
              const initials =
                group.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word[0]?.toUpperCase())
                  .join("") || "CS";

              return (
                <motion.article
                  key={group.id}
                  className="workspace-group-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    delay: Math.min(idx * 0.04, 0.16),
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <header className="workspace-group-card__header">
                    <div className="workspace-group-card__identity">
                      <div className="workspace-group-card__avatar">{initials}</div>
                      <div className="workspace-group-card__info">
                        <div className="workspace-group-card__title-row">
                          <h3 className="workspace-group-card__name">{group.name}</h3>
                          {renderRoleBadge(group.role)}
                        </div>
                        <span className="workspace-group-card__meta">
                          {group.channels.length} kênh hoạt động
                        </span>
                      </div>
                    </div>
                    <div className="workspace-group-card__actions">
                      {group.archivedAt && <Badge tone="amber">Đã lưu trữ</Badge>}
                      {group.role !== "owner" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setLeavingGroup(group)}
                        >
                          Rời nhóm
                        </Button>
                      )}
                      {group.role !== "member" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="settings"
                          onClick={() => navigate({ view: "admin", workspaceId: group.id })}
                        >
                          Quản trị
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="message"
                        onClick={() =>
                          openChannel(group.id, group.channels.find((c) => c.type === "text")?.id)
                        }
                      >
                        Vào trò chuyện
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="video"
                        onClick={() =>
                          openChannel(
                            group.id,
                            group.channels.find((c) => c.type !== "text")?.id,
                            true,
                          )
                        }
                      >
                        Họp video
                      </Button>
                    </div>
                  </header>

                  <div className="workspace-group-card__body">
                    <span className="workspace-channels-label">Kênh trong nhóm</span>
                    {group.channels.length === 0 ? (
                      <div className="workspace-channels-empty">
                        Nhóm chưa có kênh nào. Bạn có thể thêm kênh mới trong phần Tin nhắn.
                      </div>
                    ) : (
                      <div className="workspace-channels-grid">
                        {group.channels.map((channel) => {
                          const isVideo = channel.type === "video";
                          return (
                            <button
                              key={channel.id}
                              type="button"
                              className={`workspace-channel-btn ${
                                isVideo ? "workspace-channel-btn--video" : ""
                              }`}
                              onClick={() =>
                                openChannel(group.id, channel.id, channel.type !== "text")
                              }
                              title={`Mở kênh ${channel.name}`}
                            >
                              <div className="workspace-channel-btn__lead">
                                <span className="workspace-channel-btn__icon">
                                  <Icon name={isVideo ? "video" : "message"} size={14} />
                                </span>
                                <span className="workspace-channel-btn__name">
                                  {isVideo ? channel.name : `# ${channel.name}`}
                                </span>
                              </div>
                              <span className="workspace-channel-btn__tag">
                                {isVideo ? "SFU Video" : "Chat"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal Tạo Nhóm Mới */}
      <AnimatePresence>{leavingGroup && (
        <Modal
          title="Rời nhóm"
          initialFocus="[data-cancel]"
          onClose={() => {
            if (!leaving) setLeavingGroup(null);
          }}
        >
          <p className="modal-lead">
            Bạn sẽ mất quyền đọc nội dung và mọi kênh riêng tư trong {leavingGroup.name}. Muốn tham
            gia lại, bạn cần lời mời mới.
          </p>
          <div className="modal-footer-actions">
            <Button variant="ghost" data-cancel disabled={leaving} onClick={() => setLeavingGroup(null)}>
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={leaving}
              loading={leaving}
              onClick={() => {
                if (!accessToken) return;
                setLeaving(true);
                void governanceApi(accessToken, `workspaces/${leavingGroup.id}/leave`, "POST", {})
                  .then(() => {
                    setGroups((items) => items.filter((item) => item.id !== leavingGroup.id));
                    setLeavingGroup(null);
                    notify("Đã rời nhóm");
                  })
                  .catch((reason) => {
                    setError(reason instanceof Error ? reason.message : "Không thể rời nhóm.");
                  })
                  .finally(() => setLeaving(false));
              }}
            >
              Rời nhóm
            </Button>
          </div>
        </Modal>
      )}</AnimatePresence>
      <AnimatePresence>
        {createModalOpen && (
          <CreateWorkspaceModal
            title="Tạo nhóm làm việc mới"
            eyebrow="TẠO WORKSPACE"
            onClose={() => {
              if (!creating) {
                setCreateModalOpen(false);
                setCreateError("");
              }
            }}
            footer={
              <div className="modal-footer-actions">
                <Button
                  variant="ghost"
                  disabled={creating}
                  onClick={() => {
                    setCreateModalOpen(false);
                    setCreateError("");
                  }}
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  form="create-workspace-form"
                  loading={creating}
                  disabled={creating || !newWorkspaceName.trim()}
                >
                  Tạo nhóm ngay
                </Button>
              </div>
            }
          >
            <form id="create-workspace-form" onSubmit={handleCreateWorkspace}>
              <p className="modal-lead">
                Nhóm làm việc là nơi bạn và các thành viên cùng trao đổi tin nhắn thời gian thực và
                tham gia hội nghị truyền hình SFU bảo mật. Bạn sẽ tự động là{" "}
                <strong>Quản trị viên (Admin)</strong> của nhóm này.
              </p>
              <Field
                label="Tên nhóm làm việc"
                hint="Ví dụ: Đội ngũ Frontend, Dự án 2026, Bộ môn Công nghệ mạng"
                error={createError}
              >
                <div className="editorial-input-wrap">
                  <Icon name="users" size={16} className="editorial-input-icon" />
                  <input
                    type="text"
                    autoFocus
                    required
                    maxLength={80}
                    placeholder="Nhập tên nhóm làm việc…"
                    value={newWorkspaceName}
                    onChange={(e) => {
                      setNewWorkspaceName(e.target.value);
                      if (createError) setCreateError("");
                    }}
                    disabled={creating}
                    className="editorial-input"
                  />
                </div>
              </Field>
            </form>
          </CreateWorkspaceModal>
        )}
      </AnimatePresence>
    </div>
  );
}
