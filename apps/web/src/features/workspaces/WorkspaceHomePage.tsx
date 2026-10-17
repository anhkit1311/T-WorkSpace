import { useMemo, useState, useEffect } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Icon } from "../../shared/ui/Icon";
import { FilterPills, KpiStatCard } from "../../shared/ui/Primitives";
import { governanceApi } from "./api";
import "./workspace-home.css";

interface NewsItem {
  id: string;
  category: string;
  badge?: string;
  title: string;
  summary: string;
  author: string;
  time: string;
  scope: string;
  filterKey: "general" | "training" | "event" | "urgent";
}

export function WorkspaceHomePage() {
  const { setActiveView, user, accessToken } = useApp();
  const { unreadCount: unreadMessages } = useSocket();

  const [unreadNotifications, setUnreadNotifications] = useState(1);
  const [selectedFilter, setSelectedFilter] = useState<string>("all");

  useEffect(() => {
    if (!accessToken) return;
    void governanceApi<{ unreadCount: number }>(accessToken, "notifications?unread=true")
      .then((res) => {
        if (typeof res?.unreadCount === "number") {
          setUnreadNotifications(res.unreadCount);
        }
      })
      .catch(() => {});
  }, [accessToken]);

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

  const calendarDate = useMemo(() => {
    const now = new Date();
    const day = now.getDate();
    const dayOfWeek = now.getDay();
    const weekdayShort = dayOfWeek === 0 ? "CN" : `T${dayOfWeek + 1}`;
    return {
      weekday: weekdayShort,
      day: day.toString().padStart(2, "0"),
    };
  }, []);

  const displayName = user?.displayName?.trim() || "Nguyễn Đăng Khoa";

  const filterTabs = [
    { key: "all", label: "Tất cả" },
    { key: "general", label: "Thông báo chung" },
    { key: "training", label: "Đào tạo" },
    { key: "event", label: "Sự kiện" },
    { key: "urgent", label: "Khẩn" },
  ];

  const featuredPost: NewsItem = {
    id: "1",
    category: "Thông báo chung",
    badge: "Mới",
    title: "đâ",
    summary: "sdasdas",
    author: displayName,
    time: "Vừa xong",
    scope: "Toàn trường",
    filterKey: "general",
  };

  return (
    <div className="tdtu-home-container">
      {/* 1. Lời chào */}
      <section className="tdtu-home-greeting">
        <div className="tdtu-home-greeting__date">{formattedDate}</div>
        <h1 className="tdtu-home-greeting__title">
          Xin chào, {displayName} 👋
        </h1>
        <p className="tdtu-home-greeting__subtitle">
          Quản trị hệ thống · Tài khoản khoa
        </p>
      </section>

      {/* 2. Hàng 3 thẻ KPI ngang */}
      <section className="tdtu-home-kpi-grid">
        <KpiStatCard
          icon="bell"
          tone="purple"
          value={unreadNotifications > 0 ? unreadNotifications : 1}
          label="Thông báo chưa đọc"
          onClick={() => setActiveView("notifications")}
        />
        <KpiStatCard
          icon="message"
          tone="green"
          value={unreadMessages || 0}
          label="Tin nhắn chưa đọc"
          onClick={() => setActiveView("chat")}
        />
        <KpiStatCard
          icon="video"
          tone="purple"
          value={1}
          label="Cuộc họp sắp tới"
          onClick={() => setActiveView("meetings")}
        />
      </section>

      {/* 3. Khu vực nội dung chính chia 2 cột (Tỷ lệ 2.2fr : 1fr) */}
      <section className="tdtu-home-main-grid">
        {/* Cột trái: Bảng tin */}
        <div className="tdtu-home-feed">
          <div className="tdtu-home-feed__head">
            <h2 className="tdtu-home-feed__title">Bảng tin</h2>
            <FilterPills
              options={filterTabs}
              activeKey={selectedFilter}
              onChange={(key) => {
                setSelectedFilter(key);
                if (key === "training") {
                  setActiveView("elearning");
                }
              }}
            />
          </div>

          {/* Thẻ bài viết nổi bật chia 2 nửa */}
          <div className="tdtu-home-featured-card">
            {/* Nửa trái: Khối màu xanh gradient có icon cái loa */}
            <div className="tdtu-home-featured-banner">
              <div className="tdtu-home-featured-banner__deco-circle-1" />
              <div className="tdtu-home-featured-banner__deco-circle-2" />
              <div className="tdtu-home-featured-banner__icon">
                <Icon name="megaphone" size={54} strokeWidth={1.7} />
              </div>
            </div>

            {/* Nửa phải: Nhãn, badge, tiêu đề, tóm tắt, tác giả */}
            <div className="tdtu-home-featured-content">
              <div>
                <div className="tdtu-home-featured-content__tags">
                  <span className="tdtu-home-featured-chip">
                    📢 {featuredPost.category}
                  </span>
                  {featuredPost.badge && (
                    <span className="tdtu-home-featured-badge">{featuredPost.badge}</span>
                  )}
                </div>
                <h3 className="tdtu-home-featured-title">{featuredPost.title}</h3>
                <p className="tdtu-home-featured-desc">{featuredPost.summary}</p>
              </div>

              <div className="tdtu-home-featured-footer">
                <div className="tdtu-home-featured-author-dot" />
                <span className="tdtu-home-featured-author-text">
                  {featuredPost.author} · {featuredPost.time} · {featuredPost.scope}
                </span>
              </div>
            </div>
          </div>
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

            <div className="tdtu-home-meeting-row">
              <div className="tdtu-home-calendar-tile">
                <span className="tdtu-home-calendar-tile__weekday">{calendarDate.weekday}</span>
                <span className="tdtu-home-calendar-tile__day">{calendarDate.day}</span>
              </div>
              <div className="tdtu-home-meeting-info">
                <div className="tdtu-home-meeting-name">Báo cáo dự án</div>
                <div className="tdtu-home-meeting-time">22:30 · 60 phút</div>
              </div>
              <button
                type="button"
                className="tdtu-home-detail-btn"
                onClick={() => setActiveView("meetings")}
              >
                Chi tiết
              </button>
            </div>
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
                onClick={() => setActiveView("chat")}
              >
                <Icon name="message" size={17} />
                <span>Nhắn tin</span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("meetings")}
              >
                <Icon name="video" size={17} />
                <span>Hội nghị</span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("call-center")}
              >
                <Icon name="phone-call" size={17} />
                <span>Cuộc gọi</span>
              </button>

              <button
                type="button"
                className="tdtu-home-shortcut-btn"
                onClick={() => setActiveView("workspace")}
              >
                <Icon name="users" size={17} />
                <span>Nhân sự</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
