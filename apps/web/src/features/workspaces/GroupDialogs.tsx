import { type FormEvent, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { DirectUserItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Avatar, Button, Field, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { createWorkspaceApi } from "../chat/api";
import { governanceApi } from "./api";
import "./group-dialogs.css";

/** Messenger's default group name: the first names of who is in it. */
function defaultGroupName(people: DirectUserItem[]) {
  const names = people.map((person) => person.displayName.trim().split(/\s+/).pop() ?? person.displayName);
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} và ${names.length - 3} người khác` : names.join(", ");
}

/** "Tạo nhóm" like Messenger: pick at least two people, the name is optional. */
export function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (group: WorkspaceItem) => void }) {
  const { accessToken, notify } = useApp();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DirectUserItem[]>([]);
  const [picked, setPicked] = useState<DirectUserItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const term = search.trim();
    setResults([]);
    if (!accessToken || term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      governanceApi<{ users: DirectUserItem[] }>(accessToken, `direct-conversations/users?q=${encodeURIComponent(term)}`, "GET", undefined, controller.signal)
        .then((data) => setResults(data.users))
        .catch(() => {
          /* Aborted or failed lookups leave the list empty; typing again retries. */
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, search]);
  const toggle = (person: DirectUserItem) => {
    setError("");
    setPicked((old) => (old.some((p) => p.userId === person.userId) ? old.filter((p) => p.userId !== person.userId) : [...old, person]));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || busy) return;
    if (picked.length < 2) {
      setError("Chọn ít nhất 2 người để tạo nhóm.");
      return;
    }
    setBusy(true);
    try {
      const created = await createWorkspaceApi(accessToken, (name.trim() || defaultGroupName(picked)).slice(0, 80), picked.map((p) => p.userId));
      notify("Đã tạo nhóm", `Nhóm "${created.name}" đã sẵn sàng.`);
      onCreated(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Tạo nhóm mới"
      initialFocus="input:not(:disabled)"
      onClose={() => !busy && onClose()}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button icon="plus" loading={busy} disabled={picked.length < 2} onClick={(event) => void submit(event as unknown as FormEvent)}>
            Tạo nhóm
          </Button>
        </div>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="ws-modal-form group-create">
        <Field label="Tên nhóm (không bắt buộc)">
          <input
            type="text"
            placeholder={picked.length >= 2 ? defaultGroupName(picked) : "Ví dụ: Bộ môn Mạng máy tính"}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
        </Field>
        {picked.length > 0 && (
          <ul className="group-create__chips" aria-label="Người đã chọn">
            {picked.map((person) => (
              <li key={person.userId}>
                <Avatar name={person.displayName} size="xs" />
                <span>{person.displayName}</span>
                <button type="button" aria-label={`Bỏ chọn ${person.displayName}`} onClick={() => toggle(person)}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Thêm người" error={error}>
          <input type="search" placeholder="Tìm tên hoặc email…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <ul className="group-create__results" aria-label="Kết quả tìm kiếm">
          {search.trim().length < 2 ? (
            <li className="group-create__hint">Nhập ít nhất 2 ký tự để tìm đồng nghiệp.</li>
          ) : !results.length ? (
            <li className="group-create__hint">Không tìm thấy người phù hợp.</li>
          ) : (
            results.map((person) => {
              const checked = picked.some((p) => p.userId === person.userId);
              return (
                <li key={person.userId}>
                  <label className="group-create__person">
                    <Avatar name={person.displayName} size="sm" />
                    <span className="group-create__who">
                      <strong>{person.displayName}</strong>
                      <span>{person.email}</span>
                    </span>
                    <input type="checkbox" checked={checked} onChange={() => toggle(person)} />
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </form>
    </Modal>
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
