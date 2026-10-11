export type PresenceStatus = "online" | "offline" | "idle";

export type HealthResponse = {
  service: string;
  status: "ok";
  timestamp: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string;
  coverUrl?: string | null;
  contactText?: string;
  statusText?: string;
  pronouns?: string;
  location?: string;
  interests?: string[];
  favoriteMusic?: string;
  profileVisibility?: "workspace" | "private";
  showActivity?: boolean;
  showContact?: boolean;
  notificationsEnabled?: boolean;
  authProvider?: "local" | "google";
  emailVerified?: boolean;
};

export type MemberProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string;
  contactText: string;
  statusText: string;
  pronouns: string;
  location: string;
  interests: string[];
  favoriteMusic: string;
  showActivity: boolean;
};

export type MeetingScheduleItem = {
  id: string;
  roomId: string;
  workspaceId: string;
  roomName: string;
  workspaceName: string;
  createdBy: string;
  organizerName: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  canManage: boolean;
  agenda?: string[];
};

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
};

export type RegisterResponse = {
  requireOtp: boolean;
  email: string;
  message: string;
};

export type VerifyOtpInput = {
  email: string;
  otp: string;
};

export type ResendOtpInput = {
  email: string;
};

export type ResendOtpResponse = {
  success: boolean;
  message: string;
  cooldownSeconds: number;
};

export type GoogleAuthInput = {
  credential?: string;
  idToken?: string;
  code?: string;
  redirectUri?: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export type MemberRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "pending" | "rejected";

export type GroupMemberItem = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
};

export type WorkspaceItem = {
  description?: string;
  archivedAt?: string | null;
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
  memberCount?: number;
  unreadCount?: number;
};

export type ChannelItem = {
  description?: string;
  isPrivate?: boolean;
  archivedAt?: string | null;
  id: string;
  workspaceId: string;
  name: string;
  type: "text" | "voice" | "video";
  position: number;
  lastMessage?: ChatMessageItem | null;
  pinned?: boolean;
  muted?: boolean;
  unreadCount?: number;
};

export type ChatMessageItem = {
  threadRootId?: string | null;
  replyCount?: number;
  threadUnreadCount?: number;
  pinned?: boolean;
  bookmarked?: boolean;
  mentions?: { userId: string; displayName: string }[];
  clientMessageId?: string | null;
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  seenCount?: number;
  replyToId?: string | null;
  replyToContent?: string | null;
  attachment?: { id: string; fileName: string; mimeType: string; fileSize: number } | null;
  reactions?: { emoji: string; count: number; reacted: boolean }[];
  kind?: "user" | "meeting_summary";
  meetingSessionId?: string | null;
};

export type GlobalMessageSearchItem = {
  threadRootId?: string | null;
  authorId?: string;
  id: string;
  workspaceId: string;
  workspaceName: string;
  channelId: string;
  channelName: string;
  authorName: string;
  content: string;
  createdAt: string;
};

export type TypingEvent = {
  channelId: string;
  userId: string;
  displayName: string;
  isTyping: boolean;
};

export type PresenceEvent = {
  userId: string;
  displayName: string;
  status: PresenceStatus;
};

export type MediaKind = "audio" | "video";
export type ProducerSource = "mic" | "webcam" | "screen";

export type ProducerInfo = {
  producerId: string;
  socketId: string;
  userId: string;
  displayName: string;
  kind: MediaKind;
  source: ProducerSource;
};

export type TransportOptions = {
  iceServers?: { urls: string[]; username?: string; credential?: string }[];
  /** Client-side override; "relay" forces media through TURN (used to verify the relay path). */
  iceTransportPolicy?: "all" | "relay";
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown[];
  dtlsParameters: unknown;
};

export type ConsumerOptions = {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: unknown;
  producerSocketId: string;
  userId: string;
  displayName: string;
  source: ProducerSource;
};

export type QosMetrics = {
  sendBitrate?:number|null;
  receiveBitrate?:number|null;
  selectedCandidatePairs?:string[];
  rtt: number | null;
  packetLoss: number | null;
  bitrate: number | null;
  jitter: number | null;
};
export interface TaskItem {
  id: string;
  channelId: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  sourceMessageId: string | null;
  meetingSessionId: string | null;
  position: number;
  version: number;
  archivedAt: string | null;
  updatedAt: string;
  checklistTotal: number;
  checklistDone: number;
}
export interface TaskDetail extends TaskItem {
  checklist: { id: string; label: string; done: boolean }[];
  comments: {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: string;
  }[];
  attachments: { id: string; fileName: string; mimeType: string; fileSize: number }[];
  activity: {
    id: string;
    actorName: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
}
export type {ClientToServerEvents,ServerToClientEvents} from './socket.js';
export interface MeetingState {
  id: string;
  channelId: string;
  scheduleId: string | null;
  hostId: string;
  waitingEnabled: boolean;
  locked: boolean;
  startedAt: string;
  maxUsers: number;
  participants: {
    userId: string;
    displayName: string;
    role: "host" | "cohost" | "member";
    state: "waiting" | "admitted" | "kicked";
    raisedHand: boolean;
    connections: number;
  }[];
}
export interface MeetingAgendaItem {
  id: string;
  label: string;
  done: boolean;
  doneByName: string | null;
  fromSchedule: boolean;
}
export interface MeetingNotes {
  content: string;
  version: number;
  updatedByName: string | null;
  updatedAt: string | null;
}
export interface MeetingOutcomeTask {
  id: string;
  channelId: string;
  title: string;
  status: TaskItem["status"];
  assigneeName: string | null;
  dueAt: string | null;
}
export interface MeetingOutcomes {
  sessionId: string;
  roomId: string;
  roomName: string;
  workspaceId: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  hostId: string;
  outcomeChannelId: string | null;
  outcomeChannelName: string | null;
  canEdit: boolean;
  canManage: boolean;
  attendees: { userId: string; displayName: string }[];
  agenda: MeetingAgendaItem[];
  notes: MeetingNotes;
  tasks: MeetingOutcomeTask[];
  summaryMessageId: string | null;
}
export interface HomeSummary {
 tasks:{id:string;title:string;status:'todo'|'doing';priority:'low'|'normal'|'high'|'urgent';dueAt:string|null;channelId:string;channelName:string;workspaceId:string}[];
 meetings:MeetingScheduleItem[];
 unreadNotifications:number;
}

export interface WorkspaceFileItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  channelId: string;
  channelName: string;
  uploaderId: string;
  uploaderName: string;
  createdAt: string;
  messageId: string | null;
  taskId: string | null;
  taskTitle: string | null;
  pinned: boolean;
}

export interface WorkspaceOverviewSummary {
  tasks: {
    id: string;
    title: string;
    status: "todo" | "doing" | "done";
    priority: "low" | "normal" | "high" | "urgent";
    dueAt: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    channelId: string;
    channelName: string;
    workspaceId: string;
    version: number;
  }[];
  recentMessages: {
    id: string;
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: string;
    attachmentName: string | null;
  }[];
  meetings: MeetingScheduleItem[];
  rooms: {
    id: string;
    name: string;
    type: "voice" | "video";
    description: string;
  }[];
  files: WorkspaceFileItem[];
}

