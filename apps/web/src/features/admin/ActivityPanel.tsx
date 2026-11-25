import { useCallback, useEffect, useState } from "react";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { dayGroup } from "../announcements/day";
import { BTN_GHOST, BTN_SM, CHIP, MUTED, SEG, SEG_BTN, TABLE_CARD, TINT } from "./ui";
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
const SOURCE_TONE: Record<Source, string> = {
  media: TINT.amber,
  workspace: TINT.green,
  academic: TINT.blue,
};
/** "Hôm nay", "Hôm qua", else the date. */
const dayLabel = (iso: string) =>
  dayGroup(iso) === "Trước đó"
    ? new Date(iso).toLocaleDateString("vi-VN", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : dayGroup(iso);
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
  "staff.created": "Thêm hồ sơ cán bộ",
  "member.role": "Đổi vai trò thành viên của",
  // Left by the thesis-term module dropped from scope; old rows still show in the log.
  "term.created": "Tạo đợt đồ án",
  "term.advanced": "Chuyển giai đoạn đợt đồ án",
  "milestone.created": "Tạo mốc nộp bài",
  "rubric.set": "Đặt tiêu chí chấm",
  "enrollment.imported": "Nhập danh sách sinh viên",
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

  const days = new Map<string, ActivityItem[]>();
  for (const item of items ?? []) {
    const label = dayLabel(item.at);
    days.set(label, [...(days.get(label) ?? []), item]);
  }
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5"
      aria-label="Nhật ký hoạt động"
    >
      <div className={SEG} role="group" aria-label="Lọc theo nguồn">
        {([["", "Tất cả"], ...Object.entries(SOURCE_LABEL)] as [Source | "", string][]).map(
          ([key, label]) => (
            <button
              key={key}
              type="button"
              className={SEG_BTN}
              aria-pressed={source === key}
              onClick={() => setSource(key)}
            >
              {label}
            </button>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className={MUTED}>
          {error}
        </p>
      )}
      {items && (
        <div className={TABLE_CARD}>
          {!items.length && (
            <p className={cn(MUTED, "px-4 py-8 text-center")}>Chưa có hoạt động nào.</p>
          )}
          {[...days].map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h3 className="border-b bg-background px-4 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground first-letter:uppercase">
                {day}
              </h3>
              <ul className="list-none">
                {list.map((item) => (
                  <li
                    key={`${item.source}:${item.id}`}
                    className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2 hover:bg-secondary max-md:grid-cols-[48px_minmax(0,1fr)]"
                  >
                    <time
                      dateTime={item.at}
                      className="font-mono text-[12.5px] text-muted-foreground"
                      title={new Date(item.at).toLocaleString("vi-VN")}
                    >
                      {new Date(item.at).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <p className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar
                        name={item.actorName ?? "?"}
                        className="size-[26px] text-[10.5px]"
                      />
                      <span className="min-w-0 truncate max-lg:whitespace-normal">
                        <b className="font-semibold">{item.actorName ?? "Hệ thống"}</b>{" "}
                        <span className="text-muted-foreground">
                          {ACTION_LABEL[item.action] ?? item.action}
                        </span>
                        {item.target && <b className="font-semibold"> {item.target}</b>}
                      </span>
                    </p>
                    <span className={cn(CHIP, SOURCE_TONE[item.source], "max-md:hidden")}>
                      {SOURCE_LABEL[item.source]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && (
            <div className="flex justify-center p-3">
              <button
                type="button"
                className={cn(BTN_GHOST, BTN_SM)}
                onClick={() => void load(items[items.length - 1].at)}
              >
                Xem cũ hơn
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
