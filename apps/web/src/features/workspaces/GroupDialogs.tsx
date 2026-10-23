import { type FormEvent, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { focusFirstInvalid } from "../../shared/lib/interaction";
import { Button, Field, Modal } from "../../shared/ui/Primitives";
import { createWorkspaceApi } from "../chat/api";
import { CreateWorkspaceModal, workspaceNameError } from "./CreateWorkspaceModal";

/** "Tạo nhóm": a new group starts with a chat channel, a task board and a meeting room. */
export function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (group: WorkspaceItem) => void }) {
  const { accessToken, notify } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || busy) return;
    const problem = workspaceNameError(name);
    if (problem) {
      setError(problem);
      focusFirstInvalid(event.currentTarget.closest(".modal") ?? event.currentTarget);
      return;
    }
    setBusy(true);
    try {
      const created = await createWorkspaceApi(accessToken, name.trim());
      notify("Đã tạo nhóm", `Nhóm "${created.name}" đã sẵn sàng.`);
      onCreated({ ...created, memberCount: 1, unreadCount: 0 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <CreateWorkspaceModal
      title="Tạo nhóm mới"
      onClose={() => !busy && onClose()}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button icon="plus" loading={busy} disabled={!name.trim()} onClick={(event) => void submit(event as unknown as FormEvent)}>
            Tạo nhóm
          </Button>
        </div>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="ws-modal-form">
        <p className="modal-lead">Nhóm mới có sẵn kênh trao đổi, bảng công việc và phòng họp cho các thành viên.</p>
        <Field label="Tên nhóm" error={error}>
          <input
            type="text"
            placeholder="Ví dụ: Bộ môn Mạng máy tính"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            maxLength={80}
            required
          />
        </Field>
      </form>
    </CreateWorkspaceModal>
  );
}

/** "Nhập mã mời": takes a pasted invitation link or bare token to the invitation page. */
export function JoinGroupDialog({ onClose }: { onClose: () => void }) {
  const { navigate } = useApp();
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const match = raw.match(/token=([^&#]+)/);
    onClose();
    navigate({ view: "invitation", invitationToken: match ? decodeURIComponent(match[1]) : raw });
  };
  return (
    <Modal
      title="Nhập mã mời"
      initialFocus="input:not(:disabled)"
      onClose={onClose}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
          <Button icon="check" disabled={!value.trim()} onClick={(event) => submit(event as unknown as FormEvent)}>
            Tiếp tục
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="ws-modal-form">
        <p className="modal-lead">Dán liên kết lời mời hoặc mã mà quản trị viên nhóm đã gửi cho bạn.</p>
        <Field label="Liên kết hoặc mã mời">
          <input type="text" value={value} onChange={(event) => setValue(event.target.value)} required />
        </Field>
      </form>
    </Modal>
  );
}

/** Empty state for the pages that gather every group, shown while the user has none. */
export function NoGroups({ text }: { text: string }) {
  const { navigate } = useApp();
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  return (
    <div className="no-groups" role="status">
      <h2>Bạn chưa ở trong nhóm nào</h2>
      <p>{text}</p>
      <div className="no-groups__actions">
        <Button icon="plus" onClick={() => setDialog("create")}>
          Tạo nhóm
        </Button>
        <Button variant="secondary" icon="link" onClick={() => setDialog("join")}>
          Nhập mã mời
        </Button>
      </div>
      <AnimatePresence>
        {dialog === "create" && (
          <CreateGroupDialog onClose={() => setDialog(null)} onCreated={(group) => navigate({ view: "chat", workspaceId: group.id })} />
        )}
        {dialog === "join" && <JoinGroupDialog onClose={() => setDialog(null)} />}
      </AnimatePresence>
    </div>
  );
}
