import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { createWorkspace, addWorkspaceMember, getWorkspaceChannels } from "../../../dist/api/modules/workspaces/service.js";
import { updateWorkspace } from "../../../dist/api/modules/workspaces/governance.js";
import { createTask, listAllTasks } from "../../../dist/api/modules/tasks/service.js";

// Pages that gather every group (Tin nhắn, Công việc, Tài liệu, Họp): owner is in A and B, member only in A.
const skip = process.env.RUN_DB_TESTS !== "1";
const owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
const groups = {};
const textChannel = async (workspaceId) => (await getWorkspaceChannels(owner, workspaceId)).find((c) => c.type === "text");

before(async () => {
  if (skip) return;
  for (const id of [owner, member, outsider])
    await pool.query(
      `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
      [id, `test-${id}@example.test`, id === owner ? "Cross Owner" : "Cross QA"],
    );
  groups.a = await createWorkspace(owner, "Cross A");
  groups.b = await createWorkspace(owner, "Cross B");
  await addWorkspaceMember(groups.a.id, member);
  groups.aText = await textChannel(groups.a.id);
  groups.bText = await textChannel(groups.b.id);
});

after(async () => {
  if (skip) return;
  await pool.query(`DELETE FROM workspaces WHERE id=ANY($1::uuid[])`, [[groups.a?.id, groups.b?.id].filter(Boolean)]);
  await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[owner, member, outsider]]);
  await pool.end();
});

test("Cross-group: tasks of every group, mine by default, outsiders see none", { skip }, async () => {
  const add = (channelId, title, assigneeId) => createTask(owner, channelId, { title, description: "", clientTaskId: randomUUID(), assigneeId });
  await add(groups.aText.id, "A cho chủ", owner);
  await add(groups.bText.id, "B cho chủ", owner);
  await add(groups.aText.id, "A cho thành viên", member);
  const list = (user, query = "") => listAllTasks(user, new URLSearchParams(query)).then((result) => result.tasks);

  const mine = await list(owner);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((task) => task.assigneeId === owner));
  const fromB = mine.find((task) => task.title === "B cho chủ");
  assert.equal(fromB.workspaceName, "Cross B");
  assert.equal(fromB.workspaceId, groups.b.id);
  assert.equal(fromB.channelName, groups.bText.name);
  assert.equal(fromB.workspaceArchived, false);

  assert.equal((await list(owner, "assignee=all")).length, 3);
  assert.deepEqual((await list(owner, `assignee=all&workspace=${groups.b.id}`)).map((task) => task.title), ["B cho chủ"]);
  assert.deepEqual((await list(member, "assignee=all")).map((task) => task.title).sort(), ["A cho chủ", "A cho thành viên"]);
  assert.equal((await list(outsider, "assignee=all")).length, 0);
  await assert.rejects(list(owner, "assignee=someone"), { statusCode: 400, code: "INVALID_FILTER" });

  await updateWorkspace(owner, groups.b.id, { archived: true });
  const archived = (await list(owner)).find((task) => task.title === "B cho chủ");
  assert.equal(archived?.workspaceArchived, true);
  await updateWorkspace(owner, groups.b.id, { archived: false });
});
