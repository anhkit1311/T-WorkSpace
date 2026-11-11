import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  AnnouncementCategory,
  CreateAnnouncementInput,
  PortalAnnouncement,
} from "@doan/shared";
import { Icon } from "../../shared/ui/Icon";
import { Avatar } from "../../shared/ui/Primitives";
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

/** Badge a category starts with; only replaces a preset badge, never one the author typed. */
const defaultBadge = (category: AnnouncementCategory) =>
  category === "urgent" ? "Khẩn" : category === "training" ? "Quan trọng" : "Mới";

interface Props {
  initial: PortalAnnouncement | null;
  /** The announcement currently in the home page's featured slot. */
  featured: PortalAnnouncement | null;
  authorName: string;
  authorRole: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateAnnouncementInput) => Promise<void>;
}

export function AnnouncementComposer({
  initial,
  featured,
  authorName,
  authorRole,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
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
      className="nf-compose"
      onSubmit={submit}
      aria-label={initial ? "Sửa thông báo" : "Soạn thông báo"}
    >
      <div className="nf-head">
        <div className="nf-head__title">
          <div className="nf-eyebrow">
            <button type="button" className="nf-crumb" onClick={onCancel}>
              ← Thông báo
            </button>
            <span>/</span>
            {initial ? "Sửa tin" : "Soạn tin mới"}
          </div>
          <h1>{initial ? "Sửa thông báo" : "Đăng thông báo"}</h1>
        </div>
        <div className="nf-as">
          <Avatar name={draft.authorName} size="sm" />
          <span>
            <small>{initial ? "Người đăng" : "Đăng với tư cách"}</small>
            <b>{draft.authorName}</b>
            {initial?.authorTitle
              ? ` · ${initial.authorTitle}`
              : authorRole
                ? ` · ${authorRole}`
                : ""}
          </span>
        </div>
      </div>

      <div className="nf-compose__body">
        <section className="nf-card nf-form" aria-label="Nội dung thông báo">
          {error && (
            <p className="nf-error" role="alert">
              {error}
            </p>
          )}
          <label className="nf-field">
            <span className="nf-label">
              Tiêu đề <em>*</em>
              <small>{title.length} / 255</small>
            </span>
            <input
              className="nf-input is-title"
              value={title}
              maxLength={255}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ví dụ: Kế hoạch đăng ký môn học Học kỳ 1 năm học 2026 - 2027"
            />
          </label>

          <fieldset className="nf-field">
            <legend className="nf-label">Danh mục</legend>
            <div className="nf-cats">
              {CATEGORIES.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`nf-cat is-${key}`}
                  aria-pressed={category === key}
                  onClick={() => pickCategory(key)}
                >
                  <b>
                    <i />
                    {CATEGORY_META[key].short}
                  </b>
                  <span>{CATEGORY_META[key].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="nf-form__pair">
            <fieldset className="nf-field">
              <legend className="nf-label">Nhãn nổi bật</legend>
              <div className="nf-pills">
                {BADGES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="nf-pill"
                    aria-pressed={badge === preset}
                    onClick={() => setBadge(preset)}
                  >
                    {preset}
                  </button>
                ))}
                <input
                  className="nf-pill-input"
                  aria-label="Nhãn tự nhập"
                  placeholder="+ Tự nhập"
                  maxLength={40}
                  value={BADGES.includes(badge) ? "" : badge}
                  onChange={(event) => setBadge(event.target.value || defaultBadge(category))}
                />
              </div>
            </fieldset>
            <fieldset className="nf-field">
              <legend className="nf-label">Phạm vi</legend>
              <div className="nf-pills">
                <button
                  type="button"
                  className="nf-pill"
                  aria-pressed={scope === SCHOOL}
                  onClick={() => setScope(SCHOOL)}
                >
                  {SCHOOL}
                </button>
                <input
                  className="nf-pill-input is-wide"
                  aria-label="Đơn vị hoặc đối tượng khác"
                  placeholder="+ Đơn vị khác, ví dụ Khoa CNTT"
                  maxLength={120}
                  value={scope === SCHOOL ? "" : scope}
                  onChange={(event) => setScope(event.target.value || SCHOOL)}
                />
              </div>
            </fieldset>
          </div>

          <div className={`nf-pin${pinned ? " is-on" : ""}`}>
            <Icon name="pin" size={16} />
            <span>
              <b>Ghim lên đầu Trang chủ</b>
              <small>
                {replacesPinned
                  ? `Sẽ thay tin đang ghim “${replacesPinned.title}” ở ô nổi bật`
                  : "Tin ghim mới nhất hiện ở ô nổi bật trên Bảng tin của mọi tài khoản"}
              </small>
            </span>
            <button
              type="button"
              className="nf-switch"
              role="switch"
              aria-checked={pinned}
              aria-label="Ghim lên đầu Trang chủ"
              onClick={() => setPinned((value) => !value)}
            />
          </div>

          <label className="nf-field">
            <span className="nf-label">
              Tóm tắt <span className="nf-label__hint">— hiện trên thẻ Bảng tin</span>
              <small className={summary.length > SUMMARY_FIT ? "is-over" : ""}>
                {summary.length} / {SUMMARY_FIT}
              </small>
            </span>
            <textarea
              className="nf-input"
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Một hai câu nêu việc chính, thời hạn và ai cần làm gì."
            />
          </label>

          <label className="nf-field is-grow">
            <span className="nf-label">Nội dung đầy đủ</span>
            <textarea
              className="nf-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Toàn văn thông báo: căn cứ, mốc thời gian, yêu cầu thực hiện…"
            />
          </label>
        </section>

        <aside className="nf-rack nf-preview" aria-label="Xem trước">
          <div className="nf-rack__label">
            <span className="nf-led" />
            Xem trước · cập nhật khi gõ
          </div>
          <div>
            <div className="nf-rack__label is-sub">Ô nổi bật trên Trang chủ</div>
            <FeatureCard item={draft} />
          </div>
          <div>
            <div className="nf-rack__label is-sub">Trong danh sách Bảng tin</div>
            <div className="nf-mini">
              <span className={`nf-dot is-${category}`} />
              <span>
                <b>{draft.title}</b>
                <small>{draft.summary || "Chưa có tóm tắt"}</small>
              </span>
              <span className={`nf-chip is-${category}`}>{CATEGORY_META[category].short}</span>
            </div>
          </div>
          <div className="nf-checks">
            <div className="nf-rack__label is-sub">Trước khi đăng</div>
            <Check ok={titleOk}>{titleOk ? "Tiêu đề hợp lệ" : "Tiêu đề cần ít nhất 3 ký tự"}</Check>
            <Check ok={summary.length > 0 && summary.length <= SUMMARY_FIT}>
              {!summary
                ? "Chưa có tóm tắt: thẻ sẽ dùng tiêu đề"
                : summary.length > SUMMARY_FIT
                  ? `Tóm tắt dài hơn ${SUMMARY_FIT} ký tự, thẻ sẽ cắt bớt`
                  : "Tóm tắt vừa khung thẻ"}
            </Check>
            <Check ok>Hiện trên Bảng tin của mọi tài khoản · phạm vi ghi “{draft.scope}”</Check>
            {replacesPinned && (
              <Check ok={false}>Bật ghim sẽ đẩy tin đang ghim xuống danh sách</Check>
            )}
          </div>
        </aside>
      </div>

      <footer className="nf-compose__bar">
        <span className="nf-kbd">Ctrl + Enter để đăng · Esc để đóng</span>
        <button type="button" className="nf-btn is-ghost" onClick={onCancel} disabled={submitting}>
          Hủy
        </button>
        <button type="button" className="nf-btn" onClick={() => setFullPreview(true)}>
          Xem toàn văn
        </button>
        <button type="submit" className="nf-btn is-primary" disabled={submitting}>
          <Icon name="send" size={15} />
          {submitting ? "Đang lưu…" : initial ? "Lưu thay đổi" : "Đăng thông báo"}
        </button>
      </footer>

      {fullPreview && (
        <AnnouncementDetailModal announcement={draft} onClose={() => setFullPreview(false)} />
      )}
    </form>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="nf-check">
      <i className={ok ? "is-ok" : "is-warn"} aria-hidden="true">
        {ok ? "✓" : "!"}
      </i>
      <span>{children}</span>
    </div>
  );
}

/** Dark card mirroring the home page's featured slot. */
export function FeatureCard({ item, onOpen }: { item: PortalAnnouncement; onOpen?: () => void }) {
  return (
    <article className={`nf-feature is-${item.category}`}>
      <div className="nf-feature__chips">
        <span className="nf-chip is-dark">
          <span className="nf-led" />
          {CATEGORY_META[item.category].label}
        </span>
        {distinctBadge(item) && <span className="nf-chip is-dark-badge">{item.badge}</span>}
        {item.pinned && <span className="nf-chip is-dark-quiet">Đã ghim</span>}
      </div>
      <h3>{item.title}</h3>
      {item.summary && <p>{item.summary}</p>}
      <div className="nf-feature__meta">
        <span>
          {item.authorName} · {formatStamp(item.createdAt)} · {item.scope}
        </span>
        {onOpen && (
          <button type="button" onClick={onOpen}>
            Xem chi tiết →
          </button>
        )}
      </div>
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
