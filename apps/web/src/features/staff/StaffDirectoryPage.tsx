import { useEffect, useMemo, useState } from "react";
import type { DirectConversationItem } from "@doan/shared";
import { Icon } from "../../shared/ui/Icon";
import { Avatar } from "../../shared/ui/Primitives";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { useApp } from "../../app/providers/AppContext";
import { academicApi, rankLabel } from "../admin/api";
import { governanceApi } from "../workspaces/api";
import "./staff-directory.css";

interface StaffMember {
  userId: string;
  displayName: string;
  email: string;
  userCode: string | null;
  unitName: string | null;
  unitKind: "faculty" | "office" | null;
  departmentName: string | null;
  rank: string | null;
  extension: string | null;
  roleTitle: string;
}

export function StaffDirectoryPage() {
  const { accessToken, user, navigate, notify } = useApp();
  const phone = useGlobalSoftphone();

  const [staffList, setStaffList] = useState<StaffMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [selectedUnit, setSelectedUnit] = useState<string>("all");

  useEffect(() => {
    if (!accessToken) return;
    setFailed(false);
    academicApi<{ staff: StaffMember[] }>(accessToken, "directory").then(
      (data) => setStaffList(data.staff),
      () => setFailed(true),
    );
  }, [accessToken]);

  const unitsList = useMemo(
    () => Array.from(new Set((staffList ?? []).flatMap((s) => (s.unitName ? [s.unitName] : [])))),
    [staffList],
  );

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (staffList ?? []).filter((staff) => {
      if (selectedKind !== "all" && staff.unitKind !== selectedKind) return false;
      if (selectedUnit !== "all" && staff.unitName !== selectedUnit) return false;
      if (!q) return true;
      return [staff.displayName, staff.userCode, staff.email, staff.extension, staff.unitName, staff.departmentName]
        .some((value) => value?.toLowerCase().includes(q));
    });
  }, [staffList, searchQuery, selectedKind, selectedUnit]);

  async function message(staff: StaffMember) {
    if (!accessToken) return;
    try {
      const { conversation } = await governanceApi<{ conversation: DirectConversationItem }>(
        accessToken,
        "direct-conversations",
        "POST",
        { userId: staff.userId },
      );
      navigate({ view: "chat", channelId: conversation.id });
    } catch {
      notify("Không mở được đoạn chat", "Hãy thử lại sau.", "warning");
    }
  }

  return (
    <div className="staff-page-container">
      {/* Header */}
      <div className="staff-page-header">
        <div>
          <h1 className="staff-page-title">Danh sách nhân sự</h1>
          <p className="staff-page-subtitle">
            Tra cứu thông tin cán bộ, giảng viên, nhân viên các khoa phòng ban và gọi nhanh Softphone.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="staff-filter-bar">
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Icon
            name="search"
            size={16}
            style={{ position: "absolute", left: 12, color: "#94a3b8" }}
          />
          <input
            type="search"
            className="staff-search-input"
            aria-label="Tìm nhân sự"
            placeholder="Tìm theo tên, mã cán bộ, email, máy lẻ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="staff-filter-select"
          aria-label="Lọc theo khối"
          value={selectedKind}
          onChange={(e) => setSelectedKind(e.target.value)}
        >
          <option value="all">Tất cả khối</option>
          <option value="faculty">Khối giảng dạy (Khoa / Bộ môn)</option>
          <option value="office">Khối hành chính (Phòng ban / Ban Giám hiệu)</option>
        </select>

        <select
          className="staff-filter-select"
          aria-label="Lọc theo đơn vị"
          value={selectedUnit}
          onChange={(e) => setSelectedUnit(e.target.value)}
        >
          <option value="all">Tất cả đơn vị</option>
          {unitsList.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      {/* Table Card */}
      <div className="staff-table-card">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Cán bộ / Giảng viên</th>
              <th>Mã CB</th>
              <th>Học vị / Chức vụ</th>
              <th>Khoa / Phòng ban</th>
              <th>Số máy lẻ</th>
              <th style={{ textAlign: "right" }}>Liên lạc nhanh</th>
            </tr>
          </thead>
          <tbody>
            {(failed || !staffList || filteredStaff.length === 0) && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--nexo-text-muted)" }}>
                  {failed
                    ? "Không tải được danh sách nhân sự. Hãy tải lại trang."
                    : !staffList
                      ? "Đang tải danh sách nhân sự…"
                      : staffList.length === 0
                        ? "Chưa có tài khoản cán bộ, giảng viên nào trên hệ thống."
                        : "Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm."}
                </td>
              </tr>
            )}
            {!failed &&
              filteredStaff.map((staff) => (
                <tr key={staff.userId}>
                  <td>
                    <div className="staff-avatar-col">
                      <Avatar name={staff.displayName} size="md" />
                      <div>
                        <strong>{staff.displayName}</strong>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{staff.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{staff.userCode ? <code>{staff.userCode}</code> : "—"}</td>
                  <td>
                    <div>{staff.rank ? (rankLabel[staff.rank] ?? staff.rank) : "—"}</div>
                    <small style={{ color: "#64748b" }}>{staff.roleTitle}</small>
                  </td>
                  <td>
                    <div>{staff.unitName ?? "Chưa thuộc đơn vị"}</div>
                    {staff.departmentName && <small style={{ color: "#64748b" }}>{staff.departmentName}</small>}
                  </td>
                  <td>
                    {staff.extension ? <strong style={{ color: "#2563eb" }}>{staff.extension}</strong> : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {staff.extension && (
                      <button
                        type="button"
                        className="staff-quick-action-btn is-call"
                        title={`Gọi softphone cho ${staff.displayName} (${staff.extension})`}
                        aria-label={`Gọi ${staff.displayName}`}
                        onClick={() => phone.call(staff.extension!)}
                      >
                        <Icon name="phone" size={15} />
                      </button>
                    )}
                    {staff.userId !== user?.id && (
                      <button
                        type="button"
                        className="staff-quick-action-btn is-msg"
                        title={`Nhắn tin cho ${staff.displayName}`}
                        aria-label={`Nhắn tin cho ${staff.displayName}`}
                        onClick={() => void message(staff)}
                      >
                        <Icon name="message" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
