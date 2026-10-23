import { useEffect, useState } from "react";
import type { CreateAnnouncementInput, HomeSummary, PortalAnnouncement } from "@doan/shared";
import { governanceApi } from "../workspaces/api";
import { Button, Badge, FilterPills, KpiStatCard } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import {
  getAnnouncementsApi,
  createAnnouncementApi,
  updateAnnouncementApi,
  deleteAnnouncementApi,
} from "../announcements/api";
import { AnnouncementDetailModal } from "../announcements/AnnouncementDetailModal";
import { CreateAnnouncementModal } from "../announcements/CreateAnnouncementModal";
import { PublisherManagementModal } from "../announcements/PublisherManagementModal";
import "../workspaces/workspace-admin.css";
import "./notifications.css";

export interface NotificationItem {
  id: string;
  kind: "mention" | "thread" | "direct";
  readAt: string | null;
  createdAt: string;
  messageId: string;
  content: string;
  threadRootId: string | null;
  channelId: string;
  channelName: string;
  workspaceId: string | null;
  authorName: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  unreadCount: number;
  hasMore: boolean;
}

const CATEGORY_PILLS = [
  { key: "all", label: "Tất cả" },
  { key: "general", label: "Thông báo chung" },
  { key: "training", label: "Đào tạo" },
  { key: "event", label: "Sự kiện" },
  { key: "urgent", label: "Khẩn" },
];

