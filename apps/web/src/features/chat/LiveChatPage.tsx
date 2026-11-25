import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { CreateGroupDialog, NoGroups } from "../workspaces/GroupDialogs";
import { useDraft } from "../../shared/hooks/useDraft";
import { AnimatePresence, motion } from "motion/react";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import { DURATION, EASE } from "../../shared/motion/tokens";
import { ReactionCount } from "../../shared/motion/AnimatedCount";
import { useSendFeedback } from "../../shared/motion/useControlMotion";
import { usePanelDialog } from "../../shared/hooks/usePanelDialog";
import { channelScroll, rememberChannelScroll } from "../../shared/lib/channel-scroll";
import { formatFileSize } from "../../shared/lib/file-size";
import type {
  CcTransferDirectory,
  ChannelItem,
  ChatMessageItem,
  DirectConversationItem,
  DirectFileItem,
  DirectUserItem,
  GroupMemberItem,
  WorkspaceFileItem,
  WorkspaceItem,
} from "@doan/shared";
import {
  getChannelsApi,
  getMessagesApi,
  getWorkspacesApi,
  getWorkspaceMembersApi,
  rejectMemberApi,
  setChannelPreferenceApi,
  setMessagePreferenceApi,
  uploadAttachmentApi,
} from "./api";
import { Button, ConfirmDialog, Modal } from "../../shared/ui/Primitives";
import { cn } from "../../shared/lib/utils";
import { Emoji } from "../../shared/ui/Emoji";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { AttachmentView } from "./ChatAttachment";
import { useUserAvatars } from "./useUserAvatars";
import { governanceApi } from "../workspaces/api";
import { callCenterApi } from "../call-center/api";
import { isAtLatest, jumpToLatestLabel } from "./jump-latest";
import { MeetingSummaryCard } from "../meetings/MeetingSummaryCard";

interface ChannelMember {
  userId: string;
  displayName: string;
  role: string;
}

const stickers = [
  { id: "cheer", emoji: "🎉", label: "Ăn mừng" },
  { id: "love", emoji: "🥰", label: "Yêu thích" },
  { id: "great", emoji: "🙌", label: "Tuyệt vời" },
  { id: "laugh", emoji: "🤣", label: "Buồn cười" },
  { id: "focus", emoji: "💪", label: "Cố lên" },
  { id: "thanks", emoji: "🙏", label: "Cảm ơn" },
  { id: "like", emoji: "👍", label: "Thích" },
  { id: "adore", emoji: "😍", label: "Mê quá" },
  { id: "clap", emoji: "👏", label: "Vỗ tay" },
  { id: "fire", emoji: "🔥", label: "Quá đỉnh" },
  { id: "heart", emoji: "❤️", label: "Thương" },
  { id: "think", emoji: "🤔", label: "Suy nghĩ" },
  { id: "wow", emoji: "😮", label: "Wow" },
  { id: "sad", emoji: "😢", label: "Buồn" },
  { id: "sleepy", emoji: "😴", label: "Buồn ngủ" },
  { id: "done", emoji: "✅", label: "Đã xong" },
] as const;

const linkPattern = /https?:\/\/[^\s<>()]+/gi;

/** Glides a chat list to its newest message; a long way (opening a channel) lands at once. */
function glideToBottom(container: HTMLElement) {
  const away = container.scrollHeight - container.scrollTop - container.clientHeight;
  container.scrollTo({ top: container.scrollHeight, behavior: away < 1200 ? "smooth" : "instant" });
}

/** Scrolls a message into the middle of the list and pulses a ring around it. */
function glideToMessage(target: HTMLElement) {
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.animate(
    [{ boxShadow: "0 0 0 3px rgb(47 107 255 / .45)" }, { boxShadow: "0 0 0 3px transparent" }],
    { duration: 1600, delay: 250, easing: "ease-out" },
  );
}

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
      <span
        className="tw inline-grid justify-items-center gap-0.5 rounded-xl border bg-card px-3 py-1.5 [&>small]:text-[11px] [&>small]:text-muted-foreground"
        role="img"
        aria-label={`Sticker ${sticker.label}`}
      >
        <Emoji emoji={sticker.emoji} className="size-10" />
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

/** Messenger's list time: the clock today, the weekday this week, the date before that. */
function shortTime(iso: string) {
  const date = new Date(iso);
  const days = (Date.now() - date.getTime()) / 86_400_000;
  if (date.toDateString() === new Date().toDateString())
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return date.toLocaleDateString("vi-VN", { weekday: "short" });
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

/** A Messenger-style collapsible group in the details panel. */
function InfoSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-t py-1">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between rounded-md px-1.5 py-2 text-left text-sm font-semibold text-foreground hover:bg-secondary"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>
          {title}
          {count !== undefined && (
            <small className="ml-1 font-normal text-muted-foreground">{count}</small>
          )}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      {open && <div className="grid gap-px pb-1">{children}</div>}
    </section>
  );
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

