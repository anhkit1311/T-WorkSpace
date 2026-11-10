import { useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { academicApi } from "../admin/api";
import "./unit-reports.css";

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

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const sum = (rows: UnitReportRow[], pick: (row: UnitReportRow) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

/** 2.5: calls, meetings and courses per unit, for faculty leaders (system admins see every unit). */
export function UnitReportsPage() {
  const { accessToken } = useApp();
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState<UnitReport | null>(null);
  const [error, setError] = useState("");

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

  const rows = report?.units ?? [];
  const offered = sum(rows, (row) => row.calls.offered);
  return (
    <div className="unit-reports">
      <header className="unit-reports__head">
        <div>
          <h1>Báo cáo đơn vị</h1>
          <p>
            Tổng đài, họp và khóa học của từng khoa, phòng ban. Chỉ có số đếm, không có dữ liệu từng
            người.
          </p>
        </div>
        <div className="unit-reports__range">
          <label>
            Từ ngày
            <input
              type="date"
              value={range.from || report?.from || ""}
              onChange={(event) =>
                setRange((current) => ({ ...current, from: event.target.value }))
              }
            />
          </label>
          <label>
            Đến ngày
            <input
              type="date"
              value={range.to || report?.to || ""}
              onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
            />
          </label>
        </div>
      </header>
      {error && (
        <p role="alert" className="unit-reports__error">
          {error}
        </p>
      )}
      {!report && !error && <p className="unit-reports__muted">Đang tải…</p>}
      {report && (
        <>
          <section className="unit-reports__tiles" aria-label="Tổng cộng">
            <div>
              <span>Cuộc gọi vào hàng đợi</span>
              <strong>{offered}</strong>
              <small>
                Nghe máy{" "}
                {percent(offered ? sum(rows, (row) => row.calls.answered) / offered : null)}
              </small>
            </div>
            <div>
              <span>Giờ họp</span>
              <strong>{Math.round(sum(rows, (row) => row.meetings.hours) * 10) / 10}</strong>
              <small>{sum(rows, (row) => row.meetings.sessions)} phiên họp</small>
            </div>
            <div>
              <span>Lượt ghi danh mới</span>
              <strong>{sum(rows, (row) => row.courses.enrolled)}</strong>
              <small>{sum(rows, (row) => row.courses.completed)} lượt hoàn thành</small>
            </div>
          </section>
          <div className="unit-reports__table-wrap">
            <table className="unit-reports__table">
              <thead>
                <tr>
                  <th rowSpan={2}>Đơn vị</th>
                  <th colSpan={4}>Tổng đài</th>
                  <th colSpan={2}>Họp</th>
                  <th colSpan={3}>Khóa học</th>
                </tr>
                <tr>
                  <th>Vào hàng đợi</th>
                  <th>Nghe máy</th>
                  <th>Bỏ máy</th>
                  <th>Hẹn gọi lại</th>
                  <th>Phiên</th>
                  <th>Giờ</th>
                  <th>Đang mở</th>
                  <th>Ghi danh</th>
                  <th>Hoàn thành</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.unitId}>
                    <th scope="row">
                      {row.name}
                      <small>{row.code}</small>
                    </th>
                    <td>{row.calls.offered}</td>
                    <td>
                      {row.calls.answered} <small>({percent(row.calls.answerRate)})</small>
                    </td>
                    <td>{row.calls.abandoned}</td>
                    <td>{row.calls.callbacks}</td>
                    <td>{row.meetings.sessions}</td>
                    <td>{row.meetings.hours}</td>
                    <td>{row.courses.published}</td>
                    <td>{row.courses.enrolled}</td>
                    <td>{row.courses.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="unit-reports__muted">Chưa có đơn vị nào.</p>}
          </div>
          <p className="unit-reports__muted">
            Giờ họp tính các phiên do giảng viên, nhân viên của đơn vị chủ trì. Ghi danh và hoàn
            thành tính trong khoảng ngày đã chọn.
          </p>
        </>
      )}
    </div>
  );
}
