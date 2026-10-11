import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessageItem } from "@doan/shared";
import { governanceApi } from "../workspaces/api";
import { uploadAttachmentApi } from "./api";
import { Button } from "../../shared/ui/Primitives";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import "./team-conversations.css";
import { AttachmentView } from "./ChatAttachment";
import { useDraft } from "../../shared/hooks/useDraft";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { motion, useIsPresent } from "motion/react";
import { useMotionSafe } from "../../shared/motion/MotionProvider";

export interface ChannelMember {
  userId: string;
  displayName: string;
  role: string;
}
interface ThreadPage {
  root: ChatMessageItem;
  messages: ChatMessageItem[];
  hasMore: boolean;
}

export function ThreadPanel({
  rootId,
  channelId,
  readOnly,
  onClose,
  members,
}: {
  rootId: string;
  channelId: string;
  readOnly: boolean;
  onClose: () => void;
  members: ChannelMember[];
}) {
  const safe = useMotionSafe();
  const present = useIsPresent();
  const { accessToken, user } = useApp();
  const panelRef = usePanelDialog(onClose);
  const { socket, sendMessage, isConnected } = useSocket();
  const [page, setPage] = useState<ThreadPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft, draftReady] = useDraft<{
    content: string;
    mentions: string[];
    file: File | null;
    pending: {
      clientMessageId: string;
      content: string;
      attachmentId?: string;
      mentionedUserIds: string[];
    } | null;
  }>(`${user?.id ?? "anonymous"}:thread:${rootId}`, {
    content: "",
    mentions: [],
    file: null,
    pending: null,
  });
  const { content, mentions, file } = draft;
  const setContent = (content: string) => setDraft((old) => ({ ...old, content }));
  const setMentions = (mentions: string[]) => setDraft((old) => ({ ...old, mentions }));
  const setFile = (file: File | null) => setDraft((old) => ({ ...old, file }));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const pendingRef = useRef<{
    clientMessageId: string;
    content: string;
    attachmentId?: string;
    mentionedUserIds: string[];
  } | null>(null);
  useEffect(() => {
    if (draftReady) pendingRef.current = draft.pending;
  }, [draftReady, draft.pending]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    setPage(null);
    setLoading(true);
    setError("");
    const load = () =>
      void governanceApi<ThreadPage>(accessToken, `threads/${rootId}`)
        .then((data) => {
          if (!active) return;
          setPage((old) => ({
            ...data,
            hasMore: old && old.messages.length >= 50 ? old.hasMore : data.hasMore,
            messages: old
              ? [
                  ...old.messages.filter(
                    (message) => !data.messages.some((next) => next.id === message.id),
                  ),
                  ...data.messages,
                ]
              : data.messages,
          }));
          void governanceApi(accessToken, `threads/${rootId}/read`, "POST", {}).catch(() => { /* Read markers are retried when the thread is opened again; keep the successfully loaded conversation. */ });
        })
        .catch((reason) => {
          if (active) {
            setPage(null);
            setError(reason.message);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    const onMessage = (message: ChatMessageItem) => {
      if (message.threadRootId === rootId) {
        if (message.clientMessageId === pendingRef.current?.clientMessageId) {
          pendingRef.current = null;
          setDraft((old) => ({ ...old, pending: null }));
          setContent("");
          setFile(null);
          setMentions([]);
          setError("");
        }
        load();
      }
    };
    const onChanged = (event: { channelId: string }) => {
      if (event.channelId === channelId) load();
    };
    load();
    socket?.on("new_message", onMessage);
    socket?.on("message_changed", onChanged);
    socket?.on("connect", load);
    socket?.on("access_revoked", load);
    return () => {
      active = false;
      socket?.off("new_message", onMessage);
      socket?.off("message_changed", onChanged);
      socket?.off("connect", load);
      socket?.off("access_revoked", load);
    };
  }, [rootId, channelId, accessToken, socket]);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (
      !accessToken ||
      !page ||
      busy ||
      !draftReady ||
      readOnly ||
      (!content.trim() && !file && !pendingRef.current)
    )
      return;
    setBusy(true);
    setError("");
    const pending = pendingRef.current ?? {
      clientMessageId: crypto.randomUUID(),
      content: content.trim(),
      mentionedUserIds: mentions,
    };
    pendingRef.current = pending;
    setDraft((old) => ({ ...old, pending: { ...pending } }));
    try {
      if (file && !pending.attachmentId) {
        pending.attachmentId = (
          await uploadAttachmentApi(accessToken, channelId, file, setProgress)
        ).id;
        setDraft((old) => ({ ...old, pending: { ...pending } }));
      }
      const message = await sendMessage(channelId, pending.content, {
        ...pending,
        threadRootId: rootId,
      });
      setPage((old) =>
        old
          ? {
              ...old,
              messages: old.messages.some((item) => item.id === message.id)
                ? old.messages
                : [...old.messages, message],
            }
          : old,
      );
      pendingRef.current = null;
      setDraft((old) => ({ ...old, pending: null }));
      setContent("");
      setFile(null);
      setMentions([]);
    } catch (reason) {
      if (pendingRef.current?.clientMessageId === pending.clientMessageId)
        setError(
          reason instanceof Error
            ? reason.message
            : "Không gửi được phản hồi. Thử lại sẽ giữ cùng mã gửi.",
        );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  return (
    <motion.aside
      {...safe.panel}
      inert={!present}
      style={present ? undefined : {pointerEvents:"none"}}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="thread-panel"
      aria-label="Chủ đề trao đổi"
    >
      <header>
        <h2>Chủ đề</h2>
        <button ref={closeRef} onClick={onClose} aria-label="Đóng chủ đề">
          Đóng
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Đang tải chủ đề…</p>}
      {page && (
        <>
          <div className="thread-history" role="log" aria-label="Phản hồi chủ đề">
            <article className="thread-root">
              <strong>{page.root.authorName}</strong>
              <p>{page.root.content || page.root.attachment?.fileName}</p>
            </article>
            {page.hasMore && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setLoading(true);
                  void governanceApi<ThreadPage>(
                    accessToken!,
                    `threads/${rootId}?before=${page.messages[0].id}`,
                  )
                    .then((older) =>
                      setPage((old) =>
                        old
                          ? {
                              ...old,
                              hasMore: older.hasMore,
                              messages: [
                                ...older.messages.filter(
                                  (item) => !old.messages.some((current) => current.id === item.id),
                                ),
                                ...old.messages,
                              ],
                            }
                          : older,
                      ),
                    )
                    .catch((reason) => setError(reason.message))
                    .finally(() => setLoading(false));
                }}
              >
                Tải phản hồi cũ
              </Button>
            )}
            {page.messages.map((message) => (
              <article key={message.id}>
                <strong>{message.authorName}</strong>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString("vi-VN")}
                </time>
                <p>{message.content}</p>
                {message.attachment && accessToken && (
                  <AttachmentView attachment={message.attachment} accessToken={accessToken} />
                )}
                {message.mentions?.length ? (
                  <small>Nhắc: {message.mentions.map((item) => item.displayName).join(", ")}</small>
                ) : null}
              </article>
            ))}
            {!page.messages.length && <p>Chưa có phản hồi. Bắt đầu trao đổi trong chủ đề này.</p>}
          </div>
          <form onSubmit={submit}>
            <label>
              Phản hồi
              <textarea
                maxLength={4000}
                value={content}
                disabled={readOnly || busy || Boolean(pendingRef.current)}
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            <label>
              Nhắc thành viên
              <select
                multiple
                value={mentions}
                disabled={readOnly || busy || Boolean(pendingRef.current)}
                onChange={(event) =>
                  setMentions(Array.from(event.target.selectedOptions, (option) => option.value))
                }
              >
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tệp đính kèm
              <input
                type="file"
                disabled={readOnly || busy || Boolean(pendingRef.current)}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {file && <small>{file.name}</small>}
            {progress !== null && (
              <p role="status">
                Tải tệp {progress}%{" "}
                <progress max={100} value={progress} aria-label="Tiến độ tải tệp trong chủ đề" />
              </p>
            )}
            <Button
              type="submit"
              disabled={
                busy ||
                readOnly ||
                !isConnected ||
                (!content.trim() && !file && !pendingRef.current)
              }
              loading={busy}
            >
              {pendingRef.current ? "Thử gửi lại" : "Gửi phản hồi"}
            </Button>
            {readOnly && <p>Kênh đã lưu trữ, chỉ xem chủ đề.</p>}
          </form>
        </>
      )}
    </motion.aside>
  );
}
