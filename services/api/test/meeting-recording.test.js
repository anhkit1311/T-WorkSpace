import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chooseStreams } from "../../../dist/api/modules/meetings/recording/recorder.js";
import { hlsArgs, joinPlaylists } from "../../../dist/api/modules/meetings/recording/ffmpeg.js";
import { randomUUID } from "node:crypto";
process.env.JWT_SECRET ??= "meeting-recording-secret-at-least-32-characters";
const db = process.env.RUN_DB_TESTS === "1";
after(async () => {
  if (db) await (await import("../../../dist/api/infrastructure/database/db.js")).pool.end();
});

const producer = (producerId, socketId, kind, source, paused = false) => ({
  producerId,
  socketId,
  userId: socketId,
  displayName: socketId,
  kind,
  source,
  paused,
});

test("Recording picks every microphone and one picture: screen, else speaker, else any camera", () => {
  const mics = [producer("m2", "b", "audio", "mic", true), producer("m1", "a", "audio", "mic")];
  const camA = producer("ca", "a", "video", "webcam");
  const camB = producer("cb", "b", "video", "webcam");
  let choice = chooseStreams([...mics, camA, camB], "b");
  assert.deepEqual(
    choice.audio.map((item) => item.producerId),
    ["m1", "m2"],
    "Muted mics stay in, so muting does not restart",
  );
  assert.equal(choice.video.producerId, "cb");
  assert.equal(choice.key, "m1,m2,cb");
  choice = chooseStreams([...mics, camA, camB, producer("sa", "a", "video", "screen")], "b");
  assert.equal(choice.video.producerId, "sa");
  choice = chooseStreams([...mics, camA, producer("cb", "b", "video", "webcam", true)], "b");
  assert.equal(choice.video.producerId, "ca", "A camera turned off is not chosen");
  assert.equal(chooseStreams([], null).key, "-");
});