/** Whether `next` continues `previous`'s run: same author, same day, within 5 minutes, not a reply. */
function continuesRun(previous?: ChatMessageItem, next?: ChatMessageItem) {
  if (!previous || !next || previous.authorId !== next.authorId || next.replyToId) return false;
  if ((previous.kind ?? "user") !== (next.kind ?? "user")) return false;
  const gap = new Date(next.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return (
    gap >= 0 &&
    gap < 5 * 60_000 &&
    new Date(previous.createdAt).toDateString() === new Date(next.createdAt).toDateString()
  );
}

const HEADER_ICON =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
const MESSAGE_TOOL =
  "grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
const COMPOSER_ICON =
  "grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
const COMPOSER_CHIP =
  "mb-1.5 flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-muted-foreground";
const CHIP_CLOSE =
  "grid size-6 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-background hover:text-foreground";
const INFO_QUICK =
  "grid w-[66px] cursor-pointer justify-items-center gap-1 rounded-[10px] px-1 py-2 text-xs text-muted-foreground no-underline transition-colors hover:bg-secondary hover:text-foreground";
const INFO_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary disabled:cursor-default disabled:hover:bg-transparent [&>svg]:shrink-0 [&>svg]:text-muted-foreground";
// Strips under the header: pinned message, in-chat search, saved views, errors.
const STRIP =
  "tw flex shrink-0 items-center gap-2.5 border-b px-4 py-1.5 text-[13px] text-foreground";
const STRIP_BUTTON =
  "h-7 shrink-0 cursor-pointer rounded-md border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-secondary";
const CONVERSATION_ROW =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-foreground transition-colors";

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
    notify,
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
  // One chat per group (its first text channel), then the direct conversations (kind 'direct').
  const [channels, setChannels] = useState<(ChannelItem | DirectConversationItem)[]>([]);
  const [peopleResults, setPeopleResults] = useState<DirectUserItem[]>([]);
  /** Each group's meeting room (first video room), for "Họp ngay". */
  const [rooms, setRooms] = useState<Record<string, string>>({});
  const [creatingGroup, setCreatingGroup] = useState(false);
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
  const [removingMember, setRemovingMember] = useState<GroupMemberItem | null>(null);
  const [showStickers, setShowStickers] = useState(false);
  // The details panel opens from the header's info button, so the conversation gets the width.
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [mobileChannelDrawerOpen, setMobileChannelDrawerOpen] = useState(false);
  const [wideInfoLayout, setWideInfoLayout] = useState(
    () => window.matchMedia("(min-width: 961px)").matches,
  );
  const infoPanelRef = usePanelDialog(
    () => setShowInfoPanel(false),
    showInfoPanel && !wideInfoLayout,
    "[data-info-backdrop]",
  );
  const channelsPanelRef = usePanelDialog(
    () => setMobileChannelDrawerOpen(false),
    mobileChannelDrawerOpen,
    "[data-list-backdrop]",
  );
  const [deleteTarget, setDeleteTarget] = useState<ChatMessageItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reactionPickerId, setReactionPickerId] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "unread" | "groups" | "favorites">("all");
  const [openSections, setOpenSections] = useState<string[]>(["about", "files"]);
  const toggleSection = (id: string) =>
    setOpenSections((old) => (old.includes(id) ? old.filter((item) => item !== id) : [...old, id]));
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
  const [revision, setRevision] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isPrependingRef = useRef(false);
  const followNewMessagesRef = useRef(true);
  /** Messages from others that arrived live: they slide in; loaded history does not. */
  const freshIdsRef = useRef(new Set<string>());
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
    const remember = () => {
      if (container && readyScrollRef.current) rememberChannelScroll(key, container.scrollTop);
    };
    container?.addEventListener("scroll", remember, { passive: true });
    return () => container?.removeEventListener("scroll", remember);
  }, [channelId, user?.id]);
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

  const channel = channels.find((c) => c.id === channelId);
  // The open channel's group: its members, meeting room and admin actions follow the channel.
  const workspaceId = channel?.workspaceId ?? "";
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const meetingRoomId = rooms[workspaceId] ?? "";
  const isDirect = channel?.kind === "direct";
  const openConversation = (id: string) => {
    const target = channels.find((c) => c.id === id);
    navigate({ view: "chat", workspaceId: target?.workspaceId ?? undefined, channelId: id });
  };
  const directPeer = isDirect ? (channel as DirectConversationItem).peer : undefined;
  const channelGroupRef = useRef(new Map<string, string>());
  channelGroupRef.current = new Map(
    channels.flatMap((c) => (c.workspaceId ? [[c.id, c.workspaceId] as [string, string]] : [])),
  );
  const knownChannelIdsRef = useRef(new Set<string>());
  knownChannelIdsRef.current = new Set(channels.map((c) => c.id));
  const directIdsRef = useRef(new Set<string>());
  directIdsRef.current = new Set(channels.filter((c) => c.kind === "direct").map((c) => c.id));
  const loadDirects = useCallback(async () => {
    if (!accessToken) return;
    const { conversations } = await governanceApi<{ conversations: DirectConversationItem[] }>(
      accessToken,
      "direct-conversations",
    );
    setChannels((previous) => [...previous.filter((c) => c.kind !== "direct"), ...conversations]);
    setChannelPreviews((previous) => ({
      ...previous,
      ...(Object.fromEntries(
        conversations.filter((c) => c.lastMessage).map((c) => [c.id, c.lastMessage]),
      ) as Record<string, ChatMessageItem>),
    }));
    return conversations;
  }, [accessToken]);
  // Runs even with no channel open: the first message of a conversation someone opened with us.
  // Messages from the user's other workspaces also land here and only cost one list refresh.
  useEffect(() => {
    if (!socket) return;
    const onNew = (message: ChatMessageItem) => {
      if (knownChannelIdsRef.current.has(message.channelId)) return;
      // A new 1-1 refreshes the direct list; otherwise someone just added us to a group.
      void loadDirects()
        .then((direct) => {
          if (!direct?.some((c) => c.id === message.channelId)) setRevision((value) => value + 1);
        })
        .catch(() => {});
    };
    socket.on("new_message", onNew);
    return () => {
      socket.off("new_message", onNew);
    };
  }, [socket, loadDirects]);
  const [chatFiles, setChatFiles] = useState<
    (Omit<DirectFileItem, "messageId"> & { messageId: string | null })[]
  >([]);
  const loadedFileCount = messages.filter((m) => m.attachment).length;
  useEffect(() => {
    setChatFiles([]);
    if (!accessToken || !channelId || !showInfoPanel || (!isDirect && !workspaceId)) return;
    let active = true;
    // A group's file list spans the group; keep the files sent in this chat.
    const path = isDirect
      ? `direct-conversations/${channelId}/files?limit=20`
      : `files?workspace=${workspaceId}&limit=40`;
    governanceApi<{ files: (DirectFileItem | WorkspaceFileItem)[] }>(accessToken, path)
      .then((data) => {
        if (active)
          setChatFiles(
            data.files.filter((file) => !("channelId" in file) || file.channelId === channelId),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken, channelId, workspaceId, isDirect, showInfoPanel, loadedFileCount]);
  // The peer's switchboard extension; only call-center members can read the directory (others get 403, no button).
  const [peerExtension, setPeerExtension] = useState("");
  useEffect(() => {
    setPeerExtension("");
    if (!accessToken || !directPeer) return;
    let active = true;
    callCenterApi<CcTransferDirectory>(accessToken, "transfer-directory")
      .then((data) => {
        const extension = data.extensions.find((item) => item.userId === directPeer.userId);
        if (active && extension) setPeerExtension(extension.number);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken, directPeer?.userId]);
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
      .catch((reason) => {
        if (active) fail(reason);
      });
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
  }, [route.view, route.workspaceId, loading, workspaces]);

  // Every group's text channels and the direct conversations, in one list.
  useEffect(() => {
    setChannels([]);
    setRooms({});
    setChannelId("");
    setMessages([]);
    setChannelPreviews({});
    if (!accessToken || loading) return;
    let active = true;
    Promise.all([
      Promise.all(workspaces.map((item) => getChannelsApi(accessToken, item.id))),
      governanceApi<{ conversations: DirectConversationItem[] }>(
        accessToken,
        "direct-conversations",
      ),
    ])
      .then(([lists, direct]) => {
        if (!active || routeRef.current.view !== "chat") return;
        const all = lists.flat();
        // Messenger-style: a group is one conversation. Extra channels of older groups stay hidden.
        const groupChats = lists.flatMap((list) => {
          const chat = list
            .filter((c) => c.type === "text")
            .sort(
              (a, b) =>
                Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) ||
                a.position - b.position,
            )[0];
          return chat ? [chat] : [];
        });
        const text = [...groupChats, ...direct.conversations];
        setChannels(text);
        setRooms(
          Object.fromEntries(
            workspaces.map((item) => [
              item.id,
              all.find((c) => c.workspaceId === item.id && c.type !== "text" && !c.archivedAt)
                ?.id ?? "",
            ]),
          ),
        );
        const target = routeRef.current;
        if (target.channelId) {
          const allowed = text.some((item) => item.id === target.channelId);
          setNavigationError(
            allowed
              ? ""
              : "Kênh không tồn tại, không phải kênh chat hoặc bạn không có quyền truy cập.",
          );
          setChannelId(allowed ? target.channelId : "");
        } else {
          // A group link opens that group's first channel; otherwise the first group channel.
          const first =
            (target.workspaceId
              ? text.find((c) => c.workspaceId === target.workspaceId)
              : text.find((c) => c.kind !== "direct")) ?? text[0];
          setChannelId(first?.id ?? "");
          if (first)
            navigate(
              { view: "chat", workspaceId: first.workspaceId ?? undefined, channelId: first.id },
              true,
            );
        }
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
  }, [accessToken, workspaces, revision, navigate, loading]);

  useEffect(() => {
    if (route.channelId && channels.length) {
      const allowed = channels.some((item) => item.id === route.channelId);
      setNavigationError(allowed ? "" : "Kênh không tồn tại hoặc bạn không có quyền truy cập.");
      setChannelId(allowed ? route.channelId : "");
    }
  }, [route.channelId, channels]);

  useEffect(() => {
    setMembers([]);
    if (!accessToken || !workspaceId) return;
    let active = true;
    getWorkspaceMembersApi(accessToken, workspaceId)
      .then((people) => {
        if (active) setMembers(people);
      })
      .catch(() => {
        /* The member list only feeds mentions and the header count; the chat still works. */
      });
    return () => {
      active = false;
    };
  }, [accessToken, workspaceId, revision]);

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
            .catch((reason) => {
              if (active) fail(reason);
            });
          return;
        }
        if (message.authorId !== user?.id) {
          freshIdsRef.current.add(message.id);
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
      const changedGroup = channelGroupRef.current.get(data.channelId);
      if (changedGroup)
        void getChannelsApi(accessToken, changedGroup)
          .then((fresh) => {
            if (!active) return;
            const text = fresh.filter((item) => item.type === "text");
            // An edit or delete can change that group's previews; other groups keep theirs.
            setChannelPreviews((previous) => ({
              ...Object.fromEntries(
                Object.entries(previous).filter(
                  ([id]) => channelGroupRef.current.get(id) !== changedGroup,
                ),
              ),
              ...(Object.fromEntries(
                text.filter((item) => item.lastMessage).map((item) => [item.id, item.lastMessage]),
              ) as Record<string, ChatMessageItem>),
            }));
          })
          .catch(fail);
      if (directIdsRef.current.has(data.channelId)) void loadDirects();
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
        .catch((reason) => {
          if (active) fail(reason);
        });
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
        .catch(() => {
          /* Read receipts are advisory; the next channel_read/reconnect retries. Preserve messages. */
        });
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
    if (target) glideToMessage(target);
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
      glideToBottom(chatContainerRef.current);
    }
    followNewMessagesRef.current = false;
  }, [messages, messagesLoading, messagesChannelId, channelId]);

  // After leaving a context window, land on the bottom of the latest page once it renders.
  useEffect(() => {
    if (!jumpPendingRef.current || searchResults) return;
    jumpPendingRef.current = false;
    const container = chatContainerRef.current;
    if (container) glideToBottom(container);
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
    if (!searchResults && container) glideToBottom(container);
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
    const trigger = root?.querySelector("[data-load-more]");
    if (!root || !trigger || !hasMore || loadingOlder || messagesLoading || searchResults) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && root.scrollTop < 80)
          void loadOlderMessages();
      },
      { root, rootMargin: "40px 0px", threshold: 0 },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [channelId, hasMore, loadingOlder, messagesLoading, messages.length, searchResults]);

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
      if (!(event.target as Element | null)?.closest("[data-reaction-anchor]"))
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
      if (window.matchMedia("(min-width: 1024px)").matches) setMobileChannelDrawerOpen(false);
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

  const titleOf = (c: ChannelItem | DirectConversationItem) =>
    c.kind === "direct" ? c.name : (workspaces.find((w) => w.id === c.workspaceId)?.name ?? c.name);
  const lastActivity = (c: ChannelItem | DirectConversationItem) =>
    new Date(channelPreviews[c.id]?.createdAt ?? 0).getTime();
  // One list like Messenger: newest activity first, pinned ones on top.
  const conversations = channels
    .filter(
      (c) =>
        titleOf(c).toLowerCase().includes(channelSearch.trim().toLowerCase()) &&
        (filterTab === "all" ||
          (filterTab === "unread" && Boolean(c.unreadCount)) ||
          (filterTab === "groups" && c.kind !== "direct") ||
          (filterTab === "favorites" && Boolean(c.pinned))),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || lastActivity(b) - lastActivity(a),
    );
  // People who already have a conversation are not offered again, even when it is filtered out.
  const newPeople = peopleResults.filter(
    (person) =>
      !channels.some(
        (c) => c.kind === "direct" && (c as DirectConversationItem).peer.userId === person.userId,
      ),
  );

  useEffect(() => {
    const term = channelSearch.trim();
    setPeopleResults([]);
    if (!accessToken || term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void governanceApi<{ users: DirectUserItem[] }>(
        accessToken,
        `direct-conversations/users?q=${encodeURIComponent(term)}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((data) => setPeopleResults(data.users))
        .catch(() => {
          /* Aborted or failed lookups leave the list empty; typing again retries. */
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, channelSearch]);

  async function startDirect(peer: DirectUserItem) {
    if (!accessToken) return;
    await mutate(async () => {
      const { conversation } = await governanceApi<{ conversation: DirectConversationItem }>(
        accessToken,
        "direct-conversations",
        "POST",
        { userId: peer.userId },
      );
      await loadDirects();
      setChannelSearch("");
      openConversation(conversation.id);
      setMobileChannelDrawerOpen(false);
    });
  }

  const visibleMessages = searchResults ?? messages;
  /** "Bạn đã trả lời …" above a reply; the original's author is known only while it is loaded. */
  const replyLabel = (m: ChatMessageItem, isMine: boolean) => {
    const original = messages.find((item) => item.id === m.replyToId);
    const to = !original
      ? ""
      : original.authorId === user?.id
        ? isMine
          ? " chính mình"
          : " bạn"
        : ` ${original.authorName}`;
    return `${isMine ? "Bạn" : m.authorName} đã trả lời${to}`;
  };
  /** Scrolls to a loaded message and flashes it. */
  const jumpToMessage = (id: string) => {
    const target = chatContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(id)}"]`,
    );
    if (!target)
      return notify("Tin nhắn gốc chưa được tải, hãy cuộn lên để xem.", undefined, "info");
    glideToMessage(target);
  };
  const avatarOf = useUserAvatars(
    useMemo(
      () => [
        ...visibleMessages.map((m) => m.authorId),
        ...members.map((m) => m.userId),
        ...(directPeer ? [directPeer.userId] : []),
      ],
      [visibleMessages, members, directPeer],
    ),
  );
  const draftLink = firstLink(content);
  const pinnedMessage = messages.find((m) => m.pinned);
  const openMeetingRoom = () =>
    workspaceId
      ? openChannel(workspaceId, meetingRoomId || undefined, true)
      : setActiveView("meetings");

  return (
    <section
      className="relative flex size-full min-h-0 overflow-hidden bg-background text-[13px] text-foreground"
      aria-label="Tin nhắn"
    >
      {/* 1. Conversation list (Tailwind). On phones it is a drawer opened from the chat header. */}
      {mobileChannelDrawerOpen && (
        <button
          type="button"
          data-list-backdrop
          className="tw fixed inset-0 z-40 cursor-default bg-black/30 lg:hidden"
          aria-label="Đóng danh sách kênh"
          onClick={() => setMobileChannelDrawerOpen(false)}
        />
      )}
      <aside
        className={cn(
          "tw flex min-h-0 w-[280px] shrink-0 flex-col gap-2.5 border-r bg-background px-2.5 pt-3.5 text-foreground",
          "max-lg:fixed max-lg:top-16 max-lg:bottom-[72px] max-lg:left-3 max-lg:z-[41] max-lg:w-[min(300px,calc(100vw-24px))] max-lg:rounded-xl max-lg:border max-lg:shadow-lg max-lg:transition-transform max-lg:duration-200 motion-reduce:transition-none",
          !mobileChannelDrawerOpen && "max-lg:invisible max-lg:-translate-x-[calc(100%+24px)]",
        )}
        ref={channelsPanelRef}
        aria-label="Danh sách hội thoại"
        role={mobileChannelDrawerOpen ? "dialog" : undefined}
        aria-modal={mobileChannelDrawerOpen || undefined}
      >
        <div className="flex items-center justify-between px-1">
          <h2 className="m-0 text-lg leading-7 font-bold tracking-normal text-foreground">
            Tin nhắn
          </h2>
          <button
            type="button"
            className="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Tạo nhóm"
            aria-label="Tạo nhóm"
            onClick={() => setCreatingGroup(true)}
          >
            <Icon name="edit" size={18} />
          </button>
        </div>

        <label className="flex items-center gap-2 rounded-full bg-secondary px-2.5 py-1.5 text-[13.5px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="w-full min-w-0 bg-transparent text-foreground !outline-none placeholder:text-muted-foreground"
            aria-label="Tìm cuộc trò chuyện hoặc người để nhắn tin"
            placeholder="Tìm người hoặc đoạn chat…"
            title="Tìm theo tên, email, MSSV hoặc tên đoạn chat"
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
          />
        </label>

        <div className="flex gap-1" role="tablist" aria-label="Lọc hội thoại">
          {(
            [
              ["all", "Tất cả"],
              ["unread", "Chưa đọc"],
              ["groups", "Nhóm"],
              ["favorites", "Đã ghim"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filterTab === key}
              className={cn(
                "cursor-pointer rounded-full border px-[7px] py-[3px] text-xs whitespace-nowrap transition-colors",
                filterTab === key
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFilterTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <nav
          className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-3"
          aria-label="Hội thoại"
        >
          {conversations.length === 0 && newPeople.length === 0 && (
            <div className="px-2 py-1 text-[12.5px] text-muted-foreground">
              {channelSearch.trim()
                ? "Không tìm thấy cuộc trò chuyện hoặc người phù hợp"
                : filterTab === "favorites"
                  ? "Chưa ghim đoạn chat nào"
                  : filterTab === "unread"
                    ? "Bạn đã đọc hết tin nhắn"
                    : filterTab === "groups"
                      ? "Bạn chưa ở trong nhóm chat nào"
                      : "Tìm tên, email hoặc MSSV ở ô trên để bắt đầu trò chuyện"}
            </div>
          )}
          {conversations.map((c) => {
            const latest = channelPreviews[c.id];
            const title = titleOf(c);
            const peer = c.kind === "direct" ? (c as DirectConversationItem).peer : undefined;
            const author =
              latest && latest.authorId === user?.id
                ? "Bạn: "
                : latest && !peer
                  ? `${latest.authorName.trim().split(/\s+/).pop()}: `
                  : "";
            const unread = Boolean(c.unreadCount);
            return (
              <button
                key={c.id}
                type="button"
                className={cn(
                  CONVERSATION_ROW,
                  c.id === channelId ? "bg-secondary" : "hover:bg-secondary",
                )}
                aria-current={c.id === channelId ? "page" : undefined}
                onClick={() => {
                  openConversation(c.id);
                  setMobileChannelDrawerOpen(false);
                }}
              >
                <UserAvatar
                  name={title}
                  group={!peer}
                  image={peer ? avatarOf(peer.userId) : undefined}
                  online={Boolean(peer && onlineUserIds.includes(peer.userId))}
                />
                <span className="grid min-w-0 flex-1">
                  <strong
                    className={cn("truncate text-[13.5px]", unread ? "font-bold" : "font-semibold")}
                  >
                    {title}
                  </strong>
                  <span
                    className={cn(
                      "truncate text-xs",
                      unread ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {latest
                      ? `${author}${latest.content || (latest.attachment ? "Đã gửi tệp đính kèm" : "")}`
                      : "Chưa có tin nhắn"}
                  </span>
                </span>
                <span className="grid shrink-0 justify-items-end gap-0.5 text-muted-foreground">
                  {latest && (
                    <time className="text-[11.5px]" dateTime={latest.createdAt}>
                      {shortTime(latest.createdAt)}
                    </time>
                  )}
                  <span className="flex items-center gap-1">
                    {c.muted && <Icon name="bell-off" size={14} aria-label="Đã tắt thông báo" />}
                    {unread ? (
                      <span
                        className="rounded-full bg-brand px-1.5 text-[11.5px] leading-[18px] font-semibold text-white"
                        aria-label={`${c.unreadCount} tin chưa đọc`}
                      >
                        {c.unreadCount}
                      </span>
                    ) : c.pinned ? (
                      <Icon name="star" size={13} />
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
          {newPeople.length > 0 && (
            <>
              <h3 className="m-0 px-2 pt-3 pb-1 text-[11.5px] leading-[1.5] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Bắt đầu trò chuyện mới
              </h3>
              {newPeople.map((person) => (
                <button
                  key={person.userId}
                  type="button"
                  className={cn(CONVERSATION_ROW, "hover:bg-secondary disabled:cursor-progress")}
                  disabled={busy}
                  onClick={() => void startDirect(person)}
                >
                  <UserAvatar name={person.displayName} />
                  <span className="grid min-w-0 flex-1">
                    <strong className="truncate text-[13.5px] font-semibold">
                      {person.displayName}
                    </strong>
                    <span className="truncate text-xs text-muted-foreground">
                      {person.userCode ? `${person.userCode} · ${person.email}` : person.email}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
        </nav>
      </aside>

      {/* 2. Main Chat Area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {readOnly && (
          <p
            role="status"
            className="tw border-b bg-secondary px-4 py-2 text-[13px] text-muted-foreground"
          >
            Nhóm hoặc kênh đã lưu trữ: chỉ xem lịch sử, không thể gửi hay sửa tin nhắn.
          </p>
        )}
        {navigationError && (
          <div
            className={cn(
              STRIP,
              "flex-wrap bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
            )}
            role="alert"
          >
            <strong>Không thể mở liên kết</strong>
            <span className="flex-1">{navigationError}</span>
            <button
              type="button"
              className={STRIP_BUTTON}
              onClick={() => setActiveView("overview")}
            >
              Về trang chủ
            </button>
          </div>
        )}

        {/* Active conversation header (Tailwind) */}
        <header className="tw flex shrink-0 items-center gap-2.5 border-b px-4 py-2 text-foreground max-lg:pl-1.5">
          <button
            type="button"
            className={cn(HEADER_ICON, "lg:hidden")}
            aria-label="Mở danh sách hội thoại"
            onClick={() => setMobileChannelDrawerOpen(true)}
          >
            <Icon name="chevron-left" size={18} />
          </button>
          {channel && (
            <UserAvatar
              name={titleOf(channel)}
              group={!directPeer}
              image={directPeer ? avatarOf(directPeer.userId) : undefined}
              online={Boolean(directPeer && onlineUserIds.includes(directPeer.userId))}
            />
          )}
          <div className="grid min-w-0 flex-1">
            <h2 className="m-0 truncate text-[15px] leading-5 font-semibold tracking-normal text-foreground">
              {channel ? titleOf(channel) : "Chọn cuộc trò chuyện"}
            </h2>
            <span className="truncate text-[12.5px] leading-[1.4] text-muted-foreground">
              {directPeer ? (
                onlineUserIds.includes(directPeer.userId) ? (
                  "Đang hoạt động"
                ) : (
                  "Không hoạt động"
                )
              ) : channel ? (
                <>
                  {mentionMembers.length || members.length} thành viên ·{" "}
                  {isConnected
                    ? `${members.filter((m) => onlineUserIds.includes(m.userId)).length} đang hoạt động`
                    : connectionStatus === "disconnected"
                      ? "Mất kết nối"
                      : "Đang kết nối lại…"}
                </>
              ) : null}
            </span>
          </div>

          {channel && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={cn(HEADER_ICON, showInChannelSearch && "bg-secondary text-foreground")}
                title="Tìm trong cuộc trò chuyện"
                aria-label="Tìm trong cuộc trò chuyện"
                aria-expanded={showInChannelSearch}
                onClick={() => setShowInChannelSearch(!showInChannelSearch)}
              >
                <Icon name="search" size={18} />
              </button>
              {peerExtension && (
                <button
                  type="button"
                  className={HEADER_ICON}
                  title={`Gọi máy lẻ ${peerExtension}`}
                  aria-label={`Gọi máy lẻ ${peerExtension}`}
                  onClick={() => navigate({ view: "call-center", query: peerExtension })}
                >
                  <Icon name="phone" size={18} />
                </button>
              )}
              {workspace && !isDirect && !readOnly && (
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold whitespace-nowrap text-primary-foreground hover:bg-primary/90"
                  title={`Họp ngay trong phòng của ${workspace.name}`}
                  aria-label="Họp ngay"
                  onClick={openMeetingRoom}
                >
                  <Icon name="video" size={16} />
                  <span className="max-sm:hidden">Họp ngay</span>
                </button>
              )}
              <button
                type="button"
                className={cn(HEADER_ICON, showInfoPanel && "bg-secondary text-foreground")}
                title="Thông tin về đoạn chat"
                aria-label="Thông tin về đoạn chat"
                aria-expanded={showInfoPanel}
                onClick={() => setShowInfoPanel(!showInfoPanel)}
              >
                <Icon name="info" size={18} />
              </button>
            </div>
          )}
        </header>

        {pinnedMessage && (
          <button
            type="button"
            className={cn(
              STRIP,
              "w-full cursor-pointer bg-secondary text-left hover:bg-brand-soft",
            )}
            onClick={() => {
              setMessageSearch("");
              setSavedMode(null);
              navigate({ ...route, messageId: pinnedMessage.id });
            }}
          >
            <Icon name="pin" size={15} className="shrink-0 text-brand" />
            <strong className="shrink-0">Tin nhắn ghim</strong>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {pinnedMessage.content || "Tệp đính kèm"}
            </span>
            <Icon name="chevron-right" size={16} />
          </button>
        )}

        {channel && (showInChannelSearch || messageSearch) && (
          <div className={cn(STRIP, "text-muted-foreground")}>
            <Icon name="search" size={14} />
            <input
              id="message-search"
              type="search"
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              placeholder="Tìm trong cuộc trò chuyện…"
              aria-label="Tìm tin nhắn trong cuộc trò chuyện"
            />
            {searchResults && (
              <span className="shrink-0 text-xs">
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
            className={cn(STRIP, "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300")}
            role="alert"
          >
            <span className="flex-1">{error}</span>
            <button
              type="button"
              className={STRIP_BUTTON}
              onClick={() => setRevision((n) => n + 1)}
            >
              Tải lại
            </button>
          </div>
        )}

        {savedMode && (
          <div className={cn(STRIP, "bg-brand-soft")} role="status">
            <Icon name={savedMode === "pins" ? "pin" : "bookmark"} size={15} />
            <span className="flex-1">
              Đang xem{" "}
              <strong>{savedMode === "pins" ? "Tin nhắn đã ghim" : "Tin nhắn đã đánh dấu"}</strong>
              {searchResults ? ` · ${searchResults.length} tin` : ""}
            </span>
            <button type="button" className={STRIP_BUTTON} onClick={exitSavedMode}>
              Quay lại tất cả tin nhắn
            </button>
          </div>
        )}

        {/* Messages list (Tailwind): bubbles, mine on the right */}
        <div
          ref={chatContainerRef}
          className="tw flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-5 py-3 text-foreground max-md:px-3"
          role="log"
          aria-label="Lịch sử tin nhắn"
          aria-live="polite"
          onScroll={trackLatest}
        >
          {!searchResults && messagesChannelId === channelId && hasMore && messages.length > 0 && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                data-load-more
                className="h-7 cursor-pointer rounded-full border bg-card px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={() => void loadOlderMessages()}
                disabled={loadingOlder}
              >
                {loadingOlder ? "Đang tải tin nhắn cũ hơn…" : "Tải tin nhắn cũ hơn"}
              </button>
            </div>
          )}
          {loading || messagesLoading || (channelId && messagesChannelId !== channelId) ? (
            <div role="status" className="m-auto text-sm text-muted-foreground">
              Đang tải cuộc trò chuyện…
            </div>
          ) : !workspaces.length && !channels.length ? (
            <NoGroups text="Nhóm chat của bạn sẽ hiện ở đây. Bạn cũng có thể tìm tên hoặc email ở ô bên trái để nhắn riêng." />
          ) : !channel || !visibleMessages.length ? (
            <div className="m-auto grid max-w-[360px] justify-items-center gap-1 p-6 text-center">
              <span className="mb-2 grid size-12 place-items-center rounded-xl bg-secondary text-foreground">
                <Icon name="message" size={24} />
              </span>
              <h3 className="m-0 text-[15px] leading-snug font-semibold tracking-normal text-foreground">
                {!channel
                  ? "Chưa chọn cuộc trò chuyện"
                  : messageSearch
                    ? "Không tìm thấy tin nhắn"
                    : isDirect
                      ? `Bắt đầu trò chuyện với ${channel.name}`
                      : `Chào mừng đến với ${titleOf(channel)}`}
              </h3>
              <div className="text-sm leading-normal text-muted-foreground">
                {!channel
                  ? "Chọn một đoạn chat ở bên trái, hoặc tìm tên/email để bắt đầu trò chuyện."
                  : messageSearch
                    ? "Thử một từ khóa khác."
                    : "Gửi tin nhắn đầu tiên để bắt đầu cuộc trò chuyện với mọi người trong nhóm."}
              </div>
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
              // Consecutive messages share one name/avatar; the receipt sits on the last one.
              const grouped = continuesRun(previous, m);
              const endsRun = !continuesRun(m, visibleMessages[index + 1]);
              const seen = (m.seenCount ?? 0) > 0;

              return (
                <Fragment key={m.id}>
                  {showDate && (
                    <div className="mt-3 mb-1 text-center text-xs text-muted-foreground">
                      {new Date(m.createdAt).toDateString() === new Date().toDateString()
                        ? "Hôm nay"
                        : new Date(m.createdAt).toLocaleDateString("vi-VN", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                    </div>
                  )}
                  <article
                    data-message-id={m.id}
                    className={cn(
                      "group/msg flex items-end gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      grouped ? "mt-0.5" : "mt-2",
                      isMine && "flex-row-reverse",
                      freshIdsRef.current.has(m.id) && "msg-in",
                      searchHighlight?.messageId === m.id && "bg-amber-50 dark:bg-amber-950/40",
                    )}
                    tabIndex={0}
                  >
                    {!isMine && (
                      <div className="w-6 shrink-0">
                        {endsRun && (
                          <UserAvatar
                            name={m.authorName}
                            image={avatarOf(m.authorId)}
                            className="size-6 text-[10px]"
                          />
                        )}
                      </div>
                    )}
                    <div
                      className={cn(
                        "flex max-w-[72%] min-w-0 flex-col gap-0.5 max-md:max-w-[85%]",
                        isMine ? "items-end" : "items-start",
                      )}
                    >
                      {!grouped && !isMine && !isDirect && (
                        <span className="pl-1 text-[11.5px] text-muted-foreground">
                          {m.authorName} ·{" "}
                          <time
                            dateTime={m.createdAt}
                            title={new Date(m.createdAt).toLocaleString("vi-VN")}
                          >
                            {formattedTime}
                          </time>
                        </span>
                      )}
                      {m.replyToId && (
                        <>
                          <span className="flex items-center gap-1 px-1.5 pt-1 text-[11.5px] text-muted-foreground">
                            <Icon name="reply" size={12} />
                            {replyLabel(m, isMine)}
                          </span>
                          <button
                            type="button"
                            className="-mb-2.5 max-w-full cursor-pointer rounded-2xl whitespace-pre-line [overflow-wrap:anywhere] bg-secondary/70 px-3 pt-1.5 pb-3.5 text-left text-[13px] text-muted-foreground hover:bg-secondary"
                            title="Xem tin nhắn gốc"
                            onClick={() => jumpToMessage(m.replyToId!)}
                          >
                            {m.replyToContent === ""
                              ? "Tệp đính kèm"
                              : (m.replyToContent ?? "Tin nhắn đã xóa")}
                          </button>
                        </>
                      )}
                      {editingId === m.id ? (
                        <div className="flex w-[min(100%,76ch)] min-w-[240px] flex-col gap-1.5">
                          <textarea
                            className="min-h-[60px] w-full resize-y rounded-md border border-primary bg-card px-2.5 py-2 text-sm leading-normal text-foreground"
                            value={editingContent}
                            maxLength={4000}
                            onChange={(event) => setEditingContent(event.target.value)}
                          />
                          <div className="flex justify-end gap-1.5">
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
                      ) : m.kind === "meeting_summary" ? (
                        <MeetingSummaryCard message={m} />
                      ) : (
                        <>
                          {m.content && (
                            <div
                              data-message-text
                              className={cn(
                                "w-fit max-w-full rounded-2xl px-[11px] py-1.5 text-[13.5px] leading-[1.4] [overflow-wrap:anywhere] whitespace-pre-wrap [&_a]:underline [&_a]:underline-offset-2",
                                isMine
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-secondary text-foreground [&_a]:text-brand",
                              )}
                              title={`${m.authorName} · ${new Date(m.createdAt).toLocaleString("vi-VN")}`}
                            >
                              <MessageText content={m.content.trim()} />
                              {m.editedAt && (
                                <span className="text-[11.5px] opacity-70"> (đã sửa)</span>
                              )}
                            </div>
                          )}
                          {m.attachment && accessToken && (
                            <AttachmentView attachment={m.attachment} accessToken={accessToken} />
                          )}
                        </>
                      )}

                      {(m.pinned || m.bookmarked) && (
                        <div className="flex gap-2 text-[11px] text-amber-600">
                          {m.pinned && (
                            <span className="flex items-center gap-1">
                              <Icon name="pin" size={11} /> Đã ghim
                            </span>
                          )}
                          {m.bookmarked && (
                            <span className="flex items-center gap-1">
                              <Icon name="bookmark" size={11} /> Đã đánh dấu
                            </span>
                          )}
                        </div>
                      )}

                      {m.reactions && m.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {m.reactions.map((reaction) => (
                            <button
                              type="button"
                              key={reaction.emoji}
                              className={cn(
                                "flex h-[22px] cursor-pointer items-center gap-1 rounded-full border px-[7px] text-xs",
                                reaction.reacted
                                  ? "border-brand bg-brand-soft text-brand"
                                  : "bg-card text-muted-foreground hover:border-foreground",
                              )}
                              aria-label={`${reaction.emoji} ${reaction.count} cảm xúc`}
                              onClick={() =>
                                void messageAction("react_message", {
                                  messageId: m.id,
                                  emoji: reaction.emoji,
                                }).catch(fail)
                              }
                            >
                              <Emoji emoji={reaction.emoji} className="size-3.5" />{" "}
                              <ReactionCount value={reaction.count} />
                            </button>
                          ))}
                        </div>
                      )}

                      {isMine && endsRun && (
                        <span
                          className={cn(
                            "text-[11.5px]",
                            seen ? "text-foreground" : "text-muted-foreground",
                          )}
                          title={seen ? `${m.seenCount} người đã xem` : "Đã gửi, chưa ai xem"}
                        >
                          {seen ? "✓✓ Đã xem" : "✓ Đã gửi"}
                        </span>
                      )}
                    </div>

                    {/* Tools beside the bubble: shown on hover or focus, always on touch screens. */}
                    {!readOnly && (
                      <div
                        className={cn(
                          "flex shrink-0 items-center gap-px self-center rounded-full border bg-card p-0.5 shadow-md transition-opacity",
                          reactionPickerId === m.id
                            ? "visible opacity-100"
                            : "invisible opacity-0 group-focus-within/msg:visible group-focus-within/msg:opacity-100 group-hover/msg:visible group-hover/msg:opacity-100 [@media(hover:none)]:visible [@media(hover:none)]:opacity-100",
                        )}
                      >
                        <div className="relative" data-reaction-anchor>
                          <button
                            type="button"
                            className={cn(
                              MESSAGE_TOOL,
                              reactionPickerId === m.id && "bg-secondary text-foreground",
                            )}
                            title="Thả cảm xúc"
                            aria-label="Chọn biểu cảm"
                            aria-expanded={reactionPickerId === m.id}
                            onClick={() =>
                              setReactionPickerId((current) => (current === m.id ? "" : m.id))
                            }
                          >
                            <Icon name="smile" size={15} />
                          </button>
                          <AnimatePresence>
                            {reactionPickerId === m.id && (
                              <motion.div
                                className={cn(
                                  "absolute bottom-[calc(100%+6px)] z-[6] grid grid-cols-[repeat(8,30px)] gap-0.5 rounded-xl border bg-card p-1 shadow-lg",
                                  isMine ? "right-0" : "left-0",
                                )}
                                initial={safe.reduced ? false : { opacity: 0, scale: 0.95, y: 4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{
                                  duration: safe.duration(DURATION.micro),
                                  ease: EASE.out,
                                }}
                                style={{ transformOrigin: isMine ? "bottom right" : "bottom left" }}
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
                                    className="grid size-[30px] cursor-pointer place-items-center rounded-md text-[17px] hover:bg-secondary"
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
                                    <Emoji emoji={emoji} className="size-5" />
                                  </motion.button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <button
                          type="button"
                          className={MESSAGE_TOOL}
                          title="Trả lời"
                          aria-label="Trả lời tin nhắn"
                          onClick={() => {
                            setReplyTo(m);
                            composerRef.current?.focus();
                          }}
                        >
                          <Icon name="reply" size={15} />
                        </button>
                        <button
                          type="button"
                          className={cn(MESSAGE_TOOL, m.pinned && "bg-secondary text-foreground")}
                          title={m.pinned ? "Bỏ ghim" : "Ghim tin nhắn"}
                          aria-label={m.pinned ? "Bỏ ghim" : "Ghim tin nhắn"}
                          aria-pressed={Boolean(m.pinned)}
                          onClick={() => void toggleMessageFlag(m, "pinned")}
                        >
                          <Icon name="pin" size={15} />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            MESSAGE_TOOL,
                            m.bookmarked && "bg-secondary text-foreground",
                          )}
                          title={m.bookmarked ? "Bỏ đánh dấu" : "Đánh dấu tin nhắn"}
                          aria-label={m.bookmarked ? "Bỏ đánh dấu" : "Đánh dấu tin nhắn"}
                          aria-pressed={Boolean(m.bookmarked)}
                          onClick={() => void toggleMessageFlag(m, "bookmarked")}
                        >
                          <Icon name="bookmark" size={15} />
                        </button>
                        {isMine && m.content && m.kind !== "meeting_summary" && (
                          <button
                            type="button"
                            className={MESSAGE_TOOL}
                            title="Sửa tin nhắn"
                            aria-label="Sửa tin nhắn"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditingContent(m.content);
                            }}
                          >
                            <Icon name="edit" size={15} />
                          </button>
                        )}
                        {isMine && (
                          <button
                            type="button"
                            className={cn(MESSAGE_TOOL, "hover:bg-red-50 hover:text-red-600")}
                            title="Thu hồi tin nhắn"
                            aria-label="Thu hồi tin nhắn"
                            onClick={() => setDeleteTarget(m)}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                </Fragment>
              );
            })
          )}
          <div ref={end} />
        </div>

        {/* Zero-height anchor: the jump button floats over the bottom of the list. */}
        <div className="tw relative h-0">
          {showJumpToLatest && (
            <button
              type="button"
              className="absolute bottom-2.5 left-1/2 z-[4] flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-medium whitespace-nowrap text-foreground shadow-md hover:bg-secondary"
              aria-label={jumpToLatestLabel(newWhileAway)}
              onClick={() => {
                jumpToLatest();
                // The button unmounts at the bottom; keep focus where the user continues.
                composerRef.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name="chevron-down" size={15} />
              Xuống tin mới nhất
              {newWhileAway > 0 && (
                <span
                  className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground"
                  aria-hidden="true"
                >
                  {newWhileAway > 99 ? "99+" : newWhileAway}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Typing indicator */}
        <div className="tw min-h-5 shrink-0 px-5 text-xs text-muted-foreground" role="status">
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

        {/* Composer (Tailwind): pending chips above, then tools, the message box and send */}
        <fieldset
          className="tw min-w-0 shrink-0 border-t px-3.5 py-2 text-foreground max-md:px-2"
          disabled={readOnly}
        >
          {replyTo && (
            <div className={cn(COMPOSER_CHIP, "border-l-[3px] border-brand")}>
              <span className="grid min-w-0 flex-1">
                <b className="text-xs font-semibold text-brand">
                  Đang trả lời {replyTo.authorId === user?.id ? "chính mình" : replyTo.authorName}
                </b>
                <span className="truncate">{replyTo.content || "Tệp đính kèm"}</span>
              </span>
              <button
                type="button"
                className={CHIP_CLOSE}
                aria-label="Bỏ trả lời"
                onClick={() => setReplyTo(null)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {attachmentFile && (
            <div className={COMPOSER_CHIP}>
              {attachmentPreview && (
                <img
                  src={attachmentPreview}
                  alt="Xem trước ảnh sẽ gửi"
                  className="size-10 rounded-md object-cover"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {attachmentFile.name} · {formatFileSize(attachmentFile.size)}
              </span>
              <button
                type="button"
                className={CHIP_CLOSE}
                aria-label="Bỏ tệp đính kèm"
                onClick={() => setAttachmentFile(null)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {recording && (
            <div
              className={cn(
                COMPOSER_CHIP,
                "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
              )}
              role="status"
            >
              <span className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
              <span className="flex-1">Đang ghi âm · tự dừng sau 2 phút</span>
              <button
                type="button"
                className="cursor-pointer font-semibold underline"
                onClick={() => stopRecording(true)}
              >
                Hủy
              </button>
            </div>
          )}
          {draftLink && (
            <div className={COMPOSER_CHIP}>
              <Icon name="link" size={15} />
              <span className="min-w-0 flex-1 truncate">
                Liên kết sẽ gửi: <strong className="text-foreground">{draftLink.hostname}</strong> ·{" "}
                {draftLink.pathname === "/" ? draftLink.href : draftLink.pathname}
              </span>
            </div>
          )}
          {outbox
            .filter((item) => item.channelId === channelId)
            .map((draft) => (
              <div
                key={draft.clientMessageId}
                className={cn(
                  COMPOSER_CHIP,
                  "flex-wrap",
                  draft.status === "failed" &&
                    "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
                )}
                role={draft.status === "failed" ? "alert" : "status"}
              >
                <span className="min-w-0 flex-1">
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

          <form className="flex items-end gap-1" onSubmit={submit}>
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
            <button
              type="button"
              className={cn(
                COMPOSER_ICON,
                recording && "bg-red-50 text-red-600 hover:bg-red-50 hover:text-red-600",
              )}
              title="Tin nhắn thoại"
              aria-label={recording ? "Dừng ghi âm" : "Tin nhắn thoại"}
              disabled={!channel || (sending && !recording)}
              onClick={() => {
                setShowStickers(false);
                if (recording) stopRecording();
                else void startRecording();
              }}
            >
              <Icon name="mic" size={18} />
            </button>
            <button
              type="button"
              className={COMPOSER_ICON}
              title="Đính kèm ảnh hoặc tệp"
              aria-label="Đính kèm tệp"
              disabled={!channel || sending}
              onClick={() => {
                setShowStickers(false);
                fileInputRef.current?.click();
              }}
            >
              <Icon name="paperclip" size={18} />
            </button>
            <div className="relative">
              <button
                type="button"
                className={cn(COMPOSER_ICON, showStickers && "bg-secondary text-foreground")}
                title="Nhãn dán"
                aria-label="Chọn sticker"
                aria-expanded={showStickers}
                disabled={!channel || sending}
                onClick={() => setShowStickers((value) => !value)}
              >
                <Icon name="smile" size={18} />
              </button>
              {showStickers && (
                <div
                  className="motion-pop absolute bottom-[calc(100%+8px)] left-0 z-10 grid w-[312px] grid-cols-4 gap-1 rounded-xl border bg-card p-2 shadow-lg"
                  role="group"
                  aria-label="Chọn sticker"
                >
                  {stickers.map((sticker) => (
                    <button
                      key={sticker.id}
                      type="button"
                      className="group grid cursor-pointer justify-items-center gap-1 rounded-lg px-1 py-2 hover:bg-secondary"
                      title={sticker.label}
                      onClick={() => void sendSticker(sticker.id)}
                    >
                      <Emoji
                        emoji={sticker.emoji}
                        className="size-9 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-110"
                      />
                      <small className="text-[11px] whitespace-nowrap text-muted-foreground">
                        {sticker.label}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              id="chat-message"
              ref={composerRef}
              className="mx-1.5 max-h-[120px] min-h-9 flex-1 resize-none rounded-[18px] bg-secondary px-3.5 py-2 text-sm leading-5 text-foreground !outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              maxLength={4000}
              rows={1}
              disabled={!channel || busy || readOnly || !draftReady}
              placeholder={
                !isConnected
                  ? "Mất kết nối. Đang thử lại…"
                  : channel
                    ? "Nhập tin nhắn…"
                    : "Chọn một đoạn chat để nhắn tin"
              }
              aria-label={channel ? `Nhắn tin tới ${titleOf(channel)}` : "Nhắn tin"}
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
            {content.trim() || attachmentFile ? (
              <button
                type="submit"
                className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                ref={sendRef}
                title="Gửi tin nhắn"
                aria-label="Gửi tin nhắn"
                disabled={!isConnected || !channel || busy || sending}
              >
                <Icon name="send" size={18} />
              </button>
            ) : (
              <button
                type="button"
                className={COMPOSER_ICON}
                title="Gửi lượt thích"
                aria-label="Gửi lượt thích"
                disabled={!isConnected || !channel || busy || sending}
                onClick={() => void sendSticker("like")}
              >
                <Icon name="thumbs-up" size={18} />
              </button>
            )}
          </form>
        </fieldset>
      </div>

      {/* Details panel (Tailwind): a third column on wide screens, an overlay card up to 960px */}
      {showInfoPanel && (workspace || isDirect) && (
        <button
          type="button"
          data-info-backdrop
          className="tw fixed inset-0 z-40 hidden cursor-default bg-black/30 max-[960px]:block"
          aria-label="Đóng thông tin kênh"
          onClick={() => setShowInfoPanel(false)}
        />
      )}
      {showInfoPanel && (workspace || isDirect) && (
        <motion.aside
          {...safe.panel}
          ref={infoPanelRef}
          role={wideInfoLayout ? undefined : "dialog"}
          aria-modal={wideInfoLayout ? undefined : true}
          tabIndex={-1}
          className="tw flex min-h-0 w-[300px] shrink-0 flex-col border-l bg-background text-foreground !outline-none max-[960px]:fixed max-[960px]:top-16 max-[960px]:right-3 max-[960px]:bottom-3 max-[960px]:z-[41] max-[960px]:w-[min(320px,calc(100vw-24px))] max-[960px]:rounded-xl max-[960px]:border max-[960px]:bg-card max-[960px]:shadow-lg"
          aria-label="Thông tin về đoạn chat"
        >
          <div className="flex shrink-0 justify-end px-2 pt-2">
            <button
              type="button"
              className={HEADER_ICON}
              title="Đóng bảng thông tin"
              aria-label="Đóng thông tin đoạn chat"
              onClick={() => setShowInfoPanel(false)}
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-5">
            <div className="grid justify-items-center gap-1 pb-2.5 text-center">
              <UserAvatar
                name={channel ? titleOf(channel) : (workspace?.name ?? "")}
                image={directPeer ? avatarOf(directPeer.userId) : undefined}
                online={Boolean(directPeer && onlineUserIds.includes(directPeer.userId))}
                group={!directPeer}
                className="mb-1 size-14 text-lg"
              />
              <h2 className="m-0 text-[15px] leading-5 font-semibold tracking-normal text-foreground">
                {channel ? titleOf(channel) : workspace?.name}
              </h2>
              <span className="text-[13px] text-muted-foreground">
                {directPeer
                  ? onlineUserIds.includes(directPeer.userId)
                    ? "Đang hoạt động"
                    : "Không hoạt động"
                  : `Nhóm · ${mentionMembers.length || members.length} thành viên`}
              </span>

              <div className="mt-2.5 flex justify-center gap-1">
                {directPeer && (
                  <a
                    className={INFO_QUICK}
                    href={`mailto:${directPeer.email}`}
                    title={directPeer.email}
                  >
                    <Icon name="mail" size={18} />
                    <span>Email</span>
                  </a>
                )}
                {workspace && !isDirect && !readOnly && (
                  <button type="button" className={INFO_QUICK} onClick={openMeetingRoom}>
                    <Icon name="video" size={18} />
                    <span>Họp nhóm</span>
                  </button>
                )}
                {channel && (
                  <button
                    type="button"
                    className={INFO_QUICK}
                    aria-pressed={Boolean(channel.muted)}
                    onClick={() => void toggleChannelFlag("muted")}
                  >
                    <Icon name={channel.muted ? "bell-off" : "bell"} size={18} />
                    <span>{channel.muted ? "Bật báo" : "Tắt báo"}</span>
                  </button>
                )}
                <button
                  type="button"
                  className={INFO_QUICK}
                  onClick={() => {
                    setShowInChannelSearch(true);
                    requestAnimationFrame(() => document.getElementById("message-search")?.focus());
                  }}
                >
                  <Icon name="search" size={18} />
                  <span>Tìm kiếm</span>
                </button>
              </div>
            </div>

            <InfoSection
              title="Thông tin về đoạn chat"
              open={openSections.includes("about")}
              onToggle={() => toggleSection("about")}
            >
              <button
                type="button"
                className={INFO_ITEM}
                onClick={() => {
                  setMessageSearch("");
                  setSavedMode("pins");
                }}
              >
                <Icon name="pin" size={17} />
                <span>Xem tin nhắn đã ghim</span>
              </button>
              <button
                type="button"
                className={INFO_ITEM}
                onClick={() => {
                  setMessageSearch("");
                  setSavedMode("bookmarks");
                }}
              >
                <Icon name="bookmark" size={17} />
                <span>Tin đã đánh dấu của bạn</span>
              </button>
            </InfoSection>

            {workspace && !isDirect && (
              <InfoSection
                title="Thành viên"
                count={members.length}
                open={openSections.includes("members")}
                onToggle={() => toggleSection("members")}
              >
                {members.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2.5 p-1.5">
                    <UserAvatar
                      name={m.displayName}
                      image={avatarOf(m.userId)}
                      online={onlineUserIds.includes(m.userId)}
                      className="size-8 text-[11px]"
                    />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm">{m.displayName}</span>
                      {m.role !== "member" && (
                        <small className="text-xs text-muted-foreground">
                          {m.role === "owner" ? "Chủ nhóm" : "Quản trị viên"}
                        </small>
                      )}
                    </span>
                    {/* The owner can remove anyone else; an admin only plain members. */}
                    {isAdmin &&
                      m.userId !== user?.id &&
                      m.role !== "owner" &&
                      (workspace.role === "owner" || m.role === "member") && (
                        <button
                          type="button"
                          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive"
                          aria-label={`Loại ${m.displayName} khỏi nhóm`}
                          title="Loại khỏi nhóm"
                          disabled={busy}
                          onClick={() => setRemovingMember(m)}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      )}
                  </div>
                ))}
                {isAdmin && (
                  <form className="flex gap-1.5 p-1.5" onSubmit={addMember}>
                    <input
                      type="email"
                      className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-[13px] text-foreground !outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Thêm người bằng email…"
                      aria-label="Email người cần thêm"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="h-8 cursor-pointer rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy}
                    >
                      Thêm
                    </button>
                  </form>
                )}
              </InfoSection>
            )}

            <InfoSection
              title="File phương tiện và file"
              open={openSections.includes("files")}
              onToggle={() => toggleSection("files")}
            >
              {(
                [
                  [
                    "image",
                    "File phương tiện",
                    chatFiles.filter((file) => file.mimeType.startsWith("image/")),
                  ],
                  ["file", "File", chatFiles.filter((file) => !file.mimeType.startsWith("image/"))],
                ] as const
              ).map(([icon, label, files]) => (
                <div key={label}>
                  <div className="px-1.5 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
                    {label}
                  </div>
                  {files.length === 0 ? (
                    <p className="m-0 px-1.5 pb-1.5 text-[13px] text-muted-foreground">
                      Chưa có {label.toLowerCase()} nào.
                    </p>
                  ) : (
                    files.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        className={INFO_ITEM}
                        title={`${file.uploaderName} · ${new Date(file.createdAt).toLocaleString("vi-VN")}`}
                        disabled={!file.messageId}
                        onClick={() =>
                          file.messageId && navigate({ ...route, messageId: file.messageId })
                        }
                      >
                        <Icon name={icon} size={17} />
                        <span className="grid min-w-0">
                          <span className="truncate">{file.fileName}</span>
                          <small className="text-xs text-muted-foreground">
                            {formatFileSize(file.fileSize)}
                          </small>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ))}
            </InfoSection>

            {channel && (
              <InfoSection
                title="Tùy chỉnh đoạn chat"
                open={openSections.includes("custom")}
                onToggle={() => toggleSection("custom")}
              >
                <button
                  type="button"
                  className={INFO_ITEM}
                  aria-pressed={Boolean(channel.pinned)}
                  onClick={() => void toggleChannelFlag("pinned")}
                >
                  <Icon name="star" size={17} fill={channel.pinned ? "currentColor" : "none"} />
                  <span>{channel.pinned ? "Bỏ ghim đoạn chat" : "Ghim đoạn chat"}</span>
                </button>
              </InfoSection>
            )}

            {channel && (
              <InfoSection
                title="Quyền riêng tư và hỗ trợ"
                open={openSections.includes("privacy")}
                onToggle={() => toggleSection("privacy")}
              >
                <button
                  type="button"
                  className={INFO_ITEM}
                  aria-pressed={Boolean(channel.muted)}
                  onClick={() => void toggleChannelFlag("muted")}
                >
                  <Icon name={channel.muted ? "bell-off" : "bell"} size={17} />
                  <span>{channel.muted ? "Bật thông báo" : "Tắt thông báo"}</span>
                </button>
              </InfoSection>
            )}
          </div>
        </motion.aside>
      )}

      <AnimatePresence>
        {deleteTarget && (
          <Modal
            title="Thu hồi tin nhắn"
            eyebrow="TIN NHẮN"
            icon="trash"
            iconTone="red"
            onClose={() => {
              if (!deleting) setDeleteTarget(null);
            }}
            footer={
              <>
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
              </>
            }
          >
            <p className="tw text-muted-foreground">
              Tin nhắn sẽ bị gỡ khỏi cuộc trò chuyện với mọi thành viên. Thao tác này không thể hoàn
              tác.
            </p>
            {deleteTarget.content && (
              <blockquote className="tw mt-3 border-l-[3px] bg-secondary px-3 py-2 whitespace-pre-wrap text-muted-foreground">
                {deleteTarget.content}
              </blockquote>
            )}
          </Modal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {removingMember && workspaceId && (
          <ConfirmDialog
            title="Loại thành viên"
            description={`${removingMember.displayName} sẽ không còn xem và gửi tin trong nhóm này nữa.`}
            confirmLabel="Loại khỏi nhóm"
            loading={busy}
            onClose={() => setRemovingMember(null)}
            onConfirm={() =>
              void mutate(async () => {
                await rejectMemberApi(accessToken!, workspaceId, removingMember.userId);
                setMembers(await getWorkspaceMembersApi(accessToken!, workspaceId));
                setRemovingMember(null);
              })
            }
          />
        )}
        {creatingGroup && (
          <CreateGroupDialog
            onClose={() => setCreatingGroup(false)}
            onCreated={(group) => {
              setCreatingGroup(false);
              navigate({ view: "chat", workspaceId: group.id });
              setRevision((value) => value + 1);
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
