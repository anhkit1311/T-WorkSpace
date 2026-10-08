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
import { AnimatePresence, motion } from "motion/react";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import { DURATION, EASE } from "../../shared/motion/tokens";
import { ReactionCount } from "../../shared/motion/AnimatedCount";
import { ambientBridge } from "../../shared/motion/AmbientBackdrop";
import { useSendFeedback } from "../../shared/motion/useControlMotion";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { channelScroll, rememberChannelScroll } from "../../shared/lib/channel-scroll";
import { formatFileSize } from "../../shared/lib/file-size";
import type { ChannelItem, ChatMessageItem, GroupMemberItem, WorkspaceItem } from "@doan/shared";
import {
  getChannelsApi,
  getMessagesApi,
  getWorkspacesApi,
  getWorkspaceMembersApi,
  setChannelPreferenceApi,
  setMessagePreferenceApi,
  uploadAttachmentApi,
} from "./api";
import { Avatar, Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import "./chat-live.css";
import "./chat-media.css";
import { AttachmentView } from "./ChatAttachment";
import type { ChannelMember } from "./ThreadPanel";
import { useUserAvatars } from "./useUserAvatars";
import { governanceApi } from "../workspaces/api";
import { isAtLatest, jumpToLatestLabel } from "./jump-latest";

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

const reactionEmojis = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "✅"] as const;

