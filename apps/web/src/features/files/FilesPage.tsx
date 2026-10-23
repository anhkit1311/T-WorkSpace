import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import type { ChannelItem, WorkspaceFileItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { formatFileSize } from "../../shared/lib/file-size";
import { Icon } from "../../shared/ui/Icon";
import { Button, Field, Modal } from "../../shared/ui/Primitives";
import { getAttachmentBlobApi, getChannelsApi, getWorkspacesApi, uploadAttachmentApi } from "../chat/api";
import { governanceApi } from "../workspaces/api";
import { NoGroups } from "../workspaces/GroupDialogs";
import "./files-page.css";

const PAGE = 30;
type Kind = "all" | "pinned" | "docs" | "images";

/** "Tài liệu": every file sent in the user's groups, newest first; the group is only a filter. */
export function FilesPage() {
  const { accessToken, route, navigate, notify } = useApp();
  const [groups, setGroups] = useState<WorkspaceItem[] | null>(null);
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [revision, setRevision] = useState(0);
  const [uploading, setUploading] = useState(false);
  const groupId = route.workspaceId ?? "";

  useEffect(() => {
    if (!accessToken) return;
    getWorkspacesApi(accessToken)
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [accessToken]);

  // Search on the server once typing pauses.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const path = (before?: string) => {
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (groupId) params.set("workspace", groupId);
    if (query) params.set("q", query);
    if (before) params.set("before", before);
    return `files?${params}`;
  };

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    governanceApi<{ files: WorkspaceFileItem[]; hasMore: boolean }>(accessToken, path(), "GET", undefined, controller.signal)
      .then((page) => {
        setFiles(page.files);
        setHasMore(page.hasMore);
      })
      .catch((reason) => !controller.signal.aborted && setError(reason instanceof Error ? reason.message : "Không tải được tài liệu."))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [accessToken, groupId, query, revision]);

  const loadMore = async () => {
    if (!accessToken || loadingMore || !files.length) return;
    setLoadingMore(true);
    try {
      const page = await governanceApi<{ files: WorkspaceFileItem[]; hasMore: boolean }>(accessToken, path(files[files.length - 1].id));
      setFiles((previous) => [...previous, ...page.files]);
      setHasMore(page.hasMore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải thêm được tài liệu.");
    } finally {
      setLoadingMore(false);
    }
  };

  const open = async (file: WorkspaceFileItem) => {
    if (!accessToken) return;
    try {
      const url = URL.createObjectURL(await getAttachmentBlobApi(accessToken, file.id));
      if (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") window.open(url, "_blank", "noopener,noreferrer");
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = file.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      notify("Không tải được tài liệu", reason instanceof Error ? reason.message : "Vui lòng thử lại.", "warning");
    }
  };

  const visible = useMemo(
    () =>
      files.filter((file) =>
        kind === "pinned" ? file.pinned : kind === "images" ? file.mimeType.startsWith("image/") : kind === "docs" ? !file.mimeType.startsWith("image/") : true,
      ),
    [files, kind],
  );

  if (groups?.length === 0) return <NoGroups text="Tài liệu gửi trong các nhóm của bạn sẽ hiện ở đây." />;

  return (
    <section className="ws-files-tab files-page" aria-labelledby="files-title">
      <div className="ws-files-toolbar">
        <div className="ws-files-toolbar__left">
          <h1 id="files-title">Tài liệu</h1>
          <p>Tệp gửi trong kênh và thẻ công việc của mọi nhóm bạn tham gia.</p>
        </div>
        <div className="ws-files-toolbar__controls">
          <div className="ws-files-search">
            <Icon name="search" size={15} />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên tệp…" aria-label="Tìm tệp" />
          </div>
          <label className="files-page__group">
            <span className="sr-only">Nhóm</span>
            <select value={groupId} onChange={(event) => navigate({ view: "files", workspaceId: event.target.value || undefined }, true)}>
              <option value="">Nhóm: Tất cả</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ws-files-filters" role="group" aria-label="Loại tệp">
            {(
              [
                ["all", "Tất cả"],
                ["pinned", "Đã ghim"],
                ["docs", "Tài liệu"],
                ["images", "Hình ảnh"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" className={`ws-files-filter-btn ${kind === key ? "is-active" : ""}`} aria-pressed={kind === key} onClick={() => setKind(key)}>
                {label}
              </button>
            ))}
          </div>
          <Button icon="upload" onClick={() => setUploading(true)} disabled={!groups?.some((group) => !group.archivedAt)}>
            Tải lên
          </Button>
        </div>
      </div>

      {loading ? (
        <p role="status">Đang tải tài liệu…</p>
      ) : error ? (
        <div className="inline-alert" role="alert">
          <p>{error}</p>
          <Button size="sm" variant="secondary" onClick={() => setRevision((value) => value + 1)}>
            Thử lại
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="ws-files-empty-wrap">
          <div className="ws-files-empty">
            <Icon name="folder" size={28} />
            <h3>{files.length === 0 && !query ? "Chưa có tài liệu nào" : "Không tìm thấy tài liệu phù hợp"}</h3>
            <p>Tệp đính kèm trong kênh hoặc thẻ công việc sẽ tự động tập hợp tại đây.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="ws-files-table" role="list">
            {visible.map((file) => (
              <article key={file.id} className="ws-file-row" role="listitem">
                <div className="ws-file-row__icon" aria-hidden="true">
                  <Icon name={file.mimeType.startsWith("image/") ? "image" : "file"} size={18} />
                </div>
                <div className="ws-file-row__main">
                  <div className="ws-file-row__title-line">
                    <strong className="ws-file-row__name" title={file.fileName}>
                      {file.fileName}
                    </strong>
                    <span className="ws-file-tag">{file.workspaceName}</span>
                    {file.pinned && (
                      <span className="ws-file-tag is-pinned">
                        <Icon name="pin" size={11} /> Đã ghim
                      </span>
                    )}
                    {file.taskId && <span className="ws-file-tag">Đính kèm công việc</span>}
                  </div>
                  <div className="ws-file-row__meta">
                    <span className="ws-channel-pill">#{file.channelName}</span>
                    <span>{file.uploaderName}</span>
                    <span>{formatFileSize(file.fileSize)}</span>
                    <time dateTime={file.createdAt}>
                      {new Date(file.createdAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })}
                    </time>
                  </div>
                </div>
                <div className="ws-file-row__actions">
                  <Button
                    size="sm"
                    variant="text"
                    icon="message"
                    onClick={() => navigate({ view: "chat", workspaceId: file.workspaceId, channelId: file.channelId, messageId: file.messageId ?? undefined })}
                  >
                    Xem trong kênh
                  </Button>
                  <Button size="sm" variant="secondary" icon="download" onClick={() => void open(file)}>
                    Mở / Tải
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {hasMore && (
            <div className="ws-files-more">
              <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                Xem thêm
              </Button>
            </div>
          )}
        </>
      )}
      <AnimatePresence>
        {uploading && groups && (
          <UploadDialog
            groups={groups.filter((group) => !group.archivedAt)}
            defaultGroupId={groupId}
            onClose={() => setUploading(false)}
            onUploaded={() => {
              setUploading(false);
              setRevision((value) => value + 1);
              notify("Đã tải tệp lên", undefined, "success");
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

/** A file always lives in a channel, so uploading sends it there as a message, the same way the chat does. */
function UploadDialog({
  groups,
  defaultGroupId,
  onClose,
  onUploaded,
}: {
  groups: WorkspaceItem[];
  defaultGroupId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { accessToken } = useApp();
  const { sendMessage } = useSocket();
  const [groupId, setGroupId] = useState(() => (groups.some((group) => group.id === defaultGroupId) ? defaultGroupId : (groups[0]?.id ?? "")));
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [channelId, setChannelId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const attachmentId = useRef<string | null>(null);
  const clientMessageId = useRef(crypto.randomUUID());
  const busy = progress !== null;

  useEffect(() => {
    setChannels([]);
    setChannelId("");
    if (!accessToken || !groupId) return;
    let active = true;
    getChannelsApi(accessToken, groupId)
      .then((items) => {
        if (!active) return;
        const text = items.filter((item) => item.type === "text" && !item.archivedAt);
        setChannels(text);
        setChannelId(text[0]?.id ?? "");
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Không tải được kênh."));
    return () => {
      active = false;
    };
  }, [accessToken, groupId]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!accessToken || !channelId || !file || busy) return;
    setError("");
    setProgress(0);
    try {
      // Retrying after a failed send reuses the uploaded file and message id, so nothing is posted twice.
      attachmentId.current ??= (await uploadAttachmentApi(accessToken, channelId, file, setProgress)).id;
      await sendMessage(channelId, "", { attachmentId: attachmentId.current, clientMessageId: clientMessageId.current });
      onUploaded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được tệp lên.");
      setProgress(null);
    }
  };
  const pick = (next: () => void) => {
    attachmentId.current = null;
    clientMessageId.current = crypto.randomUUID();
    next();
  };

  return (
    <Modal
      title="Tải tệp lên"
      initialFocus="select"
      onClose={() => !busy && onClose()}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button icon="upload" loading={busy} disabled={!channelId || !file} onClick={() => void submit()}>
            {busy && progress ? `Tải lên ${progress}%` : "Tải lên"}
          </Button>
        </div>
      }
    >
      <form className="ws-modal-form" onSubmit={(event) => void submit(event)}>
        <Field label="Nhóm">
          <select value={groupId} disabled={busy} onChange={(event) => pick(() => setGroupId(event.target.value))}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kênh" hint="Tệp được gửi vào kênh này như một tin nhắn.">
          <select value={channelId} disabled={busy || !channels.length} onChange={(event) => pick(() => setChannelId(event.target.value))}>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tệp" error={error}>
          <input type="file" disabled={busy} onChange={(event) => pick(() => setFile(event.target.files?.[0] ?? null))} />
        </Field>
      </form>
    </Modal>
  );
}
