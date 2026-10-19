import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseStreams } from "../../../dist/api/modules/meetings/recording/recorder.js";
import { hlsArgs, joinPlaylists } from "../../../dist/api/modules/meetings/recording/ffmpeg.js";
import { randomUUID } from "node:crypto";
process.env.JWT_SECRET ??= "meeting-recording-secret-at-least-32-characters";
const db = process.env.RUN_DB_TESTS === "1";

const producer = (producerId, socketId, kind, source, paused = false) => ({
  producerId, socketId, userId: socketId, displayName: socketId, kind, source, paused,
});

test("Recording picks every microphone and one picture: screen, else speaker, else any camera", () => {
  const mics = [producer("m2", "b", "audio", "mic", true), producer("m1", "a", "audio", "mic")];
  const camA = producer("ca", "a", "video", "webcam");
  const camB = producer("cb", "b", "video", "webcam");
  let choice = chooseStreams([...mics, camA, camB], "b");
  assert.deepEqual(choice.audio.map((item) => item.producerId), ["m1", "m2"], "Muted mics stay in, so muting does not restart");
  assert.equal(choice.video.producerId, "cb");
  assert.equal(choice.key, "m1,m2,cb");
  choice = chooseStreams([...mics, camA, camB, producer("sa", "a", "video", "screen")], "b");
  assert.equal(choice.video.producerId, "sa");
  choice = chooseStreams([...mics, camA, producer("cb", "b", "video", "webcam", true)], "b");
  assert.equal(choice.video.producerId, "ca", "A camera turned off is not chosen");
  assert.equal(chooseStreams([], null).key, "-");
});

test("HLS arguments: mixing, black picture, silence and the cut at the next part", () => {
  const mixed = hlsArgs({ input: "r/part-0001.mkv", out: "r/p0001", video: true, audio: 2, duration: 12.5 });
  const graph = mixed[mixed.indexOf("-filter_complex") + 1];
  assert.match(graph, /\[0:a:0\]aresample=async=1:first_pts=0\[a0\]/);
  assert.match(graph, /\[a0\]\[a1\]amix=inputs=2/);
  assert.equal(mixed[mixed.indexOf("-t") + 1], "12.500");
  assert.ok(!mixed.includes("-shortest"));
  const audioOnly = hlsArgs({ input: "x.mkv", out: "p", video: false, audio: 1 });
  assert.ok(audioOnly.includes("color=c=black:s=1280x720:r=25") && audioOnly.includes("-shortest"));
  const upload = hlsArgs({ input: "v.mp4", out: "v", video: true, audio: "auto" });
  assert.ok(upload.includes("0:a:0?"));
  assert.equal(upload.at(-1), "v.m3u8");
});

test("Part playlists join into one VOD playlist with discontinuities", () => {
  const part = (name, target) =>
    `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${target}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\n${name}_00000.ts\n#EXT-X-ENDLIST\n`;
  const joined = joinPlaylists([part("p0001", 6), "#EXTM3U\n#EXT-X-ENDLIST\n", part("p0002", 7)]);
  assert.match(joined, /#EXT-X-TARGETDURATION:7/);
  assert.equal(joined.match(/#EXT-X-DISCONTINUITY/g).length, 1);
  assert.ok(joined.indexOf("p0001_00000.ts") < joined.indexOf("p0002_00000.ts"));
  assert.ok(joined.trimEnd().endsWith("#EXT-X-ENDLIST"));
});

test("Recording access: host manages, attendees watch, the room only once shared", { skip: !db, timeout: 30000 }, async () => {
  const { pool } = await import("../../../dist/api/infrastructure/database/db.js");
  const { createWorkspace, addWorkspaceMember, getWorkspaceChannels } = await import("../../../dist/api/modules/workspaces/service.js");
  const { enterSession } = await import("../../../dist/api/modules/meetings/sessions.js");
  const recordings = await import("../../../dist/api/modules/meetings/recording/recordings.js");
  const [owner, member, latecomer] = [randomUUID(), randomUUID(), randomUUID()];
  let workspace;
  try {
    for (const id of [owner, member, latecomer])
      await pool.query(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`, [
        id, `test-${id}@example.test`, `Rec QA ${id.slice(0, 4)}`,
      ]);
    workspace = await createWorkspace(owner, "Recording test");
    for (const id of [member, latecomer]) await addWorkspaceMember(workspace.id, id);
    const room = (await getWorkspaceChannels(owner, workspace.id)).find((c) => c.type === "video");
    const { sessionId } = await enterSession(owner, room.id, "qa-r-host", "qa-r");
    await enterSession(member, room.id, "qa-r-member", "qa-r");

    await assert.rejects(recordings.startRecording(member, sessionId, () => {}), { statusCode: 403 });
    await assert.rejects(recordings.startRecording(owner, sessionId, () => {}), { statusCode: 409, code: "ROOM_NOT_HERE" });

    const id = randomUUID();
    await pool.query(`INSERT INTO meeting_recordings(id,session_id,channel_id,started_by,status,stopped_at,duration_seconds) VALUES($1,$2,$3,$4,'ready',now(),60)`, [
      id, sessionId, room.id, owner,
    ]);
    assert.equal((await recordings.listRecordings(owner, sessionId)).canManage, true);
    const seen = await recordings.listRecordings(member, sessionId);
    assert.equal(seen.canManage, false);
    assert.equal(seen.recordings[0].durationSeconds, 60);
    assert.match(await recordings.recordingFile(member, id, "index.m3u8"), /index\.m3u8$/);
    await assert.rejects(recordings.recordingFile(member, id, "../secret"), { statusCode: 404 });

    assert.equal((await recordings.listRecordings(latecomer, sessionId)).recordings.length, 0, "Did not attend");
    await assert.rejects(recordings.recordingFile(latecomer, id, "index.m3u8"), { statusCode: 403 });
    await assert.rejects(recordings.shareRecording(member, id, true), { statusCode: 403 });
    await recordings.shareRecording(owner, id, true);
    assert.equal((await recordings.listRecordings(latecomer, sessionId)).recordings.length, 1);
    await recordings.recordingFile(latecomer, id, "p0001_00000.ts");
  } finally {
    if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
    for (const id of [owner, member, latecomer]) await pool.query(`DELETE FROM users WHERE id=$1`, [id]);
    await pool.end();
  }
});
