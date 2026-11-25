import { Modal, Button } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import type { PortalAnnouncement } from "@doan/shared";
import { CATEGORY_CHIP, CATEGORY_META, CHIP } from "./AnnouncementComposer";

interface Props {
  announcement: PortalAnnouncement | null;
  onClose: () => void;
}

type Category = keyof typeof CATEGORY_META;
const LOOK: Record<Category, { icon: IconName; tone: "neutral" | "blue" | "violet" | "red" }> = {
  general: { icon: "megaphone", tone: "neutral" },
  training: { icon: "graduation-cap", tone: "blue" },
  event: { icon: "calendar", tone: "violet" },
  urgent: { icon: "warning", tone: "red" },
};

/** One notice, read like an article: title, who and when, the summary, then the text. */
export function AnnouncementDetailModal({ announcement, onClose }: Props) {
  if (!announcement) return null;

  const date = new Date(announcement.createdAt);
  const category: Category =
    announcement.category in CATEGORY_META ? (announcement.category as Category) : "general";
  const label = CATEGORY_META[category].label;
  // Short notices often repeat the title as their summary; show it only when it adds something.
  const summary =
    announcement.summary.trim() !== announcement.title.trim() ? announcement.summary : "";
  const badge =
    announcement.badge && announcement.badge.trim().toLowerCase() !== label.toLowerCase()
      ? announcement.badge
      : "";

  return (
    <Modal
      title={label}
      eyebrow={announcement.scope}
      icon={LOOK[category].icon}
      iconTone={LOOK[category].tone}
      size="reading"
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <article className="tw grid gap-3.5 px-7 pt-5 pb-6 text-foreground max-md:px-5">
        {(badge || announcement.pinned) && (
          <div className="flex flex-wrap gap-1.5">
            {badge && <span className={cn(CHIP, CATEGORY_CHIP[category])}>{badge}</span>}
            {announcement.pinned && (
              <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>
                <Icon name="pin" size={12} /> Đã ghim
              </span>
            )}
          </div>
        )}
        <h1 className="m-0! text-2xl! leading-snug! font-bold! tracking-tight! text-foreground! max-md:text-xl!">
          {announcement.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 border-b pb-3.5 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-2.5 text-foreground">
            <UserAvatar name={announcement.authorName} className="size-[34px]" />
            <span>
              <b className="block text-[13.5px] font-semibold">{announcement.authorName}</b>
              <small className="text-xs text-muted-foreground">
                {announcement.authorTitle || "Cổng nội bộ TDTU"}
              </small>
            </span>
          </span>
          <time className="inline-flex items-center gap-1.5" dateTime={announcement.createdAt}>
            <Icon name="calendar" size={14} />
            {date.toLocaleDateString("vi-VN", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}{" "}
            · {date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
          </time>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="users" size={14} />
            {announcement.scope}
          </span>
        </div>
        {category === "urgent" && (
          <p
            className={cn(
              "flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13.5px]",
              CATEGORY_CHIP.urgent,
            )}
          >
            <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
            <span>
              <b className="block font-semibold">Tin khẩn</b>
              Vui lòng đọc kỹ và thực hiện sớm theo hướng dẫn bên dưới.
            </span>
          </p>
        )}
        {summary && (
          <p className="border-l-[3px] pl-3.5 text-base leading-relaxed text-muted-foreground!">
            {summary}
          </p>
        )}
        <div className="text-[15px] leading-[1.75] whitespace-pre-line [overflow-wrap:anywhere]">
          {announcement.content}
        </div>
      </article>
    </Modal>
  );
}
