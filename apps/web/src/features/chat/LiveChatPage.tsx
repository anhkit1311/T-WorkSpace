import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { useDraft } from "../../shared/hooks/useDraft";
import { formatFileSize } from "../../shared/lib/file-size";
import type { ChannelItem, ChatMessageItem, GroupMemberItem, WorkspaceItem } from "@doan/shared";
import {
  createWorkspaceApi,
  getChannelsApi,
  getMessagesApi,
  getWorkspacesApi,
  getWorkspaceMembersApi,
  setChannelPreferenceApi,
  uploadAttachmentApi,
} from "./api";
import { Avatar, Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import "./chat-live.css";
import "./chat-media.css";
import { AttachmentView } from "./ChatAttachment";
import { ThreadPanel, type ChannelMember } from "./ThreadPanel";
import { governanceApi } from "../workspaces/api";

const stickers = [
  { id: "cheer", emoji: "🎉", label: "Ăn mừng" },
  { id: "love", emoji: "🥰", label: "Yêu thích" },
  { id: "great", emoji: "🙌", label: "Tuyệt vời" },
  { id: "laugh", emoji: "🤣", label: "Buồn cười" },
  { id: "focus", emoji: "💪", label: "Cố lên" },
  { id: "thanks", emoji: "🙏", label: "Cảm ơn" },
] as const;

const linkPattern = /https?:\/\/[^\s<>()]+/gi;

function firstLink(text: string): URL | null {
  const candidate = text.match(linkPattern)?.[0]?.replace(/[.,!?;:]+$/, "");
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function MessageText({ content }: { content: string }) {
  const sticker = stickers.find((item) => content === `[[sticker:${item.id}]]`);
  if (sticker)
    return (
      <span className="chat-sticker" role="img" aria-label={`Sticker ${sticker.label}`}>
        <span>{sticker.emoji}</span>
        <small>{sticker.label}</small>
      </span>
    );
  const parts = [];
  let start = 0;
  for (const match of content.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    if (index > start) parts.push(content.slice(start, index));
    const raw = match[0];
    const link = raw.replace(/[.,!?;:]+$/, "");
    const suffix = raw.slice(link.length);
    try {
      const url = new URL(link);
      if (url.protocol === "http:" || url.protocol === "https:")
        parts.push(
          <a key={`${index}-${link}`} href={url.href} target="_blank" rel="noopener noreferrer">
            {link}
          </a>,
        );
      else parts.push(link);
    } catch {
      parts.push(link);
    }
    if (suffix) parts.push(suffix);
    start = index + raw.length;
  }
  if (start < content.length) parts.push(content.slice(start));
  return <>{parts}</>;
}

type OutgoingMessage = {
  mentionedUserIds?: string[];
  clientMessageId: string;
  channelId: string;
  content: string;
  replyToId?: string;
  attachmentId?: string;
  file?: File;
  fileName?: string;
  status: "sending" | "failed";
  error?: string;
  uploadProgress?: number;
};

export function ChatPage() {
  const {
    accessToken,
    user,
    setActiveView,
    route,
    navigate,
    openChannel,
    chatNavigation,
    clearChatNavigation,
  } = useApp();
  const {
    socket,
    isConnected,
    connectionStatus,
    onlineUserIds,
    typingUsers,
    refreshUnreadCount,
    joinChannel,
    leaveChannel,
    sendMessage,
    setTyping,
  } = useSocket();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [channelId, setChannelId] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessageItem[] | null>(null);
  const [searchHighlight, setSearchHighlight] = useState<{
    messageId: string;
    query: string;
  } | null>(null);
  const [editingId, setEditingId] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState("");
  const [members, setMembers] = useState<GroupMemberItem[]>([]);
  const [showStickers, setShowStickers] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(true);
  const [filterTab, setFilterTab] = useState<"all" | "unread" | "groups" | "favorites">("all");
  const [showInChannelSearch, setShowInChannelSearch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [messagesChannelId, setMessagesChannelId] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [outbox, setOutbox, outboxReady] = useDraft<OutgoingMessage[]>(
    `${user?.id ?? "anonymous"}:outbox`,
    [],
  );
  const [mentionMembers, setMentionMembers] = useState<ChannelMember[]>([]);
  const [savedMode, setSavedMode] = useState<"pins" | "bookmarks" | null>(null);
  const savedModeRef = useRef(savedMode);
  savedModeRef.current = savedMode;
  const sendingIdsRef = useRef(new Set<string>());
  const [channelPreviews, setChannelPreviews] = useState<Record<string, ChatMessageItem>>({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [composer, setComposer, draftReady] = useDraft<{
    content: string;
    replyTo: ChatMessageItem | null;
    file: File | null;
    mentions: string[];
  }>(`${user?.id ?? "anonymous"}:channel:${channelId}`, {
    content: "",
    replyTo: null,
    file: null,
    mentions: [],
  });
  const { content, replyTo, file: attachmentFile, mentions: mentionedUserIds } = composer;
  const setContent = (content: string) => setComposer((old) => ({ ...old, content }));
  const setReplyTo = (replyTo: ChatMessageItem | null) =>
    setComposer((old) => ({ ...old, replyTo }));
  const setAttachmentFile = (file: File | null) => setComposer((old) => ({ ...old, file }));
  const setMentionedUserIds = (value: SetStateAction<string[]>) =>
    setComposer((old) => ({
      ...old,
      mentions: typeof value === "function" ? value(old.mentions) : value,
    }));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [revision, setRevision] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isPrependingRef = useRef(false);
  const followNewMessagesRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingCancelledRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const [navigationError, setNavigationError] = useState("");
  useEffect(() => {
    if (outboxReady)
      setOutbox((old) =>
        old.map((item) =>
          item.status === "sending" && !sendingIdsRef.current.has(item.clientMessageId)
            ? {
                ...item,
                status: "failed",
                error: "Lần gửi trước chưa xác nhận. Thử lại dùng cùng mã gửi.",
              }
            : item,
        ),
      );
  }, [outboxReady]);

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const channel = channels.find((c) => c.id === channelId);
  const readOnly = Boolean(workspace?.archivedAt || channel?.archivedAt);
  const isAdmin = workspace?.role === "owner" || workspace?.role === "admin";

  useEffect(() => {
    setMentionMembers([]);
    setSavedMode(null);
    if (!accessToken || !channelId) return;
    let active = true;
    void governanceApi<{ members: ChannelMember[] }>(accessToken, `channels/${channelId}/members`)
      .then((data) => {
        if (active) setMentionMembers(data.members);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken, channelId]);

  const fail = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : "Không thể hoàn tất. Vui lòng thử lại.");

  useEffect(() => {
    if (!savedMode || !accessToken || !channelId) return;
    let active = true;
    setSearchResults([]);
    void governanceApi<{ messages: ChatMessageItem[] }>(
      accessToken,
      `channels/${channelId}/${savedMode}`,
    )
      .then((data) => {
        if (active) setSearchResults(data.messages);
      })
      .catch((reason) => {
        if (active) fail(reason);
      });
    return () => {
      active = false;
    };
  }, [savedMode, accessToken, channelId]);

  useEffect(() => {
    if (!attachmentFile || !attachmentFile.type.startsWith("image/")) {
      setAttachmentPreview("");
      return;
    }
    const url = URL.createObjectURL(attachmentFile);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachmentFile]);

  useEffect(
    () => () => {
      recordingCancelledRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!accessToken || !channelId || !messageSearch.trim()) {
      if (savedMode) return;
      setSearchResults(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      getMessagesApi(accessToken, channelId, 100, undefined, messageSearch)
        .then((items) => {
          if (active) setSearchResults(items);
        })
        .catch((reason) => {
          if (active) fail(reason);
        });
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accessToken, channelId, messageSearch, savedMode]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    setLoading(true);
    getWorkspacesApi(accessToken)
      .then((items) => {
        if (!active) return;
        setWorkspaces(items);
        setWorkspaceId((old) => {
          const target = routeRef.current.workspaceId;
          if (target) return items.some((item) => item.id === target) ? target : "";
          return items.some((item) => item.id === old) ? old : (items[0]?.id ?? "");
        });
        setError("");
      })
      .catch((reason) => {
        if (active) fail(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, revision]);

  useEffect(() => {
    if (loading || route.view !== "chat") return;
    const target = route.workspaceId;
    setNavigationError(
      target && !workspaces.some((item) => item.id === target)
        ? "Nhóm không tồn tại hoặc bạn không còn quyền truy cập liên kết này."
        : "",
    );
    setWorkspaceId(
      target
        ? workspaces.some((item) => item.id === target)
          ? target
          : ""
        : (workspaces[0]?.id ?? ""),
    );
  }, [route.view, route.workspaceId, loading, workspaces]);

  useEffect(() => {
    setChannels([]);
    setChannelId("");
    setMembers([]);
    setMessages([]);
    setChannelPreviews({});
    if (!accessToken || !workspaceId) return;
    let active = true;
    Promise.all([
      getChannelsApi(accessToken, workspaceId),
      getWorkspaceMembersApi(accessToken, workspaceId),
    ])
      .then(([items, people]) => {
        if (!active || routeRef.current.view !== "chat") return;
        const text = items.filter((c) => c.type === "text");
        setChannels(text);
        const target = routeRef.current;
        if (target.workspaceId === workspaceId && target.channelId) {
          const allowed = text.some((item) => item.id === target.channelId);
          setNavigationError(
            allowed
              ? ""
              : "Kênh không tồn tại, không phải kênh chat hoặc bạn không có quyền truy cập.",
          );
          setChannelId(allowed ? target.channelId : "");
        } else {
          setChannelId(text[0]?.id ?? "");
          navigate({ view: "chat", workspaceId, channelId: text[0]?.id }, true);
        }
        setMembers(people);
        setChannelPreviews(
          Object.fromEntries(
            text.filter((item) => item.lastMessage).map((item) => [item.id, item.lastMessage]),
          ) as Record<string, ChatMessageItem>,
        );
      })
      .catch((reason) => {
        if (active) fail(reason);
      });
    return () => {
      active = false;
    };
  }, [accessToken, workspaceId, revision, navigate]);

  useEffect(() => {
    if (route.workspaceId === workspaceId && route.channelId && channels.length) {
      const allowed = channels.some((item) => item.id === route.channelId);
      setNavigationError(allowed ? "" : "Kênh không tồn tại hoặc bạn không có quyền truy cập.");
      setChannelId(allowed ? route.channelId : "");
    }
  }, [route.workspaceId, route.channelId, workspaceId, channels]);

  useEffect(() => {
    setMessages([]);
    setMessagesChannelId(channelId);
    followNewMessagesRef.current = true;
    setHasMore(false);
    setLoadingOlder(false);
    setMessageSearch("");
    if (!accessToken || !channelId) {
      setMessagesLoading(false);
      return;
    }
    let active = true;
    let markReadTimer: number | undefined;
    setMessagesLoading(true);
    const merge = (incoming: ChatMessageItem[]) => {
      const delivered = new Set(
        incoming.filter((item) => item.authorId === user?.id).map((item) => item.clientMessageId),
      );
      setOutbox((previous) => previous.filter((item) => !delivered.has(item.clientMessageId)));
      setMessages((prev) => {
        const ids = new Set(prev.map((item) => item.id));
        const append = incoming.filter((item) => !ids.has(item.id));
        return append.length
          ? [...prev, ...append].sort(
              (a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
                a.id.localeCompare(b.id),
            )
          : prev;
      });
    };

    const markRead = () => {
      window.clearTimeout(markReadTimer);
      if (document.visibilityState !== "visible") return;
      markReadTimer = window.setTimeout(async () => {
        if (!active) return;
        try {
          if (socket?.connected) {
            const response = (await socket
              .timeout(5000)
              .emitWithAck("mark_channel_read", { channelId })) as { success: boolean };
            if (!response.success) throw new Error("Không thể đánh dấu đã xem.");
          } else {
            await setChannelPreferenceApi(accessToken, channelId, { markRead: true });
          }
          if (!active) return;
          setChannels((prev) =>
            prev.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
          );
          void refreshUnreadCount();
        } catch {
          // A later visibility or message event retries the read marker.
        }
      }, 180);
    };
    let latestCursor: string | undefined;
    let recovering = false;
    const recover = async () => {
      if (recovering) return;
      recovering = true;
      try {
        let cursor = latestCursor;
        do {
          const records = await getMessagesApi(
            accessToken,
            channelId,
            cursor ? 100 : 50,
            undefined,
            undefined,
            cursor,
          );
          if (!active) return;
          merge(records);
          cursor = records.at(-1)?.id ?? cursor;
          if (!latestCursor) setHasMore(records.length === 50);
          if (!latestCursor || records.length < 100) break;
        } while (active);
        latestCursor = cursor;
        markRead();
      } catch (reason) {
        if (active) {
          setMessages([]);
          setNavigationError(
            "Không thể đồng bộ lịch sử. Kênh có thể đã bị thu hồi quyền; hãy tải lại hoặc chọn kênh khác.",
          );
          fail(reason);
        }
      } finally {
        recovering = false;
        if (active) setMessagesLoading(false);
      }
    };
    const onConnect = () => {
      joinChannel(channelId);
      void recover();
    };
    if (socket?.connected) onConnect();
    socket?.on("connect", onConnect);
    void recover();

    const onIncoming = (message: ChatMessageItem) => {
      setChannelPreviews((previous) => ({ ...previous, [message.channelId]: message }));
      if (message.channelId === channelId) {
        if (message.threadRootId) {
          void getMessagesApi(accessToken, channelId, 100)
            .then((fresh) => {
              if (!active) return;
              const values = new Map(fresh.map((item) => [item.id, item]));
              setMessages((previous) => previous.map((item) => values.get(item.id) ?? item));
            })
            .catch(() => {});
          return;
        }
        if (message.authorId !== user?.id) {
          const container = chatContainerRef.current;
          followNewMessagesRef.current =
            !container ||
            container.scrollHeight - container.scrollTop - container.clientHeight < 140;
        } else {
          followNewMessagesRef.current = true;
        }
        merge([message]);
        if (message.authorId !== user?.id) markRead();
      } else if (message.authorId !== user?.id) {
        setChannels((previous) =>
          previous.map((c) =>
            c.id === message.channelId ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 } : c,
          ),
        );
      }
    };
    const onChanged = (data: { channelId: string; messageId: string; deleted?: boolean }) => {
      if (workspaceId)
        void getChannelsApi(accessToken, workspaceId)
          .then((fresh) => {
            if (!active) return;
            const text = fresh.filter((item) => item.type === "text");
            setChannelPreviews(
              Object.fromEntries(
                text.filter((item) => item.lastMessage).map((item) => [item.id, item.lastMessage]),
              ) as Record<string, ChatMessageItem>,
            );
          })
          .catch(fail);
      if (data.channelId !== channelId) return;
      if (data.deleted) {
        setMessages((previous) => previous.filter((m) => m.id !== data.messageId));
        setSearchResults((previous) => previous?.filter((m) => m.id !== data.messageId) ?? null);
        return;
      }
      void governanceApi<{ target: ChatMessageItem }>(
        accessToken,
        `messages/${data.messageId}/context`,
      )
        .then(({ target }) => {
          if (!active) return;
          setMessages((previous) =>
            previous.map((item) => (item.id === target.id ? target : item)),
          );
          setSearchResults(
            (previous) =>
              previous
                ?.map((item) => (item.id === target.id ? target : item))
                .filter((item) =>
                  savedModeRef.current === "bookmarks"
                    ? item.bookmarked
                    : savedModeRef.current === "pins"
                      ? item.pinned
                      : true,
                ) ?? null,
          );
        })
        .catch(() => {});
      void getMessagesApi(accessToken, channelId, 100)
        .then((fresh) => {
          if (!active) return;
          const byId = new Map(fresh.map((m) => [m.id, m]));
          setMessages((previous) => previous.map((m) => byId.get(m.id) ?? m));
          setSearchResults((previous) => previous?.map((m) => byId.get(m.id) ?? m) ?? null);
        })
        .catch(fail);
    };
    socket?.on("new_message", onIncoming);
    const onRevoked = () => {
      setMessages([]);
      setSearchResults(null);
      setChannels([]);
      setMembers([]);
      setChannelPreviews({});
      setNavigationError(
        "Quyền thành viên đã thay đổi. Hãy kết nối lại để tải danh sách kênh được phép truy cập.",
      );
      setRevision((previous) => previous + 1);
    };
    socket?.on("access_revoked", onRevoked);
    socket?.on("message_changed", onChanged);
    const onChannelRead = (data: { channelId: string }) => {
      if (data.channelId !== channelId) return;
      void getMessagesApi(accessToken, channelId, 100)
        .then((fresh) => {
          if (!active) return;
          const counts = new Map(fresh.map((m) => [m.id, m.seenCount]));
          setMessages((previous) =>
            previous.map((m) => (counts.has(m.id) ? { ...m, seenCount: counts.get(m.id) } : m)),
          );
        })
        .catch(() => {});
    };
    socket?.on("channel_read", onChannelRead);
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearTimeout(markReadTimer);
      document.removeEventListener("visibilitychange", onVisible);
      if (socket) leaveChannel(channelId);
      socket?.off("connect", onConnect);
      socket?.off("new_message", onIncoming);
      socket?.off("access_revoked", onRevoked);
      socket?.off("message_changed", onChanged);
      socket?.off("channel_read", onChannelRead);
    };
  }, [
    accessToken,
    channelId,
    workspaceId,
    joinChannel,
    leaveChannel,
    refreshUnreadCount,
    socket,
    user?.id,
  ]);

  useEffect(() => {
    if (chatNavigation?.channelId !== channelId) return;
    clearChatNavigation();
  }, [chatNavigation, channelId, clearChatNavigation]);

  useEffect(() => {
    if (!accessToken || route.channelId !== channelId || !route.messageId) return;
    let active = true;
    setMessageSearch("");
    setSavedMode(null);
    void governanceApi<{ target: ChatMessageItem; messages: ChatMessageItem[] }>(
      accessToken,
      `messages/${route.messageId}/context`,
    )
      .then((data) => {
        if (!active) return;
        setSearchResults(data.messages);
        setSearchHighlight({ messageId: data.target.id, query: "" });
        if (data.target.threadRootId && !route.threadId)
          navigate(
            { ...route, messageId: data.target.threadRootId, threadId: data.target.threadRootId },
            true,
          );
      })
      .catch((reason) => {
        if (active) {
          setSearchResults([]);
          fail(reason);
        }
      });
    return () => {
      active = false;
    };
  }, [route.channelId, route.messageId, route.threadId, channelId, accessToken, navigate]);

  useEffect(() => {
    if (
      !searchResults ||
      messagesLoading ||
      !searchHighlight ||
      (!route.messageId && messageSearch !== searchHighlight.query)
    )
      return;
    const target = Array.from(
      chatContainerRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((element) => element.dataset.messageId === searchHighlight.messageId);
    if (target) target.scrollIntoView({ block: "center" });
  }, [searchResults, messagesLoading, searchHighlight, channelId, messageSearch]);

  useEffect(() => {
    if (isPrependingRef.current) {
      isPrependingRef.current = false;
      return;
    }
    if (followNewMessagesRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
    followNewMessagesRef.current = false;
  }, [messages]);

  async function loadOlderMessages() {
    if (!accessToken || !channelId || loadingOlder || !hasMore || !messages.length) return;
    const oldest = messages[0];
    setLoadingOlder(true);
    const container = chatContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    try {
      const older = await getMessagesApi(accessToken, channelId, 50, oldest.id);
      setHasMore(older.length === 50);
      if (older.length > 0) {
        isPrependingRef.current = true;
        setMessages((prev) => {
          const ids = new Set(prev.map((item) => item.id));
          const uniqueOlder = older.filter((item) => !ids.has(item.id));
          return [...uniqueOlder, ...prev];
        });
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
          }
        });
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    await mutate(async () => {
      const created = await createWorkspaceApi(accessToken, name.trim());
      setWorkspaces((prev) => [created, ...prev]);
      openChannel(created.id);
      setWorkspaceId(created.id);
      setName("");
      setRevision((r) => r + 1);
    });
  }

  async function submit(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = content.trim();
    if (
      (!text && !attachmentFile) ||
      !channelId ||
      !isConnected ||
      busy ||
      sending ||
      readOnly ||
      !draftReady
    )
      return;
    const draft: OutgoingMessage = {
      clientMessageId: crypto.randomUUID(),
      channelId,
      content: text,
      replyToId: replyTo?.id,
      mentionedUserIds,
      file: attachmentFile ?? undefined,
      fileName: attachmentFile?.name,
      status: "sending",
    };
    setOutbox((previous) => [...previous, draft]);
    setContent("");
    setMentionedUserIds([]);
    setReplyTo(null);
    setAttachmentFile(null);
    if (composerRef.current) composerRef.current.style.height = "";
    setTyping(channelId, false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    await deliver(draft);
  }

  async function deliver(draft: OutgoingMessage) {
    if (!accessToken || sendingIdsRef.current.has(draft.clientMessageId)) return;
    sendingIdsRef.current.add(draft.clientMessageId);
    setSending(true);
    setError("");
    setOutbox((previous) =>
      previous.map((item) =>
        item.clientMessageId === draft.clientMessageId
          ? { ...item, status: "sending", error: undefined }
          : item,
      ),
    );
    try {
      if (draft.file && !draft.attachmentId) {
        const attachment = await uploadAttachmentApi(
          accessToken,
          draft.channelId,
          draft.file,
          (uploadProgress) =>
            setOutbox((old) =>
              old.map((item) =>
                item.clientMessageId === draft.clientMessageId ? { ...item, uploadProgress } : item,
              ),
            ),
        );
        draft.attachmentId = attachment.id;
        setOutbox((previous) =>
          previous.map((item) =>
            item.clientMessageId === draft.clientMessageId
              ? { ...item, attachmentId: attachment.id }
              : item,
          ),
        );
      }
      const message = await sendMessage(draft.channelId, draft.content, {
        clientMessageId: draft.clientMessageId,
        replyToId: draft.replyToId,
        attachmentId: draft.attachmentId,
        mentionedUserIds: draft.mentionedUserIds,
      });
      setOutbox((previous) =>
        previous.filter((item) => item.clientMessageId !== draft.clientMessageId),
      );
      if (routeRef.current.channelId === draft.channelId) {
        followNewMessagesRef.current = true;
        setMessages((previous) =>
          previous.some((item) => item.id === message.id) ? previous : [...previous, message],
        );
      }
      setChannelPreviews((previous) => ({ ...previous, [draft.channelId]: message }));
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "Không thể gửi tin.";
      setOutbox((previous) =>
        previous.map((item) =>
          item.clientMessageId === draft.clientMessageId
            ? { ...item, attachmentId: draft.attachmentId, status: "failed", error }
            : item,
        ),
      );
    } finally {
      sendingIdsRef.current.delete(draft.clientMessageId);
      setSending(sendingIdsRef.current.size > 0);
    }
  }

  function chooseAttachment(file?: File) {
    if (!file) return;
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "audio/mpeg",
      "application/pdf",
      "text/plain",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.type)) setError("Định dạng tệp chưa được hỗ trợ.");
    else if (file.size > 8_000_000) setError("Tệp tối đa 8 MB.");
    else {
      setError("");
      setAttachmentFile(file);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Trình duyệt này chưa hỗ trợ ghi âm.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        setError("Trình duyệt chưa hỗ trợ định dạng ghi âm cần thiết.");
        return;
      }
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingCancelledRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
        setRecording(false);
        if (recordingCancelledRef.current) return;
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) setError("Không thu được âm thanh. Vui lòng thử lại.");
        else if (blob.size > 8_000_000) setError("Bản ghi vượt quá 8 MB. Hãy ghi ngắn hơn.");
        else
          chooseAttachment(
            new File([blob], `ghi-am-${Date.now()}.${mimeType.split("/")[1]}`, { type: mimeType }),
          );
      };
      recorder.start(1000);
      setRecording(true);
      setError("");
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 120_000);
    } catch {
      setError("Không thể dùng micro. Hãy kiểm tra quyền truy cập micro.");
    }
  }

  function stopRecording(cancel = false) {
    recordingCancelledRef.current = cancel;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function sendSticker(id: string) {
    if (!channelId || !isConnected || sending || busy || readOnly) return;
    setShowStickers(false);
    const draft: OutgoingMessage = {
      clientMessageId: crypto.randomUUID(),
      channelId,
      content: `[[sticker:${id}]]`,
      replyToId: replyTo?.id,
      status: "sending",
    };
    setOutbox((previous) => [...previous, draft]);
    setReplyTo(null);
    await deliver(draft);
  }

  function messageAction(
    event: "edit_message" | "delete_message" | "react_message",
    data: Record<string, string>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!socket?.connected) {
        reject(new Error("Chưa kết nối máy chủ."));
        return;
      }
      socket
        .timeout(10000)
        .emit(
          event,
          data,
          (timeoutError: Error | null, result: { success: boolean; error?: string }) => {
            if (timeoutError || !result?.success)
              reject(new Error(result?.error || "Thao tác chưa được xác nhận."));
            else resolve();
          },
        );
    });
  }

  async function saveEdit(id: string) {
    const text = editingContent.trim();
    if (!text) return;
    try {
      await messageAction("edit_message", { messageId: id, content: text });
      setEditingId("");
    } catch (reason) {
      fail(reason);
    }
  }

  async function removeMessage(id: string) {
    if (!window.confirm("Xóa tin nhắn này?")) return;
    try {
      await messageAction("delete_message", { messageId: id });
    } catch (reason) {
      fail(reason);
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  async function addMember(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !workspaceId) return;
    await mutate(async () => {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL ?? ""}/api/workspaces/${workspaceId}/members/add`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: "include",
          body: JSON.stringify({ email: email.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Không thể thêm thành viên.");
      setMembers(await getWorkspaceMembersApi(accessToken, workspaceId));
      setEmail("");
    });
  }

  const totalUnread = useMemo(
    () => channels.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0),
    [channels],
  );

  const filteredChannels = useMemo(() => {
    return channels
      .filter((c) => {
        const matches = c.name.toLowerCase().includes(channelSearch.toLowerCase());
        if (!matches) return false;
        if (filterTab === "unread") return Boolean(c.unreadCount);
        if (filterTab === "favorites") return Boolean(c.pinned);
        return true;
      })
      .sort(
        (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.position - b.position,
      );
  }, [channels, channelSearch, filterTab]);

  const visibleMessages = searchResults ?? messages;
  const draftLink = firstLink(content);
  const pinnedMessage = messages.find((m) => m.pinned);

  return (
    <section className="live-chat" aria-label="Tin nhắn nhóm">
      {/* 1. Panel: Conversation List matching mockup */}
      <aside className="live-chat-nav">
        <div className="live-chat-nav__header">
          <h2 className="chat-nav-title">Tin nhắn</h2>
          <button
            type="button"
            className="chat-nav-compose-btn"
            title="Tạo nhóm mới"
            onClick={() => {
              const summary = document.querySelector(
                ".live-chat-create-group summary",
              ) as HTMLElement;
              summary?.click();
            }}
          >
            <Icon name="edit" size={17} />
          </button>
        </div>

        {/* Search Input Pill */}
        <div className="chat-search-pill-box">
          <Icon name="search" size={15} />
          <input
            type="text"
            className="chat-search-pill-input"
            aria-label="Tìm kiếm cuộc trò chuyện"
            placeholder="Tìm kiếm cuộc trò chuyện…"
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
          />
        </div>

        {/* Filter Tabs Pill Row */}
        <div className="chat-nav-filter-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "all"}
            className={`chat-filter-pill ${filterTab === "all" ? "is-active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            Tất cả
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "unread"}
            className={`chat-filter-pill ${filterTab === "unread" ? "is-active" : ""}`}
            onClick={() => setFilterTab("unread")}
          >
            Chưa đọc
            {totalUnread > 0 && <span className="filter-badge-red">{totalUnread}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "groups"}
            className={`chat-filter-pill ${filterTab === "groups" ? "is-active" : ""}`}
            onClick={() => setFilterTab("groups")}
          >
            Nhóm
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "favorites"}
            className={`chat-filter-pill ${filterTab === "favorites" ? "is-active" : ""}`}
            onClick={() => setFilterTab("favorites")}
          >
            Yêu thích
          </button>
        </div>

        {/* Workspaces selector dropdown */}
        {workspaces.length > 1 && (
          <div className="chat-workspace-selector-row">
            <select
              className="chat-workspace-select-pill"
              value={workspaceId}
              disabled={busy}
              onChange={(e) => openChannel(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="chat-channels-scroll" aria-label="Danh sách kênh">
          {filteredChannels.length === 0 ? (
            <p className="live-chat-nav__empty">
              {channels.length === 0 ? "Nhóm chưa có kênh nào" : "Không tìm thấy cuộc trò chuyện"}
            </p>
          ) : (
            filteredChannels.map((c: ChannelItem) => {
              const latest = channelPreviews[c.id];
              const formattedTime = latest
                ? new Date(latest.createdAt).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";

              return (
                <div key={c.id} className="chat-conversation-item-wrap">
                  <button
                    type="button"
                    className={`chat-conversation-card ${c.id === channelId ? "is-active" : ""}`}
                    aria-current={c.id === channelId ? "page" : undefined}
                    disabled={busy}
                    onClick={() => openChannel(workspaceId, c.id)}
                  >
                    <div className="chat-convo-avatar">
                      <Avatar name={c.name} size="md" />
                    </div>
                    <div className="chat-convo-info">
                      <div className="chat-convo-top">
                        <strong className="chat-convo-name">{c.name}</strong>
                        {formattedTime && <time dateTime={latest?.createdAt}>{formattedTime}</time>}
                      </div>
                      <div className="chat-convo-bottom">
                        <span className="chat-convo-preview">
                          {latest ? (
                            <>
                              {latest.authorId === user?.id ? "Bạn: " : ""}
                              {latest.content || (latest.attachment ? "Đã gửi tệp đính kèm" : "")}
                            </>
                          ) : (
                            "Chưa có tin nhắn mới"
                          )}
                        </span>
                        {c.unreadCount ? (
                          <span
                            className="chat-unread-badge-circle"
                            aria-label={`${c.unreadCount} tin chưa đọc`}
                          >
                            {c.unreadCount}
                          </span>
                        ) : c.pinned ? (
                          <Icon name="star" size={13} className="chat-pinned-star-icon" />
                        ) : null}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </nav>

        <details className="live-chat-create-group">
          <summary>Tạo nhóm mới</summary>
          <form onSubmit={createGroup}>
            <label>
              Tên nhóm
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tên nhóm mới…"
              />
            </label>
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              Tạo nhóm
            </Button>
          </form>
        </details>
      </aside>

      {/* 2. Main Chat Area matching mockup */}
      <div className="live-chat-main">
        {readOnly && (
          <p role="status" className="chat-compose-preview">
            Nhóm hoặc kênh đã lưu trữ: chỉ xem lịch sử, không thể gửi hay sửa tin nhắn.
          </p>
        )}
        {navigationError && (
          <div className="live-chat-error" role="alert">
            <strong>Không thể mở liên kết</strong>
            <p>{navigationError}</p>
            <button onClick={() => setActiveView("overview")}>Về trang chủ</button>
          </div>
        )}

        {/* Header matching mockup */}
        <header className="chat-main-header">
          <div className="chat-header-identity">
            <div className="chat-header-avatar">
              <Avatar name={channel?.name || workspace?.name || "Kênh"} size="md" />
            </div>
            <div className="chat-header-title-box">
              <h2 className="chat-header-room-name">
                {channel ? channel.name : workspace?.name || "Kênh"}
              </h2>
              <span className="chat-header-room-subtitle">
                {members.length} thành viên •{" "}
                {isConnected
                  ? `${members.filter((m) => onlineUserIds.includes(m.userId)).length} đang trực tuyến`
                  : connectionStatus === "disconnected"
                    ? "Mất kết nối"
                    : "Đang kết nối lại…"}
              </span>
            </div>
          </div>

          <div className="chat-header-action-group">
            <button
              type="button"
              className={`chat-header-icon-btn ${showInChannelSearch ? "is-active" : ""}`}
              title="Tìm trong cuộc trò chuyện"
              aria-label="Tìm kiếm"
              onClick={() => setShowInChannelSearch((prev) => !prev)}
            >
              <Icon name="search" size={17} />
            </button>
            <button
              type="button"
              className="chat-header-icon-btn"
              title="Gọi nhóm"
              aria-label="Gọi thoại"
              onClick={() => setActiveView("meetings")}
            >
              <Icon name="phone" size={17} />
            </button>
            <button
              type="button"
              className="chat-header-icon-btn"
              title="Phòng họp video SFU"
              aria-label="Cuộc họp video"
              onClick={() => setActiveView("meetings")}
            >
              <Icon name="video" size={17} />
            </button>
            <button
              type="button"
              className={`chat-header-icon-btn ${showInfoPanel ? "is-active" : ""}`}
              title="Thông tin nhóm"
              aria-label="Thông tin nhóm"
              onClick={() => setShowInfoPanel(!showInfoPanel)}
            >
              <Icon name="more" size={17} />
            </button>
          </div>
        </header>

        {/* Pinned Message Banner matching mockup */}
        <div
          className="chat-pinned-banner"
          onClick={() => {
            setMessageSearch("");
            setSavedMode("pins");
          }}
          role="button"
          tabIndex={0}
        >
          <div className="chat-pinned-banner-left">
            <div className="chat-pinned-pin-icon-circle">
              <Icon name="pin" size={15} />
            </div>
            <div className="chat-pinned-text">
              <strong>Tin nhắn ghim</strong>
              <span>
                {pinnedMessage?.content ||
                  "Lịch kiểm tra giữa kỳ và các tài liệu ôn tập quan trọng."}
              </span>
            </div>
          </div>
          <Icon name="chevron-right" size={16} />
        </div>

        {channel && (showInChannelSearch || messageSearch) && (
          <div className="chat-message-search">
            <Icon name="search" size={14} />
            <input
              id="message-search"
              type="search"
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              placeholder="Tìm nội dung trong kênh…"
              aria-label="Tìm tin nhắn trong kênh"
            />
            {searchResults && (
              <span>
                {route.messageId
                  ? "Ngữ cảnh tin nhắn"
                  : savedMode === "pins"
                    ? "Tin được ghim"
                    : savedMode === "bookmarks"
                      ? "Đã đánh dấu"
                      : `${searchResults.length} kết quả gần nhất`}
              </span>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "10px 24px",
              background: "rgba(239, 68, 68, 0.1)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
            role="alert"
          >
            <span>{error}</span>
            <Button size="sm" variant="ghost" onClick={() => setRevision((n) => n + 1)}>
              Tải lại
            </Button>
          </div>
        )}

        {/* Messages List */}
        <div
          ref={chatContainerRef}
          className="chat-messages"
          role="log"
          aria-label="Lịch sử tin nhắn"
          aria-live="polite"
        >
          {!searchResults && messagesChannelId === channelId && hasMore && messages.length > 0 && (
            <div className="chat-load-more-wrap">
              <button
                type="button"
                className="chat-load-more-btn"
                onClick={() => void loadOlderMessages()}
                disabled={loadingOlder}
              >
                {loadingOlder ? "Đang tải tin nhắn cũ hơn…" : "Tải tin nhắn cũ hơn"}
              </button>
            </div>
          )}
          {loading || messagesLoading || (channelId && messagesChannelId !== channelId) ? (
            <p
              role="status"
              style={{ textAlign: "center", color: "var(--editorial-text-muted)", margin: "auto" }}
            >
              Đang tải cuộc trò chuyện…
            </p>
          ) : !workspace ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <Icon name="users" size={24} />
              </div>
              <h3>Bắt đầu cộng tác nhóm</h3>
              <p>Tạo nhóm mới hoặc nhờ Quản trị viên thêm bạn để bắt đầu trao đổi tin nhắn.</p>
            </div>
          ) : !channel ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <Icon name="message" size={24} />
              </div>
              <h3>Chưa chọn cuộc trò chuyện</h3>
              <p>Chọn một kênh ở bên trái để xem tin nhắn hoặc tạo nhóm làm việc mới.</p>
            </div>
          ) : !visibleMessages.length ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <Icon name="message" size={24} />
              </div>
              <h3>
                {messageSearch
                  ? "Không tìm thấy tin nhắn"
                  : channel
                    ? `Chào mừng đến với #${channel.name}`
                    : "Chưa có kênh văn bản"}
              </h3>
              <p>
                {messageSearch
                  ? "Thử một từ khóa khác."
                  : "Gửi tin nhắn đầu tiên để bắt đầu cuộc trò chuyện với mọi người trong nhóm."}
              </p>
            </div>
          ) : (
            visibleMessages.map((m, index) => {
              const isMine = m.authorId === user?.id;
              const previous = visibleMessages[index - 1];
              const dateKey = new Date(m.createdAt).toDateString();
              const showDate = !previous || new Date(previous.createdAt).toDateString() !== dateKey;
              const formattedTime = new Date(m.createdAt).toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <Fragment key={m.id}>
                  {showDate && (
                    <div className="chat-date-separator">
                      <span>
                        {new Date(m.createdAt).toDateString() === new Date().toDateString()
                          ? "Hôm nay"
                          : new Date(m.createdAt).toLocaleDateString("vi-VN", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                      </span>
                    </div>
                  )}
                  <article
                    data-message-id={m.id}
                    className={`message-item ${isMine ? "is-mine" : "is-incoming"} ${searchHighlight?.messageId === m.id ? "is-search-target" : ""}`}
                  >
                    {!isMine && (
                      <div className="message-author-avatar">
                        <Avatar name={m.authorName} size="sm" />
                      </div>
                    )}
                    <div className="message-item__body">
                      {!isMine && <span className="chat-author-name-tag">{m.authorName}</span>}
                      {m.replyToId && (
                        <div className="chat-reply-quote">
                          <Icon name="arrow-right" size={12} />{" "}
                          {m.replyToContent || "Tin nhắn đã xóa"}
                        </div>
                      )}
                      {editingId === m.id ? (
                        <div className="chat-edit-box">
                          <textarea
                            value={editingContent}
                            maxLength={4000}
                            onChange={(event) => setEditingContent(event.target.value)}
                          />
                          <div>
                            <button type="button" onClick={() => setEditingId("")}>
                              Hủy
                            </button>
                            <button type="button" onClick={() => void saveEdit(m.id)}>
                              Lưu
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="message-bubble">
                          {m.content && <MessageText content={m.content.trim()} />}
                          {m.attachment && accessToken && (
                            <AttachmentView attachment={m.attachment} accessToken={accessToken} />
                          )}
                        </div>
                      )}

                      {/* Reactions dock matching mockup */}
                      <div className="chat-reactions-dock">
                        {m.reactions &&
                          m.reactions.length > 0 &&
                          m.reactions.map((reaction) => (
                            <button
                              type="button"
                              key={reaction.emoji}
                              className={`chat-reaction-chip ${reaction.reacted ? "is-active" : ""}`}
                              aria-label={`${reaction.emoji} ${reaction.count} cảm xúc`}
                              onClick={() =>
                                void messageAction("react_message", {
                                  messageId: m.id,
                                  emoji: reaction.emoji,
                                }).catch(fail)
                              }
                            >
                              <span>{reaction.emoji}</span> <b>{reaction.count}</b>
                            </button>
                          ))}
                        <button
                          type="button"
                          className="chat-reaction-add-btn"
                          title="Thả cảm xúc"
                          onClick={() =>
                            void messageAction("react_message", {
                              messageId: m.id,
                              emoji: "❤️",
                            }).catch(fail)
                          }
                        >
                          <Icon name="smile" size={13} />
                        </button>
                      </div>

                      <div className="message-item__meta">
                        <time dateTime={m.createdAt}>{formattedTime}</time>
                        {m.editedAt && <span>· đã sửa</span>}
                        {isMine && <span className="message-check-icon">✓✓</span>}
                      </div>

                      <div className="chat-message-actions">
                        <button
                          type="button"
                          title="Trả lời"
                          aria-label="Trả lời tin nhắn"
                          onClick={() => {
                            setReplyTo(m);
                            composerRef.current?.focus();
                          }}
                        >
                          <Icon name="arrow-right" size={13} />
                        </button>
                        {(["👍", "❤️", "😂"] as const).map((emoji) => (
                          <button
                            type="button"
                            title={`Thả cảm xúc ${emoji}`}
                            aria-label={`Thả cảm xúc ${emoji}`}
                            key={emoji}
                            onClick={() =>
                              void messageAction("react_message", { messageId: m.id, emoji }).catch(
                                fail,
                              )
                            }
                          >
                            {emoji}
                          </button>
                        ))}
                        {isMine && (
                          <button
                            type="button"
                            title="Xóa tin"
                            aria-label="Xóa tin nhắn"
                            onClick={() => void removeMessage(m.id)}
                          >
                            <Icon name="x" size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                </Fragment>
              );
            })
          )}
          <div ref={end} />
        </div>

        {/* Typing indicator */}
        <div className="live-chat-typing" role="status">
          {typingUsers.some((t) => t.channelId === channelId && t.userId !== user?.id) && (
            <span>
              {typingUsers
                .filter((t) => t.channelId === channelId && t.userId !== user?.id)
                .map((t) => t.displayName)
                .join(", ")}{" "}
              đang nhập…
            </span>
          )}
        </div>

        {/* Floating Bottom Compose Dock matching mockup */}
        <fieldset
          className="live-chat-compose-container"
          disabled={readOnly}
          style={{ border: 0, minWidth: 0, margin: 0 }}
        >
          {replyTo && (
            <div className="chat-compose-preview">
              <span>
                Đang trả lời <strong>{replyTo.authorName}</strong>: {replyTo.content}
              </span>
              <button type="button" aria-label="Bỏ trả lời" onClick={() => setReplyTo(null)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {attachmentFile && (
            <div className="chat-compose-preview">
              {attachmentPreview && <img src={attachmentPreview} alt="Xem trước ảnh sẽ gửi" />}
              <span>
                {attachmentFile.name} · {formatFileSize(attachmentFile.size)}
              </span>
              <button
                type="button"
                aria-label="Bỏ tệp đính kèm"
                onClick={() => setAttachmentFile(null)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {recording && (
            <div className="chat-recording-banner" role="status">
              <span className="chat-recording-dot" />
              Đang ghi âm · tự dừng sau 2 phút
              <button type="button" onClick={() => stopRecording(true)}>
                Hủy
              </button>
            </div>
          )}
          {draftLink && (
            <div className="chat-compose-preview chat-link-preview">
              <Icon name="link" size={15} />
              <span>
                Liên kết sẽ gửi: <strong>{draftLink.hostname}</strong> ·{" "}
                {draftLink.pathname === "/" ? draftLink.href : draftLink.pathname}
              </span>
            </div>
          )}
          {outbox
            .filter((item) => item.channelId === channelId)
            .map((draft) => (
              <div
                key={draft.clientMessageId}
                className={`chat-send-error-banner ${draft.status === "failed" ? "is-failed" : ""}`}
                role={draft.status === "failed" ? "alert" : "status"}
              >
                <span>
                  <strong>{draft.status === "sending" ? "Đang gửi…" : "Gửi lỗi"}</strong> ·{" "}
                  {draft.content || draft.fileName}
                  {draft.error && <small> · {draft.error}</small>}
                  {draft.file && !draft.attachmentId && draft.status === "sending" && (
                    <span>
                      {" "}
                      · Tải tệp {draft.uploadProgress ?? 0}%{" "}
                      <progress
                        max={100}
                        value={draft.uploadProgress ?? 0}
                        aria-label="Tiến độ tải tệp"
                      />
                    </span>
                  )}
                </span>
                {draft.status === "failed" && (
                  <button
                    type="button"
                    onClick={() =>
                      setOutbox((old) =>
                        old.filter((item) => item.clientMessageId !== draft.clientMessageId),
                      )
                    }
                  >
                    Bỏ lần gửi
                  </button>
                )}
                {draft.status === "failed" && (
                  <button
                    type="button"
                    className="chat-retry-send-btn"
                    disabled={!isConnected || sending}
                    onClick={() => void deliver(draft)}
                  >
                    Thử gửi lại
                  </button>
                )}
              </div>
            ))}

          <form className="chat-floating-dock-form" onSubmit={submit}>
            <button
              type="button"
              className="chat-dock-circle-btn"
              title="Đính kèm tệp"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="plus" size={18} />
            </button>

            <textarea
              id="chat-message"
              ref={composerRef}
              className="chat-dock-textarea"
              maxLength={4000}
              rows={1}
              disabled={!channel || busy || sending || readOnly || !draftReady}
              placeholder={!isConnected ? "Mất kết nối. Đang thử lại…" : "Nhập tin nhắn…"}
              value={content}
              onKeyDown={handleKeyDown}
              onInput={(event) => {
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
              }}
              onChange={(e) => {
                setContent(e.target.value);
                setTyping(channelId, Boolean(e.target.value.trim()));
                if (typingTimer.current) clearTimeout(typingTimer.current);
                typingTimer.current = setTimeout(() => setTyping(channelId, false), 1500);
              }}
            />

            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,application/zip,.docx,.pptx,.xlsx"
              onChange={(event) => {
                chooseAttachment(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <div className="chat-dock-actions-row">
              <div className="chat-sticker-control">
                <button
                  type="button"
                  className="chat-dock-icon-btn"
                  title="Biểu cảm"
                  aria-label="Chọn sticker"
                  aria-expanded={showStickers}
                  disabled={!channel || sending}
                  onClick={() => setShowStickers((value) => !value)}
                >
                  <Icon name="smile" size={18} />
                </button>
                {showStickers && (
                  <div className="chat-sticker-picker" role="group" aria-label="Chọn sticker">
                    {stickers.map((sticker) => (
                      <button
                        key={sticker.id}
                        type="button"
                        title={sticker.label}
                        onClick={() => void sendSticker(sticker.id)}
                      >
                        <span>{sticker.emoji}</span>
                        <small>{sticker.label}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="chat-dock-icon-btn"
                title="Đính kèm tệp"
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="paperclip" size={18} />
              </button>
              <button
                type="button"
                className={`chat-dock-icon-btn ${recording ? "is-recording" : ""}`}
                title="Tin nhắn thoại"
                onClick={() => (recording ? stopRecording() : void startRecording())}
              >
                <Icon name="mic" size={18} />
              </button>
              <button
                type="submit"
                className="chat-dock-send-btn"
                title="Gửi tin nhắn"
                disabled={
                  !isConnected ||
                  !channel ||
                  (!content.trim() && !attachmentFile) ||
                  busy ||
                  sending
                }
              >
                <Icon name="send" size={16} />
              </button>
            </div>
          </form>
        </fieldset>

        {route.threadId && (
          <ThreadPanel
            key={route.threadId}
            rootId={route.threadId}
            channelId={channelId}
            members={mentionMembers}
            readOnly={readOnly}
            onClose={() => navigate({ ...route, threadId: undefined })}
          />
        )}
      </div>

      {/* 3. Panel: Right "Thông tin nhóm" Card matching mockup */}
      {showInfoPanel && (
        <aside className="live-chat-info-panel" aria-label="Thông tin nhóm">
          <div className="chat-info-head">
            <h3>Thông tin nhóm</h3>
            <button
              type="button"
              className="chat-info-close-btn"
              title="Đóng thông tin nhóm"
              onClick={() => setShowInfoPanel(false)}
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="chat-info-scrollable">
            <div className="chat-info-identity-card">
              <div className="chat-info-avatar-large">
                <Avatar name={channel?.name || workspace?.name || "Kênh"} size="lg" />
              </div>
              <h2 className="chat-info-title">
                {channel ? channel.name : workspace?.name || "Kênh"}
              </h2>
              <span className="chat-info-member-subtitle">{members.length} thành viên</span>
            </div>

            <div className="chat-info-action-row">
              <button
                type="button"
                className="chat-info-circle-action"
                title="Gọi nhóm"
                onClick={() => setActiveView("meetings")}
              >
                <div className="circle-action-icon">
                  <Icon name="phone" size={18} />
                </div>
                <span>Gọi nhóm</span>
              </button>

              <button
                type="button"
                className="chat-info-circle-action"
                title="Cuộc họp video"
                onClick={() => setActiveView("meetings")}
              >
                <div className="circle-action-icon">
                  <Icon name="video" size={18} />
                </div>
                <span>Video</span>
              </button>

              <button
                type="button"
                className="chat-info-circle-action"
                title="Thêm thành viên"
                onClick={() => setShowMembers(true)}
              >
                <div className="circle-action-icon">
                  <Icon name="user-plus" size={18} />
                </div>
                <span>Thêm</span>
              </button>

              <button
                type="button"
                className="chat-info-circle-action"
                title="Tìm kiếm"
                onClick={() => document.getElementById("message-search")?.focus()}
              >
                <div className="circle-action-icon">
                  <Icon name="search" size={18} />
                </div>
                <span>Tìm kiếm</span>
              </button>
            </div>

            <div className="chat-info-desc-box">
              <div className="chat-info-desc-content">
                <strong>Mô tả</strong>
                <p>
                  Không gian trao đổi học tập và sinh hoạt của{" "}
                  {channel ? channel.name : workspace?.name || "Kênh"}.
                </p>
              </div>
              <Icon name="chevron-right" size={16} />
            </div>

            <div className="chat-info-menu-list">
              <button
                type="button"
                className="chat-info-menu-item"
                onClick={() => setShowMembers(!showMembers)}
              >
                <div className="menu-item-left">
                  <Icon name="users" size={18} />
                  <span>Thành viên</span>
                </div>
                <div className="menu-item-right">
                  <span className="menu-item-badge">{members.length}</span>
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>

              {showMembers && (
                <div className="chat-info-members-list">
                  {members.map((m) => (
                    <div key={m.userId} className="chat-info-member-pill">
                      <Avatar name={m.displayName} size="sm" />
                      <div className="member-pill-text">
                        <strong>{m.displayName}</strong>
                        <small>
                          {m.role === "owner"
                            ? "Chủ nhóm"
                            : m.role === "admin"
                              ? "Quản trị viên"
                              : "Thành viên"}
                        </small>
                      </div>
                      <span className="chat-profile-presence member-pill-presence">
                        <i className={onlineUserIds.includes(m.userId) ? "is-online" : ""} />
                        {onlineUserIds.includes(m.userId) ? "Trực tuyến" : "Ngoại tuyến"}
                      </span>
                    </div>
                  ))}
                  {isAdmin && (
                    <form className="chat-info-add-member-form" onSubmit={addMember}>
                      <input
                        type="email"
                        placeholder="Nhập email thành viên…"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                      <Button size="sm" type="submit" disabled={busy}>
                        Thêm
                      </Button>
                    </form>
                  )}
                </div>
              )}

              <button
                type="button"
                className="chat-info-menu-item"
                onClick={() => {
                  setMessageSearch("");
                  setSavedMode("bookmarks");
                }}
              >
                <div className="menu-item-left">
                  <Icon name="file" size={18} />
                  <span>Tệp tin</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>

              <button type="button" className="chat-info-menu-item">
                <div className="menu-item-left">
                  <Icon name="image" size={18} />
                  <span>Ảnh & video</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>

              <button
                type="button"
                className="chat-info-menu-item"
                onClick={() => {
                  setMessageSearch("");
                  setSavedMode("pins");
                }}
              >
                <div className="menu-item-left">
                  <Icon name="pin" size={18} />
                  <span>Tin nhắn ghim</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>

              <button type="button" className="chat-info-menu-item">
                <div className="menu-item-left">
                  <Icon name="link" size={18} />
                  <span>Liên kết</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>

              <button
                type="button"
                className="chat-info-menu-item"
                onClick={() => workspace && navigate({ view: "admin", workspaceId: workspace.id })}
              >
                <div className="menu-item-left">
                  <Icon name="settings" size={18} />
                  <span>Cài đặt nhóm</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>
            </div>
          </div>
        </aside>
      )}
    </section>
  );
}
