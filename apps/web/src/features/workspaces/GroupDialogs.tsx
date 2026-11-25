import { type FormEvent, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { DirectUserItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { createWorkspaceApi } from "../chat/api";
import { governanceApi } from "./api";

/** Messenger's default group name: the first names of who is in it. */
function defaultGroupName(people: DirectUserItem[]) {
  const names = people.map(
    (person) => person.displayName.trim().split(/\s+/).pop() ?? person.displayName,
  );
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} và ${names.length - 3} người khác`
    : names.join(", ");
}

/** "Tạo nhóm" like Messenger: pick at least two people, the name is optional. */
export function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (group: WorkspaceItem) => void;
}) {
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
      governanceApi<{ users: DirectUserItem[] }>(
        accessToken,
        `direct-conversations/users?q=${encodeURIComponent(term)}`,
        "GET",
        undefined,
        controller.signal,
      )
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
    setPicked((old) =>
      old.some((p) => p.userId === person.userId)
        ? old.filter((p) => p.userId !== person.userId)
        : [...old, person],
    );
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
      const created = await createWorkspaceApi(
        accessToken,
        (name.trim() || defaultGroupName(picked)).slice(0, 80),
        picked.map((p) => p.userId),
      );
      notify("Đã tạo nhóm", `Nhóm "${created.name}" đã sẵn sàng.`);
      onCreated(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };
  const fallbackName = picked.length >= 2 ? defaultGroupName(picked) : "";
  const label = "text-xs font-semibold tracking-[.05em] text-muted-foreground uppercase";
  return (
    <Modal
      title="Tạo nhóm mới"
      eyebrow="Chọn ít nhất 2 người"
      icon="users"
      initialFocus="input:not(:disabled)"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span className="mr-auto min-w-0 text-[12.5px] text-muted-foreground">
            {picked.length ? (
              <>
                <b className="font-semibold text-foreground">{picked.length} người</b>
                {fallbackName && !name.trim() && ` · nhóm sẽ tên “${fallbackName}” nếu để trống`}
              </>
            ) : (
              "Chưa chọn ai"
            )}
          </span>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button
            icon="plus"
            loading={busy}
            disabled={picked.length < 2}
            onClick={(event) => void submit(event as unknown as FormEvent)}
          >
            Tạo nhóm
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="tw grid gap-3.5 text-sm text-foreground"
      >
        <input
          type="text"
          className="w-full border-0 border-b bg-transparent pt-0.5 pb-2.5 text-lg font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground focus:border-foreground"
          aria-label="Tên nhóm (không bắt buộc)"
          placeholder={fallbackName || "Tên nhóm (không bắt buộc)"}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />
        {picked.length > 0 && (
          <div className="grid gap-2">
            <span className={label}>Đã chọn ({picked.length})</span>
            <ul className="flex flex-wrap gap-1.5" aria-label="Người đã chọn">
              {picked.map((person) => (
                <li
                  key={person.userId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-1 pl-0.5 text-[12.5px]"
                >
                  <UserAvatar name={person.displayName} className="size-5 text-[9px]" />
                  {person.displayName}
                  <button
                    type="button"
                    className="grid size-4 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
                    aria-label={`Bỏ chọn ${person.displayName}`}
                    onClick={() => toggle(person)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-2">
          <span className={label}>Thêm người</span>
          <div className="overflow-hidden rounded-[10px] border bg-card">
            <label className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground">
              <Icon name="search" size={14} />
              <input
                type="search"
                className="w-0 min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none"
                aria-label="Thêm người"
                aria-invalid={Boolean(error) || undefined}
                placeholder="Tìm tên hoặc email…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <ul className="max-h-[240px] overflow-y-auto p-1" aria-label="Kết quả tìm kiếm">
              {search.trim().length < 2 ? (
                <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                  Nhập ít nhất 2 ký tự để tìm đồng nghiệp hoặc sinh viên.
                </li>
              ) : !results.length ? (
                <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                  Không tìm thấy người phù hợp.
                </li>
              ) : (
                results.map((person) => {
                  const checked = picked.some((p) => p.userId === person.userId);
                  return (
                    <li key={person.userId}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-secondary">
                        <UserAvatar name={person.displayName} className="size-[30px] text-[11px]" />
                        <span className="grid min-w-0 flex-1">
                          <strong className="truncate text-[13.5px] font-medium">
                            {person.displayName}
                          </strong>
                          <span className="truncate text-xs text-muted-foreground">
                            {person.email}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-foreground"
                          checked={checked}
                          onChange={() => toggle(person)}
                        />
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
          {error && (
            <small className="text-[12.5px] font-medium text-destructive" role="alert">
              {error}
            </small>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** Empty state for the pages that gather every group, shown while the user has none. */
export function NoGroups({ text }: { text: string }) {
  const { navigate } = useApp();
  const [creating, setCreating] = useState(false);
  return (
    <div
      className="tw mx-auto my-10 grid w-[min(100%,520px)] justify-items-center gap-2.5 rounded-[14px] border border-dashed bg-card px-6 py-10 text-center text-sm text-foreground"
      role="status"
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]">
        <Icon name="users" size={26} />
      </span>
      <h2 className="text-lg! font-semibold! text-foreground!">Bạn chưa ở trong nhóm nào</h2>
      <p className="max-w-[360px] text-muted-foreground!">{text}</p>
      <Button icon="plus" className="mt-1" onClick={() => setCreating(true)}>
        Tạo nhóm
      </Button>
      <AnimatePresence>
        {creating && (
          <CreateGroupDialog
            onClose={() => setCreating(false)}
            onCreated={(group) => navigate({ view: "chat", workspaceId: group.id })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
