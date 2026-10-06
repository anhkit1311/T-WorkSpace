import type {
  ChatMessageItem,
  ConsumerOptions,
  MediaKind,
  PresenceEvent,
  ProducerInfo,
  ProducerSource,
  TransportOptions,
  TypingEvent,
} from "./index.js";
export interface ServerToClientEvents {
  meeting_state_changed: (data: { roomId: string }) => void;
  meeting_closed: (data: { roomId: string; reason: string }) => void;
  meeting_mute: (data: { roomId: string }) => void;
  task_changed: (data: { channelId: string; taskId: string; version: number }) => void;
  notifications_changed: () => void;
  access_revoked: () => void;
  user_presence: (data: PresenceEvent) => void;
  online_users: (userIds: string[]) => void;
  new_message: (message: ChatMessageItem) => void;
  message_changed: (data: { channelId: string; messageId: string; deleted?: boolean }) => void;
  channel_read: (data: { channelId: string }) => void;
  user_typing: (data: TypingEvent) => void;
  // WebRTC events
  new_producer: (producer: ProducerInfo) => void;
  producer_closed: (data: { producerId: string }) => void;
  peer_left: (data: { socketId: string; userId: string }) => void;
}

export interface ClientToServerEvents {
  restart_ice: (
    data: { roomId: string; transportId: string },
    callback: (response: { success: boolean; iceParameters?: unknown; error?: string }) => void,
  ) => void;
  consumer_layer: (
    data: { roomId: string; consumerId: string; spatialLayer: number },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  meeting_state: (
    data: { roomId: string },
    callback: (response: { success: boolean; state?: unknown; error?: string }) => void,
  ) => void;
  meeting_action: (
    data: { roomId: string; action: string; targetUserId?: string; enabled?: boolean },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  refresh_auth: (
    data: { token: string },
    callback?: (response: { success: boolean }) => void,
  ) => void;
  join_channel: (data: { channelId: string }) => void;
  leave_channel: (data: { channelId: string }) => void;
  send_message: (
    data: {
      channelId: string;
      content: string;
      replyToId?: string;
      attachmentId?: string;
      clientMessageId?: string;
      threadRootId?: string;
      mentionedUserIds?: string[];
    },
    callback?: (response: { success: boolean; message?: ChatMessageItem; error?: string }) => void,
  ) => void;
  edit_message: (
    data: { messageId: string; content: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  delete_message: (
    data: { messageId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  react_message: (
    data: { messageId: string; emoji: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  mark_channel_read: (
    data: { channelId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  typing: (data: { channelId: string; isTyping: boolean }) => void;
  // WebRTC events
  join_meeting: (
    data: { roomId: string; scheduleId?: string },
    callback: (response: {
      success: boolean;
      routerRtpCapabilities?: unknown;
      existingProducers?: ProducerInfo[];
      error?: string;
      waiting?: boolean;
      sessionId?: string;
    }) => void,
  ) => void;
  create_webrtc_transport: (
    data: { roomId: string },
    callback: (response: { success: boolean; params?: TransportOptions; error?: string }) => void,
  ) => void;
  connect_webrtc_transport: (
    data: { roomId: string; transportId: string; dtlsParameters: unknown },
    callback: (response: { success: boolean; error?: string }) => void,
  ) => void;
  produce: (
    data: {
      roomId: string;
      transportId: string;
      kind: MediaKind;
      rtpParameters: unknown;
      appData: { source: ProducerSource };
    },
    callback: (response: { success: boolean; producerId?: string; error?: string }) => void,
  ) => void;
  consume: (
    data: {
      roomId: string;
      producerId: string;
      rtpCapabilities: unknown;
    },
    callback: (response: { success: boolean; params?: ConsumerOptions; error?: string }) => void,
  ) => void;
  resume_consumer: (
    data: { roomId: string; consumerId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  pause_consumer: (
    data: { roomId: string; consumerId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  close_producer: (
    data: { roomId: string; producerId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
  leave_meeting: (
    data: { roomId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) => void;
}
