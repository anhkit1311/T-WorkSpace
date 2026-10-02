import assert from "node:assert/strict";
import { URLSearchParams } from "node:url";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { io } from "socket.io-client";
process.env.JWT_SECRET = "task-test-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import {
  createWorkspace,
  addWorkspaceMember,
  getWorkspaceChannels,
  saveMessage,
  getAttachmentMetadata,
} from "../../../dist/api/modules/workspaces/service.js";
import {
  saveChannel,
  setChannelMember,
  updateWorkspace,
} from "../../../dist/api/modules/workspaces/governance.js";
import { createTask, getTask, listTasks, mutateTask } from "../../../dist/api/modules/tasks/service.js";
import { createApiServer } from "../../../dist/api/server.js";
import { createAccessToken } from "../../../dist/api/modules/auth/tokens.js";
import { roomManager } from "../../../dist/api/modules/meetings/media/room-manager.js";

test(
  "Kanban: optimistic conflicts, stable order, source, files and current private rights",
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
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Task QA',true)`,
          [id, `test-${id}@example.test`],
        );
      workspace = await createWorkspace(owner, "Kanban test");
      await addWorkspaceMember(workspace.id, member);
      const channel = (await getWorkspaceChannels(owner, workspace.id)).find(
        (c) => c.type === "text",
      );
      const source = await saveMessage(owner, channel.id, "Task from chat");
      const input = {
        title: "Thực hiện đồ án",
        description: "Mô tả",
        clientTaskId: randomUUID(),
        sourceMessageId: source.id,
        assigneeId: member,
      };
      let task = await createTask(owner, channel.id, input);
      assert.equal(task.sourceMessageId, source.id);
      assert.equal(task.assigneeId, member);
      assert.equal((await createTask(owner, channel.id, input)).id, task.id);
      await assert.rejects(createTask(owner,channel.id,{...input,description:'Different retry'}),{code:'IDEMPOTENCY_CONFLICT'});
      await assert.rejects(
        createTask(owner, channel.id, {
          ...input,
          clientTaskId: randomUUID(),
          assigneeId: outsider,
        }),
        { statusCode: 400 },
      );
      const concurrent = await Promise.allSettled([
        mutateTask(owner, task.id, { version: task.version, title: "Owner update" }),
        mutateTask(member, task.id, { version: task.version, title: "Member update" }),
      ]);
      assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(concurrent.find((r) => r.status === "rejected").reason.code, "TASK_CONFLICT");
      task = await getTask(member, task.id);
      assert.equal((await createTask(owner,channel.id,input)).id,task.id);
      task = await mutateTask(member, task.id, {
        version: task.version,
        action: "checklist-add",
        label: "Kiểm tra quyền",
      });
      task = await mutateTask(owner, task.id, {
        version: task.version,
        action: "checklist-toggle",
        itemId: task.checklist[0].id,
      });
      assert.equal(task.checklistDone, 1);
      task = await mutateTask(member, task.id, {
        version: task.version,
        action: "comment",
        content: "Đã hoàn thành kiểm thử",
      });
      assert.equal(task.comments.length, 1);
      const file = randomUUID();
      await pool.query(
        `INSERT INTO message_attachments(id,channel_id,uploader_id,file_name,mime_type,file_size,data) VALUES($1,$2,$3,'qa.txt','text/plain',4,$4)`,
        [file, channel.id, member, Buffer.from("test")],
      );
      task = await mutateTask(member, task.id, {
        version: task.version,
        action: "attachment-add",
        attachmentId: file,
      });
      assert.equal((await getAttachmentMetadata(owner, file)).id, file);
      await assert.rejects(getAttachmentMetadata(outsider, file), { statusCode: 404 });
      task = await mutateTask(owner, task.id, {
        version: task.version,
        status: "doing",
        priority: "high",
        dueAt: "2025-01-01T00:00:00Z",
      });
      assert.equal(
        (
          await listTasks(
            member,
            channel.id,
            new URLSearchParams({
              deadline: "overdue",
              priority: "high",
              assignee: member,
              status: "doing",
            }),
          )
        ).tasks.length,
        1,
      );
      const second = await createTask(owner, channel.id, {
        title: "Second",
        clientTaskId: randomUUID(),
      });
      await mutateTask(owner, second.id, { version: 1, status: "doing", beforeTaskId: task.id });
      const ordered = (await listTasks(owner, channel.id, new URLSearchParams({ status: "doing" })))
        .tasks;
      assert.equal(ordered[0].id, second.id);
      assert.notEqual(ordered[0].position, ordered[1].position);
      task = await getTask(owner, task.id);
      task = await mutateTask(owner, task.id, { version: task.version, archived: true });
      await assert.rejects(
        mutateTask(member, task.id, { version: task.version, title: "Archived mutation" }),
        { statusCode: 409 },
      );
      task = await mutateTask(owner, task.id, { version: task.version, archived: false });
      assert.ok(task.activity.length >= 9);
      const privateChannel = await saveChannel(owner, workspace.id, undefined, {
        name: "private-board",
        type: "text",
        isPrivate: true,
      });
      const secret = await createTask(owner, privateChannel.id, {
        title: "Secret",
        clientTaskId: randomUUID(),
      });
      await assert.rejects(getTask(member, secret.id), { statusCode: 404 });
      await assert.rejects(
        createTask(member, privateChannel.id, { title: "Leak", clientTaskId: randomUUID() }),
        { statusCode: 403 },
      );
      server = createApiServer().listen(0);
      await once(server, "listening");
      const address = `http://127.0.0.1:${server.address().port}`;
      const tokens = new Map();
      for (const id of [owner, member]) {
        const token = await createAccessToken(id);
        tokens.set(id, token);
        const socket = io(address, { transports: ["websocket"], auth: { token } });
        sockets.push(socket);
        await Promise.race([
          once(socket, "connect"),
          once(socket, "connect_error").then(([error]) => {
            throw error;
          }),
        ]);
      }
      const events = [[], []];
      sockets.forEach((socket, index) =>
        socket.on("task_changed", (data) => events[index].push(data)),
      );
      const res = await fetch(`${address}/api/tasks/${secret.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokens.get(owner)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: 1, title: "Secret updated" }),
      });
      assert.equal(res.status, 200);
      await delay(80);
      assert.equal(events[0].length, 1);
      assert.equal(events[1].length, 0);
      await setChannelMember(owner, workspace.id, privateChannel.id, member, true);
      assert.equal((await getTask(member, secret.id)).title, "Secret updated");
      await setChannelMember(owner, workspace.id, privateChannel.id, member, false);
      await assert.rejects(mutateTask(member, secret.id, { version: 2, title: "Revoked" }), {
        statusCode: 404,
      });
      await updateWorkspace(owner, workspace.id, { archived: true });
      await assert.rejects(
        mutateTask(member, task.id, { version: task.version, title: "Read only" }),
        { statusCode: 409 },
      );
      assert.ok((await listTasks(member, channel.id)).tasks.length);
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