export function ChatPage() {
  const safe = useMotionSafe();
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
  const [meetingRoomId, setMeetingRoomId] = useState("");
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
  // The details panel defaults to closed so the reading and composing area remains spacious.
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [mobileChannelDrawerOpen, setMobileChannelDrawerOpen] = useState(false);
  const [wideInfoLayout, setWideInfoLayout] = useState(() => window.matchMedia("(min-width: 961px)").matches);
  const infoPanelRef = usePanelDialog(() => setShowInfoPanel(false), showInfoPanel && !wideInfoLayout, ".live-chat-info-backdrop");
  const channelsPanelRef = usePanelDialog(() => setMobileChannelDrawerOpen(false), mobileChannelDrawerOpen, ".live-chat-mobile-backdrop");
  const [deleteTarget, setDeleteTarget] = useState<ChatMessageItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reactionPickerId, setReactionPickerId] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "favorites">("all");
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
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const sendRef = useSendFeedback(sending);
  const [showMembers, setShowMembers] = useState(false);
  const [revision, setRevision] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isPrependingRef = useRef(false);
  const followNewMessagesRef = useRef(true);
  const pendingScroll = useRef<number | undefined>(undefined);
  const activeChannelRef = useRef(channelId);
  activeChannelRef.current = channelId;
  const scrollGeneration = useRef(0);
  const olderRequest = useRef<number | null>(null);
  const prependFrame = useRef<number | undefined>(undefined);
  useEffect(() => {
    scrollGeneration.current += 1;
    olderRequest.current = null;
    return () => {
      scrollGeneration.current += 1;
      if (prependFrame.current !== undefined) cancelAnimationFrame(prependFrame.current);
    };
  }, [channelId]);
  const readyScrollRef = useRef(false);
  readyScrollRef.current = !messagesLoading && messagesChannelId === channelId;
  useEffect(() => {
    const container = chatContainerRef.current;
    const key = `${user?.id ?? "anonymous"}:${channelId}`;
    pendingScroll.current = channelScroll(key);
    const remember = () => {if(container && readyScrollRef.current) rememberChannelScroll(key,container.scrollTop);};
    container?.addEventListener("scroll",remember,{passive:true});
    return () => container?.removeEventListener("scroll",remember);
  },[channelId,user?.id]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingCancelledRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  // "Xuống tin mới nhất": shown in a message-context window or when scrolled far up.
  const [scrolledAway, setScrolledAway] = useState(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const jumpPendingRef = useRef(false);
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
      .catch(reason => {if(active)fail(reason);});
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
    if (loading || (route.view !== "chat" && route.view !== "workspace")) return;
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
    setMeetingRoomId("");
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
        if (!active || (routeRef.current.view !== "chat" && routeRef.current.view !== "workspace"))
          return;
        const text = items.filter((c) => c.type === "text");
        setChannels(text);
        setMeetingRoomId(items.find((c) => c.type !== "text")?.id ?? "");
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
    setNewWhileAway(0);
    setScrolledAway(false);
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
            .catch(reason => {if(active)fail(reason);});
          return;
        }
        if (message.authorId !== user?.id) {
          const container = chatContainerRef.current;
          const inContext = Boolean(routeRef.current.messageId);
          followNewMessagesRef.current =
            !inContext &&
            (!container ||
              container.scrollHeight - container.scrollTop - container.clientHeight < 140);
          // Reading older messages or a context window: count instead of jumping.
          if (!followNewMessagesRef.current) setNewWhileAway((count) => count + 1);
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
        .catch(reason => {if(active)fail(reason);});
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
        .catch(() => { /* Read receipts are advisory; the next channel_read/reconnect retries. Preserve messages. */ });
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
    if (messagesLoading || messagesChannelId !== channelId) return;
    if (pendingScroll.current !== undefined && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = pendingScroll.current;
      pendingScroll.current = undefined;
      followNewMessagesRef.current = false;
      return;
    }
    if (isPrependingRef.current) {
      isPrependingRef.current = false;
      return;
    }
    if (followNewMessagesRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
    followNewMessagesRef.current = false;
  }, [messages,messagesLoading,messagesChannelId,channelId]);

  // After leaving a context window, land on the bottom of the latest page once it renders.
  useEffect(() => {
    if (!jumpPendingRef.current || searchResults) return;
    jumpPendingRef.current = false;
    const container = chatContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [searchResults, messages]);

  const trackLatest = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    const atLatest = isAtLatest({
      inContext: false,
      distanceFromBottom: container.scrollHeight - container.scrollTop - container.clientHeight,
    });
    setScrolledAway(!atLatest);
    if (atLatest && !routeRef.current.messageId) setNewWhileAway(0);
  };

  const jumpToLatest = () => {
    const current = routeRef.current;
    if (current.messageId) navigate({ ...current, messageId: undefined });
    setSearchResults(null);
    setSearchHighlight(null);
    setNewWhileAway(0);
    setScrolledAway(false);
    followNewMessagesRef.current = true;
    const container = chatContainerRef.current;
    // Already on the live list: nothing re-renders, so scroll now. A context window
    // scrolls once the live list replaces it (see the effect above).
    if (!searchResults && container) container.scrollTop = container.scrollHeight;
    else jumpPendingRef.current = true;
    if (!accessToken || !channelId) return;
    const target = channelId;
    void getMessagesApi(accessToken, target, 50)
      .then((latest) => {
        if (routeRef.current.channelId !== target) return;
        setMessages((previous) => {
          const ids = new Set(previous.map((item) => item.id));
          const append = latest.filter((item) => !ids.has(item.id));
          // Only a real append re-renders the list, so only then wait to scroll.
          if (append.length) jumpPendingRef.current = true;
          return append.length
            ? [...previous, ...append].sort(
                (a, b) =>
                  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
                  a.id.localeCompare(b.id),
              )
            : previous;
        });
      })
      .catch(fail);
  };
  const inContextWindow = Boolean(route.messageId && searchResults);
  const showJumpToLatest = inContextWindow || (!searchResults && scrolledAway);

  async function loadOlderMessages() {
    if (!accessToken || !channelId || loadingOlder || !hasMore || !messages.length) return;
    const generation = scrollGeneration.current;
    if (olderRequest.current === generation) return;
    olderRequest.current = generation;
    const oldest = messages[0];
    setLoadingOlder(true);
    const container = chatContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    try {
      const older = await getMessagesApi(accessToken, channelId, 50, oldest.id);
      if (scrollGeneration.current !== generation || activeChannelRef.current !== channelId) return;
      setHasMore(older.length === 50);
      if (older.length > 0) {
        isPrependingRef.current = true;
        setMessages((prev) => {
          const ids = new Set(prev.map((item) => item.id));
          const uniqueOlder = older.filter((item) => !ids.has(item.id));
          return [...uniqueOlder, ...prev];
        });
        prependFrame.current = requestAnimationFrame(() => {
          prependFrame.current = undefined;
          if (container && scrollGeneration.current === generation) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
          }
        });
      }
    } catch (reason) {
      if (scrollGeneration.current === generation) fail(reason);
    } finally {
      if (scrollGeneration.current === generation) {
        olderRequest.current = null;
        setLoadingOlder(false);
      }
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

  useEffect(() => {
    const root = chatContainerRef.current;
    const trigger = root?.querySelector('.chat-load-more-btn');
    if(!root || !trigger || !hasMore || loadingOlder || messagesLoading || searchResults) return;
    const observer = new IntersectionObserver(entries => {
      if(entries.some(entry => entry.isIntersecting) && root.scrollTop < 80) void loadOlderMessages();
    },{root,rootMargin:"40px 0px",threshold:0});
    observer.observe(trigger);
    return () => observer.disconnect();
  },[channelId,hasMore,loadingOlder,messagesLoading,messages.length,searchResults]);

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
    // A message sent from a context window belongs at the latest end; show it there.
    if (routeRef.current.messageId) jumpToLatest();
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
      ambientBridge.pulse();
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

  async function confirmDeleteMessage() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await messageAction("delete_message", { messageId: deleteTarget.id });
      setDeleteTarget(null);
    } catch (reason) {
      fail(reason);
    } finally {
      setDeleting(false);
    }
  }

  const patchMessage = (id: string, patch: Partial<ChatMessageItem>) => {
    const apply = (item: ChatMessageItem) => (item.id === id ? { ...item, ...patch } : item);
    setMessages((previous) => previous.map(apply));
    setSearchResults(
      (previous) =>
        previous
          ?.map(apply)
          .filter((item) =>
            savedMode === "bookmarks" ? item.bookmarked : savedMode === "pins" ? item.pinned : true,
          ) ?? null,
    );
  };

  // Optimistic toggle; the server's message_changed broadcast reconciles every open client.
  async function toggleMessageFlag(message: ChatMessageItem, flag: "pinned" | "bookmarked") {
    if (!accessToken) return;
    const next = !message[flag];
    patchMessage(message.id, { [flag]: next });
    try {
      await setMessagePreferenceApi(
        accessToken,
        message.id,
        flag === "pinned" ? { pinned: next } : { bookmarked: next },
      );
    } catch (reason) {
      patchMessage(message.id, { [flag]: !next });
      fail(reason);
    }
  }

  async function toggleChannelFlag(flag: "pinned" | "muted") {
    if (!accessToken || !channel) return;
    const next = !channel[flag];
    const update = (value: boolean) =>
      setChannels((previous) =>
        previous.map((item) => (item.id === channel.id ? { ...item, [flag]: value } : item)),
      );
    update(next);
    try {
      const saved = await setChannelPreferenceApi(accessToken, channel.id, { [flag]: next });
      update(saved[flag]);
    } catch (reason) {
      update(!next);
      fail(reason);
    }
  }

  useEffect(() => {
    if (!reactionPickerId && !mobileChannelDrawerOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setReactionPickerId("");
        setMobileChannelDrawerOpen(false);
        return;
      }
      if (!(event.target as Element | null)?.closest(".chat-reaction-picker-anchor"))
        setReactionPickerId("");
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [reactionPickerId, mobileChannelDrawerOpen]);

  // Leaving the wide layout turns the docked details panel into an overlay; close it then.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 961px)");
    const sync = () => {
      setWideInfoLayout(wide.matches);
      if (!wide.matches) setShowInfoPanel(false);
      if (window.matchMedia("(min-width: 681px)").matches) setMobileChannelDrawerOpen(false);
    };
    wide.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      wide.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const exitSavedMode = () => {
    setSavedMode(null);
    setSearchResults(null);
  };

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


  const filteredChannels = useMemo(() => {
    return channels
      .filter((c) => {
        const matches = c.name.toLowerCase().includes(channelSearch.toLowerCase());
        if (!matches) return false;
        if (filterTab === "favorites") return Boolean(c.pinned);
        return true;
      })
      .sort(
        (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.position - b.position,
      );
  }, [channels, channelSearch, filterTab]);

  const visibleMessages = searchResults ?? messages;
  const avatarOf = useUserAvatars(
    useMemo(
      () => [...visibleMessages.map((m) => m.authorId), ...members.map((m) => m.userId)],
      [visibleMessages, members],
    ),
  );
  const draftLink = firstLink(content);
  const pinnedMessage = messages.find((m) => m.pinned);
  const openMeetingRoom = () =>
    workspaceId
      ? openChannel(workspaceId, meetingRoomId || undefined, true)
      : setActiveView("meetings");

  return (
    <section className="live-chat" aria-label="Tin nhắn nhóm">
      {/* 1. Panel: Conversation List matching mockup */}
      {mobileChannelDrawerOpen && (
        <button
          type="button"
          className="live-chat-mobile-backdrop"
          aria-label="Đóng danh sách kênh"
          onClick={() => setMobileChannelDrawerOpen(false)}
        />
      )}
      <aside
        className={`live-chat-nav ${mobileChannelDrawerOpen ? "is-mobile-open" : ""}`}
        ref={channelsPanelRef}
        aria-label="Danh sách kênh trong nhóm"
        role={mobileChannelDrawerOpen ? "dialog" : undefined}
        aria-modal={mobileChannelDrawerOpen || undefined}
      >
        <div className="live-chat-nav__header">
          <div className="chat-nav-title-stack">
            <span className="chat-nav-eyebrow">KÊNH TRONG NHÓM</span>
            <h2 className="chat-nav-title">Kênh trao đổi</h2>
          </div>
          {isAdmin && workspaceId && (
            <button
              type="button"
              className="chat-nav-compose-btn"
              title="Quản lý & Tạo kênh"
              aria-label="Quản lý và tạo kênh"
              onClick={() => navigate({ view: "admin", workspaceId })}
            >
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>

        {/* Search Input Pill */}
        <div className="chat-search-pill-box">
          <Icon name="search" size={15} />
          <input
            type="text"
            className="chat-search-pill-input"
            aria-label="Tìm kiếm kênh trong nhóm"
            placeholder="Tìm kênh # trong nhóm…"
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
            aria-selected={filterTab === "favorites"}
            className={`chat-filter-pill ${filterTab === "favorites" ? "is-active" : ""}`}
            onClick={() => setFilterTab("favorites")}
          >
            Đã ghim
          </button>
        </div>

        <nav className="chat-channels-scroll" aria-label="Danh sách kênh">
          {filteredChannels.length === 0 ? (
            <p className="live-chat-nav__empty">
              {channels.length === 0 ? "Nhóm chưa có kênh nào" : "Không tìm thấy kênh phù hợp"}
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
                    onClick={() => {
                      openChannel(workspaceId, c.id);
                      setMobileChannelDrawerOpen(false);
                    }}
                  >
                    <div className="chat-convo-hash" aria-hidden="true">
                      #
                    </div>
                    <div className="chat-convo-info">
                      <div className="chat-convo-top">
                        <strong className="chat-convo-name">#{c.name}</strong>
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
                            c.description?.trim() || "Chưa có tin nhắn mới"
                          )}
                        </span>
                        <span className="chat-convo-indicators">
                          {c.muted && (
                            <Icon
                              name="bell-off"
                              size={12}
                              className="chat-muted-icon"
                              aria-label="Đã tắt thông báo"
                            />
                          )}
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
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </nav>
      </aside>

      {/* 2. Main Chat Area */}
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
            <Button size="sm" variant="secondary" onClick={() => setActiveView("overview")}>
              Về trang chủ
            </Button>
          </div>
        )}

        {/* Active Channel Sub-Header */}
        <header className="chat-main-header">
          <div className="chat-header-identity">
            <div className="chat-header-hash" aria-hidden="true">
              #
            </div>
            <div className="chat-header-title-box">
              <h2 className="chat-header-room-name">
                {channel ? channel.name : "Chọn kênh trao đổi"}
              </h2>
              <span className="chat-header-room-subtitle">
                {channel?.description?.trim() ? `${channel.description} • ` : ""}
                {mentionMembers.length || members.length} thành viên •{" "}
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
              className={`chat-header-icon-btn ${showInfoPanel ? "is-active" : ""}`}
              title="Thông tin kênh & nhóm"
              aria-label="Thông tin kênh"
              aria-expanded={showInfoPanel}
              onClick={() => setShowInfoPanel(!showInfoPanel)}
            >
              <Icon name="more" size={17} />
            </button>
          </div>
        </header>

        {pinnedMessage && (
          <button
            type="button"
            className="chat-pinned-banner"
            onClick={() => {
              setMessageSearch("");
              setSavedMode(null);
              navigate({...route,messageId:pinnedMessage.id});
            }}
          >
            <div className="chat-pinned-banner-left">
              <div className="chat-pinned-pin-icon-circle">
                <Icon name="pin" size={15} />
              </div>
              <div className="chat-pinned-text">
                <strong>Tin nhắn ghim</strong>
                <span>{pinnedMessage.content || "Tệp đính kèm"}</span>
              </div>
            </div>
            <Icon name="chevron-right" size={16} />
          </button>
        )}

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
          <div className="inline-alert inline-alert--flush" role="alert">
            <span>{error}</span>
            <Button size="sm" variant="ghost" onClick={() => setRevision((n) => n + 1)}>
              Tải lại
            </Button>
          </div>
        )}

        {savedMode && (
          <div className="chat-saved-mode-banner" role="status">
            <Icon name={savedMode === "pins" ? "pin" : "bookmark"} size={15} />
            <span>
              Đang xem{" "}
              <strong>{savedMode === "pins" ? "Tin nhắn đã ghim" : "Tin nhắn đã đánh dấu"}</strong>
              {searchResults ? ` · ${searchResults.length} tin` : ""}
            </span>
            <Button size="sm" variant="secondary" icon="chevron-left" onClick={exitSavedMode}>
              Quay lại tất cả tin nhắn
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
          onScroll={trackLatest}
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
            <p role="status" className="loading-note">
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
                    tabIndex={0}
                  >
                    <div className="message-author-avatar">
                      <Avatar name={m.authorName} image={avatarOf(m.authorId)} size="sm" />
                    </div>
                    <div className="message-item__body">
                      <span className="chat-author-name-tag">{m.authorName}</span>
                      {m.replyToId && (
                        <div className="chat-reply-quote">
                          <Icon name="arrow-right" size={12} />{" "}
                          {m.replyToContent === "" ? "Tệp đính kèm" : m.replyToContent ?? "Tin nhắn đã xóa"}
                        </div>
                      )}
                      <div className="message-bubble-row">
                        {editingId === m.id ? (
                          <div className="chat-edit-box">
                            <textarea
                              value={editingContent}
                              maxLength={4000}
                              onChange={(event) => setEditingContent(event.target.value)}
                            />
                            <div className="chat-edit-box__actions">
                              <Button size="sm" variant="ghost" onClick={() => setEditingId("")}>
                                Hủy
                              </Button>
                              <Button
                                size="sm"
                                disabled={!editingContent.trim()}
                                onClick={() => void saveEdit(m.id)}
                              >
                                Lưu
                              </Button>
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

                        {!readOnly && (
                          <div
                            className={`chat-message-actions ${reactionPickerId === m.id ? "is-open" : ""}`}
                          >
                            <div className="chat-reaction-picker-anchor">
                              <button
                                type="button"
                                className={reactionPickerId === m.id ? "is-active" : ""}
                                title="Thả cảm xúc"
                                aria-label="Chọn biểu cảm"
                                aria-expanded={reactionPickerId === m.id}
                                onClick={() =>
                                  setReactionPickerId((current) => (current === m.id ? "" : m.id))
                                }
                              >
                                <Icon name="smile" size={14} />
                              </button>
                              <AnimatePresence>
                                {reactionPickerId === m.id && (
                                  <motion.div
                                    className="chat-reaction-picker"
                                    initial={safe.reduced ? false : { opacity: 0, scale: 0.95, y: 4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{
                                      duration: safe.duration(DURATION.micro),
                                      ease: EASE.out,
                                    }}
                                    style={{ transformOrigin: "bottom left" }}
                                    role="group"
                                    aria-label="Chọn biểu cảm"
                                  >
                                    {reactionEmojis.map((emoji, idx) => (
                                      <motion.button
                                        initial={safe.reduced ? false : { opacity: 0, y: 3 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                          duration: safe.duration(DURATION.micro),
                                          delay: safe.duration(idx * 0.02),
                                        }}
                                        type="button"
                                        key={emoji}
                                        aria-label={`Thả cảm xúc ${emoji}`}
                                        onClick={() => {
                                          setReactionPickerId("");
                                          void messageAction("react_message", {
                                            messageId: m.id,
                                            emoji,
                                          }).catch(fail);
                                        }}
                                      >
                                        {emoji}
                                      </motion.button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            <button
                              type="button"
                              title="Trả lời"
                              aria-label="Trả lời tin nhắn"
                              onClick={() => {
                                setReplyTo(m);
                                composerRef.current?.focus();
                              }}
                            >
                              <Icon name="arrow-right" size={14} />
                            </button>
                            <button
                              type="button"
                              className={m.pinned ? "is-active" : ""}
                              title={m.pinned ? "Bỏ ghim" : "Ghim tin nhắn"}
                              aria-label={m.pinned ? "Bỏ ghim" : "Ghim tin nhắn"}
                              aria-pressed={Boolean(m.pinned)}
                              onClick={() => void toggleMessageFlag(m, "pinned")}
                            >
                              <Icon name="pin" size={14} />
                            </button>
                            <button
                              type="button"
                              className={m.bookmarked ? "is-active" : ""}
                              title={m.bookmarked ? "Bỏ đánh dấu" : "Đánh dấu tin nhắn"}
                              aria-label={m.bookmarked ? "Bỏ đánh dấu" : "Đánh dấu tin nhắn"}
                              aria-pressed={Boolean(m.bookmarked)}
                              onClick={() => void toggleMessageFlag(m, "bookmarked")}
                            >
                              <Icon name="bookmark" size={14} />
                            </button>
                            {isMine && m.content && (
                              <button
                                type="button"
                                title="Sửa tin nhắn"
                                aria-label="Sửa tin nhắn"
                                onClick={() => {
                                  setEditingId(m.id);
                                  setEditingContent(m.content);
                                }}
                              >
                                <Icon name="edit" size={14} />
                              </button>
                            )}
                            {isMine && (
                              <button
                                type="button"
                                className="is-danger"
                                title="Thu hồi tin nhắn"
                                aria-label="Thu hồi tin nhắn"
                                onClick={() => setDeleteTarget(m)}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {(m.pinned || m.bookmarked) && (
                        <div className="chat-message-flags">
                          {m.pinned && (
                            <span>
                              <Icon name="pin" size={11} /> Đã ghim
                            </span>
                          )}
                          {m.bookmarked && (
                            <span>
                              <Icon name="bookmark" size={11} /> Đã đánh dấu
                            </span>
                          )}
                        </div>
                      )}

                      {m.reactions && m.reactions.length > 0 && (
                        <div className="chat-reactions-dock">
                          {m.reactions.map((reaction) => (
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
                              <span>{reaction.emoji}</span> <ReactionCount value={reaction.count} />
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="message-item__meta">
                        <time dateTime={m.createdAt}>{formattedTime}</time>
                        {m.editedAt && <span>· đã sửa</span>}
                        {isMine &&
                          ((m.seenCount ?? 0) > 0 ? (
                            <span
                              className="message-check-icon is-seen"
                              title={`${m.seenCount} người đã xem`}
                              aria-label={`${m.seenCount} người đã xem`}
                            >
                              ✓✓
                            </span>
                          ) : (
                            <span
                              className="message-check-icon"
                              title="Đã gửi, chưa ai xem"
                              aria-label="Đã gửi, chưa ai xem"
                            >
                              ✓
                            </span>
                          ))}
                      </div>
                    </div>
                  </article>
                </Fragment>
              );
            })
          )}
          <div ref={end} />
        </div>

        {/* Zero-height anchor: the jump button floats over the bottom of the list. */}
        <div className="chat-jump-latest-anchor">
          {showJumpToLatest && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon="chevron-down"
              className="chat-jump-latest"
              aria-label={jumpToLatestLabel(newWhileAway)}
              onClick={() => {
                jumpToLatest();
                // The button unmounts at the bottom; keep focus where the user continues.
                composerRef.current?.focus({ preventScroll: true });
              }}
            >
              Xuống tin mới nhất
              {newWhileAway > 0 && (
                <span className="chat-jump-latest__count" aria-hidden="true">
                  {newWhileAway > 99 ? "99+" : newWhileAway}
                </span>
              )}
            </Button>
          )}
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setOutbox((old) =>
                        old.filter((item) => item.clientMessageId !== draft.clientMessageId),
                      )
                    }
                  >
                    Bỏ lần gửi
                  </Button>
                )}
                {draft.status === "failed" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="refresh"
                    disabled={!isConnected || sending}
                    onClick={() => void deliver(draft)}
                  >
                    Thử gửi lại
                  </Button>
                )}
              </div>
            ))}

          <form className="chat-floating-dock-form" onSubmit={submit}>
            <textarea
              id="chat-message"
              ref={composerRef}
              className="chat-dock-textarea"
              maxLength={4000}
              rows={1}
              disabled={!channel || busy || readOnly || !draftReady}
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
                ref={sendRef}
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
      </div>

      {/* 3. Panel: Right Info Card — Distinguishes Channel Info vs Group Info */}
      {showInfoPanel && workspace && (
        <button
          type="button"
          className="live-chat-info-backdrop"
          aria-label="Đóng thông tin kênh"
          onClick={() => setShowInfoPanel(false)}
        />
      )}
      {showInfoPanel && workspace && (
        <motion.aside {...safe.panel} ref={infoPanelRef} role={wideInfoLayout ? undefined : "dialog"} aria-modal={wideInfoLayout ? undefined : true} tabIndex={-1} className="live-chat-info-panel" aria-label="Thông tin kênh và nhóm">
          <div className="chat-info-head">
            <h3>{channel ? "Thông tin kênh" : "Thông tin nhóm"}</h3>
            <button
              type="button"
              className="chat-info-close-btn"
              title="Đóng bảng thông tin"
              aria-label="Đóng thông tin kênh"
              onClick={() => setShowInfoPanel(false)}
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="chat-info-scrollable">
            <div className="chat-info-identity-card">
              <div className="chat-info-hash-large" aria-hidden="true">
                #
              </div>
              <h2 className="chat-info-title">
                {channel ? `#${channel.name}` : workspace.name}
              </h2>
              <span className="chat-info-member-subtitle">
                Thuộc nhóm <strong>{workspace.name}</strong> •{" "}
                {mentionMembers.length || members.length} thành viên
              </span>
            </div>

            <div className="chat-info-action-row">
              <button
                type="button"
                className="chat-info-circle-action"
                title="Tìm kiếm trong kênh"
                onClick={() => {
                  setShowInChannelSearch(true);
                  requestAnimationFrame(() => document.getElementById("message-search")?.focus());
                }}
              >
                <div className="circle-action-icon">
                  <Icon name="search" size={18} />
                </div>
                <span>Tìm kiếm</span>
              </button>

              <button
                type="button"
                className="chat-info-circle-action"
                title="Bảng công việc của kênh"
                onClick={() =>
                  navigate({
                    view: "tasks",
                    workspaceId: workspace.id,
                    channelId: channel?.id,
                  })
                }
              >
                <div className="circle-action-icon">
                  <Icon name="check-square" size={18} />
                </div>
                <span>Công việc</span>
              </button>

              <button
                type="button"
                className="chat-info-circle-action"
                title="Cuộc họp video"
                onClick={openMeetingRoom}
              >
                <div className="circle-action-icon">
                  <Icon name="video" size={18} />
                </div>
                <span>Họp nhóm</span>
              </button>
            </div>

            {channel?.description?.trim() && (
              <div className="chat-info-desc-box">
                <div className="chat-info-desc-content">
                  <strong>Mô tả kênh #{channel.name}</strong>
                  <p>{channel.description}</p>
                </div>
              </div>
            )}

            <div className="chat-info-menu-list">
              {channel && (
                <>
                  <div className="chat-info-section-label">Tùy chọn kênh #{channel.name}</div>
                  <button
                    type="button"
                    className="chat-info-menu-item"
                    aria-pressed={Boolean(channel.pinned)}
                    onClick={() => void toggleChannelFlag("pinned")}
                  >
                    <div className="menu-item-left">
                      <Icon name="star" size={18} fill={channel.pinned ? "currentColor" : "none"} />
                      <span>Ghim kênh này</span>
                    </div>
                    <div className="menu-item-right">
                      <span className={`chat-info-switch ${channel.pinned ? "is-on" : ""}`}>
                        {channel.pinned ? "Bật" : "Tắt"}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="chat-info-menu-item"
                    aria-pressed={Boolean(channel.muted)}
                    onClick={() => void toggleChannelFlag("muted")}
                  >
                    <div className="menu-item-left">
                      <Icon name={channel.muted ? "bell-off" : "bell"} size={18} />
                      <span>Tắt thông báo kênh</span>
                    </div>
                    <div className="menu-item-right">
                      <span className={`chat-info-switch ${channel.muted ? "is-on" : ""}`}>
                        {channel.muted ? "Bật" : "Tắt"}
                      </span>
                    </div>
                  </button>
                </>
              )}

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
                  <span>Tin nhắn ghim trong kênh</span>
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
                  setSavedMode("bookmarks");
                }}
              >
                <div className="menu-item-left">
                  <Icon name="bookmark" size={18} />
                  <span>Tin đã đánh dấu của bạn</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>

              <div className="chat-info-section-label">Thông tin chung của nhóm {workspace.name}</div>
              <button
                type="button"
                className="chat-info-menu-item"
                onClick={() => setShowMembers(!showMembers)}
              >
                <div className="menu-item-left">
                  <Icon name="users" size={18} />
                  <span>Thành viên nhóm</span>
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
                      <Avatar name={m.displayName} image={avatarOf(m.userId)} size="sm" />
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
                onClick={() => workspace && navigate({ view: "admin", workspaceId: workspace.id })}
              >
                <div className="menu-item-left">
                  <Icon name="settings" size={18} />
                  <span>Cài đặt & Quản trị nhóm</span>
                </div>
                <div className="menu-item-right">
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>
            </div>
          </div>
        </motion.aside>
      )}

      <AnimatePresence>{deleteTarget && (
        <Modal
          title="Thu hồi tin nhắn"
          eyebrow="TIN NHẮN"
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          footer={
            <div className="modal-footer-actions">
              <Button variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                Giữ lại
              </Button>
              <Button
                variant="danger"
                icon="trash"
                loading={deleting}
                onClick={() => void confirmDeleteMessage()}
              >
                Thu hồi tin nhắn
              </Button>
            </div>
          }
        >
          <p className="modal-lead">
            Tin nhắn sẽ bị gỡ khỏi cuộc trò chuyện với mọi thành viên. Thao tác này không thể hoàn
            tác.
          </p>
          {deleteTarget.content && (
            <blockquote className="chat-delete-preview">{deleteTarget.content}</blockquote>
          )}
        </Modal>
      )}</AnimatePresence>
    </section>
  );
}
