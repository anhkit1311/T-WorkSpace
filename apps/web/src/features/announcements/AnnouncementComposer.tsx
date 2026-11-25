import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  AnnouncementCategory,
  CreateAnnouncementInput,
  PortalAnnouncement,
} from "@doan/shared";
import { Icon } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { AnnouncementDetailModal } from "./AnnouncementDetailModal";

export const CATEGORY_META: Record<
  AnnouncementCategory,
  { label: string; short: string; hint: string }
> = {
  general: { label: "Thông báo chung", short: "Chung", hint: "Tin hành chính, hoạt động" },
  training: { label: "Đào tạo", short: "Đào tạo", hint: "Học vụ, lịch học, đồ án" },
  event: { label: "Sự kiện", short: "Sự kiện", hint: "Hội thảo, lễ, cuộc thi" },
  urgent: { label: "Khẩn", short: "Khẩn", hint: "Cần xử lý ngay, có hạn" },
};

export const CATEGORIES = Object.keys(CATEGORY_META) as AnnouncementCategory[];
/** The author's badge, unless it only repeats the category chip beside it ("Khẩn" on an urgent post). */
export const distinctBadge = (item: { badge?: string | null; category: AnnouncementCategory }) =>
  item.badge && item.badge.trim().toLowerCase() !== CATEGORY_META[item.category].label.toLowerCase()
    ? item.badge
    : undefined;

const BADGES = ["Mới", "Quan trọng", "Khẩn"];
const SCHOOL = "Toàn trường";
const SUMMARY_FIT = 200;

export const CATEGORY_DOT: Record<AnnouncementCategory, string> = {
  general: "bg-zinc-400",
  training: "bg-[#2f6bff]",
  event: "bg-violet-500",
  urgent: "bg-red-500",
};
export const CATEGORY_CHIP: Record<AnnouncementCategory, string> = {
  general: "bg-secondary text-muted-foreground",
  training: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  event: "bg-[var(--tint-violet-bg)] text-[var(--tint-violet-fg)]",
  urgent: "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]",
};
export const CHIP =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap";
const BTN =
  "inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
export const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
const LABEL = "flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground";
const PILL =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] text-muted-foreground hover:bg-secondary";
const PILL_ON = "border-foreground bg-foreground text-background hover:bg-foreground";
const PILL_INPUT = "!h-[28px] !w-32 !rounded-full !border-dashed !px-3 !py-0 !text-[12.5px]";
const PREVIEW_LABEL = "text-[11.5px] font-semibold tracking-wider text-muted-foreground uppercase";

/** Badge a category starts with; only replaces a preset badge, never one the author typed. */
const defaultBadge = (category: AnnouncementCategory) =>
  category === "urgent" ? "Khẩn" : category === "training" ? "Quan trọng" : "Mới";

interface Props {
  initial: PortalAnnouncement | null;
  /** The announcement currently in the home page's featured slot. */
  featured: PortalAnnouncement | null;
  authorName: string;
  authorRole: string;
  /** Staff may post for staff only; students never receive those. */
  canRestrict: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateAnnouncementInput) => Promise<void>;
}

