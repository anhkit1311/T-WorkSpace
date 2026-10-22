import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatMessageItem, PresenceEvent, TypingEvent } from "@doan/shared";
import { io, type Socket } from "socket.io-client";
import { getChannelsApi, getWorkspacesApi } from "../../features/chat/api";
import { governanceApi } from "../../features/workspaces/api";
import { useApp } from "./AppContext";

export type ConnectionStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  onlineUserIds: string[];
  typingUsers: TypingEvent[];
  unreadCount: number;
  /** Unread messages in the user's group channels, shown on the groups menu item. */
  groupUnreadCount: number;
  refreshUnreadCount: () => Promise<void>;
  joinChannel: (channelId: string) => void;
  leaveChannel: (channelId: string) => void;
  sendMessage: (
    channelId: string,
    content: string,
    options?: {
      replyToId?: string;
      attachmentId?: string;
      clientMessageId?: string;
      threadRootId?: string;
      mentionedUserIds?: string[];
    },
  ) => Promise<ChatMessageItem>;
  setTyping: (channelId: string, isTyping: boolean) => void;
  reconnect: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const SOCKET_URL = import.meta.env.VITE_API_URL ?? "";

export function SocketProvider({ children }: { children: ReactNode }) {
  const { accessToken, user, activeView, notify, openChannel } = useApp();
  const notificationRef = useRef({ accessToken, user, activeView, notify, openChannel });
  notificationRef.current = { accessToken, user, activeView, notify, openChannel };
  const socketRef = useRef<Socket | null>(null);
  const activeChannelRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0);
  const hasAccessToken = Boolean(accessToken);

  const refreshUnreadCount = useCallback(async () => {
    if (!accessToken) {
      setUnreadCount(0);
      setGroupUnreadCount(0);
      activeChannelRef.current = null;
      return;
    }
    const total = (items: { unreadCount?: number }[]) =>
      items.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0);
    try {
      // "Tin nhắn" counts direct conversations; group channels are counted for the groups menu item.
      const [{ conversations }, workspaces] = await Promise.all([
        governanceApi<{ conversations: { unreadCount?: number }[] }>(accessToken, "direct-conversations"),
        getWorkspacesApi(accessToken),
      ]);
      setUnreadCount(total(conversations));
      const channelLists = await Promise.all(
        workspaces.map((workspace) => getChannelsApi(accessToken, workspace.id)),
      );
      setGroupUnreadCount(total(channelLists.flat()));
    } catch {
      /* The socket will refresh the count on the next message. */
    }
  }, [accessToken]);

  const refreshUnreadRef = useRef(refreshUnreadCount);
  refreshUnreadRef.current = refreshUnreadCount;
  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!accessToken || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsConnected(false);
      setConnectionStatus("disconnected");
      setOnlineUserIds([]);
      setTypingUsers([]);
      setUnreadCount(0);
      setGroupUnreadCount(0);
      return;
    }

    setConnectionStatus("connecting");
    const socket = io(SOCKET_URL, {
      auth: { token: accessToken },
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;
    let refreshingAccess = false;
    let accessRefreshTimer: number | undefined;

    socket.on("connect", () => {
      setIsConnected(true);
      setConnectionStatus("connected");
      if (activeChannelRef.current) {
        socket.emit("join_channel", { channelId: activeChannelRef.current });
      }
    });
    socket.on("access_revoked", () => {
      refreshingAccess = true;
      setUnreadCount(0);
      setGroupUnreadCount(0);
      socket.once("disconnect", () => {
        accessRefreshTimer = window.setTimeout(() => {
          refreshingAccess = false;
          if (socketRef.current === socket) socket.connect();
        }, 250);
      });
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      setTypingUsers([]);
      setOnlineUserIds([]);
      if (refreshingAccess) {
        setConnectionStatus("connecting");
      } else if (reason === "io client disconnect" || reason === "io server disconnect") {
        setConnectionStatus("disconnected");
      } else {
        setConnectionStatus("reconnecting");
      }
    });

    socket.on("connect_error", () => {
      setIsConnected(false);
      setConnectionStatus(socket.active ? "reconnecting" : "disconnected");
    });

    socket.io.on("reconnect_attempt", () => {
      setConnectionStatus("reconnecting");
    });

    socket.io.on("reconnect_failed", () => {
      setConnectionStatus("disconnected");
    });

    socket.on("online_users", (userIds: string[]) => {
      setOnlineUserIds(userIds);
    });

    socket.on("user_presence", (event: PresenceEvent) => {
      setOnlineUserIds((prev) => {
        if (event.status === "online") {
          return prev.includes(event.userId) ? prev : [...prev, event.userId];
        } else {
          return prev.filter((id) => id !== event.userId);
        }
      });
    });

    socket.on("user_typing", (event: TypingEvent) => {
      setTypingUsers((prev) => {
        const filtered = prev.filter(
          (t) => !(t.channelId === event.channelId && t.userId === event.userId),
        );
        if (event.isTyping) {
          return [...filtered, event];
        }
        return filtered;
      });
    });

    socket.on("new_message", (message: ChatMessageItem) => {
      const current = notificationRef.current;
      if (
        message.authorId !== current.user?.id &&
        (message.channelId !== activeChannelRef.current || document.visibilityState !== "visible")
      ) {
        // The payload does not say whether the channel is direct, so recount from the server.
        void refreshUnreadRef.current();
      }
      if (
        !current.accessToken ||
        !current.user?.notificationsEnabled ||
        message.authorId === current.user.id ||
        current.activeView === "chat" ||
        current.activeView === "workspace"
      )
        return;
      void fetch(
        `${import.meta.env.VITE_API_URL ?? ""}/api/channels/${message.channelId}/preferences`,
        {
          headers: { Authorization: `Bearer ${current.accessToken}` },
          credentials: "include",
        },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data && !data.preference?.muted) {
            const workspaceId: string | undefined = data.preference?.workspaceId;
            current.notify(
              `Tin mới từ ${message.authorName}`,
              message.content || message.attachment?.fileName || "Tệp đính kèm",
              "info",
              undefined,
              {
                icon: "message",
                // Direct conversations have no workspace; the chat page resolves them by id.
                onOpen: () => notificationRef.current.openChannel(workspaceId ?? "", message.channelId),
              },
            );
          }
        })
        .catch(() => { /* Do not send a toast when the mute preference is unknown. Unread data remains in the inbox and reconnect retries. */ });
    });

    // socket.io stops after reconnectionAttempts; coming back online or to the tab starts it again.
    const revive = () => {
      if (document.visibilityState === "visible" && navigator.onLine && !socket.connected && !socket.active) socket.connect();
    };
    window.addEventListener("online", revive);
    document.addEventListener("visibilitychange", revive);

    return () => {
      window.removeEventListener("online", revive);
      document.removeEventListener("visibilitychange", revive);
      socket.disconnect();
      window.clearTimeout(accessRefreshTimer);
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user?.id, user?.showActivity, hasAccessToken]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !accessToken) return;
    socket.auth = { token: accessToken };
    if (socket.connected) socket.emit("refresh_auth", { token: accessToken });
    else if (!socket.active) socket.connect();
  }, [accessToken]);

  const joinChannel = useCallback((channelId: string) => {
    activeChannelRef.current = channelId;
    socketRef.current?.emit("join_channel", { channelId });
  }, []);

  const leaveChannel = useCallback((channelId: string) => {
    if (activeChannelRef.current === channelId) {
      activeChannelRef.current = null;
    }
    socketRef.current?.emit("leave_channel", { channelId });
  }, []);

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      setConnectionStatus("connecting");
      socketRef.current.connect();
    }
  }, []);

  const sendMessage = (
    channelId: string,
    content: string,
    options?: {
      replyToId?: string;
      attachmentId?: string;
      clientMessageId?: string;
      threadRootId?: string;
      mentionedUserIds?: string[];
    },
  ): Promise<ChatMessageItem> => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !isConnected) {
        reject(new Error("Chưa kết nối tới máy chủ thời gian thực."));
        return;
      }

      socketRef.current
        .timeout(10000)
        .emit(
          "send_message",
          { channelId, content, clientMessageId: crypto.randomUUID(), ...options },
          (
            error: Error | null,
            response: { success: boolean; message?: ChatMessageItem; error?: string },
          ) => {
            if (error) {
              reject(
                new Error("Máy chủ chưa xác nhận. Bạn có thể thử lại an toàn với cùng mã gửi."),
              );
              return;
            }
            if (response?.success && response.message) {
              resolve(response.message);
            } else {
              reject(new Error(response?.error ?? "Không thể gửi tin nhắn."));
            }
          },
        );
    });
  };

  const setTyping = (channelId: string, isTyping: boolean) => {
    socketRef.current?.emit("typing", { channelId, isTyping });
  };

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        connectionStatus,
        onlineUserIds,
        typingUsers,
        unreadCount,
        groupUnreadCount,
        refreshUnreadCount,
        joinChannel,
        leaveChannel,
        sendMessage,
        setTyping,
        reconnect,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
