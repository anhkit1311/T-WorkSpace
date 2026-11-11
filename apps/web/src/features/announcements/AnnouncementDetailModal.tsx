import { Modal, Button, Avatar } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import type { PortalAnnouncement } from "@doan/shared";
import "./announcement-detail.css";

interface Props {
  announcement: PortalAnnouncement | null;
  onClose: () => void;
}

const CATEGORY_NAMES: Record<string, string> = {
  general: "Thông báo chung",
  training: "Đào tạo",
  event: "Sự kiện",
  urgent: "Khẩn",
};

export function AnnouncementDetailModal({ announcement, onClose }: Props) {
  if (!announcement) return null;

  const date = new Date(announcement.createdAt);
  const category = announcement.category in CATEGORY_NAMES ? announcement.category : "general";
  // Short notices often repeat the title as their summary; show it only when it adds something.
  const summary =
    announcement.summary.trim() !== announcement.title.trim() ? announcement.summary : "";

  return (
    <Modal
      title={announcement.title}
      eyebrow={`${CATEGORY_NAMES[category]} · ${announcement.scope}`}
      onClose={onClose}
      footer={
        <div className="ad-footer">
          <Avatar name={announcement.authorName} size="sm" />
          <span className="ad-footer__author">
            <b>{announcement.authorName}</b>
            <small>{announcement.authorTitle || "Cổng nội bộ TDTU"}</small>
          </span>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      }
    >
      <article className={`ad is-${category}`}>
        <div className="ad-head">
          <time className="ad-date" dateTime={announcement.createdAt}>
            <span>Thg {date.getMonth() + 1}</span>
            <b>{String(date.getDate()).padStart(2, "0")}</b>
            <span>{date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
          </time>
          <div className="ad-head__info">
            <div className="ad-chips">
              <span className="ad-chip is-category">
                <i aria-hidden="true" />
                {CATEGORY_NAMES[category]}
              </span>
              {announcement.badge &&
                announcement.badge.trim().toLowerCase() !==
                  CATEGORY_NAMES[category].toLowerCase() && (
                  <span className="ad-chip is-badge">{announcement.badge}</span>
                )}
              {announcement.pinned && (
                <span className="ad-chip">
                  <Icon name="pin" size={12} /> Đã ghim
                </span>
              )}
            </div>
            <dl className="ad-facts">
              <div>
                <dt>Ngày đăng</dt>
                <dd>
                  {date.toLocaleDateString("vi-VN", {
                    weekday: "long",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </dd>
              </div>
              <div>
                <dt>Phạm vi</dt>
                <dd>{announcement.scope}</dd>
              </div>
            </dl>
          </div>
        </div>

        {summary && <p className="ad-summary">{summary}</p>}
        <div className="ad-content">{announcement.content}</div>
      </article>
    </Modal>
  );
}
