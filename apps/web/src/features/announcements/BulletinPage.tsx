import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AnnouncementCategory,
  CreateAnnouncementInput,
  PortalAnnouncement,
} from "@doan/shared";
import { ConfirmDialog } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import {
  getAnnouncementsApi,
  createAnnouncementApi,
  updateAnnouncementApi,
  deleteAnnouncementApi,
  getPublishersApi,
} from "./api";
import { AnnouncementDetailModal } from "./AnnouncementDetailModal";
import {
  AnnouncementComposer,
  BTN_GHOST,
  BTN_PRIMARY,
  CATEGORIES,
  CATEGORY_CHIP,
  CATEGORY_DOT,
  CATEGORY_META,
  CHIP,
  distinctBadge,
  formatStamp,
} from "./AnnouncementComposer";
import { PublisherManagementModal } from "./PublisherManagementModal";
import { byDay, timeLabel, WEEK } from "./day";

const ROLE_LABEL: Record<string, string> = {
  system_admin: "Quản trị hệ thống",
  unit_admin: "Quản trị đơn vị",
  unit_head: "Trưởng đơn vị",
  lecturer: "Giảng viên",
  publisher: "Được cấp quyền đăng",
  workspace_admin: "Quản trị nhóm",
};
const badgeTone = (badge: string) =>
  badge === "Khẩn"
    ? "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]"
    : badge === "Quan trọng"
      ? "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]"
      : "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]";

const MUTED = "text-[13px] text-muted-foreground";
const PILL =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] text-muted-foreground hover:bg-secondary";
const PILL_ON = "border-foreground bg-foreground text-background hover:bg-foreground";
const STAT = "grid min-w-0 gap-0.5 rounded-[10px] border bg-card px-3.5 py-3";

