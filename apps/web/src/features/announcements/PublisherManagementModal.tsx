import { useEffect, useState, type FormEvent } from "react";
import { Modal, Button, Field } from "../../shared/ui/Primitives";
import type { AnnouncementPublisher } from "@doan/shared";
import { getPublishersApi, grantPublisherApi, revokePublisherApi } from "./api";

interface Props {
  accessToken: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function PublisherManagementModal({ accessToken, onClose, onChanged }: Props) {
  const [publishers, setPublishers] = useState<AnnouncementPublisher[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await getPublishersApi(accessToken);
      setPublishers(res.publishers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [accessToken]);

  const handleGrant = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setSuccessMsg("");
    setSubmitting(true);
    try {
      const res = await grantPublisherApi(accessToken, email.trim());
      setSuccessMsg(`Đã cấp quyền đăng thông báo cho: ${res.displayName}`);
      setEmail("");
      await loadData();
      onChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể cấp quyền.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (userId: string, name: string) => {
    if (!window.confirm(`Bạn có chắc muốn thu hồi quyền đăng bài của "${name}"?`)) return;
    try {
      await revokePublisherApi(accessToken, userId);
      setPublishers((prev) => prev.filter((p) => p.userId !== userId));
      onChanged?.();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Không thể thu hồi quyền.");
    }
  };

  return (
    <Modal
      title="Phân quyền đăng tải thông báo"
      eyebrow="Quản trị hệ thống · Phân quyền nội dung"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary, #475569)", lineHeight: 1.5 }}>
          Những tài khoản trong danh sách dưới đây (cùng với Quản trị hệ thống và Ban Chủ nhiệm Khoa) sẽ có quyền tạo, chỉnh sửa và đăng thông báo trực tiếp lên Bảng tin Trang chủ cho toàn bộ sinh viên xem.
        </p>

        {error && (
          <div
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

        {successMsg && (
          <div
            style={{
              padding: "10px 14px",
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              borderRadius: 8,
              color: "#059669",
              fontSize: 13,
            }}
          >
            {successMsg}
          </div>
        )}

        <form onSubmit={handleGrant} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Field label="Cấp quyền cho tài khoản (Email trường)">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="VD: lecturer@tdtu.edu.vn hoặc student@student.tdtu.edu.vn"
                className="input"
              />
            </Field>
          </div>
          <Button variant="primary" loading={submitting} type="submit" style={{ height: 40 }}>
            + Cấp quyền đăng
          </Button>
        </form>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text, #0F172A)", marginBottom: 8 }}>
            Danh sách tài khoản được cấp quyền đăng bài ({publishers.length})
          </div>

          {loading ? (
            <p style={{ fontSize: 13, color: "var(--text-muted, #64748B)" }}>Đang tải danh sách...</p>
          ) : publishers.length === 0 ? (
            <div
              style={{
                padding: "20px 16px",
                textAlign: "center",
                background: "var(--bg-subtle, #F1F5F9)",
                borderRadius: 10,
                color: "var(--text-muted, #64748B)",
                fontSize: 13,
              }}
            >
              Chưa có tài khoản riêng nào được cấp quyền. Mặc định Quản trị hệ thống và Giáo vụ Khoa đã có sẵn quyền đăng bài.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--border-color, #E2E8F0)",
                borderRadius: 10,
                overflow: "hidden",
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {publishers.map((p) => (
                <div
                  key={p.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border-color, #E2E8F0)",
                    background: "var(--bg-surface, #FFFFFF)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text, #0F172A)" }}>
                      {p.displayName}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted, #64748B)" }}>
                      {p.email} · Được cấp {new Date(p.grantedAt).toLocaleDateString("vi-VN")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleRevoke(p.userId, p.displayName)}
                  >
                    Thu hồi
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
