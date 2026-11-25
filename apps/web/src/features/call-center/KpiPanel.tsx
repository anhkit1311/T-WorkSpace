import { useEffect, useState } from "react";
import type { CcKpiReport } from "@doan/shared";
import { Button, KpiStatCard } from "../../shared/ui/Primitives";
import { cn } from "../../shared/lib/utils";
import { downloadCsv } from "./api";
import { CARD, H2, TABLE } from "./ui";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const duration = (seconds: number | null) =>
  seconds === null
    ? "—"
    : seconds < 60
      ? `${Math.round(seconds)}s`
      : `${Math.floor(seconds / 60)}p ${Math.round(seconds % 60)}s`;
const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`);

/** CC-9: ASA, AHT, abandonment and service level for a period, with the CDR export for Excel. */
export function KpiPanel({
  departmentId,
  api,
  fail,
  token,
  refreshKey,
}: {
  departmentId: string;
  api: Api;
  fail: (error: unknown) => void;
  token: string;
  refreshKey: number;
}) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<CcKpiReport | null>(null);

  useEffect(() => {
    if (!departmentId || !from || !to) return;
    let current = true; // a slower answer for an older range must not overwrite the newer one
    api<CcKpiReport>(`departments/${departmentId}/kpi?from=${from}&to=${to}`).then(
      (next) => current && setReport(next),
      fail,
    );
    return () => {
      current = false;
    };
  }, [api, departmentId, fail, from, to, refreshKey]);

  const busiest = Math.max(1, ...(report?.hourly.map((row) => row.offered) ?? []));
  return (
    <section className={cn(CARD, "tw-form gap-3.5")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={H2}>Chỉ số chất lượng</h2>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <input
            className="h-8! py-0! text-[13px]!"
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Từ ngày"
          />
          <input
            className="h-8! py-0! text-[13px]!"
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Đến ngày"
          />
          <Button
            size="sm"
            variant="ghost"
            icon="download"
            onClick={() =>
              downloadCsv(
                token,
                `departments/${departmentId}/calls.xlsx?from=${from}&to=${to}`,
                `cuoc-goi-${from}_${to}.xlsx`,
              ).catch(fail)
            }
          >
            Xuất Excel
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        <KpiStatCard
          icon="phone-call"
          tone="blue"
          value={report ? `${report.answered}/${report.offered}` : "—"}
          label="Cuộc gọi đã nghe / vào hàng đợi"
        />
        <KpiStatCard
          icon="clock"
          tone="amber"
          value={duration(report?.asa ?? null)}
          label="ASA – thời gian chờ trung bình"
        />
        <KpiStatCard
          icon="headset"
          tone="purple"
          value={duration(report?.aht ?? null)}
          label="AHT – thời gian xử lý trung bình"
        />
        <KpiStatCard
          icon="warning"
          tone="red"
          value={percent(report?.abandonRate ?? null)}
          label="Tỉ lệ bỏ máy"
        />
        <KpiStatCard
          icon="check"
          tone="green"
          value={percent(report?.serviceLevel ?? null)}
          label={`Service level (nghe trong ${report?.serviceLevelSeconds ?? 20}s)`}
        />
        <KpiStatCard
          icon="message"
          tone="blue"
          value={report?.voicemail ?? "—"}
          label="Thư thoại"
        />
        <KpiStatCard
          icon="phone"
          tone="amber"
          value={report?.callback ?? "—"}
          label="Hẹn gọi lại (không tính bỏ máy)"
        />
      </div>
      {report && report.hourly.length > 0 && (
        <div className="flex h-[120px] items-stretch gap-1.5" aria-label="Cuộc gọi theo giờ">
          {report.hourly.map((row) => (
            <div
              key={row.hour}
              className="grid flex-1 grid-rows-[1fr_auto] justify-items-center gap-1"
              title={`${row.hour}h: ${row.answered}/${row.offered} cuộc đã nghe`}
            >
              <span
                className="flex w-full max-w-[26px] items-end self-end overflow-hidden rounded-t-[5px] rounded-b-[2px] bg-secondary"
                style={{ height: `${(row.offered / busiest) * 100}%` }}
              >
                <i
                  className="block w-full rounded-t-[5px] rounded-b-[2px] bg-[#2f6bff]"
                  style={{ height: `${(row.answered / row.offered) * 100}%` }}
                />
              </span>
              <small className="text-[10.5px] text-muted-foreground">{row.hour}h</small>
            </div>
          ))}
        </div>
      )}
      {report && report.agents.length > 0 && (
        <div className="overflow-x-auto rounded-[9px] border">
          <table className={TABLE}>
            <thead>
              <tr>
                <th>Tổng đài viên</th>
                <th>Đã nghe</th>
                <th>Tổng đàm thoại</th>
                <th>Đàm thoại TB</th>
              </tr>
            </thead>
            <tbody>
              {report.agents.map((agent) => (
                <tr key={agent.userId}>
                  <td>{agent.displayName}</td>
                  <td>{agent.answered}</td>
                  <td>{duration(agent.talkSeconds)}</td>
                  <td>{duration(agent.averageTalk)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
