import { useState, type FormEvent } from "react";
import { Modal, Button, Field } from "../../shared/ui/Primitives";
import type {
  AnnouncementCategory,
  CreateAnnouncementInput,
  PortalAnnouncement,
} from "@doan/shared";

interface Props {
  initialData?: PortalAnnouncement | null;
  onClose: () => void;
  onSubmit: (input: CreateAnnouncementInput) => Promise<void>;
  loading?: boolean;
}

const CATEGORIES: { key: AnnouncementCategory; label: string }[] = [
  { key: "general", label: "Thông báo chung" },
  { key: "training", label: "Đào tạo" },
  { key: "event", label: "Sự kiện" },
  { key: "urgent", label: "Khẩn" },
];

export function CreateAnnouncementModal({ initialData, onClose, onSubmit, loading = false }: Props) {
  const [title, setTitle] = useState(initialData?.title || "");
  const [category, setCategory] = useState<AnnouncementCategory>(initialData?.category || "general");
  const [badge, setBadge] = useState(initialData?.badge || "Mới");
  const [scope, setScope] = useState(initialData?.scope || "Toàn trường");
  const [pinned, setPinned] = useState(initialData?.pinned || false);
  const [summary, setSummary] = useState(initialData?.summary || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Vui lòng nhập tiêu đề thông báo.");
      return;
    }
    if (!summary.trim() && !content.trim()) {
      setError("Vui lòng nhập nội dung thông báo.");
      return;
    }
    setError("");

    try {
      await onSubmit({
        title: title.trim(),
        category,
        badge: badge.trim() || undefined,
        scope: scope.trim() || "Toàn trường",
        pinned,
        summary: summary.trim() || title.trim(),
        content: content.trim() || summary.trim() || title.trim(),
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể lưu thông báo.");
    }
  };

  return (
    <Modal
      title={initialData ? "Chỉnh sửa thông báo" : "Đăng thông báo mới cho sinh viên"}
      eyebrow="Cổng nội bộ TDTU · Bảng tin thông báo"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", gap: 10 }}>
          <Button variant="ghost" disabled={loading} onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={loading} onClick={handleSubmit}>
            {initialData ? "Lưu thay đổi" : "Đăng thông báo ngay"}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 8,
              color: "#DC2626",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <Field label="Tiêu đề thông báo *">
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Kế hoạch đăng ký môn học và thời khóa biểu HK1..."
            className="input"
            autoFocus
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Danh mục">
            <select
              value={category}
              onChange={(e) => {
                const cat = e.target.value as AnnouncementCategory;
                setCategory(cat);
                if (cat === "urgent") setBadge("Khẩn");
                else if (cat === "training") setBadge("Quan trọng");
                else setBadge("Mới");
              }}
              className="select"
            >
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nhãn nổi bật (Badge)">
            <input
              type="text"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              placeholder="VD: Mới, Khẩn, Quan trọng..."
              className="input"
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Phạm vi đối tượng">
            <input
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="VD: Toàn trường, Khoa CNTT, Ký túc xá..."
              className="input"
            />
          </Field>

          <div style={{ display: "flex", alignItems: "center", paddingTop: 26, gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--brand-primary, #2563EB)" }}
              />
              <span style={{ fontWeight: 500 }}>Ghim lên đầu Bảng tin Trang chủ</span>
            </label>
          </div>
        </div>

        <Field label="Tóm tắt ngắn (hiển thị trên thẻ Bảng tin)">
          <textarea
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Tóm tắt ngắn gọn nội dung thông báo trong 1-2 câu..."
            className="textarea"
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border-color, #E2E8F0)", padding: "8px 12px", fontSize: 13.5 }}
          />
        </Field>

        <Field label="Nội dung chi tiết văn bản thông báo *">
          <textarea
            rows={6}
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Nhập toàn văn thông báo, các mục lục, thời gian, yêu cầu thực hiện dành cho sinh viên..."
            className="textarea"
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border-color, #E2E8F0)", padding: "10px 12px", fontSize: 13.5, fontFamily: "inherit" }}
          />
        </Field>
      </form>
    </Modal>
  );
}
