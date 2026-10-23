import { useMemo, useState, useEffect } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Icon } from "../../shared/ui/Icon";
import { KpiStatCard } from "../../shared/ui/Primitives";
import { governanceApi } from "./api";
import { RoleHome, roleSubtitle, useRoleData } from "./RoleHome";
import "./workspace-home.css";

export function WorkspaceHomePage() {
  const { setActiveView, user, accessToken } = useApp();
  const { unreadCount: unreadMessages } = useSocket();

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const roleData = useRoleData();
  const nextMeeting = roleData?.meetings[0] ?? null;

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

      {/* 2. Hàng 3 thẻ KPI ngang */}
      <section className="tdtu-home-kpi-grid">
        <KpiStatCard
          icon="bell"
          tone="purple"
          value={unreadNotifications}
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
          value={roleData?.meetings.length ?? "…"}
          label="Cuộc họp sắp tới"
          onClick={() => setActiveView("meetings")}
        />
      </section>

      {/* 3. Khu vực nội dung chính chia 2 cột (Tỷ lệ 2.2fr : 1fr) */}
      <section className="tdtu-home-main-grid">
        {/* Cột trái: Bảng tin */}
        <div className="tdtu-home-feed">
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
            {nextMeeting && <div className="tdtu-home-meeting-row">
              <div className="tdtu-home-calendar-tile">
                <span className="tdtu-home-calendar-tile__weekday">{calendarDate(nextMeeting.startsAt).weekday}</span>
                <span className="tdtu-home-calendar-tile__day">{calendarDate(nextMeeting.startsAt).day}</span>
              </div>
              <div className="tdtu-home-meeting-info">
                <div className="tdtu-home-meeting-name">{nextMeeting.title}</div>
                <div className="tdtu-home-meeting-time">
                  {new Date(nextMeeting.startsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                  {Math.round((new Date(nextMeeting.endsAt).getTime() - new Date(nextMeeting.startsAt).getTime()) / 60000)} phút
                </div>
              </div>
              <button
                type="button"
                className="tdtu-home-detail-btn"
                onClick={() => setActiveView("meetings")}
              >
                Chi tiết
              </button>
            </div>}
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
    </div>
  );
}
