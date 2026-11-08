import { useMemo, useState, useEffect, useCallback } from "react";
import type { PortalAnnouncement } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Icon } from "../../shared/ui/Icon";
import { FilterPills } from "../../shared/ui/Primitives";
import { RoleHome, useRoleData } from "./RoleHome";
import { useMenuAccess } from "../../app/layout/useMenuAccess";
import { getAnnouncementsApi } from "../announcements/api";
import { AnnouncementDetailModal } from "../announcements/AnnouncementDetailModal";
import "./workspace-home.css";

const CATEGORY_LABELS: Record<string, string> = {
  general: "Thông báo chung",
  training: "Đào tạo",
  event: "Sự kiện",
  urgent: "Khẩn",
};

const FILTER_TABS = [
  { key: "all", label: "Tất cả" },
  { key: "general", label: "Thông báo chung" },
  { key: "training", label: "Đào tạo" },
  { key: "event", label: "Sự kiện" },
  { key: "urgent", label: "Khẩn" },
];

function formatTimeAgo(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Vừa xong";
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ngày trước`;
    return new Date(isoString).toLocaleDateString("vi-VN");
  } catch {
    return "";
  }
}

/** Unopened announcements younger than this count as unread (older ones are not news any more). */
const UNREAD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const FEED_GROUPS = ["Hôm nay", "Tuần này", "Trước đó"] as const;

function feedGroup(iso: string): (typeof FEED_GROUPS)[number] {
  const created = new Date(iso);
  const now = new Date();
  if (created.toDateString() === now.toDateString()) return "Hôm nay";
  return now.getTime() - created.getTime() < 7 * 24 * 60 * 60 * 1000 ? "Tuần này" : "Trước đó";
}

/** Category key for colours; anything unknown looks like a general notice. */
function categoryKey(category: string): string {
  return category in CATEGORY_LABELS ? category : "general";
}

/** The author's badge, minus a plain "Mới": the unread mark already says that, per reader. */
function authorBadge(item: PortalAnnouncement): string | undefined {
  return item.badge && item.badge.trim().toLowerCase() !== "mới" ? item.badge : undefined;
}

// shortcut: read marks live in this browser (per account); move them to a server table to follow the user across devices.
function loadReadIds(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function WorkspaceHomePage() {
  const { setActiveView, accessToken, user } = useApp();
  const menuAccess = useMenuAccess(accessToken);
  const { socket } = useSocket();

  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<PortalAnnouncement | null>(null);
  const readKey = `announcements-read:${user?.id ?? "anon"}`;
  const [readIds, setReadIds] = useState(() => loadReadIds(readKey));
  const markRead = (ids: string[]) => {
    const next = new Set(readIds);
    ids.forEach((id) => next.add(id));
    setReadIds(next);
    try {
      localStorage.setItem(readKey, JSON.stringify([...next].slice(-300)));
    } catch {
      // not persisted; the marks still apply to this visit
    }
  };
  const isUnread = (item: PortalAnnouncement) =>
    !readIds.has(item.id) && Date.now() - new Date(item.createdAt).getTime() < UNREAD_WINDOW_MS;
  const openAnnouncement = (item: PortalAnnouncement) => {
    markRead([item.id]);
    setSelectedAnnouncement(item);
  };

  const roleData = useRoleData();
  const nextMeeting = roleData?.meetings[0] ?? null;

  // 1. Fetch announcements
  const loadAnnouncements = useCallback(async () => {
    if (!accessToken) return;
    try {
      setLoadingAnnouncements(true);
      const res = await getAnnouncementsApi(accessToken, selectedFilter);
      setAnnouncements(res.items || []);
    } catch {
      // Keep existing announcements if error
    } finally {
      setLoadingAnnouncements(false);
    }
  }, [accessToken, selectedFilter]);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  // 2. Real-time refresh when announcements change via Socket.IO
  useEffect(() => {
    if (!socket) return;
    const handleAnnouncementsChanged = () => {
      void loadAnnouncements();
    };
    socket.on("announcements_changed", handleAnnouncementsChanged);
    return () => {
      socket.off("announcements_changed", handleAnnouncementsChanged);
    };
  }, [socket, loadAnnouncements]);

  const calendarDate = (iso: string) => {
    const now = new Date(iso);
    const day = now.getDate();
    const dayOfWeek = now.getDay();
    const weekdayShort = dayOfWeek === 0 ? "CN" : `T${dayOfWeek + 1}`;
    return {
      weekday: weekdayShort,
      day: day.toString().padStart(2, "0"),
    };
  };

  const featuredAnnouncement = announcements.length > 0 ? announcements[0] : null;
  const secondaryAnnouncements = announcements.slice(1, 5);
  const unreadCount = announcements.filter(isUnread).length;
  const upcomingMeetings = useMemo(() => (roleData?.meetings ?? []).slice(0, 3), [roleData?.meetings]);

  return (
    <div className="tdtu-home-container">
      <h1 className="sr-only">Trang chủ</h1>
      {/* Khu vực nội dung chính chia 2 cột Bento (Tỷ lệ 2.15fr : 1fr) */}
      <section className="tdtu-home-main-grid">
        {/* Cột trái: Bảng tin + Việc của bạn */}
        <div className="tdtu-home-feed">
          {/* Header Bảng tin & Bộ lọc pills */}
          <div className="tdtu-home-feed__head">
            <div className="tdtu-home-feed__title-group">
              <h2 className="tdtu-home-feed__title tdtu-home-feed__title--lead">Bảng tin nội bộ</h2>
              <span className="tdtu-home-feed__count">
                {announcements.length} tin{unreadCount > 0 && ` · ${unreadCount} chưa đọc`}
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="tdtu-board-mark-all"
                  onClick={() => markRead(announcements.map((item) => item.id))}
                >
                  Đánh dấu đã đọc hết
                </button>
              )}
            </div>
            <FilterPills
              options={FILTER_TABS}
              activeKey={selectedFilter}
              onChange={(key) => setSelectedFilter(key)}
            />
          </div>

          {/* Skeleton khi đang tải */}
          {loadingAnnouncements && announcements.length === 0 && (
            <div className="tdtu-home-skeleton-stack" aria-busy="true" aria-label="Đang tải thông báo">
              <div className="tdtu-home-skeleton-featured" />
              <div className="tdtu-home-skeleton-row" />
              <div className="tdtu-home-skeleton-row" />
            </div>
          )}

          {/* Thẻ nổi bật: panel tối, màu theo loại tin, khối "rack" tóm tắt bên phải */}
          {featuredAnnouncement && (
            <article
              className={`tdtu-board-feature is-${categoryKey(featuredAnnouncement.category)}`}
              onClick={() => openAnnouncement(featuredAnnouncement)}
            >
              <div className="tdtu-board-feature__lead">
                <div className="tdtu-board-feature__tags">
                  <span className="tdtu-board-chip is-category">
                    <span className="tdtu-board-led" aria-hidden="true" />
                    {CATEGORY_LABELS[featuredAnnouncement.category] || featuredAnnouncement.category}
                  </span>
                  {featuredAnnouncement.pinned && (
                    <span className="tdtu-board-chip is-quiet">
                      <Icon name="pin" size={12} /> Đã ghim
                    </span>
                  )}
                  {authorBadge(featuredAnnouncement) && (
                    <span className="tdtu-board-chip is-quiet">{authorBadge(featuredAnnouncement)}</span>
                  )}
                  {isUnread(featuredAnnouncement) && <span className="tdtu-board-chip is-new">Mới</span>}
                </div>
                <h3 className="tdtu-board-feature__title">{featuredAnnouncement.title}</h3>
                {featuredAnnouncement.summary && (
                  <p className="tdtu-board-feature__summary">{featuredAnnouncement.summary}</p>
                )}
                <p className="tdtu-board-feature__meta">
                  {featuredAnnouncement.authorName} · {new Date(featuredAnnouncement.createdAt).toLocaleDateString("vi-VN")} ·{" "}
                  {featuredAnnouncement.scope}
                </p>
                <button
                  type="button"
                  className="tdtu-board-feature__cta"
                  onClick={(event) => {
                    event.stopPropagation();
                    openAnnouncement(featuredAnnouncement);
                  }}
                >
                  Xem chi tiết <Icon name="arrow-right" size={15} />
                </button>
              </div>

              {/* Same facts as the meta line, drawn as server-rack units: decoration for sighted users. */}
              <div className="tdtu-board-rack" aria-hidden="true">
                <span className="tdtu-board-rack__rail" />
                <div className="tdtu-board-rack__units">
                  <span className="tdtu-board-rack__unit is-blank" />
                  <span className="tdtu-board-rack__unit is-lit">
                    <span className="tdtu-board-led" />
                    <b>Loại</b>
                    <b>{CATEGORY_LABELS[featuredAnnouncement.category] || featuredAnnouncement.category}</b>
                  </span>
                  <span className="tdtu-board-rack__unit">
                    <span className="tdtu-board-led is-off" />
                    <span>Phạm vi</span>
                    <span>{featuredAnnouncement.scope}</span>
                  </span>
                  <span className="tdtu-board-rack__unit">
                    <span className="tdtu-board-led is-off" />
                    <span>Đăng</span>
                    <span>{formatTimeAgo(featuredAnnouncement.createdAt)}</span>
                  </span>
                  <span className="tdtu-board-rack__unit is-blank" />
                </div>
                <span className="tdtu-board-rack__rail" />
              </div>
            </article>
          )}

          {/* Các tin kế tiếp: dòng thời gian theo Hôm nay / Tuần này / Trước đó */}
          {secondaryAnnouncements.length > 0 && (
            <section className="tdtu-board-timeline" aria-label="Các tin khác">
              {FEED_GROUPS.map((group) => {
                const items = secondaryAnnouncements.filter((item) => feedGroup(item.createdAt) === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="tdtu-board-group">
                    <h3 className="tdtu-board-group__label">{group}</h3>
                    <ul className="tdtu-board-list">
                      {items.map((item) => {
                        const unread = isUnread(item);
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={`tdtu-board-row is-${categoryKey(item.category)} ${unread ? "is-unread" : ""}`}
                              onClick={() => openAnnouncement(item)}
                            >
                              <span className="tdtu-board-row__dot" aria-hidden="true" />
                              <span className="tdtu-board-row__body">
                                <span className="tdtu-board-row__head">
                                  <span className="tdtu-board-row__title">{item.title}</span>
                                  <span className="tdtu-board-chip is-category">
                                    {CATEGORY_LABELS[item.category] || item.category}
                                  </span>
                                  {item.pinned && (
                                    <span className="tdtu-board-row__pin" title="Đã ghim">
                                      <Icon name="pin" size={13} />
                                      <span className="sr-only">Đã ghim</span>
                                    </span>
                                  )}
                                  {authorBadge(item) && (
                                    <span className="tdtu-board-chip is-category">{authorBadge(item)}</span>
                                  )}
                                  {unread && <span className="tdtu-board-chip is-new">Mới</span>}
                                </span>
                                {item.summary && <span className="tdtu-board-row__summary">{item.summary}</span>}
                                <span className="tdtu-board-row__meta">
                                  {item.authorName} · {item.scope}
                                </span>
                              </span>
                              <span className="tdtu-board-row__time">{formatTimeAgo(item.createdAt)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}

          {/* Trạng thái rỗng */}
          {!loadingAnnouncements && announcements.length === 0 && (
            <div className="tdtu-home-announcements-empty">
              <Icon name="bell" size={28} style={{ margin: "0 auto 8px", color: "var(--text-muted)" }} />
              <div>Chưa có thông báo nào trong chuyên mục này.</div>
            </div>
          )}

          {/* Việc của bạn hôm nay theo vai trò (Sinh viên, Giảng viên, Supervisor, v.v.) */}
          <RoleHome data={roleData} />
        </div>

        {/* Cột phải: 2 thẻ Bento xếp dọc */}
        <div className="tdtu-home-side-cards">
          {/* Thẻ 1: Lịch trình cuộc họp sắp tới */}
          <div className="tdtu-home-side-card">
            <div className="tdtu-home-side-card__head">
              <h3 className="tdtu-home-side-card__title">
                <Icon name="calendar" size={16} />
                <span>Lịch họp sắp tới</span>
              </h3>
              <button
                type="button"
                className="tdtu-home-side-card__link"
                onClick={() => setActiveView("meetings")}
              >
                Xem lịch
              </button>
            </div>

            {!nextMeeting && (
              <div className="tdtu-home-side-empty">
                <Icon name="video" size={22} />
                <p>Không có lịch họp sắp diễn ra.</p>
                <button
                  type="button"
                  className="tdtu-home-detail-btn"
                  onClick={() => setActiveView("meetings")}
                >
                  Tạo hoặc vào phòng họp
                </button>
              </div>
            )}
            {upcomingMeetings.length > 0 && (
              <div className="tdtu-home-meetings-timeline">
                {upcomingMeetings.map((item, idx) => (
                  <div key={item.id} className={`tdtu-home-meeting-row ${idx === 0 ? "is-next" : ""}`}>
                    <div className="tdtu-home-calendar-tile">
                      <span className="tdtu-home-calendar-tile__weekday">
                        {calendarDate(item.startsAt).weekday}
                      </span>
                      <span className="tdtu-home-calendar-tile__day">
                        {calendarDate(item.startsAt).day}
                      </span>
                    </div>
                    <div className="tdtu-home-meeting-info">
                      <div className="tdtu-home-meeting-name">{item.title}</div>
                      <div className="tdtu-home-meeting-time">
                        {new Date(item.startsAt).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        ·{" "}
                        {Math.max(
                          1,
                          Math.round(
                            (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) /
                              60000,
                          ),
                        )}{" "}
                        phút
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`tdtu-home-detail-btn ${idx === 0 ? "is-primary" : ""}`}
                      onClick={() => setActiveView("meetings")}
                    >
                      {idx === 0 ? "Tham gia" : "Chi tiết"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Thẻ 2: Lối tắt phân hệ */}
          <div className="tdtu-home-side-card">
            <div className="tdtu-home-side-card__head">
              <h3 className="tdtu-home-side-card__title">
                <Icon name="sparkles" size={16} />
                <span>Truy cập nhanh</span>
              </h3>
            </div>

            <div className="tdtu-home-shortcuts-grid">
              <button
                type="button"
                className="tdtu-home-shortcut-btn is-blue"
                onClick={() => setActiveView("call-center")}
              >
                <span className="tdtu-home-shortcut-btn__icon">
                  <Icon name="headset" size={17} />
                </span>
                <span className="tdtu-home-shortcut-btn__text">
                  <strong>Tổng đài</strong>
                  <small>Softphone & Hỗ trợ</small>
                </span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn is-emerald"
                onClick={() => setActiveView("meetings")}
              >
                <span className="tdtu-home-shortcut-btn__icon">
                  <Icon name="video" size={17} />
                </span>
                <span className="tdtu-home-shortcut-btn__text">
                  <strong>Họp trực tuyến</strong>
                  <small>Phòng họp & Lịch tuần</small>
                </span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn is-violet"
                onClick={() => setActiveView("elearning")}
              >
                <span className="tdtu-home-shortcut-btn__icon">
                  <Icon name="graduation-cap" size={17} />
                </span>
                <span className="tdtu-home-shortcut-btn__text">
                  <strong>Khóa học</strong>
                  <small>Bài giảng & Kiểm tra</small>
                </span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn is-amber"
                onClick={() => setActiveView(menuAccess?.systemAdmin ? "access" : "staff")}
              >
                <span className="tdtu-home-shortcut-btn__icon">
                  <Icon name="building" size={17} />
                </span>
                <span className="tdtu-home-shortcut-btn__text">
                  <strong>Khoa / Phòng ban</strong>
                  <small>{menuAccess?.systemAdmin ? "Quản trị & Tổ chức" : "Danh bạ nhân sự"}</small>
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Modal xem chi tiết thông báo */}
      {selectedAnnouncement && (
        <AnnouncementDetailModal
          announcement={selectedAnnouncement}
          onClose={() => setSelectedAnnouncement(null)}
        />
      )}
    </div>
  );
}