test("HLS arguments: mixing, black picture, silence and the cut at the next part", () => {
  const mixed = hlsArgs({
    input: "r/part-0001.mkv",
    out: "r/p0001",
    video: true,
    audio: 2,
    duration: 12.5,
  });
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

test(
  "Recording access: host manages, attendees watch, the room only once shared",
  { skip: !db, timeout: 30000 },
  async () => {
    const { pool } = await import("../../../dist/api/infrastructure/database/db.js");
    const { createWorkspace, addWorkspaceMember, getWorkspaceChannels } =
      await import("../../../dist/api/modules/workspaces/service.js");
    const { enterSession } = await import("../../../dist/api/modules/meetings/sessions.js");
    const recordings = await import("../../../dist/api/modules/meetings/recording/recordings.js");
    const [owner, member, latecomer] = [randomUUID(), randomUUID(), randomUUID()];
    let workspace;
    try {
      for (const id of [owner, member, latecomer])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
          [id, `test-${id}@example.test`, `Rec QA ${id.slice(0, 4)}`],
        );
      workspace = await createWorkspace(owner, "Recording test");
      for (const id of [member, latecomer]) await addWorkspaceMember(workspace.id, id);
      const room = (await getWorkspaceChannels(owner, workspace.id)).find(
        (c) => c.type === "video",
      );
      const { sessionId } = await enterSession(owner, room.id, "qa-r-host", "qa-r");
      await enterSession(member, room.id, "qa-r-member", "qa-r");

      await assert.rejects(
        recordings.startRecording(member, sessionId, () => {}),
        { statusCode: 403 },
      );
      await assert.rejects(
        recordings.startRecording(owner, sessionId, () => {}),
        { statusCode: 409, code: "ROOM_NOT_HERE" },
      );

      const id = randomUUID();
      await pool.query(
        `INSERT INTO meeting_recordings(id,session_id,channel_id,started_by,status,stopped_at,duration_seconds) VALUES($1,$2,$3,$4,'ready',now(),60)`,
        [id, sessionId, room.id, owner],
      );
      assert.equal((await recordings.listRecordings(owner, sessionId)).canManage, true);
      const seen = await recordings.listRecordings(member, sessionId);
      assert.equal(seen.canManage, false);
      assert.equal(seen.recordings[0].durationSeconds, 60);
      assert.match(await recordings.recordingFile(member, id, "index.m3u8"), /index\.m3u8$/);
      await assert.rejects(recordings.recordingFile(member, id, "../secret"), { statusCode: 404 });

      assert.equal(
        (await recordings.listRecordings(latecomer, sessionId)).recordings.length,
        0,
        "Did not attend",
      );
      await assert.rejects(recordings.recordingFile(latecomer, id, "index.m3u8"), {
        statusCode: 403,
      });
      await assert.rejects(recordings.shareRecording(member, id, true), { statusCode: 403 });
      await recordings.shareRecording(owner, id, true);
      assert.equal((await recordings.listRecordings(latecomer, sessionId)).recordings.length, 1);
      await recordings.recordingFile(latecomer, id, "p0001_00000.ts");
      const views = await pool.query(`SELECT user_id FROM media_access_log WHERE ref_id=$1`, [id]);
      assert.deepEqual(
        views.rows.map((row) => row.user_id),
        [member],
        "one view per playlist; refused and segment requests are not views",
      );
    } finally {
      await pool.query(`DELETE FROM media_access_log WHERE user_id=ANY($1::uuid[])`, [
        [owner, member, latecomer],
      ]);
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      for (const id of [owner, member, latecomer])
        await pool.query(`DELETE FROM users WHERE id=$1`, [id]);
    }
  },
);

test(
  "Recording retention (BR-17): finished recordings over 90 days go with their files, lesson ones stay",
  { skip: !db, timeout: 30000 },
  async () => {
    const { mkdir, writeFile, access } = await import("node:fs/promises");
    const path = await import("node:path");
    const { pool } = await import("../../../dist/api/infrastructure/database/db.js");
    const { config } = await import("../../../dist/api/config/config.js");
    const { createWorkspace, getWorkspaceChannels } =
      await import("../../../dist/api/modules/workspaces/service.js");
    const recordings = await import("../../../dist/api/modules/meetings/recording/recordings.js");
    const owner = randomUUID();
    const unitId = randomUUID();
    let workspace;
    try {
      await pool.query(
        `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Rec retention',true)`,
        [owner, `test-${owner}@example.test`],
      );
      workspace = await createWorkspace(owner, "Retention test");
      const room = (await getWorkspaceChannels(owner, workspace.id)).find(
        (c) => c.type === "video",
      );
      const sessionId = randomUUID();
      await pool.query(
        `INSERT INTO meeting_sessions(id,channel_id,host_id,started_at,ended_at) VALUES($1,$2,$3,now()-interval '200 days',now()-interval '200 days')`,
        [sessionId, room.id, owner],
      );
      const recording = async (status, daysAgo) => {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO meeting_recordings(id,session_id,channel_id,started_by,status,started_at,stopped_at)
           VALUES($1,$2,$3,$4,$5::varchar,now()-make_interval(days=>$6),CASE WHEN $5::varchar='recording' THEN NULL ELSE now()-make_interval(days=>$6) END)`,
          [id, sessionId, room.id, owner, status, daysAgo],
        );
        const dir = path.join(config.mediaDir, "recordings", id);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "index.m3u8"), "#EXTM3U\np0001_00000.ts\n");
        return id;
      };
      const oldReady = await recording("ready", 100);
      const oldFailed = await recording("failed", 100);
      const recent = await recording("ready", 10);
      const stillRecording = await recording("recording", 100);
      const inLesson = await recording("ready", 100);
      await pool.query(`INSERT INTO academic_units(id,code,name) VALUES($1,$2,'Retention')`, [
        unitId,
        `RR${unitId.slice(0, 6).toUpperCase()}`,
      ]);
      const courseId = randomUUID();
      const chapterId = randomUUID();
      await pool.query(
        `INSERT INTO courses(id,unit_id,owner_id,code,title,status) VALUES($1,$2,$3,$4,'Học lại','published')`,
        [courseId, unitId, owner, `R${unitId.slice(0, 6).toUpperCase()}`],
      );
      await pool.query(`INSERT INTO course_chapters(id,course_id,title) VALUES($1,$2,'C1')`, [
        chapterId,
        courseId,
      ]);
      await pool.query(
        `INSERT INTO course_lessons(id,course_id,chapter_id,title,kind,status,recording_id) VALUES($1,$2,$3,'Buổi 1','video','published',$4)`,
        [randomUUID(), courseId, chapterId, inLesson],
      );

      const deleted = [];
      for (let run = 0; run < 20; run++) {
        const ids = await recordings.expireRecordings(90);
        deleted.push(...ids);
        if (!ids.length) break;
      }
      const mine = [oldReady, oldFailed, recent, stillRecording, inLesson];
      assert.deepEqual(
        deleted.filter((id) => mine.includes(id)).sort(),
        [oldReady, oldFailed].sort(),
      );
      const left = await pool.query(`SELECT id FROM meeting_recordings WHERE id=ANY($1::uuid[])`, [
        mine,
      ]);
      assert.deepEqual(
        left.rows.map((row) => row.id).sort(),
        [recent, stillRecording, inLesson].sort(),
        "new, still recording and lesson recordings stay",
      );
      const onDisk = (id) =>
        access(path.join(config.mediaDir, "recordings", id, "index.m3u8")).then(
          () => true,
          () => false,
        );
      assert.equal(await onDisk(oldReady), false, "files go with the row");
      assert.equal(await onDisk(oldFailed), false);
      assert.equal(await onDisk(inLesson), true);
      assert.equal(await onDisk(recent), true);
      for (const id of mine)
        await import("node:fs/promises").then(({ rm }) =>
          rm(path.join(config.mediaDir, "recordings", id), { recursive: true, force: true }),
        );
    } finally {
      await pool.query(`DELETE FROM courses WHERE unit_id=$1`, [unitId]);
      await pool.query(`DELETE FROM academic_units WHERE id=$1`, [unitId]);
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id=$1`, [owner]);
    }
  },
);