export function AnnouncementComposer({
  initial,
  featured,
  authorName,
  authorRole,
  canRestrict,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const [audience, setAudience] = useState(initial?.audience ?? "all");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<AnnouncementCategory>(initial?.category ?? "general");
  const [badge, setBadge] = useState(initial?.badge ?? "Mới");
  const [scope, setScope] = useState(initial?.scope ?? SCHOOL);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [error, setError] = useState("");
  const [fullPreview, setFullPreview] = useState(false);

  const draft: PortalAnnouncement = {
    id: initial?.id ?? "draft",
    title: title.trim() || "Tiêu đề thông báo",
    category,
    badge: badge.trim() || undefined,
    summary: summary.trim() || title.trim(),
    content: content.trim() || summary.trim() || title.trim(),
    scope: scope.trim() || SCHOOL,
    audience,
    pinned,
    authorName: initial?.authorName ?? authorName,
    authorTitle: initial?.authorTitle,
    createdAt: initial?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const replacesPinned =
    pinned && featured?.pinned && featured.id !== initial?.id ? featured : null;
  const titleOk = title.trim().length >= 3;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting) return;
    if (!titleOk) return setError("Tiêu đề cần ít nhất 3 ký tự.");
    if (!summary.trim() && !content.trim())
      return setError("Nhập tóm tắt hoặc nội dung thông báo.");
    setError("");
    try {
      await onSubmit({
        title: title.trim(),
        category,
        badge: badge.trim() || undefined,
        scope: scope.trim() || SCHOOL,
        audience,
        pinned,
        summary: draft.summary,
        content: draft.content,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu thông báo.");
    }
  };

  useEffect(() => {
    if (fullPreview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pickCategory = (next: AnnouncementCategory) => {
    setCategory(next);
    if (BADGES.includes(badge)) setBadge(defaultBadge(next));
  };

  return (
    <form
      className="tw grid min-w-0 gap-4 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5"
      onSubmit={submit}
      aria-label={initial ? "Sửa thông báo" : "Soạn thông báo"}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          ← Bảng tin
        </button>
        <h1 className="text-xl font-bold">{initial ? "Sửa bài đăng" : "Đăng bài lên Bảng tin"}</h1>
        <div className="ml-auto flex items-center gap-2.5 text-[13px] max-md:ml-0">
          <UserAvatar name={draft.authorName} className="size-8" />
          <span>
            <small className="block text-xs text-muted-foreground">
              {initial ? "Người đăng" : "Đăng với tư cách"}
            </small>
            <b className="font-semibold">{draft.authorName}</b>
            {initial?.authorTitle
              ? ` · ${initial.authorTitle}`
              : authorRole
                ? ` · ${authorRole}`
                : ""}
          </span>
        </div>
      </div>

      <div className="grid min-w-0 items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_400px]">
        <section
          className="tw-form grid min-w-0 gap-4 rounded-[10px] border bg-card p-[18px]"
          aria-label="Nội dung thông báo"
        >
          {error && (
            <p
              className="rounded-lg bg-[var(--tint-red-bg)] px-3 py-2 text-[13px] text-[var(--tint-red-fg)]"
              role="alert"
            >
              {error}
            </p>
          )}
          <label className="grid gap-1.5">
            <span className={LABEL}>
              Tiêu đề <em className="text-red-500 not-italic">*</em>
              <small className="ml-auto font-normal tabular-nums">{title.length} / 255</small>
            </span>
            <input
              className="!text-[17px] !font-semibold"
              value={title}
              maxLength={255}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ví dụ: Kế hoạch đăng ký môn học Học kỳ 1 năm học 2026 - 2027"
            />
          </label>

          <label className="grid gap-1.5">
            <span className={LABEL}>
              Tóm tắt
              <span className="font-normal">— hiện trên thẻ Bảng tin</span>
              <small
                className={cn(
                  "ml-auto font-normal tabular-nums",
                  summary.length > SUMMARY_FIT && "text-red-600",
                )}
              >
                {summary.length} / {SUMMARY_FIT}
              </small>
            </span>
            <textarea
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Một hai câu nêu việc chính, thời hạn và ai cần làm gì."
            />
          </label>

          <label className="grid gap-1.5">
            <span className={LABEL}>Nội dung đầy đủ</span>
            <textarea
              rows={8}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Toàn văn thông báo: căn cứ, mốc thời gian, yêu cầu thực hiện…"
            />
          </label>

          <div className="grid gap-4 min-[761px]:grid-cols-2">
            <fieldset className="grid gap-1.5">
              <legend className={cn(LABEL, "mb-1.5")}>Danh mục</legend>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(PILL, category === key && PILL_ON)}
                    aria-pressed={category === key}
                    title={CATEGORY_META[key].hint}
                    onClick={() => pickCategory(key)}
                  >
                    <span className={cn("size-2 rounded-full", CATEGORY_DOT[key])} />
                    {CATEGORY_META[key].short}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className={cn(LABEL, "mb-1.5")}>Nhãn nổi bật</legend>
              <div className="flex flex-wrap gap-1.5">
                {BADGES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={cn(PILL, badge === preset && PILL_ON)}
                    aria-pressed={badge === preset}
                    onClick={() => setBadge(preset)}
                  >
                    {preset}
                  </button>
                ))}
                <input
                  className={PILL_INPUT}
                  aria-label="Nhãn tự nhập"
                  placeholder="+ Tự nhập"
                  maxLength={40}
                  value={BADGES.includes(badge) ? "" : badge}
                  onChange={(event) => setBadge(event.target.value || defaultBadge(category))}
                />
              </div>
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className={cn(LABEL, "mb-1.5")}>Phạm vi</legend>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={cn(PILL, scope === SCHOOL && PILL_ON)}
                  aria-pressed={scope === SCHOOL}
                  onClick={() => setScope(SCHOOL)}
                >
                  {SCHOOL}
                </button>
                <input
                  className={cn(PILL_INPUT, "!w-60")}
                  aria-label="Đơn vị hoặc đối tượng khác"
                  placeholder="+ Đơn vị khác, ví dụ Khoa CNTT"
                  maxLength={120}
                  value={scope === SCHOOL ? "" : scope}
                  onChange={(event) => setScope(event.target.value || SCHOOL)}
                />
              </div>
            </fieldset>
            {canRestrict && (
              <fieldset className="grid gap-1.5">
                <legend className={cn(LABEL, "mb-1.5")}>Ai xem được</legend>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={cn(PILL, audience === "all" && PILL_ON)}
                    aria-pressed={audience === "all"}
                    onClick={() => setAudience("all")}
                  >
                    Mọi tài khoản
                  </button>
                  <button
                    type="button"
                    className={cn(PILL, audience === "staff" && PILL_ON)}
                    aria-pressed={audience === "staff"}
                    onClick={() => setAudience("staff")}
                  >
                    <Icon name="lock" size={12} />
                    Chỉ cán bộ, giảng viên
                  </button>
                </div>
              </fieldset>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
            <button
              type="button"
              className={cn(
                "relative h-5 w-[34px] shrink-0 cursor-pointer rounded-full transition-colors",
                pinned ? "bg-foreground" : "bg-zinc-300 dark:bg-zinc-600",
              )}
              role="switch"
              aria-checked={pinned}
              aria-label="Ghim lên đầu Trang chủ"
              onClick={() => setPinned((value) => !value)}
            >
              <span
                className={cn(
                  "absolute top-[3px] size-3.5 rounded-full bg-background transition-all",
                  pinned ? "right-[3px]" : "left-[3px]",
                )}
              />
            </button>
            <span className="min-w-0">
              <b className="block font-medium">Ghim lên đầu Trang chủ</b>
              <small className="block text-xs text-muted-foreground">
                {replacesPinned
                  ? `Sẽ thay tin đang ghim “${replacesPinned.title}” ở ô nổi bật`
                  : "Tin ghim mới nhất hiện ở ô nổi bật trên Bảng tin của mọi tài khoản"}
              </small>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3.5">
            <small className="mr-auto text-xs text-muted-foreground">
              Ctrl + Enter để đăng · Esc để đóng
            </small>
            <button type="button" className={BTN_GHOST} onClick={onCancel} disabled={submitting}>
              Hủy
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setFullPreview(true)}>
              Xem toàn văn
            </button>
            <button type="submit" className={BTN_PRIMARY} disabled={submitting}>
              <Icon name="send" size={15} />
              {submitting ? "Đang lưu…" : initial ? "Lưu thay đổi" : "Đăng bài"}
            </button>
          </div>
        </section>

        <aside
          className="grid min-w-0 gap-3 rounded-[10px] border bg-card p-4 min-[1100px]:sticky min-[1100px]:top-2"
          aria-label="Xem trước"
        >
          <div className={PREVIEW_LABEL}>Ô nổi bật trên Trang chủ</div>
          <FeatureCard item={draft} />
          <div className={PREVIEW_LABEL}>Trong danh sách Bảng tin</div>
          <div className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border p-3">
            <span className={cn("mt-1.5 size-2 rounded-full", CATEGORY_DOT[category])} />
            <span className="min-w-0">
              <b className="block truncate font-semibold">{draft.title}</b>
              <small className="line-clamp-1 text-[13px] text-muted-foreground">
                {draft.summary || "Chưa có tóm tắt"}
              </small>
            </span>
            <span className={cn(CHIP, CATEGORY_CHIP[category])}>
              {CATEGORY_META[category].short}
            </span>
          </div>
          <div className={PREVIEW_LABEL}>Trước khi đăng</div>
          <div className="grid gap-1.5">
            <Check ok={titleOk}>{titleOk ? "Tiêu đề hợp lệ" : "Tiêu đề cần ít nhất 3 ký tự"}</Check>
            <Check ok={summary.length > 0 && summary.length <= SUMMARY_FIT}>
              {!summary
                ? "Chưa có tóm tắt: thẻ sẽ dùng tiêu đề"
                : summary.length > SUMMARY_FIT
                  ? `Tóm tắt dài hơn ${SUMMARY_FIT} ký tự, thẻ sẽ cắt bớt`
                  : "Tóm tắt vừa khung thẻ"}
            </Check>
            <Check ok>
              {audience === "staff"
                ? "Chỉ cán bộ, giảng viên thấy tin này; sinh viên không thấy"
                : "Hiện trên Bảng tin của mọi tài khoản"}{" "}
              · phạm vi ghi “{draft.scope}”
            </Check>
            {replacesPinned && (
              <Check ok={false}>Bật ghim sẽ đẩy tin đang ghim xuống danh sách</Check>
            )}
          </div>
        </aside>
      </div>

      {fullPreview && (
        <AnnouncementDetailModal announcement={draft} onClose={() => setFullPreview(false)} />
      )}
    </form>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <i
        className={cn(
          "mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold not-italic",
          ok
            ? "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]"
            : "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]",
        )}
        aria-hidden="true"
      >
        {ok ? "✓" : "!"}
      </i>
      <span>{children}</span>
    </div>
  );
}

/** Dark card mirroring the home page's featured slot. */
export function FeatureCard({ item }: { item: PortalAnnouncement }) {
  return (
    <article className="grid gap-1.5 rounded-[10px] bg-zinc-900 p-4 text-zinc-100 dark:bg-zinc-800">
      <div className="flex flex-wrap gap-1.5">
        <span className={cn(CHIP, "bg-white/10 text-zinc-100")}>
          <span className={cn("size-1.5 rounded-full", CATEGORY_DOT[item.category])} />
          {CATEGORY_META[item.category].label}
        </span>
        {distinctBadge(item) && (
          <span className={cn(CHIP, "bg-amber-400 text-zinc-900")}>{item.badge}</span>
        )}
        {item.pinned && <span className={cn(CHIP, "bg-white/5 text-zinc-400")}>Đã ghim</span>}
      </div>
      <h3 className="text-base leading-snug font-semibold">{item.title}</h3>
      {item.summary && <p className="line-clamp-3 text-[13px] text-zinc-400">{item.summary}</p>}
      <span className="text-xs text-zinc-500">
        {item.authorName} · {formatStamp(item.createdAt)} · {item.scope}
      </span>
    </article>
  );
}

export function formatStamp(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
