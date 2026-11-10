import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi } from "./api";

type Source = "media" | "workspace" | "academic";
interface ActivityItem {
  id: string;
  at: string;
  source: Source;
  actorName: string | null;
  action: string;
  target: string | null;
}

const SOURCE_LABEL: Record<Source, string> = {
  media: "Ghi âm / ghi hình",
  workspace: "Nhóm làm việc",
  academic: "Tổ chức",
};
const ACTION_LABEL: Record<string, string> = {
  "media.call": "Nghe ghi âm cuộc gọi",
  "media.voicemail": "Nghe tin nhắn thoại",
  "media.meeting": "Xem bản ghi cuộc họp",
  "account.created": "Tạo tài khoản",
  "account.deleted": "Xoá tài khoản",
  "account.password_reset": "Đặt lại mật khẩu",
  "account.code_set": "Đổi mã số",
  "account.unit_set": "Chuyển đơn vị",
  "role.granted": "Cấp quyền",
  "role.revoked": "Thu hồi quyền",
  "unit.created": "Tạo đơn vị",
  "unit.updated": "Sửa đơn vị",
  "unit.deleted": "Xoá đơn vị",
  "department.created": "Tạo phòng ban",
  "channel.created": "Tạo kênh",
  "channel.updated": "Sửa kênh",
  "channel.reordered": "Sắp xếp kênh",
  "invitation.created": "Tạo lời mời",
  "invitation.accepted": "Nhận lời mời",
  "invitation.revoked": "Thu hồi lời mời",
  "workspace.updated": "Sửa nhóm",
  "workspace.archived": "Lưu trữ nhóm",
  "workspace.restored": "Khôi phục nhóm",
};

/** "Xem nhật ký hoạt động": who listened to which recording, and governance changes across the school. */
export function ActivityPanel({ token }: { token: string }) {
  const [source, setSource] = useState<Source | "">("");
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (before?: string) => {
      setError("");
      try {
        const query = new URLSearchParams({ ...(source && { source }), ...(before && { before }) });
        const page = (await academicApi<{ items: ActivityItem[] }>(token, `activity?${query}`))
          .items;
        setItems((old) => (before ? [...(old ?? []), ...page] : page));
        setMore(page.length === 100);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Không tải được nhật ký.");
      }
    },
    [token, source],
  );
  useEffect(() => void load(), [load]);

  return (
    <section>
      <div className="admin-activity__tools">
        <h2>Nhật ký hoạt động</h2>
        <select
          value={source}
          onChange={(event) => setSource(event.target.value as Source | "")}
          aria-label="Lọc theo nguồn"
        >
          <option value="">Tất cả</option>
          {(Object.keys(SOURCE_LABEL) as Source[]).map((key) => (
            <option key={key} value={key}>
              {SOURCE_LABEL[key]}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="admin-note">
          {error}
        </p>
      )}
      {items && (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Thời gian</th>
              <th scope="col">Người thực hiện</th>
              <th scope="col">Hành động</th>
              <th scope="col">Đối tượng</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.source}:${item.id}`}>
                <td>{new Date(item.at).toLocaleString("vi-VN")}</td>
                <td>{item.actorName ?? "—"}</td>
                <td>
                  <Badge>{SOURCE_LABEL[item.source]}</Badge>{" "}
                  {ACTION_LABEL[item.action] ?? item.action}
                </td>
                <td>{item.target ?? "—"}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4}>Chưa có hoạt động nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {more && items && (
        <Button variant="secondary" size="sm" onClick={() => void load(items[items.length - 1].at)}>
          Xem cũ hơn
        </Button>
      )}
    </section>
  );
}
