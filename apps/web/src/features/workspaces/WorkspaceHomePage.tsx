import { useMemo, useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import { createWorkspaceApi } from "../chat/api";
import { useApp } from "../../app/providers/AppContext";
import { Button, Chip, Field } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import "./workspace-home.css";
import { HomePriorities } from "./HomePriorities";
import { CreateWorkspaceModal, workspaceNameError } from "./CreateWorkspaceModal";
import { focusFirstInvalid } from "../../shared/lib/interaction";
import { ambientBridge } from "../../shared/motion/AmbientBackdrop";

export function WorkspaceHomePage() {
  const { accessToken, setActiveView, openWorkspace, user, notify } = useApp();

  // Modal tạo nhóm mới
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const formattedDate = useMemo(() => {
    try {
      const raw = new Intl.DateTimeFormat("vi-VN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date());
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    } catch {
      return "Hôm nay";
    }
  }, []);

  const handleCreateWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newWorkspaceName.trim();
    const validation = workspaceNameError(trimmed);
    if (validation) {
      setCreateError(validation);
      focusFirstInvalid(event.currentTarget.closest(".modal") ?? event.currentTarget);
      return;
    }
    if (!accessToken) return;

    setCreating(true);
    setCreateError("");
    try {
      const created = await createWorkspaceApi(accessToken, trimmed);
      ambientBridge.pulse();
      notify("Thành công", `Đã tạo nhóm "${created.name}".`, "success");
      setCreateModalOpen(false);
      setNewWorkspaceName("");
      openWorkspace(created.id, "workspace");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Không thể tạo nhóm làm việc.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="workspace-home">
      <div className="workspace-home__unified-card">
        {/* Hero Greeting Section */}
        <section className="workspace-home__hero">
          <div className="workspace-home__greeting">
            <Chip icon="calendar" className="workspace-home__date-pill">
              {formattedDate}
            </Chip>
            <h1>Xin chào, {user?.displayName ?? "bạn"}</h1>
            <p>
              Đây là trạm điều khiển của bạn. Tiếp tục cuộc trò chuyện, vào phòng họp hoặc mở nhóm
              đang làm việc.
            </p>
          </div>
          <div className="workspace-home__quick-actions">
            <Button variant="primary" icon="plus" onClick={() => setCreateModalOpen(true)}>
              Tạo nhóm mới
            </Button>
            <Button variant="secondary" icon="users" onClick={() => setActiveView("workspace")}>
              Mở không gian nhóm
            </Button>
            <Button variant="secondary" icon="video" onClick={() => setActiveView("meetings")}>
              Mở phòng họp
            </Button>
          </div>
        </section>

        <HomePriorities />
      </div>

      {/* Modal Tạo Nhóm Mới */}
      <AnimatePresence>
        {createModalOpen && (
          <CreateWorkspaceModal
            title="Tạo nhóm làm việc mới"
            eyebrow="TẠO WORKSPACE"
            onClose={() => {
              if (!creating) {
                setCreateModalOpen(false);
                setCreateError("");
              }
            }}
            footer={
              <div className="modal-footer-actions">
                <Button
                  variant="ghost"
                  disabled={creating}
                  onClick={() => {
                    setCreateModalOpen(false);
                    setCreateError("");
                  }}
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  form="create-workspace-form"
                  loading={creating}
                  disabled={creating || !newWorkspaceName.trim()}
                >
                  Tạo nhóm ngay
                </Button>
              </div>
            }
          >
            <form id="create-workspace-form" onSubmit={handleCreateWorkspace}>
              <p className="modal-lead">
                Nhóm làm việc là nơi bạn và các thành viên cùng trao đổi tin nhắn thời gian thực và
                tham gia hội nghị truyền hình SFU bảo mật. Bạn sẽ tự động là{" "}
                <strong>Quản trị viên (Admin)</strong> của nhóm này.
              </p>
              <Field
                label="Tên nhóm làm việc"
                hint="Ví dụ: Đội ngũ Frontend, Dự án 2026, Bộ môn Công nghệ mạng"
                error={createError}
              >
                <div className="editorial-input-wrap">
                  <Icon name="users" size={16} className="editorial-input-icon" />
                  <input
                    type="text"
                    required
                    maxLength={80}
                    placeholder="Nhập tên nhóm làm việc…"
                    value={newWorkspaceName}
                    onChange={(e) => {
                      setNewWorkspaceName(e.target.value);
                      if (createError) setCreateError("");
                    }}
                    disabled={creating}
                    className="editorial-input"
                  />
                </div>
              </Field>
            </form>
          </CreateWorkspaceModal>
        )}
      </AnimatePresence>
    </div>
  );
}
