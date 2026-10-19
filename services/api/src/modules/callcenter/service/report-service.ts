import type { CcKpiReport } from "@doan/shared";
import { CALL_CENTER_TIME_ZONE } from "../domain/business-hours.js";
import { kpiSummary, periodBounds } from "../domain/kpi.js";
import type { CallCenterRepository } from "../repository/callcenter-repository.js";
import type { CallCenterAdminService } from "./admin-service.js";
import { forbidden, id, integer, invalid } from "./input.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: CALL_CENTER_TIME_ZONE }).format(new Date());
const OUTCOMES: Record<string, string> = {
  answered: "Đã nghe",
  abandoned: "Bỏ máy",
  missed: "Nhỡ",
  voicemail: "Thư thoại",
  busy: "Bận",
  failed: "Lỗi",
  transferred: "Đã chuyển",
};

/** CC-9: KPI report and CDR export for a department's supervisors. */
export class CallCenterReportService {
  constructor(
    private readonly repo: CallCenterRepository,
    private readonly admin: CallCenterAdminService,
  ) {}

  private async period(userId: string, departmentId: string, params: URLSearchParams) {
    if (!(await this.admin.access(userId)).supervises(id(departmentId))) throw forbidden();
    const from = params.get("from") || today();
    const to = params.get("to") || from;
    if (!DAY.test(from) || !DAY.test(to) || to < from) throw invalid("Khoảng thời gian không hợp lệ.");
    const { start, end } = periodBounds(from, to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw invalid("Ngày không hợp lệ.");
    if (end.getTime() - start.getTime() > 92 * 86_400_000) throw invalid("Chỉ xem tối đa 92 ngày một lần.");
    return { from, to, start, end };
  }

  async kpi(userId: string, departmentId: string, params: URLSearchParams): Promise<CcKpiReport> {
    const { from, to, start, end } = await this.period(userId, departmentId, params);
    const threshold = integer({ t: Number(params.get("threshold") ?? 20) }, "t", 5, 300);
    const [calls, wrapUps] = await Promise.all([
      this.repo.kpiCalls(departmentId, start, end),
      this.repo.wrapUpSeconds(departmentId, start, end),
    ]);
    return { departmentId, from, to, serviceLevelSeconds: threshold, ...kpiSummary(calls, wrapUps, threshold) };
  }

  /**
   * CDR of the period as CSV for Excel (UTF-8 with BOM, added by the controller).
   * shortcut: CSV rather than .xlsx; switch to an xlsx writer if the school needs formatted sheets.
   */
  async exportCsv(userId: string, departmentId: string, params: URLSearchParams) {
    const { from, to, start, end } = await this.period(userId, departmentId, params);
    const calls = await this.repo.kpiCalls(departmentId, start, end);
    const time = (date: Date | null) =>
      date ? date.toLocaleString("vi-VN", { timeZone: CALL_CENTER_TIME_ZONE, hour12: false }) : "";
    const span = (a: Date | null, b: Date | null) => (a && b ? String(Math.round((b.getTime() - a.getTime()) / 1000)) : "");
    const cell = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const rows = [
      ["Bắt đầu", "Số gọi đến", "Kết quả", "Chờ (giây)", "Đàm thoại (giây)", "Tổng đài viên", "Phân loại", "Ghi chú"],
      ...calls.map((call) => [
        time(call.startedAt),
        call.callerNumber,
        OUTCOMES[call.outcome ?? ""] ?? "Đang diễn ra",
        span(call.queuedAt, call.answeredAt ?? call.endedAt),
        span(call.answeredAt, call.endedAt),
        call.agentName ?? "",
        call.disposition ?? "",
        call.notes,
      ]),
    ];
    return {
      fileName: `cuoc-goi-${from}${to === from ? "" : `_${to}`}.csv`,
      content: rows.map((row) => row.map(cell).join(",")).join("\r\n"),
    };
  }
}
