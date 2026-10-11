import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { ClientToServerEvents, ServerToClientEvents } from "@doan/shared";
import type { DtlsParameters, RtpCapabilities, RtpParameters } from "mediasoup/types";
import { Server } from "socket.io";
import { verifyAccessToken } from "../../modules/auth/tokens.js";
import { query, pool } from "../database/db.js";
import { createAdapter } from "@socket.io/postgres-adapter";
import { addPresence, onlinePeers, startPresence } from "./presence.js";
import { roomManager } from "../../modules/meetings/media/room-manager.js";
import { publishMeetingSummary } from "../../modules/meetings/outcome-events.js";
import { limitActor } from "../../shared/http/rate-limit.js";
import {
  enterSession,
  getMeetingState,
  leaveSession,
  meetingAction,
  requireAdmitted,
} from "../../modules/meetings/sessions.js";
import {
  membershipEvents,
  requireChannelAccess,
  saveMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  getMessageChannel,
  setChannelPreference,
} from "../../modules/workspaces/service.js";

interface SocketUser {
  id: string;
  displayName: string;
  showActivity: boolean;
}

// Event contracts are shared with the browser and documented in docs/17.

interface InterServerEvents {
  ping: () => void;
  revoke_user: (userId: string) => void;
  presence_visibility: (data: {
    userId: string;
    displayName: string;
    showActivity: boolean;
  }) => void;
}

interface SocketData {
  user: SocketUser;
  workspaceRooms: string[];
}

export function updatePresenceVisibility(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  userId: string,
  displayName: string,
  showActivity: boolean,
  broadcast = true,
): void {
  const rooms = new Set<string>();
  let wasVisible = false;
  let connected = false;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user?.id !== userId) continue;
    connected = true;
    wasVisible ||= socket.data.user.showActivity;
    socket.data.user.showActivity = showActivity;
    socket.data.user.displayName = displayName;
    for (const room of socket.rooms) if (room.startsWith("workspace:")) rooms.add(room);
  }
  if (connected && wasVisible !== showActivity && rooms.size)
    io.to([...rooms]).emit("user_presence", {
      userId,
      displayName,
      status: showActivity ? "online" : "offline",
    });
  if (broadcast && process.env.SOCKET_ADAPTER === "postgres")
    io.serverSideEmit("presence_visibility", { userId, displayName, showActivity });
}

