import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import {
  getChannelMessages,
  saveMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  setChannelPreference,
  requireChannelAccess,
} from "../../../dist/api/modules/workspaces/service.js";
import {
  filteredMessageSearch,
  listNotifications,
} from "../../../dist/api/modules/chat/conversations.js";
import {
  listDirectConversations,
  listDirectFiles,
  openDirectConversation,
  searchDirectUsers,
} from "../../../dist/api/modules/chat/direct.js";
import { uploadFile } from "../../../dist/api/modules/files/service.js";

test(
  "Direct messages: open-or-get, outsider denied, delivery and notifications",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const alice = randomUUID(),
      bob = randomUUID(),
      outsider = randomUUID();
    let channelId;
    try {
      for (const [id, name] of [
        [alice, "DM Alice"],
        [bob, "DM Bob"],
        [outsider, "DM Outsider"],
      ])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
          [id, `test-${id}@example.test`, name],
        );

      // Idempotent from both sides, including concurrent opens.
      const opened = await Promise.all([
        openDirectConversation(alice, bob),
        openDirectConversation(bob, alice),
        openDirectConversation(alice, bob),
      ]);
      channelId = opened[0].id;
      assert.ok(opened.every((item) => item.id === channelId));
      assert.equal(opened[0].kind, "direct");
      assert.equal(opened[0].peer.userId, bob);
      assert.equal(opened[1].peer.userId, alice);
      assert.equal(
        (await pool.query(`SELECT 1 FROM direct_conversations WHERE channel_id=$1`, [channelId]))
          .rowCount,
        1,
      );
      await assert.rejects(openDirectConversation(alice, alice), { statusCode: 400 });
      await assert.rejects(openDirectConversation(alice, randomUUID()), { statusCode: 404 });
      assert.ok((await searchDirectUsers(alice, "DM Bob")).some((u) => u.userId === bob));
      assert.ok(!(await searchDirectUsers(alice, "DM Alice")).some((u) => u.userId === alice));

      // Delivery through the group-chat pipeline.
      const first = await saveMessage(alice, channelId, "Chào Bob", {
        clientMessageId: randomUUID(),
      });
      const bobView = await getChannelMessages(bob, channelId);
      assert.deepEqual(
        bobView.map((m) => m.content),
        ["Chào Bob"],
      );
      const inbox = await listNotifications(bob);
      assert.equal(inbox.unreadCount, 1);
      assert.equal(inbox.items[0].kind, "direct");
      assert.equal((await listNotifications(alice)).unreadCount, 0);
      const bobList = await listDirectConversations(bob);
      assert.equal(bobList.find((c) => c.id === channelId).unreadCount, 1);
      assert.equal(bobList.find((c) => c.id === channelId).lastMessage.content, "Chào Bob");

      await toggleReaction(bob, first.id, "👍");
      await editMessage(alice, first.id, "Chào Bob!");
      const reply = await saveMessage(bob, channelId, "Chào Alice", {
        replyToId: first.id,
      });
      await setChannelPreference(bob, channelId, { markRead: true });
      assert.equal((await listNotifications(bob)).unreadCount, 0);
      assert.equal((await listDirectConversations(bob))[0].unreadCount, 0);
      const aliceView = await getChannelMessages(alice, channelId);
      assert.equal(aliceView[0].content, "Chào Bob!");
      assert.equal(aliceView[0].reactions[0].count, 1);
      assert.equal(aliceView[0].seenCount, 1);
      assert.equal(aliceView[1].replyToId, first.id);
      await deleteMessage(bob, reply.id);
      assert.equal((await getChannelMessages(alice, channelId)).length, 1);

      // A third user can neither read, write, react nor see the conversation.
      await assert.rejects(requireChannelAccess(outsider, channelId), { statusCode: 403 });
      await assert.rejects(getChannelMessages(outsider, channelId), { statusCode: 403 });
      await assert.rejects(saveMessage(outsider, channelId, "xen vào"), { statusCode: 403 });
      await assert.rejects(toggleReaction(outsider, first.id, "👍"), { statusCode: 403 });
      await assert.rejects(editMessage(outsider, first.id, "x"), { statusCode: 403 });
      assert.equal((await listDirectConversations(outsider)).length, 0);
      assert.equal((await listNotifications(outsider)).unreadCount, 0);

      // The contact panel lists the conversation's files; nobody else gets them.
      const file = await uploadFile(bob, channelId, "ghi-chu.pdf", "application/pdf", Buffer.from("%PDF-1.4 ghi chu"));
      const withFile = await saveMessage(bob, channelId, "Tài liệu", { attachmentId: file.id });
      assert.deepEqual(
        (await listDirectFiles(alice, channelId)).map((f) => [f.fileName, f.messageId]),
        [["ghi-chu.pdf", withFile.id]],
      );
      assert.deepEqual(await listDirectFiles(outsider, channelId), []);

      // Global search covers the conversation, named after the other person, for its two people only.
      const search = (who) => filteredMessageSearch(who, new URLSearchParams({ q: "Chào Bob!" }));
      assert.deepEqual(
        (await search(alice)).messages.map((m) => [m.workspaceId, m.channelName]),
        [[null, "DM Bob"]],
      );
      assert.equal((await search(outsider)).messages.length, 0);
    } finally {
      if (channelId) await pool.query(`DELETE FROM channels WHERE id=$1`, [channelId]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[alice, bob, outsider]]);
      await pool.end();
    }
  },
);
