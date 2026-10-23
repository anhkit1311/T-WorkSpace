import assert from "node:assert/strict";
import test from "node:test";
import { appEntryRoute, readAppRoute } from "../src/app/navigation.ts";

const at = (path) => new URL(path, "https://collab.test");
// Compare defined fields only; optional keys may be present as undefined.
const plain = (route) => JSON.parse(JSON.stringify(route));
const workspaceId = "11111111-1111-4111-8111-111111111111";

test("public auth paths are not invalid app routes", () => {
  for (const path of ["/", "/login", "/login/", "/register", "/register/"])
    assert.deepEqual(plain(readAppRoute(at(path))), { view: "overview" }, path);
});

test("app paths keep their validity", () => {
  assert.deepEqual(plain(readAppRoute(at("/app/overview"))), { view: "overview" });
  assert.equal(readAppRoute(at("/app/xyz")).invalid, true);
  assert.equal(readAppRoute(at("/app/khong-ton-tai")).invalid, true);
  assert.equal(readAppRoute(at("/loginx")).invalid, true);
});

test("entering the app resyncs the route from the current URL", () => {
  assert.deepEqual(plain(appEntryRoute(at("/login"))), { view: "overview" });
  assert.deepEqual(plain(appEntryRoute(at("/register"))), { view: "overview" });
  assert.deepEqual(plain(appEntryRoute(at("/"))), { view: "overview" });
  assert.deepEqual(plain(appEntryRoute(at("/unknown"))), { view: "overview" });
  assert.deepEqual(plain(appEntryRoute(at(`/app/tasks?workspace=${workspaceId}`))), {
    view: "tasks",
    workspaceId,
  });
  assert.equal(appEntryRoute(at("/app/xyz")).invalid, true);
});

test("old workspace links open the function pages", () => {
  const channelId = "22222222-2222-4222-8222-222222222222";
  const otherId = "33333333-3333-4333-8333-333333333333";
  assert.deepEqual(plain(readAppRoute(at(`/app/workspace?workspace=${workspaceId}`))), { view: "chat", workspaceId });
  assert.deepEqual(plain(readAppRoute(at(`/app/chat?workspace=${workspaceId}&channel=${channelId}&message=${otherId}`))), {
    view: "chat",
    workspaceId,
    channelId,
    messageId: otherId,
  });
  assert.deepEqual(plain(readAppRoute(at(`/app/tasks?workspace=${workspaceId}&channel=${channelId}&task=${otherId}`))), {
    view: "tasks",
    workspaceId,
    channelId,
    taskId: otherId,
  });
  assert.deepEqual(plain(readAppRoute(at(`/app/meetings?workspace=${workspaceId}&channel=${channelId}&schedule=${otherId}`))), {
    view: "meetings",
    workspaceId,
    channelId,
    scheduleId: otherId,
  });
  assert.deepEqual(plain(readAppRoute(at(`/app/files?workspace=${workspaceId}`))), { view: "files", workspaceId });
  assert.deepEqual(plain(readAppRoute(at("/app/groups"))), { view: "groups" });
});
