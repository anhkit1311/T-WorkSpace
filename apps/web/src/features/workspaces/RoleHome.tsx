import { useEffect, useState } from "react";
import type { CcAgentProfile, CourseSummary, MeetingScheduleItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { callCenterApi } from "../call-center/api";
import { coursesApi } from "../elearning/courses-api";
import { getMeetingSchedulesApi } from "../meetings/api";
import { Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";

const STATE: Record<CcAgentProfile["state"], string> = {
  offline: "Ngoại tuyến",
  ready: "Sẵn sàng",
  not_ready: "Tạm nghỉ",
  ringing: "Đang đổ chuông",
  on_call: "Đang đàm thoại",
  wrap_up: "Hoàn tất cuộc gọi",
};

export type RoleData = {
  callCenter: CcAgentProfile | null;
  courses: CourseSummary[];
  meetings: MeetingScheduleItem[];
};

/** UI-4: what this user does here (switchboard, courses, meetings), from the real APIs. */
export function useRoleData(): RoleData | null {
  const { accessToken } = useApp();
  const [data, setData] = useState<RoleData | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    let alive = true;
    // Each source is optional: a user outside the call center simply gets null there.
    void Promise.all([
      callCenterApi<CcAgentProfile>(accessToken, "me").catch(() => null),
      coursesApi.list(accessToken).catch(() => [] as CourseSummary[]),
      getMeetingSchedulesApi(accessToken).catch(() => [] as MeetingScheduleItem[]),
    ]).then(([callCenter, courses, meetings]) => {
      if (!alive) return;
      const now = Date.now();
      setData({
        callCenter: callCenter && (callCenter.departments.length || callCenter.isAdmin) ? callCenter : null,
        courses,
        meetings: meetings.filter((item) => new Date(item.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      });
    });
    return () => {
      alive = false;
    };
  }, [accessToken]);
  return data;
}

/** One line under the greeting: the user's roles in the three subsystems. */
export function roleSubtitle(data: RoleData | null) {
  if (!data) return "Đang tải vai trò…";
  const roles: string[] = [];
  const cc = data.callCenter;
  if (cc?.isAdmin) roles.push("Quản trị tổng đài");
  if (cc?.departments.some((item) => item.role === "supervisor")) roles.push("Giám sát tổng đài");
  if (cc?.departments.some((item) => item.role === "agent")) roles.push("Tổng đài viên");
  const learning = data.courses.filter((item) => item.enrolled).length;
  if (data.courses.some((item) => item.canManage)) roles.push("Giảng viên e-learning");
  if (learning) roles.push(`Học viên ${learning} khóa`);
  return roles.length ? roles.join(" · ") : "Thành viên TDTU";
}

/** "Việc của bạn hôm nay": one card per subsystem the user takes part in. */
export function RoleHome({ data }: { data: RoleData | null }) {
  const { navigate } = useApp();
  if (!data) return <p className="role-home__empty">Đang tải việc của bạn…</p>;
  const cc = data.callCenter;
  const isAgent = cc?.departments.some((item) => item.role === "agent");
  const supervises = cc?.isAdmin || cc?.departments.some((item) => item.role === "supervisor");
  const learning = data.courses.filter((item) => item.enrolled && (item.progress ?? 0) < 100).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  const teaching = data.courses.filter((item) => item.canManage);
  const next = data.meetings[0];
  const cards = [];

  if (cc && (isAgent || supervises))
    cards.push(
      <article key="cc" className="role-home__card">
        <Icon name="headset" size={20} />
        <div>
          <h3>Tổng đài</h3>
          {isAgent && (
            <p>
              Trạng thái: <strong>{STATE[cc.state]}</strong>
              {cc.extension ? ` · máy lẻ ${cc.extension.number}` : " · chưa có máy lẻ"}
            </p>
          )}
          {isAgent && cc.training.length > 0 && <p className="role-home__warn">Cần hoàn thành {cc.training.length} khóa đào tạo trước khi nhận cuộc gọi.</p>}
          {supervises && <p>Theo dõi hàng đợi, nghe xen và chấm điểm chất lượng cuộc gọi.</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate({ view: "call-center" })}>
          {isAgent ? "Vào bàn làm việc" : "Mở giám sát"}
        </Button>
      </article>,
    );

  if (learning.length || teaching.length)
    cards.push(
      <article key="learn" className="role-home__card">
        <Icon name="book" size={20} />
        <div>
          <h3>{learning.length ? "Tiếp tục học" : "Khóa học bạn phụ trách"}</h3>
          {(learning.length ? learning : teaching).slice(0, 2).map((course) => (
            <p key={course.id}>
              {course.code} — {course.title}
              {course.enrolled && course.progress !== null ? ` · ${course.progress}%` : ""}
            </p>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate({ view: "elearning", query: (learning[0] ?? teaching[0]).id })}>
          Mở khóa học
        </Button>
      </article>,
    );

  cards.push(
    <article key="meet" className="role-home__card">
      <Icon name="video" size={20} />
      <div>
        <h3>Cuộc họp</h3>
        {next ? (
          <p>
            {next.title} · {new Date(next.startsAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
          </p>
        ) : (
          <p>Không có lịch họp sắp tới.</p>
        )}
      </div>
      <Button size="sm" variant="secondary" onClick={() => navigate({ view: "meetings" })}>
        {next ? "Xem lịch họp" : "Họp nhanh"}
      </Button>
    </article>,
  );

  return (
    <section className="role-home" aria-label="Việc của bạn hôm nay">
      <h2 className="tdtu-home-feed__title">Việc của bạn hôm nay</h2>
      {cards}
    </section>
  );
}
