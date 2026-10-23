import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
process.env.JWT_SECRET = "integration-test-secret-at-least-32-characters";
import { io } from "socket.io-client";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { createApiServer } from "../../../dist/api/server.js";
import { createAccessToken } from "../../../dist/api/modules/auth/tokens.js";
import { hashPassword, verifyPassword } from "../../../dist/api/modules/auth/password.js";
import { roomManager } from "../../../dist/api/modules/meetings/media/room-manager.js";
import {
  addWorkspaceMember,
  createWorkspace,
  deleteMessage,
  getChannelMessages,
  getWorkspaceChannels,
  rejectWorkspaceMember,
  removeWorkspaceMember,
  saveMessage,
} from "../../../dist/api/modules/workspaces/service.js";
import { openDirectConversation } from "../../../dist/api/modules/chat/direct.js";

test(
  "PostgreSQL: workspace rights, latest history and socket isolation",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID();
    let workspace, privateWorkspace, server, directChannel;
    const sockets = [];
    try {
      for (const id of [owner, member, outsider])
        await pool.query(
          `INSERT INTO users (id,email,password_hash,display_name) VALUES ($1,$2,'test-only','Integration test')`,
          [id, `test-${id}@example.test`],
        );
      workspace = await createWorkspace(owner, "A".repeat(80));
      assert.ok(workspace.slug.length <= 80);
      await addWorkspaceMember(workspace.id, owner);
      const role = await pool.query(
        `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`,
        [workspace.id, owner],
      );
      assert.equal(role.rows[0].role, "owner");
      await addWorkspaceMember(workspace.id, member);
      const channels = await getWorkspaceChannels(owner, workspace.id);
      assert.ok(channels.some((c) => c.type === "video"));
      const channel = channels.find((c) => c.type === "text");
      await assert.rejects(getWorkspaceChannels(outsider, workspace.id), { statusCode: 403 });
      await assert.rejects(removeWorkspaceMember(workspace.id, owner), { statusCode: 403 });
      await assert.rejects(rejectWorkspaceMember(member, workspace.id, owner), { statusCode: 403 });
      await assert.rejects(saveMessage(member, channel.id, {}), { statusCode: 400 });
      await assert.rejects(getChannelMessages(member, "bad-id"), { statusCode: 400 });
      for (let i = 0; i < 60; i++)
        await pool.query(
          `INSERT INTO messages (id,channel_id,author_id,content,created_at) VALUES ($1,$2,$3,$4,now()+$5*interval '1 second')`,
          [randomUUID(), channel.id, owner, `message-${i}`, i],
        );
      const history = await getChannelMessages(member, channel.id);
      assert.equal(history.length, 50);
      assert.equal(history[0].content, "message-10");
      assert.equal(history[49].content, "message-59");
      const backfill = await getChannelMessages(
        member,
        channel.id,
        20,
        undefined,
        undefined,
        history[0].id,
      );
      assert.equal(backfill.length, 20);
      assert.equal(backfill[0].content, "message-11");
      const backfillNext = await getChannelMessages(
        member,
        channel.id,
        100,
        undefined,
        undefined,
        backfill.at(-1).id,
      );
      assert.equal(backfillNext.at(-1).content, "message-59");
      await assert.rejects(
        getChannelMessages(outsider, channel.id, 50, undefined, undefined, history[0].id),
        { statusCode: 403 },
      );
      const deliveryKey = randomUUID();
      const retried = await Promise.all(
        Array.from({ length: 6 }, () =>
          saveMessage(owner, channel.id, "same retry", { clientMessageId: deliveryKey }),
        ),
      );
      assert.equal(new Set(retried.map((item) => item.id)).size, 1);
      assert.equal(retried.filter((item) => !item.deduplicated).length, 1);
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS total FROM messages WHERE client_message_id=$1`,
            [deliveryKey],
          )
        ).rows[0].total,
        1,
      );
      await assert.rejects(
        saveMessage(owner, channel.id, "changed retry", { clientMessageId: deliveryKey }),
        { statusCode: 409 },
      );
      const channelsWithPreview = await getWorkspaceChannels(member, workspace.id);
      assert.equal(
        channelsWithPreview.find((item) => item.id === channel.id).lastMessage.content,
        "message-59",
      );
      privateWorkspace = await createWorkspace(outsider, "Private test space");
      const privateChannel = (await getWorkspaceChannels(outsider, privateWorkspace.id)).find(
        (item) => item.type === "text",
      );
      await saveMessage(owner, channel.id, "global-needle visible");
      await saveMessage(outsider, privateChannel.id, "global-needle private");
      await saveMessage(owner, channel.id, "literal%term");
      await saveMessage(owner, channel.id, "literalXterm");
      const deletedSearchMessage = await saveMessage(owner, channel.id, "global-needle deleted");
      await deleteMessage(owner, deletedSearchMessage.id);
      server = createApiServer().listen(0);
      await once(server, "listening");
      const base = `http://localhost:${server.address().port}`;
      process.env.TRUST_PROXY = "true";
      const passwordTestIp = `password-test-${randomUUID()}`;
      const passwordEmail = `test-${owner}@example.test`;
      await pool.query(`UPDATE users SET email_verified=true, password_hash=$2 WHERE id=$1`, [
        owner,
        await hashPassword("NewPassword123!"),
      ]);
      const passwordSessionId = randomUUID();
      await pool.query(
        `INSERT INTO refresh_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`,
        [passwordSessionId, owner, "a".repeat(64)],
      );
      const passwordHeaders = {
        "Content-Type": "application/json",
        "X-Forwarded-For": passwordTestIp,
      };
      const passwordLogin = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: passwordHeaders,
        body: JSON.stringify({ email: passwordEmail, password: "NewPassword123!" }),
      });
      assert.equal(passwordLogin.status, 200);
      const sessionToken = (await passwordLogin.json()).accessToken;
      const changeHeaders = { ...passwordHeaders, Authorization: `Bearer ${sessionToken}` };
      assert.equal(
        (
          await fetch(`${base}/auth/password/change`, {
            method: "POST",
            headers: changeHeaders,
            body: JSON.stringify({
              currentPassword: "incorrect",
              newPassword: "FinalPassword123!",
            }),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(`${base}/auth/password/change`, {
            method: "POST",
            headers: changeHeaders,
            body: JSON.stringify({
              currentPassword: "NewPassword123!",
              newPassword: "FinalPassword123!",
            }),
          })
        ).status,
        200,
      );
      const afterChange = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [owner]);
      assert.equal(
        await verifyPassword("FinalPassword123!", afterChange.rows[0].password_hash),
        true,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT 1 FROM refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL`,
            [owner],
          )
        ).rowCount,
        0,
      );
      process.env.TRUST_PROXY = "true";
      const limitHeaders = {
        "Content-Type": "application/json",
        "X-Forwarded-For": `test-${randomUUID()}`,
      };
      for (let i = 0; i < 10; i++) {
        const response = await fetch(`${base}/auth/login`, {
          method: "POST",
          headers: limitHeaders,
          body: JSON.stringify({ email: "missing@example.test", password: "wrong-password" }),
        });
        assert.equal(response.status, 401);
      }
      const limited = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: limitHeaders,
        body: JSON.stringify({ email: "missing@example.test", password: "wrong-password" }),
      });
      assert.equal(limited.status, 429);
      const invalid = await fetch(`${base}/api/workspaces`, {
        headers: { Authorization: "Bearer invalid" },
      });
      assert.equal(invalid.status, 401);
      const ownerToken = await createAccessToken(owner);
      const searchResponse = await fetch(`${base}/api/search/messages?q=global-needle`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(searchResponse.status, 200);
      const searchItems = (await searchResponse.json()).messages;
      assert.deepEqual(
        searchItems.map((item) => item.content),
        ["global-needle visible"],
      );
      assert.equal(searchItems[0].workspaceId, workspace.id);
      const literalSearch = await fetch(`${base}/api/search/messages?q=literal%25term`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.deepEqual(
        (await literalSearch.json()).messages.map((item) => item.content),
        ["literal%term"],
      );
      const channelLiteralSearch = await fetch(
        `${base}/api/channels/${channel.id}/messages?search=literal%25term`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      assert.deepEqual(
        (await channelLiteralSearch.json()).messages.map((item) => item.content),
        ["literal%term"],
      );
      assert.equal(
        (
          await fetch(`${base}/api/search/messages?q=x`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
          })
        ).status,
        400,
      );
      const previewResponse = await fetch(`${base}/api/channels/${channel.id}/messages?limit=1`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const latestMessage = (await previewResponse.json()).messages[0];
      assert.equal(latestMessage.content, "message-59");
      const paginatedResponse = await fetch(
        `${base}/api/channels/${channel.id}/messages?limit=2&before=${latestMessage.id}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      assert.equal(paginatedResponse.status, 200);
      const paginatedMessages = (await paginatedResponse.json()).messages;
      assert.equal(paginatedMessages.length, 2);
      assert.equal(paginatedMessages[1].content, "message-58");
      assert.equal(paginatedMessages[0].content, "message-57");
      const invalidLimitResponse = await fetch(
        `${base}/api/channels/${channel.id}/messages?limit=0`,
        {
          headers: { Authorization: `Bearer ${ownerToken}` },
        },
      );
      assert.equal(invalidLimitResponse.status, 400);
      const profile = await fetch(`${base}/auth/profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Updated test owner",
          statusText: "Đang làm đồ án",
          pronouns: "mình / bạn",
          location: "TP. Hồ Chí Minh",
          interests: ["Âm nhạc", "Thiết kế"],
          favoriteMusic: "Lofi",
          contactText: "owner@example.com",
          showContact: false,
          showActivity: false,
        }),
      });
      assert.equal(profile.status, 200);
      const updatedUser = (await profile.json()).user;
      assert.equal(updatedUser.displayName, "Updated test owner");
      assert.deepEqual(updatedUser.interests, ["Âm nhạc", "Thiết kế"]);
      const memberToken = await createAccessToken(member);
      const publicProfile = await fetch(`${base}/api/users/${owner}/profile`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.equal(publicProfile.status, 200);
      const sharedProfile = (await publicProfile.json()).profile;
      assert.equal(sharedProfile.statusText, "Đang làm đồ án");
      assert.equal(sharedProfile.favoriteMusic, "Lofi");
      assert.deepEqual(sharedProfile.interests, ["Âm nhạc", "Thiết kế"]);
      assert.equal(sharedProfile.contactText, "");
      assert.equal(sharedProfile.showActivity, false);
      // Sharing a direct conversation is enough to see the other person's profile (DM avatars).
      const outsiderProfile = async () =>
        (
          await fetch(`${base}/api/users/${owner}/profile`, {
            headers: { Authorization: `Bearer ${await createAccessToken(outsider)}` },
          })
        ).status;
      assert.equal(await outsiderProfile(), 404);
      directChannel = await openDirectConversation(outsider, owner);
      assert.equal(await outsiderProfile(), 200);
      const invalidInterests = await fetch(`${base}/auth/profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ interests: Array(9).fill("Sở thích") }),
      });
      assert.equal(invalidInterests.status, 400);
      const privateProfile = await fetch(`${base}/auth/profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Updated test owner", profileVisibility: "private" }),
      });
      assert.equal(privateProfile.status, 200);
      assert.equal(
        (
          await fetch(`${base}/api/users/${owner}/profile`, {
            headers: { Authorization: `Bearer ${memberToken}` },
          })
        ).status,
        404,
      );
      const meetingRoom = channels.find((item) => item.type === "video");
      const meetingStart = new Date(Date.now() + 2 * 3_600_000);
      const scheduleInput = {
        roomId: meetingRoom.id,
        title: "Họp tiến độ đồ án",
        description: "Cập nhật nhiệm vụ tuần này",
        startsAt: meetingStart.toISOString(),
        endsAt: new Date(meetingStart.getTime() + 3_600_000).toISOString(),
      };
      const createdSchedule = await fetch(`${base}/api/meetings/schedules`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(scheduleInput),
      });
      assert.equal(createdSchedule.status, 201);
      const scheduleId = (await createdSchedule.json()).schedule.id;
      const memberSchedules = await fetch(`${base}/api/meetings/schedules`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.equal(memberSchedules.status, 200);
      assert.equal((await memberSchedules.json()).schedules[0].title, scheduleInput.title);
      const memberEdit = await fetch(`${base}/api/meetings/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${memberToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...scheduleInput, title: "Không được sửa" }),
      });
      assert.equal(memberEdit.status, 403);
      const outsiderToken = await createAccessToken(outsider);
      const outsiderSchedules = await fetch(`${base}/api/meetings/schedules`, {
        headers: { Authorization: `Bearer ${outsiderToken}` },
      });
      assert.equal((await outsiderSchedules.json()).schedules.length, 0);
      const outsiderCreate = await fetch(`${base}/api/meetings/schedules`, {
        method: "POST",
        headers: { Authorization: `Bearer ${outsiderToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(scheduleInput),
      });
      assert.equal(outsiderCreate.status, 404);
      const outsiderEdit = await fetch(`${base}/api/meetings/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${outsiderToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(scheduleInput),
      });
      assert.equal(outsiderEdit.status, 404);
      const invalidRoomEdit = await fetch(`${base}/api/meetings/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...scheduleInput, roomId: channel.id }),
      });
      assert.equal(invalidRoomEdit.status, 404);
      const invalidSchedule = await fetch(`${base}/api/meetings/schedules`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...scheduleInput,
          endsAt: new Date(meetingStart.getTime() + 60_000).toISOString(),
        }),
      });
      assert.equal(invalidSchedule.status, 400);
      const editedSchedule = await fetch(`${base}/api/meetings/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...scheduleInput, title: "Họp đã chỉnh sửa" }),
      });
      assert.equal(editedSchedule.status, 200);
      assert.equal((await editedSchedule.json()).schedule.title, "Họp đã chỉnh sửa");
      const canceledSchedule = await fetch(`${base}/api/meetings/schedules/${scheduleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(canceledSchedule.status, 200);
      const afterCancel = await fetch(`${base}/api/meetings/schedules`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.equal((await afterCancel.json()).schedules.length, 0);
      const preference = await fetch(`${base}/api/channels/${channel.id}/preferences`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true, muted: true, markRead: true }),
      });
      assert.equal(preference.status, 200);
      assert.deepEqual((await preference.json()).preference, { pinned: true, muted: true });
      const uploaded = await fetch(`${base}/api/channels/${channel.id}/attachments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "text/plain",
          "X-File-Name": "qa.txt",
        },
        body: "attachment test",
      });
      assert.equal(uploaded.status, 201);
      const attachmentId = (await uploaded.json()).attachment.id;
      const voiceUpload = await fetch(`${base}/api/channels/${channel.id}/attachments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "audio/webm",
          "X-File-Name": "voice.webm",
        },
        body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      });
      assert.equal(voiceUpload.status, 201);
      const voiceId = (await voiceUpload.json()).attachment.id;
      const voiceMessage = await saveMessage(owner, channel.id, "", { attachmentId: voiceId });
      assert.equal(voiceMessage.attachment.mimeType, "audio/webm");
      const voiceDownload = await fetch(`${base}/api/attachments/${voiceId}`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.equal(voiceDownload.status, 200);
      assert.match(voiceDownload.headers.get("content-disposition"), /^inline/);
      assert.equal(
        (
          await fetch(`${base}/api/attachments/${attachmentId}`, {
            headers: { Authorization: `Bearer ${memberToken}` },
          })
        ).status,
        404,
      );
      const attached = await saveMessage(owner, channel.id, "File để kiểm thử", {
        replyToId: latestMessage.id,
        attachmentId,
      });
      assert.equal(attached.replyToContent, "message-59");
      assert.equal(attached.attachment.fileName, "qa.txt");
      await assert.rejects(saveMessage(owner, channel.id, "reuse", { attachmentId }), {
        statusCode: 400,
      });
      const downloaded = await fetch(`${base}/api/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.equal(downloaded.status, 200);
      assert.equal(await downloaded.text(), "attachment test");
      await deleteMessage(owner, attached.id);
      assert.equal(
        (
          await fetch(`${base}/api/attachments/${attachmentId}`, {
            headers: { Authorization: `Bearer ${memberToken}` },
          })
        ).status,
        404,
      );
      const invalidId = await fetch(`${base}/api/workspaces/bad-id/channels`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(invalidId.status, 400);
      const connect = async (id) => {
        const socket = io(base, {
          auth: { token: await createAccessToken(id) },
          transports: ["websocket"],
          forceNew: true,
        });
        sockets.push(socket);
        const [online] = await once(socket, "online_users");
        return { socket, online };
      };
      const a = await connect(owner),
        b = await connect(member),
        c = await connect(outsider);
      assert.ok(!c.online.includes(owner));
      assert.ok(!b.online.includes(owner));
      const onlinePresence = once(b.socket, "user_presence");
      const showOnline = await fetch(`${base}/auth/profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ showActivity: true }),
      });
      assert.equal(showOnline.status, 200);
      assert.equal((await onlinePresence)[0].status, "online");
      const offlinePresence = once(b.socket, "user_presence");
      const hideOnline = await fetch(`${base}/auth/profile`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ showActivity: false }),
      });
      assert.equal(hideOnline.status, 200);
      assert.equal((await offlinePresence)[0].status, "offline");
      let leaked = false;
      c.socket.on("new_message", () => {
        leaked = true;
      });
      c.socket.on("message_changed", () => {
        leaked = true;
      });
      c.socket.on("user_typing", () => {
        leaked = true;
      });
      a.socket.emit("join_channel", { channelId: channel.id });
      b.socket.emit("join_channel", { channelId: channel.id });
      c.socket.emit("join_channel", { channelId: channel.id });
      await delay(100);
      const ack = (socket, event, data) => socket.timeout(3000).emitWithAck(event, data);
      const received = once(b.socket, "new_message");
      const sent = await ack(a.socket, "send_message", {
        channelId: channel.id,
        content: "live message",
      });
      assert.equal(sent.success, true);
      assert.equal((await received)[0].content, "live message");
      const socketDeliveryId = randomUUID();
      const socketPayload = {
        channelId: channel.id,
        content: "lost ACK simulation",
        clientMessageId: socketDeliveryId,
      };
      let deliveryEvents = 0;
      const onDelivery = (message) => {
        if (message.clientMessageId === socketDeliveryId) deliveryEvents++;
      };
      b.socket.on("new_message", onDelivery);
      // Ignore the first ACK, then resend the identical payload.
      a.socket.emit("send_message", socketPayload);
      await delay(100);
      const retryAck = await ack(a.socket, "send_message", socketPayload);
      assert.equal(retryAck.success, true);
      assert.equal(retryAck.message.clientMessageId, socketDeliveryId);
      await delay(100);
      assert.equal(deliveryEvents, 1);
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS total FROM messages WHERE client_message_id=$1`,
            [socketDeliveryId],
          )
        ).rows[0].total,
        1,
      );
      b.socket.off("new_message", onDelivery);
      const readEvent = once(a.socket, "channel_read");
      assert.equal(
        (await ack(b.socket, "mark_channel_read", { channelId: channel.id })).success,
        true,
      );
      assert.equal((await readEvent)[0].channelId, channel.id);
      const readHistory = await getChannelMessages(owner, channel.id, 100);
      assert.equal(readHistory.find((message) => message.id === sent.message.id).seenCount, 1);
      assert.equal(
        (await ack(c.socket, "mark_channel_read", { channelId: channel.id })).success,
        false,
      );
      a.socket.emit("typing", { channelId: channel.id, isTyping: true });
      assert.equal(
        (
          await ack(a.socket, "edit_message", {
            messageId: sent.message.id,
            content: "edited live message",
          })
        ).success,
        true,
      );
      assert.equal(
        (await ack(c.socket, "send_message", { channelId: channel.id, content: "forbidden" }))
          .success,
        false,
      );
      assert.equal(
        (
          await ack(c.socket, "join_meeting", {
            roomId: channels.find((ch) => ch.type === "video").id,
          })
        ).success,
        false,
      );
      await delay(100);
      assert.equal(leaked, false);
      if (process.env.RUN_SFU_TESTS === "1") {
        await addWorkspaceMember(workspace.id, outsider);
        const roomId = channels.find((ch) => ch.type === "video").id;
        const joinResults = await Promise.all(
          [a.socket, b.socket, c.socket].map((s) =>
            s.timeout(10000).emitWithAck("join_meeting", { roomId }),
          ),
        );
        assert.ok(
          joinResults.every((r) => r.success),
          JSON.stringify(joinResults),
        );
        const transports = await Promise.all(
          [a.socket, b.socket, c.socket].map((s) => ack(s, "create_webrtc_transport", { roomId })),
        );
        assert.ok(transports.every((r) => r.success));
        assert.equal(roomManager.getPeer(roomId, a.socket.id)?.userId, owner);
        await ack(a.socket, "leave_meeting", { roomId });
        await ack(b.socket, "leave_meeting", { roomId });
        await ack(c.socket, "leave_meeting", { roomId });
        await delay(100);
        const sessions = await pool.query(
          `SELECT left_at FROM meeting_participations WHERE channel_id=$1`,
          [roomId],
        );
        assert.equal(sessions.rowCount, 3);
        assert.ok(sessions.rows.every((r) => r.left_at));
      }
      const disconnected = once(b.socket, "disconnect");
      await rejectWorkspaceMember(owner, workspace.id, member);
      await disconnected;
      await assert.rejects(saveMessage(member, channel.id, "revoked"), { statusCode: 403 });
      await assert.rejects(
        saveMessage(member, channel.id, socketPayload.content, {
          clientMessageId: socketDeliveryId,
        }),
        { statusCode: 403 },
      );
      await assert.rejects(
        getChannelMessages(member, channel.id, 100, undefined, undefined, history[0].id),
        { statusCode: 403 },
      );
    } finally {
      sockets.forEach((s) => s.disconnect());
      roomManager.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      if (privateWorkspace)
        await pool.query(`DELETE FROM workspaces WHERE id=$1`, [privateWorkspace.id]);
      if (directChannel) await pool.query(`DELETE FROM channels WHERE id=$1`, [directChannel.id]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[owner, member, outsider]]);
      await pool.end();
    }
  },
);
