import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
process.env.JWT_SECRET = "governance-test-secret-at-least-32-characters";
import { io } from "socket.io-client";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { createApiServer } from "../../../dist/api/server.js";
import { createAccessToken } from "../../../dist/api/modules/auth/tokens.js";
import {
  createWorkspace,
  addWorkspaceMember,
  getWorkspaceChannels,
  getChannelMessages,
  saveMessage,
  searchMessages,
  getAttachmentMetadata,
  editMessage,
  deleteMessage,
  toggleReaction,
  requireChannelAccess,
} from "../../../dist/api/modules/workspaces/service.js";
import {
  saveChannel,
  setChannelMember,
  updateWorkspace,
  changeMember,
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  reorderChannels,
  getAdministration,
} from "../../../dist/api/modules/workspaces/governance.js";
import {
  createMeetingSchedule,
  listMeetingSchedules,
} from "../../../dist/api/modules/meetings/schedules.js";
import { roomManager } from "../../../dist/api/modules/meetings/media/room-manager.js";

test(
  "Governance: private rights, invitation lifecycle, archive and owner integrity",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID();
    let workspace, server;
    const sockets = [];
    try {
      for (const id of [owner, member, outsider])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Governance QA',true)`,
          [id, `test-${id}@example.test`],
        );
      workspace = await createWorkspace(owner, "Governance test");
      await addWorkspaceMember(workspace.id, member);
      await assert.rejects(
        saveChannel(member, workspace.id, undefined, {
          name: "private",
          type: "text",
          isPrivate: true,
        }),
        { statusCode: 403 },
      );
      const privateChannel = await saveChannel(owner, workspace.id, undefined, {
        name: "private",
        type: "text",
        isPrivate: true,
      });
      const privateRoom = await saveChannel(owner, workspace.id, undefined, {
        name: "private-room",
        type: "video",
        isPrivate: true,
      });
      assert.ok(
        !(await getWorkspaceChannels(member, workspace.id)).some(
          (item) => item.id === privateChannel.id,
        ),
      );
      await assert.rejects(requireChannelAccess(member, privateRoom.id, true), { statusCode: 403 });
      const secret = await saveMessage(owner, privateChannel.id, "private-needle");
      await assert.rejects(getChannelMessages(member, privateChannel.id), { statusCode: 403 });
      await assert.rejects(saveMessage(member, privateChannel.id, "leak"), { statusCode: 403 });
      await assert.rejects(editMessage(member, secret.id, "leak"), { statusCode: 403 });
      await assert.rejects(toggleReaction(member, secret.id, "👍"), { statusCode: 403 });
      assert.equal((await searchMessages(member, "private-needle")).length, 0);
      assert.equal((await searchMessages(owner, "private-needle")).length, 1);
      server = createApiServer().listen(0);
      await once(server, "listening");
      const base = `http://localhost:${server.address().port}`;
      const auth = async (id) => ({ Authorization: `Bearer ${await createAccessToken(id)}` });
      assert.equal(
        (
          await fetch(`${base}/api/workspaces/${workspace.id}/administration`, {
            headers: await auth(member),
          })
        ).status,
        403,
      );
      const upload = await fetch(`${base}/api/channels/${privateChannel.id}/attachments`, {
        method: "POST",
        headers: {
          ...(await auth(owner)),
          "Content-Type": "text/plain",
          "X-File-Name": "private.txt",
        },
        body: "private document",
      });
      assert.equal(upload.status, 201);
      const attachment = (await upload.json()).attachment;
      await saveMessage(owner, privateChannel.id, "private-file", {
        attachmentId: attachment.id,
        clientMessageId: randomUUID(),
      });
      await assert.rejects(getAttachmentMetadata(member, attachment.id), { statusCode: 404 });
      assert.equal(
        (await fetch(`${base}/api/attachments/${attachment.id}`, { headers: await auth(member) }))
          .status,
        404,
      );
      const connect = async (id) => {
        const socket = io(base, {
          auth: { token: await createAccessToken(id) },
          transports: ["websocket"],
          forceNew: true,
        });
        sockets.push(socket);
        await once(socket, "online_users");
        return socket;
      };
      const a = await connect(owner),
        b = await connect(member);
      let leaked = false;
      b.on("new_message", () => {
        leaked = true;
      });
      const sent = await a
        .timeout(3000)
        .emitWithAck("send_message", {
          channelId: privateChannel.id,
          content: "socket private",
          clientMessageId: randomUUID(),
        });
      assert.equal(sent.success, true);
      await delay(50);
      assert.equal(leaked, false);
      assert.equal(
        (await b.timeout(3000).emitWithAck("join_meeting", { roomId: privateRoom.id })).success,
        false,
      );
      await setChannelMember(owner, workspace.id, privateChannel.id, member, true);
      assert.ok((await getChannelMessages(member, privateChannel.id)).length > 0);
      assert.ok(await getAttachmentMetadata(member, attachment.id));
      const allowed = await connect(member);
      const revoked = once(allowed, "access_revoked");
      const disconnected = once(allowed, "disconnect");
      await setChannelMember(owner, workspace.id, privateChannel.id, member, false);
      await revoked;
      await disconnected;
      await assert.rejects(getChannelMessages(member, privateChannel.id), { statusCode: 403 });
      await assert.rejects(getAttachmentMetadata(member, attachment.id), { statusCode: 404 });
      assert.equal((await searchMessages(member, "private-needle")).length, 0);
      const scheduleInput = {
        roomId: privateRoom.id,
        title: "Private schedule",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
      };
      const schedule = await createMeetingSchedule(owner, scheduleInput);
      assert.ok(!(await listMeetingSchedules(member)).some((item) => item.id === schedule.id));
      await assert.rejects(createMeetingSchedule(member, scheduleInput), { statusCode: 404 });
      await saveChannel(owner, workspace.id, privateChannel.id, { archived: true });
      assert.ok((await getChannelMessages(owner, privateChannel.id)).length);
      await assert.rejects(saveMessage(owner, privateChannel.id, "archived"), { statusCode: 409 });
      await assert.rejects(deleteMessage(owner, secret.id), { statusCode: 409 });
      await saveChannel(owner, workspace.id, privateChannel.id, { archived: false });
      await saveMessage(owner, privateChannel.id, "restored");
      const invitation = await createInvitation(
        owner,
        workspace.id,
        `test-${outsider}@example.test`,
      );
      const stored = await pool.query(`SELECT token_hash FROM workspace_invitations WHERE id=$1`, [
        invitation.id,
      ]);
      assert.equal(
        stored.rows[0].token_hash,
        createHash("sha256").update(invitation.token).digest("hex"),
      );
      await assert.rejects(acceptInvitation(member, invitation.token), { statusCode: 403 });
      const accepted = await Promise.all([
        acceptInvitation(outsider, invitation.token),
        acceptInvitation(outsider, invitation.token),
      ]);
      assert.ok(accepted.every((item) => item.workspaceId === workspace.id));
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS total FROM memberships WHERE workspace_id=$1 AND user_id=$2`,
            [workspace.id, outsider],
          )
        ).rows[0].total,
        1,
      );
      await changeMember(owner, workspace.id, outsider, "remove");
      await assert.rejects(acceptInvitation(outsider, invitation.token), { statusCode: 410 });
      const expiring = await createInvitation(owner, workspace.id);
      await pool.query(
        `UPDATE workspace_invitations SET expires_at=created_at+interval '1 millisecond' WHERE id=$1`,
        [expiring.id],
      );
      await delay(5);
      await assert.rejects(acceptInvitation(outsider, expiring.token), { statusCode: 410 });
      const renewed = await createInvitation(owner, workspace.id, undefined, expiring.id);
      await assert.rejects(acceptInvitation(outsider, expiring.token), { statusCode: 410 });
      await revokeInvitation(owner, workspace.id, renewed.id);
      await assert.rejects(acceptInvitation(outsider, renewed.token), { statusCode: 410 });
      const admin = await getAdministration(owner, workspace.id);
      assert.ok(admin.audit.some((event) => event.action === "channel.member_removed"));
      assert.ok(!JSON.stringify(admin.audit).includes(invitation.token));
      await assert.rejects(reorderChannels(owner, workspace.id, [privateChannel.id]), {
        statusCode: 400,
      });
      await assert.rejects(changeMember(owner, workspace.id, owner, "leave"), { statusCode: 403 });
      await assert.rejects(
        pool.query(`DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2`, [
          workspace.id,
          owner,
        ]),
        { code: "23514" },
      );
      await changeMember(owner, workspace.id, member, "role", "admin");
      await changeMember(owner, workspace.id, member, "transfer");
      assert.equal(
        (await pool.query(`SELECT owner_id FROM workspaces WHERE id=$1`, [workspace.id])).rows[0]
          .owner_id,
        member,
      );
      await assert.rejects(changeMember(owner, workspace.id, member, "role", "member"), {
        statusCode: 403,
      });
      await updateWorkspace(member, workspace.id, { archived: true });
      assert.ok((await getChannelMessages(owner, privateChannel.id)).length);
      await assert.rejects(saveMessage(owner, privateChannel.id, "archived workspace"), {
        statusCode: 409,
      });
      await assert.rejects(requireChannelAccess(owner, privateRoom.id, true), { statusCode: 409 });
      await updateWorkspace(member, workspace.id, { archived: false });
      await changeMember(owner, workspace.id, owner, "leave");
      await assert.rejects(getChannelMessages(owner, privateChannel.id), { statusCode: 403 });
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      roomManager.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[owner, member, outsider]]);
      await pool.end();
    }
  },
);
