import { Modal, Button, Badge } from "../../shared/ui/Primitives";
import type { PortalAnnouncement } from "@doan/shared";

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

const CATEGORY_TONES: Record<string, "blue" | "green" | "amber" | "red" | "neutral"> = {
  general: "blue",
  training: "amber",
  event: "green",
  urgent: "red",
};

export function AnnouncementDetailModal({ announcement, onClose }: Props) {
  if (!announcement) return null;

  const formattedDate = new Date(announcement.createdAt).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <Modal
      title={announcement.title}
      eyebrow={`${CATEGORY_NAMES[announcement.category] || "Thông báo"} · ${announcement.scope}`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", gap: 10 }}>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      }
    >
      <div className="announcement-detail">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <Badge tone={CATEGORY_TONES[announcement.category] || "blue"}>
            📢 {CATEGORY_NAMES[announcement.category] || announcement.category}
          </Badge>
          {announcement.badge && (
            <Badge tone={announcement.category === "urgent" ? "red" : "amber"}>
              {announcement.badge}
            </Badge>
          )}
          {announcement.pinned && (
            <Badge tone="violet">
              ⭐ Đã ghim
            </Badge>
          )}
          <span style={{ fontSize: 13, color: "var(--text-muted, #64748B)", marginLeft: "auto" }}>
            {formattedDate}
          </span>
        </div>

        <div
          style={{
            padding: "10px 14px",
            background: "var(--bg-subtle, #F1F5F9)",
            borderRadius: 8,
            borderLeft: "3px solid var(--brand-primary, #2563EB)",
            marginBottom: 14,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text, #0F172A)",
            lineHeight: 1.45,
          }}
        >
          {announcement.summary}
        </div>

        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--text, #0F172A)",
            whiteSpace: "pre-line",
            marginBottom: 18,
          }}
        >
          {announcement.content}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingTop: 12,
            borderTop: "1px solid var(--border-color, #E2E8F0)",
            fontSize: 12,
            color: "var(--text-muted, #64748B)",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--brand-primary, #2563EB)",
              color: "#FFFFFF",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {announcement.authorName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text, #0F172A)", fontSize: 13 }}>
              {announcement.authorName}
            </div>
            <div style={{ fontSize: 11.5 }}>
              {announcement.authorTitle || "Phòng Công tác Sinh viên"} · {announcement.scope}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