export function initSocketServer(
  httpServer: HttpServer,
  webOrigin: string,
): Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> {
  const onlineUsers = new Map<string, { count: number; displayName: string }>();
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: webOrigin,
        credentials: true,
      },
    },
  );
  const distributed = process.env.SOCKET_ADAPTER === "postgres";
  const instanceId = process.env.API_INSTANCE_ID || randomUUID();
  io.on("presence_visibility", (data) =>
    updatePresenceVisibility(io, data.userId, data.displayName, data.showActivity, false),
  );
  if (distributed)
    io.adapter(
      createAdapter(pool, {
        channelPrefix: process.env.SOCKET_CHANNEL_PREFIX || "collabspace",
        tableName: "socket_io_attachments",
      }),
    );
  const stopPresence = startPresence(io, instanceId);
  httpServer.on("close", stopPresence);
  httpServer.once("close", () => {
    void io.close();
  });

  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.headers.authorization;
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

      if (!token) {
        return next(new Error("UNAUTHORIZED"));
      }

      const userId = await verifyAccessToken(token);
      const userResult = await query<{ id: string; display_name: string; show_activity: boolean }>(
        `SELECT id, display_name, show_activity FROM users WHERE id = $1`,
        [userId],
      );
      if (!userResult.rowCount) {
        return next(new Error("USER_NOT_FOUND"));
      }

      socket.data.user = {
        id: userId,
        displayName: userResult.rows[0].display_name,
        showActivity: userResult.rows[0].show_activity,
      };
      const memberships = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM memberships WHERE user_id=$1`,
        [userId],
      );
      socket.data.workspaceRooms = memberships.rows.map((row) => `workspace:${row.workspace_id}`);
      await socket.join([...socket.data.workspaceRooms, `user:${userId}`]);
      await addPresence(socket.id, userId, instanceId);
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });
  const revoke = (userId: string) => {
    for (const socket of io.sockets.sockets.values())
      if (socket.data.user?.id === userId) {
        socket.emit("access_revoked");
        socket.disconnect(true);
      }
  };
  const revokeEverywhere = (userId: string) => {
    revoke(userId);
    if (distributed) io.serverSideEmit("revoke_user", userId);
  };
  io.on("revoke_user", revoke);
  membershipEvents.on("removed", revokeEverywhere);
  httpServer.on("close", () => membershipEvents.off("removed", revokeEverywhere));
  const recipients = async (channelId: string) => {
    const access = await query<{ user_id: string }>(
      `SELECT user_id FROM channel_access WHERE channel_id=$1`,
      [channelId],
    );
    return access.rows.map((row) => `user:${row.user_id}`);
  };

  const meetingClosers = new Map<
    string,
    { userId: string; room: () => string | null; close: (reason?: string) => void }
  >();
  const mediaFailure = (data: { roomId: string; socketId: string; reason: string }) => {
    const closer = meetingClosers.get(data.socketId);
    if (closer?.room() === data.roomId) closer.close(data.reason);
  };
  roomManager.events.on("media_failure", mediaFailure);
  httpServer.on("close", () => roomManager.events.off("media_failure", mediaFailure));
  const activeSpeaker = (data: {
    roomId: string;
    socketId: string | null;
    userId: string | null;
    at: number;
  }) => io.to(`meeting:${data.roomId}`).emit("active_speaker", data);
  const audioLevels = (data: { roomId: string; levels: { socketId: string; volume: number }[] }) =>
    io.to(`meeting:${data.roomId}`).emit("audio_levels", data);
  roomManager.events.on("active_speaker", activeSpeaker);
  roomManager.events.on("audio_levels", audioLevels);
  httpServer.on("close", () => {
    roomManager.events.off("active_speaker", activeSpeaker);
    roomManager.events.off("audio_levels", audioLevels);
  });
  const closeRoom = (roomId: string, reason: string, targetUserId?: string) => {
    for (const closer of meetingClosers.values())
      if (closer.room() === roomId && (!targetUserId || closer.userId === targetUserId))
        closer.close(reason);
  };

  io.on("connection", async (socket) => {
    const user = socket.data.user;
    if (!user) return;

    let activeMeetingRoomId: string | null = null;
    let joiningMeeting = false;
    let participationId: string | null = null;
    const endParticipation = () => {
      if (!participationId) return;
      const id = participationId;
      participationId = null;
      void query(
        `UPDATE meeting_participations SET left_at = now() WHERE id = $1 AND left_at IS NULL`,
        [id],
      ).catch(console.error);
    };
    const dropMeeting = (reason?: string) => {
      const roomId = activeMeetingRoomId;
      activeMeetingRoomId = null;
      endParticipation();
      if (roomId) {
        const { closedProducerIds } = roomManager.leaveRoom(roomId, socket.id);
        for (const producerId of closedProducerIds)
          socket.to(`meeting:${roomId}`).emit("producer_closed", { producerId });
        socket.to(`meeting:${roomId}`).emit("peer_left", { socketId: socket.id, userId: user.id });
        if (reason) socket.emit("meeting_closed", { roomId, reason });
        void socket.leave(`meeting:${roomId}`);
      }
      void leaveSession(socket.id)
        .then((result) => {
          if (!result) return;
          io.to(`meeting:${result.channelId}`).emit("meeting_state_changed", {
            roomId: result.channelId,
          });
          if (result.ended) {
            closeRoom(
              result.channelId,
              "Phiên họp đã kết thúc vì host rời phòng và không còn người có thể tiếp quản.",
            );
            return publishMeetingSummary(
              io,
              result.channelId,
              result.sessionId,
              result.summaryMessageId,
            );
          }
        })
        .catch(console.error);
    };
    meetingClosers.set(socket.id, {
      userId: user.id,
      room: () => activeMeetingRoomId,
      close: dropMeeting,
    });
    let token = socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.slice(7);
    let burstStart = Date.now(),
      burstCount = 0;
    socket.use(async ([event, data, ack], next) => {
      try {
        if (Date.now() - burstStart > 10000) {
          burstStart = Date.now();
          burstCount = 0;
        }
        if (++burstCount > 250) throw new Error("Quá nhiều thao tác. Hãy thử lại sau.");
        if (event === "refresh_auth") {
          if ((await verifyAccessToken(data?.token)) !== user.id)
            throw new Error("Không được thay tài khoản trên kết nối hiện tại.");
          token = data.token;
          if (typeof ack === "function") ack({ success: true });
          return;
        }
        await verifyAccessToken(token);
        if (
          [
            "send_message",
            "edit_message",
            "delete_message",
            "react_message",
            "join_meeting",
            "meeting_action",
          ].includes(event)
        )
          await limitActor(user.id, "realtime-write", 120, 60);
        if (["meeting_state", "meeting_action"].includes(event))
          await requireChannelAccess(user.id, data?.roomId, true);
        if (["join_channel", "send_message", "typing"].includes(event)) {
          await requireChannelAccess(user.id, data?.channelId);
        }
        if (
          [
            "join_meeting",
            "create_webrtc_transport",
            "connect_webrtc_transport",
            "produce",
            "consume",
            "resume_consumer",
            "pause_consumer",
            "close_producer",
            "restart_ice",
            "consumer_layer",
          ].includes(event)
        ) {
          await requireChannelAccess(user.id, data?.roomId, true);
          if (event !== "join_meeting" && activeMeetingRoomId !== data.roomId)
            throw new Error("Bạn chưa tham gia phòng này.");
          if (event !== "join_meeting") await requireAdmitted(user.id, data.roomId, socket.id);
        }
        if (event === "leave_meeting" && activeMeetingRoomId !== data?.roomId)
          throw new Error("Phòng họp không hợp lệ.");
        if (
          event === "close_producer" &&
          !roomManager.getPeer(data.roomId, socket.id)?.producers.has(data.producerId)
        )
          throw new Error("Producer không thuộc tài khoản này.");
        if (ack !== undefined && typeof ack !== "function")
          throw new Error("Callback không hợp lệ.");
        if (
          [
            "join_meeting",
            "create_webrtc_transport",
            "connect_webrtc_transport",
            "produce",
            "consume",
          ].includes(event) &&
          typeof ack !== "function"
        )
          return;
        next();
      } catch {
        if (typeof ack === "function")
          ack({ success: false, error: "Yêu cầu không hợp lệ hoặc bạn không có quyền truy cập." });
      }
    });

    const workspaceRooms = socket.data.workspaceRooms;

    // Quản lý trạng thái online
    const current = onlineUsers.get(user.id);
    if (!current) {
      onlineUsers.set(user.id, { count: 1, displayName: user.displayName });
      if (workspaceRooms.length && user.showActivity)
        io.to(workspaceRooms).emit("user_presence", {
          userId: user.id,
          displayName: user.displayName,
          status: "online",
        });
    } else {
      current.count += 1;
    }

    // Gửi danh sách người dùng đang online cho client mới kết nối
    if (distributed)
      void onlinePeers([user.id])
        .then((peers) => socket.emit("online_users", peers.get(user.id) ?? []))
        .catch(() => {});
    else
      void (
        workspaceRooms.length ? io.in(workspaceRooms).fetchSockets() : Promise.resolve([socket])
      ).then((peers) =>
        socket.emit("online_users", [
          ...new Set(
            peers.filter((peer) => peer.data.user.showActivity).map((peer) => peer.data.user.id),
          ),
        ]),
      );

    // ================= CHAT EVENTS =================

    socket.on("join_channel", async (data) => {
      if (!data?.channelId) return;
      try {
        await requireChannelAccess(user.id, data.channelId);
        await socket.join(`channel:${data.channelId}`);
      } catch {
        socket.leave(`channel:${data.channelId}`);
      }
    });

    socket.on("leave_channel", (data) => {
      if (data?.channelId) {
        socket.leave(`channel:${data.channelId}`);
      }
    });

    socket.on("send_message", async (data, callback) => {
      try {
        if (!data?.channelId || (!data?.content && !data?.attachmentId)) {
          callback?.({ success: false, error: "Dữ liệu không hợp lệ" });
          return;
        }

        const { deduplicated, ...savedMessage } = await saveMessage(
          user.id,
          data.channelId,
          data.content,
          {
            replyToId: data.replyToId,
            attachmentId: data.attachmentId,
            clientMessageId: data.clientMessageId,
            threadRootId: data.threadRootId,
            mentionedUserIds: data.mentionedUserIds,
          },
        );
        if (!deduplicated)
          io.to(await recipients(data.channelId)).emit("new_message", savedMessage);
        if (!deduplicated) io.to(await recipients(data.channelId)).emit("notifications_changed");
        callback?.({ success: true, message: savedMessage });
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : "Không thể gửi tin nhắn";
        callback?.({ success: false, error: errMsg });
      }
    });

    socket.on("edit_message", async (data, callback) => {
      try {
        const channelId = await getMessageChannel(user.id, data.messageId);
        await editMessage(user.id, data.messageId, data.content);
        io.to(await recipients(channelId)).emit("message_changed", {
          channelId,
          messageId: data.messageId,
        });
        callback?.({ success: true });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không thể sửa tin nhắn.",
        });
      }
    });
    socket.on("delete_message", async (data, callback) => {
      try {
        const channelId = await getMessageChannel(user.id, data.messageId);
        await deleteMessage(user.id, data.messageId);
        io.to(await recipients(channelId)).emit("message_changed", {
          channelId,
          messageId: data.messageId,
          deleted: true,
        });
        callback?.({ success: true });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không thể xóa tin nhắn.",
        });
      }
    });
    socket.on("react_message", async (data, callback) => {
      try {
        const channelId = await getMessageChannel(user.id, data.messageId);
        await toggleReaction(user.id, data.messageId, data.emoji);
        io.to(await recipients(channelId)).emit("message_changed", {
          channelId,
          messageId: data.messageId,
        });
        callback?.({ success: true });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không thể thả cảm xúc.",
        });
      }
    });

    socket.on("mark_channel_read", async (data, callback) => {
      try {
        await setChannelPreference(user.id, data.channelId, { markRead: true });
        io.to(await recipients(data.channelId)).emit("channel_read", { channelId: data.channelId });
        callback?.({ success: true });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không đánh dấu đã xem được.",
        });
      }
    });

    socket.on("typing", async (data) => {
      if (!data?.channelId) return;
      try {
        await requireChannelAccess(user.id, data.channelId, false, true);
      } catch {
        return;
      }
      socket.to(await recipients(data.channelId)).emit("user_typing", {
        channelId: data.channelId,
        userId: user.id,
        displayName: user.displayName,
        isTyping: Boolean(data.isTyping),
      });
    });

    // ================= WEBRTC SFU SIGNALING =================
    socket.on("restart_ice", async (data, callback) => {
      try {
        callback({
          success: true,
          iceParameters: await roomManager.restartIce(data.roomId, socket.id, data.transportId),
        });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không khởi động lại ICE được.",
        });
      }
    });
    socket.on("consumer_layer", async (data, callback) => {
      try {
        await roomManager.setConsumerLayer(
          data.roomId,
          socket.id,
          data.consumerId,
          data.spatialLayer,
        );
        callback?.({ success: true });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không đổi layer được.",
        });
      }
    });

    socket.on("meeting_state", async (data, callback) => {
      try {
        callback({ success: true, state: await getMeetingState(user.id, data.roomId) });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không lấy được phiên họp.",
        });
      }
    });
    socket.on("meeting_action", async (data, callback) => {
      try {
        const acted = await meetingAction(user.id, data.roomId, socket.id, data);
        if (data.action === "end") {
          closeRoom(data.roomId, "Host đã kết thúc cuộc họp.");
          void publishMeetingSummary(
            io,
            data.roomId,
            acted.sessionId,
            acted.summaryMessageId,
          ).catch(console.error);
        }
        if (data.action === "kick")
          closeRoom(data.roomId, "Bạn đã bị host loại khỏi cuộc họp.", data.targetUserId);
        if (data.action === "mute" && data.targetUserId) {
          for (const target of meetingClosers.entries())
            if (target[1].room() === data.roomId && target[1].userId === data.targetUserId) {
              for (const producer of roomManager
                .getPeer(data.roomId, target[0])
                ?.producers.values() ?? [])
                if (producer.appData.source === "mic") {
                  roomManager.closeProducer(data.roomId, target[0], producer.id);
                  io.to(`meeting:${data.roomId}`).emit("producer_closed", {
                    producerId: producer.id,
                  });
                }
            }
          io.to(`user:${data.targetUserId}`).emit("meeting_mute", { roomId: data.roomId });
        }
        io.to(`meeting:${data.roomId}`).emit("meeting_state_changed", { roomId: data.roomId });
        callback?.({ success: true });
      } catch (error) {
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Không điều hành được cuộc họp.",
        });
      }
    });

    socket.on("join_meeting", async (data, callback) => {
      if (typeof callback !== "function") return;
      if (joiningMeeting || (activeMeetingRoomId && activeMeetingRoomId !== data.roomId)) {
        callback({
          success: false,
          error: "Hãy rời cuộc họp hiện tại trước khi tham gia phòng khác.",
        });
        return;
      }
      joiningMeeting = true;
      try {
        if (!data?.roomId) {
          callback({ success: false, error: "Thiếu mã phòng họp" });
          return;
        }

        const admission = await enterSession(
          user.id,
          data.roomId,
          socket.id,
          instanceId,
          data.scheduleId,
          true,
        );
        activeMeetingRoomId = data.roomId;
        await socket.join(`meeting:${data.roomId}`);
        io.to(`meeting:${data.roomId}`).emit("meeting_state_changed", { roomId: data.roomId });
        if (admission.state === "waiting") {
          callback({ success: true, waiting: true, sessionId: admission.sessionId });
          return;
        }
        await requireAdmitted(user.id, data.roomId, socket.id);
        const result = await roomManager.joinRoom(
          data.roomId,
          socket.id,
          user.id,
          user.displayName,
        );
        await requireAdmitted(user.id, data.roomId, socket.id);
        if (!socket.connected) {
          dropMeeting();
          return;
        }
        activeMeetingRoomId = data.roomId;
        if (!participationId) {
          participationId = randomUUID();
          await query(
            `INSERT INTO meeting_participations (id, channel_id, user_id, socket_id,session_id) VALUES ($1, $2, $3, $4,$5)`,
            [participationId, data.roomId, user.id, socket.id, admission.sessionId],
          );
        }
        await socket.join(`meeting:${data.roomId}`);

        callback({
          success: true,
          sessionId: admission.sessionId,
          routerRtpCapabilities: result.routerRtpCapabilities,
          existingProducers: result.existingProducers,
          activeSpeakerSocketId: roomManager.activeSpeaker(data.roomId),
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi tham gia phòng họp";
        dropMeeting();
        callback({ success: false, error: msg });
      } finally {
        joiningMeeting = false;
      }
    });

    socket.on("create_webrtc_transport", async (data, callback) => {
      try {
        const transportParams = await roomManager.createWebRtcTransport(data.roomId, socket.id);
        callback({ success: true, params: transportParams });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi tạo transport";
        callback({ success: false, error: msg });
      }
    });

    socket.on("connect_webrtc_transport", async (data, callback) => {
      try {
        await roomManager.connectTransport(
          data.roomId,
          socket.id,
          data.transportId,
          data.dtlsParameters as DtlsParameters,
        );
        callback({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi kết nối transport";
        callback({ success: false, error: msg });
      }
    });

    socket.on("produce", async (data, callback) => {
      try {
        const producerInfo = await roomManager.createProducer(
          data.roomId,
          socket.id,
          data.transportId,
          data.kind,
          data.rtpParameters as RtpParameters,
          data.appData,
        );

        // Thông báo cho tất cả các thành viên khác trong phòng
        socket.to(`meeting:${data.roomId}`).emit("new_producer", producerInfo);

        callback({ success: true, producerId: producerInfo.producerId });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi khởi tạo producer";
        callback({ success: false, error: msg });
      }
    });

    socket.on("consume", async (data, callback) => {
      try {
        const consumerOptions = await roomManager.createConsumer(
          data.roomId,
          socket.id,
          data.producerId,
          data.rtpCapabilities as RtpCapabilities,
        );

        if (!consumerOptions) {
          callback({ success: false, error: "Không thể consume luồng media này" });
          return;
        }

        callback({ success: true, params: consumerOptions });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi khởi tạo consumer";
        callback({ success: false, error: msg });
      }
    });

    socket.on("resume_consumer", async (data, callback) => {
      try {
        await roomManager.resumeConsumer(data.roomId, socket.id, data.consumerId);
        callback?.({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi mở consumer";
        callback?.({ success: false, error: msg });
      }
    });

    socket.on("pause_consumer", async (data, callback) => {
      try {
        await roomManager.pauseConsumer(data.roomId, socket.id, data.consumerId);
        callback?.({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi tạm dừng consumer";
        callback?.({ success: false, error: msg });
      }
    });

    socket.on("close_producer", (data, callback) => {
      try {
        roomManager.closeProducer(data.roomId, socket.id, data.producerId);
        socket.to(`meeting:${data.roomId}`).emit("producer_closed", {
          producerId: data.producerId,
        });
        callback?.({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi đóng producer";
        callback?.({ success: false, error: msg });
      }
    });

    socket.on("leave_meeting", (_data, callback) => {
      try {
        dropMeeting();
        callback?.({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Lỗi rời phòng họp";
        callback?.({ success: false, error: msg });
      }
    });

    // ================= DISCONNECT =================

    socket.on("disconnect", () => {
      void query(`DELETE FROM socket_presence WHERE socket_id=$1`, [socket.id])
        .then(() =>
          query(`SELECT 1 FROM socket_presence WHERE user_id=$1 AND expires_at>now() LIMIT 1`, [
            user.id,
          ]),
        )
        .then((result) => {
          if (distributed && !result.rowCount && user.showActivity)
            io.to(workspaceRooms).emit("user_presence", {
              userId: user.id,
              displayName: user.displayName,
              status: "offline",
            });
        })
        .catch(() => {});
      dropMeeting();
      meetingClosers.delete(socket.id);
      endParticipation();
      // Dọn dẹp phòng họp nếu đang tham gia
      if (activeMeetingRoomId) {
        const { closedProducerIds } = roomManager.leaveRoom(activeMeetingRoomId, socket.id);
        for (const pid of closedProducerIds) {
          socket.to(`meeting:${activeMeetingRoomId}`).emit("producer_closed", { producerId: pid });
        }
        socket.to(`meeting:${activeMeetingRoomId}`).emit("peer_left", {
          socketId: socket.id,
          userId: user.id,
        });
        activeMeetingRoomId = null;
      }

      // Cập nhật presence
      const active = onlineUsers.get(user.id);
      if (active) {
        active.count -= 1;
        if (active.count <= 0) {
          onlineUsers.delete(user.id);
          if (!distributed && workspaceRooms.length && user.showActivity)
            io.to(workspaceRooms).emit("user_presence", {
              userId: user.id,
              displayName: user.displayName,
              status: "offline",
            });
        }
      }
    });
  });

  return io;
}
