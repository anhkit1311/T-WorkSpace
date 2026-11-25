import { useEffect, useState, type ReactNode } from "react";
import type { CcAgentProfile, CourseSummary, MeetingScheduleItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { callCenterApi } from "../call-center/api";
import { coursesApi } from "../elearning/courses-api";
import { getMeetingSchedulesApi } from "../meetings/api";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";

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
        callCenter:
          callCenter && (callCenter.departments.length || callCenter.isAdmin) ? callCenter : null,
        courses,
        meetings: meetings
          .filter((item) => new Date(item.endsAt).getTime() > now)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      });
    });
    return () => {
      alive = false;
    };
  }, [accessToken]);
  return data;
}

const CARD = "rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const CARD_TITLE = "m-0 text-[15px] leading-6 font-semibold text-foreground";
const TILE = "grid size-[42px] shrink-0 place-items-center rounded-md bg-secondary text-foreground";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
const minutes = (item: MeetingScheduleItem) =>
  Math.max(
    1,
    Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60000),
  );

/** "15 phút nữa" inside the hour before a meeting, "đang diễn ra" once it started. */
function startsIn(item: MeetingScheduleItem): string {
  const wait = Math.round((new Date(item.startsAt).getTime() - Date.now()) / 60000);
  if (wait <= 0) return "đang diễn ra";
  if (wait <= 60) return `${wait} phút nữa`;
  return `${minutes(item)} phút`;
}

function DayTile({ iso }: { iso: string }) {
  const date = new Date(iso);
  const weekday = date.getDay() === 0 ? "CN" : `T${date.getDay() + 1}`;
  return (
    <span className={cn(TILE, "leading-none font-bold")}>
      <span className="text-center">
        <span className="block text-[10.5px] font-semibold">{weekday}</span>
        {String(date.getDate()).padStart(2, "0")}
      </span>
    </span>
  );
}

function Row({
  tile,
  title,
  sub,
  action,
  onClick,
}: {
  tile: ReactNode;
  title: string;
  sub: ReactNode;
  action?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-3 border-t py-2.5 text-left first:border-t-0"
      onClick={onClick}
    >
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">{sub}</span>
      </span>
      {action && (
        <span className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-primary-foreground">
          {action}
        </span>
      )}
    </button>
  );
}

const IconTile = ({ name }: { name: IconName }) => (
  <span className={TILE}>
    <Icon name={name} size={18} />
  </span>
);

/** Right rail of the home feed: what needs the user today, then the meetings after that. */
export function RoleHome({ data }: { data: RoleData | null }) {
  const { navigate } = useApp();
  if (!data)
    return <div className={cn(CARD, "h-40 animate-pulse")} role="status" aria-label="Đang tải…" />;
  const cc = data.callCenter;
  const isAgent = cc?.departments.some((item) => item.role === "agent");
  const supervises = cc?.isAdmin || cc?.departments.some((item) => item.role === "supervisor");
  const learning = data.courses
    .filter((item) => item.enrolled && (item.progress ?? 0) < 100)
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  const course = learning[0] ?? data.courses.find((item) => item.canManage);
  const [next, ...later] = data.meetings;
  const rows = [];

  if (next)
    rows.push(
      <Row
        key="meet"
        tile={<DayTile iso={next.startsAt} />}
        title={next.title}
        sub={`${time(next.startsAt)} · ${startsIn(next)}`}
        action="Tham gia"
        onClick={() => navigate({ view: "meetings" })}
      />,
    );
  if (course)
    rows.push(
      <Row
        key="learn"
        tile={<IconTile name="graduation-cap" />}
        title={course.title}
        sub={
          learning.length
            ? `${course.code} · đã học ${course.progress ?? 0}%`
            : "Khóa học bạn phụ trách"
        }
        onClick={() => navigate({ view: "elearning", query: course.id })}
      />,
    );
  if (cc && (isAgent || supervises))
    rows.push(
      <Row
        key="cc"
        tile={<IconTile name="headset" />}
        title="Tổng đài"
        sub={
          !isAgent ? (
            "Giám sát hàng đợi và chất lượng cuộc gọi"
          ) : cc.training.length > 0 ? (
            `Cần hoàn thành ${cc.training.length} khóa đào tạo trước khi nhận cuộc gọi`
          ) : (
            <>
              <span
                className={cn(
                  "mr-1.5 inline-block size-2 rounded-full",
                  cc.state === "offline" ? "bg-muted-foreground" : "bg-emerald-500",
                )}
              />
              {STATE[cc.state]}
              {cc.extension ? ` · máy lẻ ${cc.extension.number}` : " · chưa có máy lẻ"}
            </>
          )
        }
        onClick={() => navigate({ view: "call-center" })}
      />,
    );

  return (
    <>
      <section className={CARD} aria-label="Hôm nay">
        <h2 className={cn(CARD_TITLE, "mb-1")}>Hôm nay</h2>
        {rows.length ? (
          rows
        ) : (
          <div className="py-3 text-sm text-muted-foreground">Hôm nay bạn chưa có việc nào.</div>
        )}
      </section>

      <section className={CARD} aria-label="Lịch họp sắp tới">
        <div className="mb-1 flex items-center justify-between">
          <h2 className={CARD_TITLE}>Lịch họp sắp tới</h2>
          <button
            type="button"
            className="cursor-pointer text-[12.5px] text-muted-foreground hover:text-foreground"
            onClick={() => navigate({ view: "meetings" })}
          >
            {data.meetings.length ? "Xem lịch" : "Tạo hoặc vào phòng họp"}
          </button>
        </div>
        {later.length ? (
          later
            .slice(0, 3)
            .map((item) => (
              <Row
                key={item.id}
                tile={<DayTile iso={item.startsAt} />}
                title={item.title}
                sub={`${time(item.startsAt)} · ${minutes(item)} phút`}
                onClick={() => navigate({ view: "meetings" })}
              />
            ))
        ) : (
          <div className="py-3 text-sm text-muted-foreground">
            {next ? "Không còn cuộc họp nào khác." : "Không có lịch họp sắp diễn ra."}
          </div>
        )}
      </section>
    </>
  );
}
