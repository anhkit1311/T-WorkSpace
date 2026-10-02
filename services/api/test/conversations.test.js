import assert from "node:assert/strict";
import { URLSearchParams } from "node:url";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import {
  createWorkspace,
  addWorkspaceMember,
  getWorkspaceChannels,
  saveMessage,
  deleteMessage,
  toggleReaction,
} from "../../../dist/api/modules/workspaces/service.js";
import { saveChannel, setChannelMember } from "../../../dist/api/modules/workspaces/governance.js";
import {
  getThread,
  markThreadRead,
  getMessageContext,
  listNotifications,
  markNotificationsRead,
  workspaceNotificationPreference,
  toggleSavedMessage,
  listSavedMessages,
  filteredMessageSearch,
} from "../../../dist/api/modules/chat/conversations.js";

test(
  "Conversations: pagination, mentions, durable read, filters and revoked access",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID();
    let workspace;
    try {
      for (const id of [owner, member, outsider])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Conversation QA',true)`,
          [id, `test-${id}@example.test`],
        );
      workspace = await createWorkspace(owner, "Conversations test");
      await addWorkspaceMember(workspace.id, member);
      const channel = (await getWorkspaceChannels(owner, workspace.id)).find(
        (c) => c.type === "text",
      );
      const root = await saveMessage(owner, channel.id, "Đồ án tiếng Việt 100%", {
        clientMessageId: randomUUID(),
        mentionedUserIds: [member],
      });
      assert.equal((await listNotifications(member)).unreadCount, 1);
      await Promise.all(Array.from({length:6},()=>toggleReaction(member,root.id,'👍')));
      assert.equal((await pool.query(`SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2`,[root.id,member])).rowCount,0);
      assert.equal((await listNotifications(outsider)).unreadCount, 0);
      await assert.rejects(
        saveMessage(owner, channel.id, "wrong mention", { mentionedUserIds: [outsider] }),
        { statusCode: 400 },
      );
      const reply = await saveMessage(member, channel.id, "Thảo luận", {
        threadRootId: root.id,
        clientMessageId: randomUUID(),
      });
      assert.equal((await getThread(owner, root.id)).root.threadUnreadCount, 1);
      await markThreadRead(owner, root.id);
      assert.equal((await getThread(owner, root.id)).root.threadUnreadCount, 0);
      assert.equal((await listNotifications(owner)).unreadCount, 1);
      await markNotificationsRead(owner);
      assert.equal((await listNotifications(owner)).unreadCount, 0);
      await assert.rejects(saveMessage(owner, channel.id, "nested", { threadRootId: reply.id }), {
        statusCode: 400,
      });
      for (let index = 0; index < 51; index++)
        await saveMessage(owner, channel.id, `Phản hồi ${index}`, { threadRootId: root.id });
      const page = await getThread(member, root.id);
      assert.equal(page.messages.length, 50);
      assert.equal(page.hasMore, true);
      const older = await getThread(member, root.id, page.messages[0].id);
      assert.equal(older.messages.length, 2);
      assert.equal(older.hasMore, false);
      assert.equal(new Set([...page.messages, ...older.messages].map((m) => m.id)).size, 52);
      await toggleSavedMessage(owner, root.id, true);
      await toggleSavedMessage(member, root.id, false);
      assert.equal((await listSavedMessages(owner, channel.id, "pins"))[0].id, root.id);
      assert.equal((await listSavedMessages(member, channel.id, "bookmarks"))[0].id, root.id);
      assert.equal((await listSavedMessages(owner, channel.id, "bookmarks")).length, 0);
      await assert.rejects(toggleSavedMessage(member, root.id, true), { statusCode: 403 });
      const params = new URLSearchParams({
        q: "tiếng Việt",
        workspace: workspace.id,
        channel: channel.id,
        author: owner,
      });
      assert.equal((await filteredMessageSearch(member, params)).messages[0].id, root.id);
      assert.equal(
        (await filteredMessageSearch(member, new URLSearchParams({ q: "100%" }))).messages[0].id,
        root.id,
      );
      assert.equal(
        (await filteredMessageSearch(member, new URLSearchParams({ q: "100_" }))).messages.length,
        0,
      );
      assert.equal(
        (await filteredMessageSearch(member, new URLSearchParams({ q: "Phản hồi" }))).messages
          .length,
        30,
      );
      assert.equal(
        (
          await filteredMessageSearch(
            member,
            new URLSearchParams({ q: "tiếng Việt", file: "image" }),
          )
        ).messages.length,
        0,
      );
      await assert.rejects(
        filteredMessageSearch(
          member,
          new URLSearchParams({ q: "tiếng Việt", from: "2026-09-30", to: "2026-09-01" }),
        ),
        { statusCode: 400 },
      );
      for (let index = 0; index < 105; index++)
        await saveMessage(owner, channel.id, `Tin mới ${index}`);
      assert.equal((await getMessageContext(member, root.id)).target.id, root.id);
      await workspaceNotificationPreference(member, workspace.id, true);
      const count = (await listNotifications(member)).unreadCount;
      const dedupId = randomUUID();
      await saveMessage(owner, channel.id, "muted", {
        mentionedUserIds: [member],
        clientMessageId: dedupId,
      });
      await saveMessage(owner, channel.id, "muted", {
        mentionedUserIds: [member],
        clientMessageId: dedupId,
      });
      assert.equal((await listNotifications(member)).unreadCount, count);
      await workspaceNotificationPreference(member, workspace.id, false);
      const privateChannel = await saveChannel(owner, workspace.id, undefined, {
        name: "secret",
        type: "text",
        isPrivate: true,
      });
      await setChannelMember(owner, workspace.id, privateChannel.id, member, true);
      const secret = await saveMessage(owner, privateChannel.id, "private conversation", {
        mentionedUserIds: [member],
      });
      await toggleSavedMessage(member, secret.id, false);
      await setChannelMember(owner, workspace.id, privateChannel.id, member, false);
      await assert.rejects(getMessageContext(member, secret.id), { statusCode: 404 });
      assert.ok(!(await listNotifications(member)).items.some((n) => n.messageId === secret.id));
      assert.equal(
        (await filteredMessageSearch(member, new URLSearchParams({ q: "private conversation" })))
          .messages.length,
        0,
      );
      await deleteMessage(owner, root.id);
      await assert.rejects(getThread(member, root.id), { statusCode: 404 });
      await assert.rejects(getMessageContext(member,reply.id),{statusCode:404});
      assert.equal((await filteredMessageSearch(member,new URLSearchParams({q:'Thảo luận'}))).messages.length,0);
      assert.ok(!(await listNotifications(member)).items.some(item=>item.threadRootId===root.id));
      assert.equal((await listSavedMessages(member, channel.id, "bookmarks")).length, 0);
    } finally {
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[owner, member, outsider]]);
      await pool.end();
    }
  },
);
