import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { io } from "socket.io-client";
process.env.JWT_SECRET = "meeting-test-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { config } from "../../../dist/api/config/config.js";
import {
  createWorkspace,
  addWorkspaceMember,
  getWorkspaceChannels,
} from "../../../dist/api/modules/workspaces/service.js";
import { createMeetingSchedule } from "../../../dist/api/modules/meetings/schedules.js";
import {
  enterSession,
  getMeetingState,
  requireAdmitted,
  meetingAction,
  leaveSession,
} from "../../../dist/api/modules/meetings/sessions.js";
import { createApiServer } from "../../../dist/api/server.js";
import { createAccessToken } from "../../../dist/api/modules/auth/tokens.js";
import { roomManager } from "../../../dist/api/modules/meetings/media/room-manager.js";
import { sweepStaleMeetings } from "../../../dist/api/infrastructure/realtime/presence.js";

test(
  "Meeting sessions: host, waiting, limits, multi-tab, kick and end",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      third = randomUUID(),
      fourth = randomUUID();
    let workspace, server;
    const sockets = [];
    const previousLimit = config.meetingMaxUsers;
    const crashedInstance = `qa-crash-${randomUUID()}`,
      crashedSocket = `qa-socket-${randomUUID()}`;
    try {
      config.meetingMaxUsers = 3;
      for (const id of [owner, member, third, fourth])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Meeting QA',true)`,
          [id, `test-${id}@example.test`],
        );
      workspace = await createWorkspace(owner, "Meeting sessions test");
      for (const id of [member, third, fourth]) await addWorkspaceMember(workspace.id, id);
      const room = (await getWorkspaceChannels(owner, workspace.id)).find(
        (c) => c.type === "video",
      );
      const schedule = await createMeetingSchedule(owner, {
        roomId: room.id,
        title: "QA schedule",
        description: "",
        startsAt: new Date(Date.now() + 120000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
      });
      const started = await enterSession(owner, room.id, "qa-host", "qa-instance", schedule.id);
      assert.equal(started.state, "admitted");
      assert.equal((await getMeetingState(member, room.id)).scheduleId, schedule.id);
      await meetingAction(owner, room.id, "qa-host", { action: "waiting", enabled: true });
      const waiting = await enterSession(member, room.id, "qa-member", "qa-instance");
      assert.equal(waiting.state, "waiting");
      await assert.rejects(requireAdmitted(member, room.id, "qa-member"), { statusCode: 403 });
      await assert.rejects(
        meetingAction(member, room.id, "qa-member", { action: "lock", enabled: true }),
        { statusCode: 403 },
      );
      await meetingAction(owner, room.id, "qa-host", { action: "admit", targetUserId: member });
      await requireAdmitted(member, room.id, "qa-member");
      await enterSession(owner, room.id, "qa-host-second", "qa-instance");
      assert.equal((await getMeetingState(owner, room.id)).participants.length, 2);
      assert.equal(
        (await getMeetingState(owner, room.id)).participants.find((p) => p.userId === owner)
          .connections,
        2,
      );
      await assert.rejects(enterSession(owner, room.id, "qa-host-third", "qa-instance"), {
        statusCode: 409,
      });
      await meetingAction(owner, room.id, "qa-host", { action: "lock", enabled: true });
      await assert.rejects(enterSession(third, room.id, "qa-third", "qa-instance"), {
        statusCode: 403,
      });
      await meetingAction(owner, room.id, "qa-host", { action: "lock", enabled: false });
      await enterSession(third, room.id, "qa-third", "qa-instance");
      await assert.rejects(enterSession(fourth, room.id, "qa-fourth", "qa-instance"), {
        statusCode: 409,
      });
      await meetingAction(owner, room.id, "qa-host", {
        action: "cohost",
        targetUserId: member,
        enabled: true,
      });
      await meetingAction(member, room.id, "qa-member", { action: "admit", targetUserId: third });
      await meetingAction(third, room.id, "qa-third", { action: "hand", enabled: true });
      assert.equal(
        (await getMeetingState(owner, room.id)).participants.find((p) => p.userId === third)
          .raisedHand,
        true,
      );
      await assert.rejects(
        meetingAction(member, room.id, "qa-member", { action: "kick", targetUserId: owner }),
        { statusCode: 403 },
      );
      await leaveSession("qa-host");
      assert.equal((await getMeetingState(member, room.id)).hostId, owner);
      await leaveSession("qa-host-second");
      assert.equal((await getMeetingState(member, room.id)).hostId, member);
      await meetingAction(member, room.id, "qa-member", { action: "kick", targetUserId: third });
      await assert.rejects(enterSession(third, room.id, "qa-third-again", "qa-instance"), {
        statusCode: 403,
      });
      await assert.rejects(requireAdmitted(third, room.id, "qa-third"), { statusCode: 403 });
      await meetingAction(member, room.id, "qa-member", { action: "end" });
      assert.equal(await getMeetingState(member, room.id), null);
      assert.ok(
        (await pool.query(`SELECT ended_at FROM meeting_sessions WHERE id=$1`, [started.sessionId]))
          .rows[0].ended_at,
      );
      const crashed = await enterSession(
        owner,
        room.id,
        crashedSocket,
        crashedInstance,
        undefined,
        true,
      );
      const participation = randomUUID();
      await pool.query(
        `INSERT INTO meeting_participations(id,channel_id,user_id,socket_id,session_id) VALUES($1,$2,$3,$4,$5)`,
        [participation, room.id, owner, crashedSocket, crashed.sessionId],
      );
      const emitted = [];
      const observer = { to: () => ({ emit: (event) => emitted.push(event) }) };
      await sweepStaleMeetings(observer);
      assert.ok(await getMeetingState(owner, room.id), "Live API lease keeps its session");
      await pool.query(
        `UPDATE api_instances SET expires_at=now()-interval '1 second' WHERE id=$1`,
        [crashedInstance],
      );
      await sweepStaleMeetings(observer);
      assert.equal(await getMeetingState(owner, room.id), null, "Expired local API session ends");
      assert.ok(
        (
          await pool.query(`SELECT left_at FROM meeting_participations WHERE id=$1`, [
            participation,
          ])
        ).rows[0].left_at,
      );
      assert.ok(emitted.includes("meeting_closed"));
      if (process.env.RUN_SFU_TESTS === "1") {
        server = createApiServer().listen(0);
        await once(server, "listening");
        const address = `http://127.0.0.1:${server.address().port}`;
        for (const id of [owner, member]) {
          const socket = io(address, {
            transports: ["websocket"],
            auth: { token: await createAccessToken(id) },
          });
          sockets.push(socket);
          await Promise.race([
            once(socket, "connect"),
            once(socket, "connect_error").then(([error]) => {
              throw error;
            }),
          ]);
        }
        const request = (socket, event, payload) =>
          socket.timeout(5000).emitWithAck(event, payload);
        assert.equal(
          (await request(sockets[0], "join_meeting", { roomId: room.id })).success,
          true,
        );
        assert.equal(
          (
            await request(sockets[0], "meeting_action", {
              roomId: room.id,
              action: "waiting",
              enabled: true,
            })
          ).success,
          true,
        );
        assert.equal(
          (await request(sockets[1], "join_meeting", { roomId: room.id })).waiting,
          true,
        );
        assert.equal(
          (await request(sockets[1], "create_webrtc_transport", { roomId: room.id })).success,
          false,
        );
        assert.equal(
          (
            await request(sockets[0], "meeting_action", {
              roomId: room.id,
              action: "admit",
              targetUserId: member,
            })
          ).success,
          true,
        );
        assert.equal(
          (await request(sockets[1], "join_meeting", { roomId: room.id })).success,
          true,
        );
        const transport = await request(sockets[1], "create_webrtc_transport", { roomId: room.id });
        assert.equal(transport.success, true);
        assert.equal(
          (
            await request(sockets[1], "restart_ice", {
              roomId: room.id,
              transportId: transport.params.id,
            })
          ).success,
          true,
        );
        const closed = once(sockets[1], "meeting_closed");
        assert.equal(
          (
            await request(sockets[0], "meeting_action", {
              roomId: room.id,
              action: "kick",
              targetUserId: member,
            })
          ).success,
          true,
        );
        await closed;
        assert.equal(roomManager.getPeer(room.id, sockets[1].id), undefined);
        assert.equal(
          (
            await request(sockets[1], "connect_webrtc_transport", {
              roomId: room.id,
              transportId: transport.params.id,
              dtlsParameters: {},
            })
          ).success,
          false,
        );
        assert.equal(
          (await request(sockets[1], "join_meeting", { roomId: room.id })).success,
          false,
        );
        assert.equal(
          (await request(sockets[0], "meeting_action", { roomId: room.id, action: "end" })).success,
          true,
        );
        await delay(100);
        assert.equal(roomManager.getPeer(room.id, sockets[0].id), undefined);
      }
    } finally {
      config.meetingMaxUsers = previousLimit;
      sockets.forEach((socket) => socket.disconnect());
      roomManager.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM api_instances WHERE id=$1`, [crashedInstance]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [
        [owner, member, third, fourth],
      ]);
      await pool.end();
    }
  },
);