/** Posts on the school board: write, edit, pin, delete, and who else may post (admins and publishers). */
export function BulletinPage() {
  const { accessToken, notify, user } = useApp();
  const { socket } = useSocket();

  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [canPublish, setCanPublish] = useState(false);
  const [role, setRole] = useState("student");
  const [isStaff, setIsStaff] = useState(false);
  const [publisherCount, setPublisherCount] = useState<number | null>(null);
  const [category, setCategory] = useState<"all" | AnnouncementCategory>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ item: PortalAnnouncement | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<PortalAnnouncement | null>(null);
  const [publishersOpen, setPublishersOpen] = useState(false);
  const [removing, setRemoving] = useState<PortalAnnouncement | null>(null);

  const reload = () => setTick((value) => value + 1);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    getAnnouncementsApi(accessToken)
      .then((res) => {
        if (!active) return;
        setAnnouncements(res.items);
        setCanPublish(res.canPublish);
        setRole(res.role);
        setIsStaff(res.isStaff);
        setError("");
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Không thể tải danh sách thông báo.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [accessToken, tick]);

  useEffect(() => {
    if (!socket) return;
    socket.on("announcements_changed", reload);
    return () => {
      socket.off("announcements_changed", reload);
    };
  }, [socket]);

  useEffect(() => {
    if (!accessToken || !canPublish) return;
    let active = true;
    getPublishersApi(accessToken)
      .then((res) => active && setPublisherCount(res.publishers.length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accessToken, canPublish, tick]);

  const canGrant = role === "system_admin" || role === "unit_admin" || canPublish;

  /** Server order (pinned first, then newest) decides the home page's featured slot. */
  const featured = announcements[0] ?? null;
  const sorted = useMemo(
    () => [...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [announcements],
  );
  const needle = query.trim().toLowerCase();
  const filtered = sorted.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      (!mineOnly || item.authorId === user?.id) &&
      (!needle ||
        [item.title, item.summary, item.authorName, item.authorTitle ?? "", item.scope].some(
          (text) => text.toLowerCase().includes(needle),
        )),
  );
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const urgent = sorted.filter((item) => item.category === "urgent");
  const weekCount = sorted.filter(
    (item) => Date.now() - new Date(item.createdAt).getTime() < WEEK,
  ).length;
  const pinnedTop = featured?.pinned ? featured : null;

  const save = async (input: CreateAnnouncementInput) => {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      const editing = composing?.item;
      const res = editing
        ? await updateAnnouncementApi(accessToken, editing.id, input)
        : await createAnnouncementApi(accessToken, input);
      notify(
        editing ? "Đã cập nhật bài đăng" : "Đã đăng bài",
        editing
          ? res.item.title
          : res.item.audience === "staff"
            ? "Tin đã lên Bảng tin của cán bộ, giảng viên."
            : "Tin đã lên Bảng tin của mọi tài khoản.",
        "success",
      );
      setComposing(null);
      setSelectedId(res.item.id);
      setCategory("all");
      reload();
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (item: PortalAnnouncement) => {
    setRemoving(null);
    if (!accessToken) return;
    try {
      await deleteAnnouncementApi(accessToken, item.id);
      notify("Đã xóa bài đăng", item.title, "info");
      reload();
    } catch (reason) {
      notify(
        "Không xóa được",
        reason instanceof Error ? reason.message : "Thử lại sau.",
        "warning",
      );
    }
  };

  const togglePin = async (item: PortalAnnouncement) => {
    if (!accessToken) return;
    try {
      await updateAnnouncementApi(accessToken, item.id, { pinned: !item.pinned });
      notify(item.pinned ? "Đã bỏ ghim" : "Đã ghim lên đầu Trang chủ", item.title, "info");
      reload();
    } catch (reason) {
      notify(
        "Không cập nhật được ghim",
        reason instanceof Error ? reason.message : "Thử lại sau.",
        "warning",
      );
    }
  };

  const pick = (item: PortalAnnouncement) => {
    setSelectedId(item.id);
    // The detail column sits below the list on narrow screens; open the full text instead.
    if (window.matchMedia("(max-width: 1100px)").matches) setDetail(item);
  };

  if (composing)
    return (
      <AnnouncementComposer
        initial={composing.item}
        featured={featured}
        authorName={user?.displayName ?? ""}
        authorRole={ROLE_LABEL[role] ?? ""}
        canRestrict={isStaff}
        submitting={submitting}
        onCancel={() => setComposing(null)}
        onSubmit={save}
      />
    );

  return (
    <div className="tw grid min-w-0 gap-3.5 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="grid gap-0.5">
          <h1 className="text-[22px] font-bold">Quản lý bảng tin</h1>
          <p className={MUTED}>
            Bài đăng trên Bảng tin toàn trường: đăng, sửa, ghim, xóa và phân quyền đăng
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 max-md:ml-0">
          {canGrant && (
            <button type="button" className={BTN_GHOST} onClick={() => setPublishersOpen(true)}>
              <Icon name="users" size={15} />
              Phân quyền đăng
            </button>
          )}
          {canPublish && (
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => setComposing({ item: null })}
            >
              <Icon name="plus" size={15} />
              Đăng bài
            </button>
          )}
        </div>
      </div>

      <section
        className="grid gap-3 min-[1100px]:grid-cols-[1fr_1fr_2fr_1fr] min-[600px]:grid-cols-2"
        aria-label="Tóm tắt bảng tin"
      >
        <div className={STAT}>
          <small className="text-[12.5px] text-muted-foreground">Bài đã đăng</small>
          <b className="text-[22px] leading-tight font-bold tabular-nums">{announcements.length}</b>
          <small className="text-xs text-muted-foreground">{weekCount} tin trong 7 ngày qua</small>
        </div>
        <div className={cn(STAT, urgent.length > 0 && "border-red-500/40")}>
          <small className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span className="size-2 rounded-full bg-red-500" />
            Tin khẩn
          </small>
          <b
            className={cn(
              "text-[22px] leading-tight font-bold tabular-nums",
              urgent.length > 0 && "text-red-600",
            )}
          >
            {urgent.length}
          </b>
          <small className="truncate text-xs text-muted-foreground">
            {urgent[0]?.title ?? "Không có tin khẩn"}
          </small>
        </div>
        <div className={cn(STAT, "min-[600px]:max-[1099px]:col-span-2")}>
          <small className="text-[12.5px] text-muted-foreground">Đang ghim ở đầu Trang chủ</small>
          {pinnedTop ? (
            <div className="flex min-w-0 items-center gap-2 py-0.5">
              <span className={cn(CHIP, CATEGORY_CHIP[pinnedTop.category])}>
                {CATEGORY_META[pinnedTop.category].short}
              </span>
              <b className="min-w-0 truncate font-semibold">{pinnedTop.title}</b>
              {pinnedTop.canManage && (
                <button
                  type="button"
                  className={cn(BTN_GHOST, "ml-auto h-7 px-2.5 text-xs")}
                  onClick={() => void togglePin(pinnedTop)}
                >
                  Bỏ ghim
                </button>
              )}
            </div>
          ) : (
            <b className="py-0.5 font-semibold text-muted-foreground">Chưa ghim tin nào</b>
          )}
          <small className="text-xs text-muted-foreground">
            {pinnedTop
              ? "Tin ghim hiện ở ô nổi bật trên Bảng tin của mọi tài khoản"
              : "Ô nổi bật đang hiện tin mới nhất"}
          </small>
        </div>
        <div className={STAT}>
          <small className="text-[12.5px] text-muted-foreground">
            {canPublish ? "Được cấp quyền đăng" : "Quyền của bạn"}
          </small>
          <b className="text-[22px] leading-tight font-bold tabular-nums">
            {canPublish ? (publisherCount ?? "–") : "Chỉ cấp quyền"}
          </b>
          <small className="text-xs text-muted-foreground">
            {canPublish ? "Ngoài Quản trị và Giáo vụ khoa" : "Bạn cấp quyền đăng cho người khác"}
          </small>
        </div>
      </section>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Lọc theo danh mục"
      >
        <button
          type="button"
          className={cn(PILL, category === "all" && PILL_ON)}
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          Tất cả <small className="opacity-70">{announcements.length}</small>
        </button>
        {CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            className={cn(PILL, category === key && PILL_ON)}
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            <span className={cn("size-2 rounded-full", CATEGORY_DOT[key])} />
            {CATEGORY_META[key].short}{" "}
            <small className="opacity-70">
              {announcements.filter((item) => item.category === key).length}
            </small>
          </button>
        ))}
        {canPublish && (
          <>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <button
              type="button"
              className={cn(PILL, mineOnly && PILL_ON)}
              aria-pressed={mineOnly}
              onClick={() => setMineOnly((value) => !value)}
            >
              Tôi đăng
            </button>
          </>
        )}
        <label className="ml-auto flex h-[34px] w-[300px] items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground max-md:ml-0 max-md:w-full">
          <Icon name="search" size={14} />
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tiêu đề, người đăng, phạm vi…"
            aria-label="Tìm bài đăng"
          />
        </label>
      </div>

      <div
        className={cn(
          "grid min-w-0 items-start gap-4",
          selected && "min-[1100px]:grid-cols-[minmax(0,1fr)_380px]",
        )}
      >
        <section
          className="min-w-0 rounded-[10px] border bg-card p-2"
          aria-label="Danh sách bài đăng"
        >
          {!loaded ? (
            <p className={cn(MUTED, "p-4")}>Đang tải bài đăng…</p>
          ) : error ? (
            <p
              className="m-2 rounded-lg bg-[var(--tint-red-bg)] px-3 py-2 text-[13px] text-[var(--tint-red-fg)]"
              role="alert"
            >
              {error}
            </p>
          ) : !filtered.length ? (
            <div className="grid justify-items-center gap-1.5 px-4 py-10 text-center">
              <Icon name="megaphone" size={26} className="text-muted-foreground" />
              <b className="font-semibold">
                {announcements.length ? "Không có bài đăng khớp bộ lọc" : "Chưa có bài đăng nào"}
              </b>
              <span className={MUTED}>
                {canPublish
                  ? "Bấm “Đăng bài” để gửi tin lên Bảng tin."
                  : "Bài đăng mới của Nhà trường sẽ hiện ở đây."}
              </span>
            </div>
          ) : (
            byDay(filtered).map(([label, items]) => (
              <Fragment key={label}>
                <div className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:pt-1">
                  {label}
                </div>
                {items.map((item) => {
                  const active = selected?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "group grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border-b px-2.5 py-3 last:border-b-0 hover:bg-secondary",
                        active && "bg-[var(--tint-blue-bg)] hover:bg-[var(--tint-blue-bg)]",
                      )}
                    >
                      <span
                        className={cn("mt-[7px] size-2 rounded-full", CATEGORY_DOT[item.category])}
                      />
                      <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left"
                        aria-current={active || undefined}
                        onClick={() => pick(item)}
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          {item.pinned && (
                            <Icon name="pin" size={13} className="text-muted-foreground" />
                          )}
                          {item.audience === "staff" && (
                            <span title="Chỉ cán bộ, giảng viên">
                              <Icon name="lock" size={13} className="text-muted-foreground" />
                            </span>
                          )}
                          <b className="font-semibold">{item.title}</b>
                          <span className={cn(CHIP, CATEGORY_CHIP[item.category])}>
                            {CATEGORY_META[item.category].short}
                          </span>
                          {distinctBadge(item) && (
                            <span className={cn(CHIP, badgeTone(item.badge ?? ""))}>
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted-foreground">
                          {item.summary}
                        </span>
                        <small className="block text-xs text-muted-foreground">
                          {[item.authorName, item.authorTitle, `Phạm vi: ${item.scope}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </button>
                      <div className="grid justify-items-end gap-1.5 text-xs text-muted-foreground">
                        <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
                        {item.canManage && (
                          <div
                            className={cn(
                              "flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100",
                              active && "opacity-100",
                            )}
                          >
                            <RowButton
                              icon="pin"
                              label={item.pinned ? "Bỏ ghim" : "Ghim lên đầu Trang chủ"}
                              active={item.pinned}
                              onClick={() => void togglePin(item)}
                            />
                            <RowButton
                              icon="edit"
                              label="Sửa"
                              onClick={() => setComposing({ item })}
                            />
                            <RowButton
                              icon="trash"
                              label="Xóa"
                              danger
                              onClick={() => setRemoving(item)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            ))
          )}
        </section>

        {selected && (
          <aside
            className="grid min-w-0 gap-3 rounded-[10px] border bg-card p-4 max-[1099px]:hidden min-[1100px]:sticky min-[1100px]:top-2"
            aria-label="Bài đăng đang chọn"
          >
            <div className="flex flex-wrap gap-1.5">
              <span className={cn(CHIP, CATEGORY_CHIP[selected.category])}>
                {CATEGORY_META[selected.category].label}
              </span>
              {selected.badge && (
                <span className={cn(CHIP, badgeTone(selected.badge))}>{selected.badge}</span>
              )}
              {selected.pinned && (
                <span className={cn(CHIP, "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]")}>
                  <Icon name="pin" size={11} /> Đang ghim
                </span>
              )}
            </div>
            <h2 className="text-[17px] leading-snug font-bold">{selected.title}</h2>
            {selected.summary && (
              <p className="text-[13.5px] leading-relaxed text-muted-foreground">
                {selected.summary}
              </p>
            )}
            <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13px] [&_dd]:font-medium [&_dt]:text-muted-foreground">
              <Fact label="Phạm vi">{selected.scope}</Fact>
              <Fact label="Ai xem được">
                {selected.audience === "staff" ? "Chỉ cán bộ, giảng viên" : "Mọi tài khoản"}
              </Fact>
              <Fact label="Người đăng">
                {selected.authorName}
                {selected.authorTitle && (
                  <small className="block font-normal text-muted-foreground">
                    {selected.authorTitle}
                  </small>
                )}
              </Fact>
              <Fact label="Đăng lúc">{formatStamp(selected.createdAt)}</Fact>
              {selected.updatedAt.slice(0, 19) !== selected.createdAt.slice(0, 19) && (
                <Fact label="Sửa lần cuối">{formatStamp(selected.updatedAt)}</Fact>
              )}
            </dl>
            <div className="flex gap-2">
              {selected.canManage && (
                <button
                  type="button"
                  className={cn(BTN_PRIMARY, "flex-1")}
                  onClick={() => setComposing({ item: selected })}
                >
                  <Icon name="edit" size={14} />
                  Sửa
                </button>
              )}
              <button
                type="button"
                className={cn(BTN_GHOST, "flex-1")}
                onClick={() => setDetail(selected)}
              >
                Xem toàn văn
              </button>
              {selected.canManage && (
                <button
                  type="button"
                  className={cn(BTN_GHOST, "hover:text-red-600")}
                  aria-label="Xóa bài đăng"
                  title="Xóa bài đăng"
                  onClick={() => setRemoving(selected)}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          </aside>
        )}
      </div>

      {detail && <AnnouncementDetailModal announcement={detail} onClose={() => setDetail(null)} />}
      {publishersOpen && accessToken && (
        <PublisherManagementModal
          accessToken={accessToken}
          onClose={() => setPublishersOpen(false)}
          onChanged={reload}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Xóa bài đăng"
          description={`Xóa bài “${removing.title}”? Không thể hoàn tác.`}
          confirmLabel="Xóa"
          onClose={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
    </div>
  );
}

function RowButton({
  icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground",
        active && "text-amber-600",
        danger && "hover:text-red-600",
      )}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
