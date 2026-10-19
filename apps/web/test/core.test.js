import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readAppRoute,
  appRouteUrl,
  isWorkspaceTabView,
  selectWorkspaceRoute,
  switchWorkspaceTabRoute,
} from "../src/app/navigation.ts";
import { mediaConstraints, publishSelectedTracks } from "../src/features/meetings/webrtc/local-media.ts";

const workspaceId = "e9d8b4a7-1d86-49a3-b8d6-2d08c213565c";
const secondWorkspaceId = "a4b5c6d7-1d86-49a3-b8d6-2d08c213565c";
const channelId = "c0d0e0b1-20d6-401b-8823-f8de9d22dcad";

test("channel and meeting URLs retain identifiers and search through reload", () => {
  for (const view of ["workspace", "meetings"]) {
    const target = {
      view,
      workspaceId,
      channelId,
      messageId: channelId,
      query: "tiếng Việt & kế hoạch",
    };
    assert.deepEqual(readAppRoute(new URL(appRouteUrl(target), "https://collab.test")), target);
  }
  assert.equal(readAppRoute(new URL("https://collab.test/app/unknown")).invalid, true);
  assert.equal(readAppRoute(new URL("https://collab.test/app/chat?workspace=bad")).invalid, true);
  assert.equal(
    readAppRoute(new URL(`https://collab.test/app/meetings?channel=${channelId}`)).invalid,
    true,
  );
  // A direct conversation has no workspace.
  assert.deepEqual(readAppRoute(new URL(`https://collab.test/app/chat?channel=${channelId}`)), {
    view: "chat",
    channelId,
  });
  // Group channels are not listed in "Tin nhắn"; old chat links open the workspace's "Trao đổi" tab.
  assert.deepEqual(
    readAppRoute(new URL(`https://collab.test/app/chat?workspace=${workspaceId}&channel=${channelId}`)),
    { view: "workspace", workspaceId, channelId },
  );
});

test("workspace-centric routes preserve workspaceId across tabs and reset channel state on workspace switch", () => {
  for (const view of ["workspace", "tasks", "chat", "meetings", "files"]) {
    assert.equal(isWorkspaceTabView(view), true);
  }
  assert.equal(isWorkspaceTabView("overview"), false);
  assert.equal(isWorkspaceTabView("notifications"), false);

  const selected = selectWorkspaceRoute(workspaceId);
  assert.deepEqual(selected, { view: "workspace", workspaceId });
  assert.deepEqual(readAppRoute(new URL(appRouteUrl(selected), "https://collab.test")), selected);

  const chatRoute = switchWorkspaceTabRoute(
    { view: "chat", workspaceId, channelId, messageId: channelId },
    "files",
    workspaceId,
  );
  assert.deepEqual(chatRoute, { view: "files", workspaceId });
  assert.deepEqual(readAppRoute(new URL(appRouteUrl(chatRoute), "https://collab.test")), chatRoute);

  // Switching to another workspace from sidebar resets stale channel/task identifiers
  const switchedWorkspace = selectWorkspaceRoute(secondWorkspaceId, "workspace");
  assert.deepEqual(switchedWorkspace, { view: "workspace", workspaceId: secondWorkspaceId });
});

test("disabled lobby sources are never published, including fallback tracks", async () => {
  for (const micEnabled of [false, true])
    for (const cameraEnabled of [false, true]) {
      const options = { micEnabled, cameraEnabled };
      const constraints = mediaConstraints(options);
      assert.equal(Boolean(constraints.audio), micEnabled);
      assert.equal(Boolean(constraints.video), cameraEnabled);
      const tracks = [
        { kind: "audio", enabled: true },
        { kind: "video", enabled: true },
      ];
      const published = [];
      await publishSelectedTracks({ getTracks: () => tracks }, options, async (track, source) => {
        assert.equal(track.enabled, true);
        published.push(source);
      });
      assert.deepEqual(published, [
        ...(micEnabled ? ["mic"] : []),
        ...(cameraEnabled ? ["webcam"] : []),
      ]);
      assert.equal(tracks[0].enabled, micEnabled);
      assert.equal(tracks[1].enabled, cameraEnabled);
    }
});
