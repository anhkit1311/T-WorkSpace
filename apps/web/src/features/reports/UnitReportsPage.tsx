import { useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { cn } from "../../shared/lib/utils";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { academicApi } from "../admin/api";

interface UnitReportRow {
  unitId: string;
  code: string;
  name: string;
  calls: {
    offered: number;
    answered: number;
    abandoned: number;
    callbacks: number;
    answerRate: number | null;
  };
  meetings: { sessions: number; hours: number };
  courses: { published: number; enrolled: number; completed: number };
}
interface UnitReport {
  from: string;
  to: string;
  units: UnitReportRow[];
}

const sum = (rows: UnitReportRow[], pick: (row: UnitReportRow) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);
const ratio = (part: number, whole: number) => (whole ? part / whole : null);
const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const num = (value: number) => value.toLocaleString("vi-VN");
const round1 = (value: number) => Math.round(value * 10) / 10;
/** Local calendar day as YYYY-MM-DD, the format the API and <input type="date"> use. */
const day = (date: Date) => new Intl.DateTimeFormat("en-CA").format(date);

// shortcut: semesters are fixed months (HK1 Aug–Dec, HK2 Jan–May, summer Jun–Jul); read them from the academic calendar if one is added.
const semesterStart = (now: Date) => {
  const month = now.getMonth();
  const start = month >= 7 ? 7 : month >= 5 ? 5 : 0;
  return new Date(now.getFullYear(), start, 1);
};
const PRESETS: { key: string; label: string; from: (now: Date) => Date }[] = [
  { key: "7d", label: "7 ngày", from: (now) => new Date(now.getTime() - 6 * 86_400_000) },
  { key: "30d", label: "30 ngày", from: (now) => new Date(now.getTime() - 29 * 86_400_000) },
  { key: "semester", label: "Học kỳ này", from: semesterStart },
  { key: "year", label: "Năm nay", from: (now) => new Date(now.getFullYear(), 0, 1) },
];

type SortKey = "name" | "offered" | "sessions" | "hours" | "enrolled";
const SORT: Record<SortKey, (row: UnitReportRow) => number | string> = {
  name: (row) => row.name,
  offered: (row) => row.calls.offered,
  sessions: (row) => row.meetings.sessions,
  hours: (row) => row.meetings.hours,
  enrolled: (row) => row.courses.enrolled,
};

const GROUPS = {
  calls: {
    text: "text-[#2f6bff] dark:text-[#7aa2ff]",
    bar: "bg-[#2f6bff]",
    tint: "bg-[#e7f0ff] text-[#2f6bff]",
  },
  meetings: {
    text: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
    tint: "bg-emerald-50 text-emerald-700",
  },
  courses: {
    text: "text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
    tint: "bg-amber-50 text-amber-700",
  },
};
const GROUP_DARK = {
  calls: "dark:bg-[#16233f] dark:text-[#7aa2ff]",
  meetings: "dark:bg-emerald-950 dark:text-emerald-300",
  courses: "dark:bg-amber-950 dark:text-amber-300",
};
const SEP = "border-l";
const CELL = "px-[9px] py-2.5 text-right whitespace-nowrap tabular-nums";

function Meter({ value, className }: { value: number | null; className: string }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-secondary">
      <span
        className={cn("block h-full rounded-full", className)}
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </span>
  );
}

function Rate({ value, className }: { value: number | null; className: string }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-10">
        <Meter value={value} className={className} />
      </span>
      <small className="w-[34px] text-right text-xs">{pct(value)}</small>
    </span>
  );
}

const Num = ({ value }: { value: number }) =>
  value ? <>{num(value)}</> : <span className="text-muted-foreground">0</span>;

