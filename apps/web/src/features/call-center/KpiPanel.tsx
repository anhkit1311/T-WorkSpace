import { useEffect, useState } from "react";
import type { CcKpiReport } from "@doan/shared";
import { Button, KpiStatCard } from "../../shared/ui/Primitives";
import { downloadCsv } from "./api";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const duration = (seconds: number | null) =>
  seconds === null ? "—" : seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}p ${Math.round(seconds % 60)}s`;
const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`);

/** CC-9: ASA, AHT, abandonment and service level for a period, with the CDR export for Excel. */
export function KpiPanel({ departmentId, api, fail, token, refreshKey }: { departmentId: string; api: Api; fail: (error: unknown) => void; token: string; refreshKey: number }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<CcKpiReport | null>(null);

  useEffect(() => {
    if (!departmentId || !from || !to) return;
    let current = true; // a slower answer for an older range must not overwrite the newer one
    api<CcKpiReport>(`departments/${departmentId}/kpi?from=${from}&to=${to}`).then((next) => current && setReport(next), fail);
    return () => {
      current = false;
    };
  }, [api, departmentId, fail, from, to, refreshKey]);

  const busiest = Math.max(1, ...(report?.hourly.map((row) => row.offered) ?? []));
  return (
    <section className="callcenter-panel desk-kpi">
      <div className="callcenter-panel__head desk-toolbar">
        <h2 className="callcenter-panel__title"><span>Chỉ số chất lượng</span></h2>
        <div className="desk-admin__inline">
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} aria-label="Từ ngày" />
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} aria-label="Đến ngày" />
          <Button size="sm" variant="ghost" icon="download" onClick={() => downloadCsv(token, `departments/${departmentId}/calls.csv?from=${from}&to=${to}`, `cuoc-goi-${from}_${to}.csv`).catch(fail)}>
            Xuất Excel
          </Button>
        </div>
      </div>
      <div className="callcenter-kpi-grid desk-kpi__grid">
        <KpiStatCard icon="phone-call" tone="blue" value={report ? `${report.answered}/${report.offered}` : "—"} label="Cuộc gọi đã nghe / vào hàng đợi" />
        <KpiStatCard icon="clock" tone="amber" value={duration(report?.asa ?? null)} label="ASA – thời gian chờ trung bình" />
        <KpiStatCard icon="headset" tone="purple" value={duration(report?.aht ?? null)} label="AHT – thời gian xử lý trung bình" />
        <KpiStatCard icon="warning" tone="red" value={percent(report?.abandonRate ?? null)} label="Tỉ lệ bỏ máy" />
        <KpiStatCard icon="check" tone="green" value={percent(report?.serviceLevel ?? null)} label={`Service level (nghe trong ${report?.serviceLevelSeconds ?? 20}s)`} />
        <KpiStatCard icon="message" tone="blue" value={report?.voicemail ?? "—"} label="Thư thoại" />
      </div>
      {report && report.hourly.length > 0 && (
        <div className="desk-hourly" aria-label="Cuộc gọi theo giờ">
          {report.hourly.map((row) => (
            <div key={row.hour} className="desk-hourly__bar" title={`${row.hour}h: ${row.answered}/${row.offered} cuộc đã nghe`}>
              <span style={{ height: `${(row.offered / busiest) * 100}%` }}>
                <i style={{ height: `${(row.answered / row.offered) * 100}%` }} />
              </span>
              <small>{row.hour}h</small>
            </div>
          ))}
        </div>
      )}
      {report && report.agents.length > 0 && (
        <table className="cdr-table">
          <thead><tr><th>Tổng đài viên</th><th>Đã nghe</th><th>Tổng đàm thoại</th><th>Đàm thoại TB</th></tr></thead>
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
      )}
    </section>
  );
}
