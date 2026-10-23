import { useMemo, useState, useEffect, useCallback } from "react";
import type { PortalAnnouncement } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Icon } from "../../shared/ui/Icon";
import { FilterPills } from "../../shared/ui/Primitives";
import { RoleHome, roleSubtitle, useRoleData } from "./RoleHome";
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

export function WorkspaceHomePage() {
  const { setActiveView, user, accessToken } = useApp();
  const { socket } = useSocket();

  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<PortalAnnouncement | null>(null);

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

  const formattedDate = useMemo(() => {
    try {
      const now = new Date();
      const day = now.getDate();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const weekdayStr = new Intl.DateTimeFormat("vi-VN", { weekday: "long" }).format(now);
      const capWeekday = weekdayStr.charAt(0).toUpperCase() + weekdayStr.slice(1);
      return `${capWeekday}, ${day} tháng ${month}, ${year}`;
    } catch {
      return "Thứ Hai, 12 tháng 10, 2026";
    }
  }, []);

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

  const displayName = user?.displayName?.trim() || "bạn";

  const featuredAnnouncement = announcements.length > 0 ? announcements[0] : null;
  const secondaryAnnouncements = announcements.slice(1, 4);

  return (
    <div className="tdtu-home-container">
      {/* 1. Lời chào */}
      <section className="tdtu-home-greeting">
        <div className="tdtu-home-greeting__date">{formattedDate}</div>
        <h1 className="tdtu-home-greeting__title">
          Xin chào, {displayName} 👋
        </h1>
        <p className="tdtu-home-greeting__subtitle">
          {roleSubtitle(roleData)}
        </p>
      </section>

      {/* 2. Khu vực nội dung chính chia 2 cột (Tỷ lệ 2.2fr : 1fr) */}
      <section className="tdtu-home-main-grid">
        {/* Cột trái: Bảng tin + Việc của bạn */}
        <div className="tdtu-home-feed">
          {/* Header Bảng tin & Bộ lọc pills */}
          <div className="tdtu-home-feed__head">
            <h2 className="tdtu-home-feed__title">Bảng tin</h2>
            <FilterPills
              options={FILTER_TABS}
              activeKey={selectedFilter}
              onChange={(key) => setSelectedFilter(key)}
            />
          </div>

          {/* Thẻ thông báo nổi bật */}
          {featuredAnnouncement && (
            <div
              className="tdtu-home-featured-card"
              onClick={() => setSelectedAnnouncement(featuredAnnouncement)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedAnnouncement(featuredAnnouncement);
                }
              }}
            >
              <div className="tdtu-home-featured-banner">
                <div className="tdtu-home-featured-banner__deco-circle-1" />
                <div className="tdtu-home-featured-banner__deco-circle-2" />
                <div className="tdtu-home-featured-banner__icon">
                  <Icon name="megaphone" size={38} strokeWidth={1.8} />
                </div>
              </div>

              <div className="tdtu-home-featured-content">
                <div>
                  <div className="tdtu-home-featured-content__tags">
                    <span className="tdtu-home-featured-chip">
                      📢 {CATEGORY_LABELS[featuredAnnouncement.category] || featuredAnnouncement.category}
                    </span>
                    {featuredAnnouncement.badge && (
                      <span className="tdtu-home-featured-badge">{featuredAnnouncement.badge}</span>
                    )}
                    {featuredAnnouncement.pinned && (
                      <span className="tdtu-home-featured-badge tdtu-home-featured-badge--pinned">
                        ⭐ Đã ghim
                      </span>
                    )}
                  </div>
                  <h3 className="tdtu-home-featured-title">{featuredAnnouncement.title}</h3>
                  <p className="tdtu-home-featured-desc">{featuredAnnouncement.summary}</p>
                </div>

                <div className="tdtu-home-featured-footer">
                  <div className="tdtu-home-featured-author-dot">
                    {featuredAnnouncement.authorName.charAt(0).toUpperCase()}
                  </div>
                  <span className="tdtu-home-featured-author-text">
                    {featuredAnnouncement.authorName} · {formatTimeAgo(featuredAnnouncement.createdAt)} · {featuredAnnouncement.scope}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Danh sách các thông báo kế tiếp */}
          {secondaryAnnouncements.length > 0 && (
            <div className="tdtu-home-announcements-list">
              {secondaryAnnouncements.map((item) => (
                <div
                  key={item.id}
                  className="tdtu-home-announcement-row"
                  onClick={() => setSelectedAnnouncement(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedAnnouncement(item);
                    }
                  }}
                >
                  <div className="tdtu-home-announcement-row__main">
                    <div className="tdtu-home-announcement-row__tags">
                      <span className="tdtu-home-featured-chip" style={{ fontSize: 11, padding: "2px 8px" }}>
                        {CATEGORY_LABELS[item.category] || item.category}
                      </span>
                      {item.badge && (
                        <span className="tdtu-home-featured-badge" style={{ fontSize: 10, padding: "1px 6px" }}>
                          {item.badge}
                        </span>
                      )}
                      {item.pinned && (
                        <span
                          className="tdtu-home-featured-badge tdtu-home-featured-badge--pinned"
                          style={{ fontSize: 10, padding: "1px 6px" }}
                        >
                          ⭐ Ghim
                        </span>
                      )}
                    </div>
                    <div className="tdtu-home-announcement-row__title">{item.title}</div>
                    <div className="tdtu-home-announcement-row__meta">
                      {item.authorName} · {formatTimeAgo(item.createdAt)} · {item.scope}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="tdtu-home-detail-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAnnouncement(item);
                    }}
                  >
                    Chi tiết
                  </button>
                </div>
              ))}
            </div>
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

        {/* Cột phải: 2 thẻ xếp dọc */}
        <div className="tdtu-home-side-cards">
          {/* Thẻ 1: Cuộc họp sắp tới */}
          <div className="tdtu-home-side-card">
            <div className="tdtu-home-side-card__head">
              <h3 className="tdtu-home-side-card__title">Cuộc họp sắp tới</h3>
              <button
                type="button"
                className="tdtu-home-side-card__link"
                onClick={() => setActiveView("meetings")}
              >
                Xem tất cả
              </button>
            </div>

            {!nextMeeting && <p className="role-home__empty">Không có lịch họp sắp tới.</p>}
            {nextMeeting && (
              <div className="tdtu-home-meeting-row">
                <div className="tdtu-home-calendar-tile">
                  <span className="tdtu-home-calendar-tile__weekday">
                    {calendarDate(nextMeeting.startsAt).weekday}
                  </span>
                  <span className="tdtu-home-calendar-tile__day">
                    {calendarDate(nextMeeting.startsAt).day}
                  </span>
                </div>
                <div className="tdtu-home-meeting-info">
                  <div className="tdtu-home-meeting-name">{nextMeeting.title}</div>
                  <div className="tdtu-home-meeting-time">
                    {new Date(nextMeeting.startsAt).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    ·{" "}
                    {Math.round(
                      (new Date(nextMeeting.endsAt).getTime() -
                        new Date(nextMeeting.startsAt).getTime()) /
                        60000,
                    )}{" "}
                    phút
                  </div>
                </div>
                <button
                  type="button"
                  className="tdtu-home-detail-btn"
                  onClick={() => setActiveView("meetings")}
                >
                  Chi tiết
                </button>
              </div>
            )}
          </div>

          {/* Thẻ 2: Lối tắt */}
          <div className="tdtu-home-side-card">
            <div className="tdtu-home-side-card__head">
              <h3 className="tdtu-home-side-card__title">Lối tắt</h3>
            </div>

            <div className="tdtu-home-shortcuts-grid">
              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("call-center")}
              >
                <Icon name="headset" size={17} />
                <span>Tổng đài</span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("meetings")}
              >
                <Icon name="video" size={17} />
                <span>Họp trực tuyến</span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("elearning")}
              >
                <Icon name="graduation-cap" size={17} />
                <span>Khóa học</span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("chat")}
              >
                <Icon name="message" size={17} />
                <span>Tin nhắn</span>
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