/** 2.5: calls, meetings and courses per unit, for faculty leaders (system admins see every unit). */
export function UnitReportsPage() {
  const { accessToken } = useApp();
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState<UnitReport | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("offered");

  useEffect(() => {
    if (!accessToken) return;
    const query = new URLSearchParams(
      Object.entries(range).filter(([, value]) => value),
    ).toString();
    academicApi<UnitReport>(accessToken, `reports${query ? `?${query}` : ""}`).then(
      (data) => {
        setError("");
        setReport(data);
      },
      (failure: Error) => setError(failure.message),
    );
  }, [accessToken, range]);

  const from = range.from || report?.from || "";
  const to = range.to || report?.to || "";
  const today = new Date();
  const activePreset = PRESETS.find(
    (preset) => to === day(today) && from === day(preset.from(today)),
  )?.key;

  const all = report?.units ?? [];
  const needle = filter.trim().toLowerCase();
  const rows = all
    .filter((row) => !needle || `${row.name} ${row.code}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const x = SORT[sort](a);
      const y = SORT[sort](b);
      return typeof x === "string" ? x.localeCompare(y as string, "vi") : (y as number) - x;
    });

  const offered = sum(all, (row) => row.calls.offered);
  const answered = sum(all, (row) => row.calls.answered);
  const abandoned = sum(all, (row) => row.calls.abandoned);
  const callbacks = sum(all, (row) => row.calls.callbacks);
  const sessions = sum(all, (row) => row.meetings.sessions);
  const hours = round1(sum(all, (row) => row.meetings.hours));
  const published = sum(all, (row) => row.courses.published);
  const enrolled = sum(all, (row) => row.courses.enrolled);
  const completed = sum(all, (row) => row.courses.completed);

  const tiles: {
    group: keyof typeof GROUPS;
    icon: IconName;
    label: string;
    value: string;
    meter: number | null;
    note: string;
  }[] = [
    {
      group: "calls",
      icon: "phone",
      label: "Cuộc gọi vào hàng đợi",
      value: num(offered),
      meter: ratio(answered, offered),
      note: `Nghe máy ${pct(ratio(answered, offered))} · ${abandoned} bỏ máy · ${callbacks} hẹn gọi lại`,
    },
    {
      group: "meetings",
      icon: "video",
      label: "Giờ họp",
      value: num(hours),
      meter: sessions ? 1 : 0,
      note: `${sessions} phiên họp do đơn vị chủ trì`,
    },
    {
      group: "courses",
      icon: "graduation-cap",
      label: "Lượt ghi danh mới",
      value: num(enrolled),
      meter: ratio(completed, enrolled),
      note: `${completed} lượt hoàn thành (${pct(ratio(completed, enrolled))}) · ${published} khóa đang mở`,
    },
  ];

  const sortHead = (key: SortKey, label: string, className?: string) => (
    <th
      className={cn(CELL, "font-semibold", className)}
      aria-sort={sort === key ? (key === "name" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className={cn("cursor-pointer hover:text-foreground", sort === key && "text-foreground")}
        onClick={() => setSort(key)}
      >
        {label}
        <span className={cn("ml-1", sort !== key && "opacity-40")} aria-hidden="true">
          {sort === key ? "↓" : "↕"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="tw tw-form grid min-w-0 gap-4 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-0.5">
          <h1 className="text-[22px] font-bold">Báo cáo đơn vị</h1>
          <p className="text-[13px] text-muted-foreground">
            Tổng đài, họp và khóa học của từng khoa, phòng ban. Chỉ có số đếm, không có dữ liệu từng
            người.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0">
          <div
            className="flex rounded-[9px] bg-secondary p-[3px]"
            role="group"
            aria-label="Khoảng thời gian"
          >
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={cn(
                  "cursor-pointer rounded-[7px] px-3 py-[5px] text-[13px] font-medium text-muted-foreground",
                  activePreset === preset.key && "bg-card font-semibold text-foreground shadow-sm",
                )}
                aria-pressed={activePreset === preset.key}
                onClick={() => setRange({ from: day(preset.from(today)), to: day(today) })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <input
              type="date"
              aria-label="Từ ngày"
              value={from}
              onChange={(event) => setRange({ from: event.target.value, to })}
            />
            –
            <input
              type="date"
              aria-label="Đến ngày"
              value={to}
              onChange={(event) => setRange({ from, to: event.target.value })}
            />
          </div>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-[var(--tint-red-bg)] px-3 py-2 text-[13px] text-[var(--tint-red-fg)]"
        >
          {error}
        </p>
      )}
      {!report && !error && <p className="text-[13px] text-muted-foreground">Đang tải…</p>}
      {report && (
        <>
          <section className="grid gap-3 min-[900px]:grid-cols-3" aria-label="Tổng cộng">
            {tiles.map((tile) => (
              <div key={tile.label} className="grid gap-1.5 rounded-[10px] border bg-card p-4">
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <span
                    className={cn(
                      "grid size-[30px] place-items-center rounded-lg",
                      GROUPS[tile.group].tint,
                      GROUP_DARK[tile.group],
                    )}
                    aria-hidden="true"
                  >
                    <Icon name={tile.icon} size={16} />
                  </span>
                  {tile.label}
                </div>
                <strong className="text-[30px] leading-tight font-bold tabular-nums">
                  {tile.value}
                </strong>
                <Meter value={tile.meter} className={GROUPS[tile.group].bar} />
                <small className="text-xs text-muted-foreground">{tile.note}</small>
              </div>
            ))}
          </section>

          <section
            className="overflow-hidden rounded-[10px] border bg-card"
            aria-label="Theo đơn vị"
          >
            <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
              <h2 className="text-[15px] font-semibold">Theo đơn vị</h2>
              <small className="text-xs text-muted-foreground">
                {all.length} đơn vị · {new Date(report.from).toLocaleDateString("vi-VN")} –{" "}
                {new Date(report.to).toLocaleDateString("vi-VN")}
              </small>
              <label className="ml-auto flex h-8 w-60 items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground max-md:ml-0 max-md:w-full">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  className="min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[13px] text-foreground outline-none"
                  placeholder="Lọc đơn vị"
                  aria-label="Lọc đơn vị"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-[13.5px]">
                <thead className="bg-background text-xs text-muted-foreground">
                  <tr className="text-[11.5px] tracking-wider uppercase">
                    <th />
                    <th
                      colSpan={5}
                      className={cn(
                        SEP,
                        "px-[9px] pt-2.5 pb-1 text-right font-semibold shadow-[inset_0_2px_0_#2f6bff]",
                        GROUPS.calls.text,
                      )}
                    >
                      Tổng đài
                    </th>
                    <th
                      colSpan={2}
                      className={cn(
                        SEP,
                        "px-[9px] pt-2.5 pb-1 text-right font-semibold shadow-[inset_0_2px_0_#10b981]",
                        GROUPS.meetings.text,
                      )}
                    >
                      Họp
                    </th>
                    <th
                      colSpan={4}
                      className={cn(
                        SEP,
                        "px-[9px] pt-2.5 pb-1 text-right font-semibold shadow-[inset_0_2px_0_#f59e0b]",
                        GROUPS.courses.text,
                      )}
                    >
                      Khóa học
                    </th>
                  </tr>
                  <tr className="border-b">
                    {sortHead("name", "Đơn vị", "text-left")}
                    {sortHead("offered", "Vào hàng đợi", SEP)}
                    <th className={cn(CELL, "font-semibold")}>Nghe máy</th>
                    <th className={cn(CELL, "font-semibold")}>Tỉ lệ nghe</th>
                    <th className={cn(CELL, "font-semibold")}>Bỏ máy</th>
                    <th className={cn(CELL, "font-semibold")}>Hẹn gọi lại</th>
                    {sortHead("sessions", "Phiên", SEP)}
                    {sortHead("hours", "Giờ")}
                    <th className={cn(CELL, SEP, "font-semibold")}>Đang mở</th>
                    {sortHead("enrolled", "Ghi danh")}
                    <th className={cn(CELL, "font-semibold")}>Hoàn thành</th>
                    <th className={cn(CELL, "font-semibold")}>Tỉ lệ xong</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.unitId} className="border-t first:border-t-0 hover:bg-secondary">
                      <th scope="row" className="px-[9px] py-2.5 text-left font-semibold">
                        {row.name}
                        <small className="block font-mono text-[11.5px] font-normal text-muted-foreground">
                          {row.code}
                        </small>
                      </th>
                      <td className={cn(CELL, SEP)}>
                        <Num value={row.calls.offered} />
                      </td>
                      <td className={CELL}>
                        <Num value={row.calls.answered} />
                      </td>
                      <td className={CELL}>
                        <Rate value={row.calls.answerRate} className={GROUPS.calls.bar} />
                      </td>
                      <td className={CELL}>
                        <Num value={row.calls.abandoned} />
                      </td>
                      <td className={CELL}>
                        <Num value={row.calls.callbacks} />
                      </td>
                      <td className={cn(CELL, SEP)}>
                        <Num value={row.meetings.sessions} />
                      </td>
                      <td className={CELL}>
                        <Num value={round1(row.meetings.hours)} />
                      </td>
                      <td className={cn(CELL, SEP)}>
                        <Num value={row.courses.published} />
                      </td>
                      <td className={CELL}>
                        <Num value={row.courses.enrolled} />
                      </td>
                      <td className={CELL}>
                        <Num value={row.courses.completed} />
                      </td>
                      <td className={CELL}>
                        <Rate
                          value={ratio(row.courses.completed, row.courses.enrolled)}
                          className={GROUPS.courses.bar}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {all.length > 1 && (
                  <tfoot className="border-t-2 bg-background font-bold">
                    <tr>
                      <th className="px-[9px] py-2.5 text-left">Tổng cộng</th>
                      <td className={cn(CELL, SEP)}>{num(offered)}</td>
                      <td className={CELL}>{num(answered)}</td>
                      <td className={CELL}>
                        <Rate value={ratio(answered, offered)} className={GROUPS.calls.bar} />
                      </td>
                      <td className={CELL}>{num(abandoned)}</td>
                      <td className={CELL}>{num(callbacks)}</td>
                      <td className={cn(CELL, SEP)}>{num(sessions)}</td>
                      <td className={CELL}>{num(hours)}</td>
                      <td className={cn(CELL, SEP)}>{num(published)}</td>
                      <td className={CELL}>{num(enrolled)}</td>
                      <td className={CELL}>{num(completed)}</td>
                      <td className={CELL}>
                        <Rate value={ratio(completed, enrolled)} className={GROUPS.courses.bar} />
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {!rows.length && (
                <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  {all.length ? "Không có đơn vị khớp bộ lọc." : "Chưa có đơn vị nào."}
                </p>
              )}
            </div>
          </section>
          <p className="text-[12.5px] text-muted-foreground">
            Giờ họp tính các phiên do giảng viên, nhân viên của đơn vị chủ trì. Ghi danh và hoàn
            thành tính trong khoảng ngày đã chọn.
          </p>
        </>
      )}
    </div>
  );
}