export function NotificationsPage() {
  const { accessToken, navigate, notify } = useApp();
  const { socket } = useSocket();

  // Tab view: "portal_announcements" (Quản lý đăng tải thông báo) | "personal_alerts" (Nhắc tên/thảo luận)
  const [activeTab, setActiveTab] = useState<"portal_announcements" | "personal_alerts">("portal_announcements");

  // Portal Announcements State
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState("");
  const [canPublish, setCanPublish] = useState(false);
  const [userRole, setUserRole] = useState("student");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [detailAnnouncement, setDetailAnnouncement] = useState<PortalAnnouncement | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<PortalAnnouncement | null>(null);
  const [publishersModalOpen, setPublishersModalOpen] = useState(false);
  const [submittingAnnouncement, setSubmittingAnnouncement] = useState(false);

  // Personal alerts state (legacy inbox)
  const [page, setPage] = useState<NotificationPage>({ items: [], unreadCount: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unreadChannels, setUnreadChannels] = useState<HomeSummary["unreadChannels"]>([]);

  // Fetch announcements
  const fetchAnnouncements = async () => {
    if (!accessToken) return;
    try {
      setAnnouncementsLoading(true);
      const res = await getAnnouncementsApi(accessToken, selectedCategory);
      setAnnouncements(res.items);
      setCanPublish(res.canPublish);
      setUserRole(res.role);
      setAnnouncementsError("");
    } catch (err: unknown) {
      setAnnouncementsError(err instanceof Error ? err.message : "Không thể tải danh sách thông báo.");
    } finally {
      setAnnouncementsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAnnouncements();
  }, [accessToken, selectedCategory]);

  // Realtime updates for announcements
  useEffect(() => {
    if (!socket) return;
    const handleAnnouncementsChanged = () => {
      void fetchAnnouncements();
    };
    socket.on("announcements_changed", handleAnnouncementsChanged);
    return () => {
      socket.off("announcements_changed", handleAnnouncementsChanged);
    };
  }, [socket, accessToken, selectedCategory]);

  // Load personal alerts
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    let timer: number | undefined;
    const load = () =>
      void governanceApi<HomeSummary>(accessToken, "home")
        .then((data) => {
          if (active) {
            setUnreadChannels(data.unreadChannels);
          }
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

  // Handle Create / Edit announcement submit
  const handleSaveAnnouncement = async (input: CreateAnnouncementInput) => {
    if (!accessToken) return;
    try {
      setSubmittingAnnouncement(true);
      if (editingAnnouncement) {
        await updateAnnouncementApi(accessToken, editingAnnouncement.id, input);
        notify("Thành công", "Đã cập nhật thông báo.", "success");
      } else {
        await createAnnouncementApi(accessToken, input);
        notify("Thành công", "Đã đăng thông báo mới lên Bảng tin.", "success");
      }
      setEditingAnnouncement(null);
      setCreateModalOpen(false);
      await fetchAnnouncements();
    } finally {
      setSubmittingAnnouncement(false);
    }
  };

  // Handle Delete announcement
  const handleDeleteAnnouncement = async (announcement: PortalAnnouncement) => {
    if (!window.confirm(`Bạn có chắc muốn xóa thông báo: "${announcement.title}"?`)) return;
    if (!accessToken) return;
    try {
      await deleteAnnouncementApi(accessToken, announcement.id);
      notify("Đã xóa", "Thông báo đã được gỡ khỏi hệ thống.", "info");
      await fetchAnnouncements();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Không thể xóa thông báo.");
    }
  };

  // Handle Toggle Pin
  const handleTogglePin = async (announcement: PortalAnnouncement) => {
    if (!accessToken) return;
    try {
      await updateAnnouncementApi(accessToken, announcement.id, {
        pinned: !announcement.pinned,
      });
      notify("Cập nhật ghim", announcement.pinned ? "Đã bỏ ghim thông báo." : "Đã ghim thông báo lên đầu.", "info");
      await fetchAnnouncements();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Không thể cập nhật trạng thái ghim.");
    }
  };

  // Filtered announcements by search
  const filteredAnnouncements = announcements.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.authorName.toLowerCase().includes(q) ||
      a.scope.toLowerCase().includes(q)
    );
  });

  const urgentCount = announcements.filter((a) => a.category === "urgent" || a.pinned).length;

  return (
    <div className="tdtu-home-container">
      {/* Top Header */}
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted, #64748B)", marginBottom: 2 }}>
              Cổng nội bộ TDTU · Kênh Thông tin Toàn trường
            </div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text, #0F172A)" }}>
              Quản lý Thông báo & Bảng tin
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canPublish ? (
              <Button
                variant="primary"
                onClick={() => {
                  setEditingAnnouncement(null);
                  setCreateModalOpen(true);
                }}
              >
                <Icon name="bell" size={15} />
                <span>+ Đăng thông báo mới</span>
              </Button>
            ) : (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 9999,
                  background: "var(--bg-subtle, #F1F5F9)",
                  color: "var(--text-muted, #64748B)",
                  fontSize: 12,
                  fontWeight: 500,
                  border: "1px solid var(--border-color, #E2E8F0)",
                }}
                title="Tài khoản sinh viên chỉ có quyền xem thông báo"
              >
                <Icon name="info" size={13} />
                <span>Chế độ Sinh viên (Chỉ xem)</span>
              </div>
            )}

            {(userRole === "system_admin" || userRole === "unit_admin" || canPublish) && (
              <Button
                variant="secondary"
                onClick={() => setPublishersModalOpen(true)}
                title="Quản lý danh sách người được cấp quyền đăng thông báo"
              >
                <Icon name="users" size={15} />
                <span>Phân quyền đăng bài</span>
              </Button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: "flex", gap: 6, marginTop: 12, borderBottom: "1px solid var(--border-color, #E2E8F0)", paddingBottom: 8 }}>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === "portal_announcements" ? "is-active" : ""}`}
            onClick={() => setActiveTab("portal_announcements")}
            style={{
              padding: "4px 12px",
              borderRadius: "9999px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              border: activeTab === "portal_announcements" ? "1px solid var(--brand-primary, #2563EB)" : "1px solid var(--border-color, #E2E8F0)",
              background: activeTab === "portal_announcements" ? "var(--brand-primary, #2563EB)" : "var(--bg-surface, #FFFFFF)",
              color: activeTab === "portal_announcements" ? "#FFFFFF" : "var(--text-secondary, #475569)",
              transition: "all 0.15s ease",
            }}
          >
            📢 Thông báo sinh viên & Bảng tin ({announcements.length})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === "personal_alerts" ? "is-active" : ""}`}
            onClick={() => setActiveTab("personal_alerts")}
            style={{
              padding: "4px 12px",
              borderRadius: "9999px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              border: activeTab === "personal_alerts" ? "1px solid var(--brand-primary, #2563EB)" : "1px solid var(--border-color, #E2E8F0)",
              background: activeTab === "personal_alerts" ? "var(--brand-primary, #2563EB)" : "var(--bg-surface, #FFFFFF)",
              color: activeTab === "personal_alerts" ? "#FFFFFF" : "var(--text-secondary, #475569)",
              transition: "all 0.15s ease",
            }}
          >
            🔔 Thông báo thảo luận & Nhắc tên ({page.unreadCount})
          </button>
        </div>
      </header>

      {/* TAB 1: PORTAL ANNOUNCEMENTS (BẢNG TIN & ĐĂNG TẢI THÔNG BÁO) */}
      {activeTab === "portal_announcements" && (
        <div>
          {/* KPI Cards Row */}
          <section className="tdtu-home-kpi-grid" style={{ marginBottom: 20 }}>
            <KpiStatCard
              icon="bell"
              tone="purple"
              value={announcements.length}
              label="Tổng số thông báo toàn trường"
            />
            <KpiStatCard
              icon="shield"
              tone={canPublish ? "green" : "blue"}
              value={canPublish ? "Có quyền đăng bài" : "Tài khoản Sinh viên"}
              label={canPublish ? "Bạn được phép đăng thông báo" : "Chế độ xem thông báo chính thức"}
            />
            <KpiStatCard
              icon="message"
              tone="red"
              value={urgentCount}
              label="Thông báo khẩn / Đang ghim"
            />
          </section>

          {/* Permission Info Notice for Students */}
          {!canPublish && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                borderRadius: 8,
                marginBottom: 14,
                color: "#1E40AF",
                fontSize: 12.5,
              }}
            >
              <Icon name="info" size={16} />
              <div>
                <strong>Thông tin phân quyền:</strong> Bạn đang đăng nhập với vai trò <strong>Sinh viên (quyền xem)</strong>. Khi các Đơn vị, Ban Giám hiệu, Phòng ban hoặc Khoa đăng thông báo mới, thông báo sẽ hiển thị trực tiếp tại Trang chủ của bạn. Chỉ cán bộ / giảng viên hoặc người được cấp quyền mới có thể đăng tải thông báo.
              </div>
            </div>
          )}

          {/* Filters & Search Toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <FilterPills
              options={CATEGORY_PILLS}
              activeKey={selectedCategory}
              onChange={(key) => setSelectedCategory(key)}
            />

            <div style={{ position: "relative", minWidth: 240 }}>
              <input
                type="text"
                placeholder="Tìm kiếm thông báo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  height: 32,
                  padding: "0 12px 0 32px",
                  borderRadius: 9999,
                  border: "1px solid var(--border-color, #E2E8F0)",
                  background: "var(--bg-surface, #FFFFFF)",
                  fontSize: 12.5,
                  outline: "none",
                }}
              />
              <span style={{ position: "absolute", left: 10, top: 8, color: "var(--text-muted, #64748B)" }}>
                <Icon name="search" size={14} />
              </span>
            </div>
          </div>

          {/* Announcements Feed List */}
          {announcementsLoading ? (
            <p style={{ textAlign: "center", padding: 30, color: "var(--text-muted, #64748B)", fontSize: 13 }}>
              Đang tải danh sách thông báo...
            </p>
          ) : announcementsError ? (
            <div role="alert" style={{ padding: 14, background: "#FEF2F2", color: "#DC2626", borderRadius: 8, fontSize: 13 }}>
              {announcementsError}
            </div>
          ) : filteredAnnouncements.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 16px",
                background: "var(--bg-surface, #FFFFFF)",
                borderRadius: 10,
                border: "1px solid var(--border-color, #E2E8F0)",
              }}
            >
              <Icon name="bell" size={30} />
              <h3 style={{ margin: "10px 0 4px", fontSize: 14.5, color: "var(--text, #0F172A)" }}>
                Chưa có thông báo nào trong mục này
              </h3>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted, #64748B)" }}>
                {canPublish
                  ? 'Bấm nút "+ Đăng thông báo mới" ở góc trên để phát thông báo cho sinh viên.'
                  : "Các thông báo mới từ Nhà trường sẽ xuất hiện ở đây."}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredAnnouncements.map((item) => (
                <article
                  key={item.id}
                  style={{
                    background: "var(--bg-surface, #FFFFFF)",
                    border: item.pinned
                      ? "1.5px solid var(--brand-primary, #2563EB)"
                      : "1px solid var(--border-color, #E2E8F0)",
                    borderRadius: 10,
                    padding: "12px 16px",
                    boxShadow: "var(--shadow-card, 0 1px 2px rgba(15, 23, 42, 0.04))",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Badge tone={item.category === "urgent" ? "red" : item.category === "training" ? "amber" : "blue"}>
                        {item.category === "general"
                          ? "📢 Thông báo chung"
                          : item.category === "training"
                            ? "📚 Đào tạo"
                            : item.category === "event"
                              ? "🎉 Sự kiện"
                              : "⚠️ Khẩn"}
                      </Badge>
                      {item.badge && (
                        <Badge tone={item.category === "urgent" ? "red" : "amber"}>
                          {item.badge}
                        </Badge>
                      )}
                      {item.pinned && (
                        <Badge tone="violet">
                          ⭐ Đã ghim
                        </Badge>
                      )}
                      <span style={{ fontSize: 11.5, color: "var(--text-muted, #64748B)" }}>
                        {new Date(item.createdAt).toLocaleDateString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDetailAnnouncement(item)}
                      >
                        Xem chi tiết
                      </Button>

                      {canPublish && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleTogglePin(item)}
                            title={item.pinned ? "Bỏ ghim" : "Ghim lên đầu Bảng tin"}
                          >
                            {item.pinned ? "Bỏ ghim" : "Ghim"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingAnnouncement(item);
                              setCreateModalOpen(true);
                            }}
                          >
                            Sửa
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteAnnouncement(item)}
                          >
                            Xóa
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <h3
                    style={{
                      margin: 0,
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: "var(--text, #0F172A)",
                      lineHeight: 1.35,
                      cursor: "pointer",
                    }}
                    onClick={() => setDetailAnnouncement(item)}
                  >
                    {item.title}
                  </h3>

                  <p
                    style={{
                      margin: 0,
                      fontSize: 12.5,
                      color: "var(--text-secondary, #475569)",
                      lineHeight: 1.45,
                    }}
                  >
                    {item.summary}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                      color: "var(--text-muted, #64748B)",
                      paddingTop: 6,
                      borderTop: "1px dashed var(--border-color, #E2E8F0)",
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "#0F172A",
                        color: "#FFFFFF",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {item.authorName.charAt(0).toUpperCase()}
                    </div>
                    <span>{item.authorName}</span>
                    <span>·</span>
                    <span>{item.authorTitle || "Phòng Công tác Sinh viên"}</span>
                    <span>·</span>
                    <span>Phạm vi: {item.scope}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PERSONAL ALERTS (NHẮC TÊN / THẢO LUẬN CŨ) */}
      {activeTab === "personal_alerts" && (
        <section className="notifications-personal-wrap" style={{ marginTop: 10 }}>
          <div className="notifications-section-head">
            <h2>Tin nhắn chưa đọc trong nhóm</h2>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await governanceApi(accessToken!, "notifications/read", "POST", {});
                setPage((prev) => ({
                  ...prev,
                  unreadCount: 0,
                  items: prev.items.map((i) => ({ ...i, readAt: i.readAt || new Date().toISOString() })),
                }));
              }}
            >
              Đánh dấu tất cả đã đọc
            </Button>
          </div>

          {unreadChannels.length > 0 ? (
            <ul className="notifications-unread-channels" style={{ marginBottom: 24 }}>
              {unreadChannels.map((c) => (
                <li key={c.channelId}>
                  <button
                    type="button"
                    onClick={() => navigate({ view: "chat", workspaceId: c.workspaceId, channelId: c.channelId })}
                  >
                    <span>#{c.channelName}</span>
                    <small>{c.workspaceName}</small>
                    <b>{c.unreadCount}</b>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13.5, color: "var(--text-muted, #64748B)", marginBottom: 24 }}>
              Bạn không có tin nhắn nhóm nào chưa đọc.
            </p>
          )}

          <div className="notifications-section-head">
            <h2>Lịch sử thông báo & Nhắc tên ({page.items.length})</h2>
          </div>

          {loading ? (
            <p style={{ fontSize: 13.5, color: "var(--text-muted, #64748B)" }}>Đang tải...</p>
          ) : error ? (
            <p className="inline-alert" role="alert">{error}</p>
          ) : page.items.length === 0 ? (
            <div className="notifications-empty-card" style={{ padding: 32, textAlign: "center", background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0" }}>
              <Icon name="check" size={28} />
              <h3>Bạn đã cập nhật hết thông báo</h3>
              <p>Khi có ai đó nhắc tên bạn hoặc trả lời tin nhắn của bạn trong nhóm, thông báo sẽ hiển thị ở đây.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {page.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "12px 16px",
                    background: item.readAt ? "#FFFFFF" : "#EEF2FF",
                    border: "1px solid #E2E8F0",
                    borderRadius: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0F172A" }}>
                      {item.authorName} trong #{item.channelName}
                    </div>
                    <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
                      {item.content}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (item.workspaceId) {
                        navigate({ view: "chat", workspaceId: item.workspaceId, channelId: item.channelId, messageId: item.messageId });
                      }
                    }}
                  >
                    Xem
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Detail Modal */}
      {detailAnnouncement && (
        <AnnouncementDetailModal
          announcement={detailAnnouncement}
          onClose={() => setDetailAnnouncement(null)}
        />
      )}

      {/* Create / Edit Modal */}
      {createModalOpen && (
        <CreateAnnouncementModal
          initialData={editingAnnouncement}
          onClose={() => {
            setCreateModalOpen(false);
            setEditingAnnouncement(null);
          }}
          onSubmit={handleSaveAnnouncement}
          loading={submittingAnnouncement}
        />
      )}

      {/* Publishers Management Modal */}
      {publishersModalOpen && accessToken && (
        <PublisherManagementModal
          accessToken={accessToken}
          onClose={() => setPublishersModalOpen(false)}
          onChanged={() => void fetchAnnouncements()}
        />
      )}
    </div>
  );
}
