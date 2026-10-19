import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { query } from "../../infrastructure/database/db.js";
import { requireChannelAccess } from "../workspaces/service.js";
import { HttpError } from "../../shared/http/http-error.js";
import {
  listMeetingSchedules,
  createMeetingSchedule,
  updateMeetingSchedule,
  cancelMeetingSchedule,
} from "./schedules.js";
import {
  addAgendaItem,
  createMeetingTask,
  deleteAgendaItem,
  getMeetingOutcomes,
  saveMeetingNotes,
  setOutcomeChannel,
  updateAgendaItem,
} from "./outcomes.js";
import { publishOutcomeChange } from "./outcome-events.js";
import { exportMeetingAttendance, getMeetingAttendance } from "./attendance.js";
import { sessionCommittee } from "./committee-room.js";
import { myCommittees } from "../academic/evaluation.js";
import {
  listRecordings,
  recordingFile,
  shareRecording,
  startRecording,
  stopRecording,
  requestRecordingTranscript,
} from "./recording/recordings.js";
import { pipeline } from "node:stream/promises";
import { limitRequest } from "../../shared/http/rate-limit.js";
import { dialInInfo } from "./dial-in.js";
import { openMediaPath } from "../../infrastructure/media-storage.js";
export async function meetingRoutes({
  request,
  response,
  pathname,
  io,
}: RouteContext): Promise<void> {
  const attendance = pathname.match(/^\/api\/meetings\/sessions\/([^/]+)\/attendance(\.csv)?$/);
  if (attendance && request.method === "GET") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (!attendance[2]) {
      sendJson(response, 200, { attendance: await getMeetingAttendance(userId, attendance[1]) });
      return;
    }
    const file = await exportMeetingAttendance(userId, attendance[1]);
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
    });
    response.end("﻿" + file.content); // BOM so Excel reads Vietnamese correctly
    return;
  }
  const committee = pathname.match(/^\/api\/meetings\/sessions\/([^/]+)\/committee$/);
  if (committee && request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { committee: await sessionCommittee(await getAuthUserId(request), committee[1]) });
    return;
  }
  if (pathname === "/api/meetings/committees" && request.method === "GET") {
    sendJson(response, 200, { committees: await myCommittees(await getAuthUserId(request)) });
    return;
  }
  const dialIn = pathname.match(/^\/api\/meetings\/rooms\/([^/]+)\/dial-in$/);
  if (dialIn && request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, await dialInInfo(await getAuthUserId(request), dialIn[1]));
    return;
  }
  const changed = (roomId: string, sessionId: string) =>
    publishOutcomeChange(io, { roomId, sessionId, part: "recording" });
  const sessionRecordings = pathname.match(/^\/api\/meetings\/sessions\/([^/]+)\/recordings$/);
  if (sessionRecordings) {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      sendJson(response, 200, await listRecordings(userId, sessionRecordings[1]));
      return;
    }
    if (request.method === "POST") {
      await limitRequest(request, `meeting-recording:${userId}`, 20, 60);
      sendJson(response, 201, await startRecording(userId, sessionRecordings[1], changed));
      return;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  }
  const transcript = pathname.match(/^\/api\/meetings\/recordings\/([^/]+)\/transcript$/);
  if (transcript && request.method === "POST") {
    const userId = await getAuthUserId(request);
    await limitRequest(request, `meeting-transcript:${userId}`, 10, 60);
    sendJson(response, 202, await requestRecordingTranscript(userId, transcript[1], changed));
    return;
  }
  const recording = pathname.match(/^\/api\/meetings\/recordings\/([^/]+)(?:\/(stop)|\/files\/([^/]+))?$/);
  if (recording) {
    const userId = await getAuthUserId(request);
    const [, recordingId, stop, file] = recording;
    if (file && request.method === "GET") {
      const media = await openMediaPath(await recordingFile(userId, recordingId, file));
      if (!media) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
      response.writeHead(200, {
        "Content-Type": file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : file.endsWith(".vtt")
            ? "text/vtt; charset=utf-8"
            : file.endsWith(".json")
              ? "application/json; charset=utf-8"
              : "video/mp2t",
        "Content-Length": media.size,
        "Cache-Control": "private, max-age=3600",
      });
      await pipeline(media.stream, response);
      return;
    }
    if (stop && request.method === "POST") {
      sendJson(response, 200, await stopRecording(userId, recordingId));
      return;
    }
    if (!stop && !file && request.method === "PATCH") {
      const result = await shareRecording(userId, recordingId, (await readJson(request)).shared);
      changed(result.channel_id, result.session_id);
      sendJson(response, 200, { ok: true });
      return;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  }
  const outcomes = pathname.match(
    /^\/api\/meetings\/sessions\/([^/]+)\/(outcomes|notes|agenda|outcome-channel|tasks)(?:\/([^/]+))?$/,
  );
  if (outcomes) {
    const userId = await getAuthUserId(request);
    const [, sessionId, part, itemId] = outcomes;
    response.setHeader("Cache-Control", "no-store");
    if (part === "outcomes" && request.method === "GET" && !itemId) {
      sendJson(response, 200, { outcomes: await getMeetingOutcomes(userId, sessionId) });
      return;
    }
    await limitRequest(request, `meeting-outcomes:${userId}`, 240, 60);
    if (part === "notes" && request.method === "PATCH" && !itemId) {
      const saved = await saveMeetingNotes(userId, sessionId, await readJson(request));
      publishOutcomeChange(io, { ...saved, part: "notes" });
      sendJson(response, 200, { notes: saved.notes });
      return;
    }
    if (part === "agenda" && request.method === "POST" && !itemId) {
      publishOutcomeChange(io, {
        ...(await addAgendaItem(userId, sessionId, await readJson(request))),
        part: "agenda",
      });
      sendJson(response, 201, { ok: true });
      return;
    }
    if (part === "agenda" && itemId && (request.method === "PATCH" || request.method === "DELETE")) {
      const changed =
        request.method === "PATCH"
          ? await updateAgendaItem(userId, sessionId, itemId, await readJson(request))
          : await deleteAgendaItem(userId, sessionId, itemId);
      publishOutcomeChange(io, { ...changed, part: "agenda" });
      sendJson(response, 200, { ok: true });
      return;
    }
    if (part === "outcome-channel" && request.method === "PATCH" && !itemId) {
      publishOutcomeChange(io, {
        ...(await setOutcomeChannel(userId, sessionId, await readJson(request))),
        part: "channel",
      });
      sendJson(response, 200, { ok: true });
      return;
    }
    if (part === "tasks" && request.method === "POST" && !itemId) {
      const created = await createMeetingTask(userId, sessionId, await readJson(request));
      const recipients = await query<{ user_id: string }>(
        `SELECT user_id FROM channel_access WHERE channel_id=$1`,
        [created.task.channelId],
      );
      io.to(recipients.rows.map((row) => `user:${row.user_id}`)).emit("task_changed", {
        channelId: created.task.channelId,
        taskId: created.task.id,
        version: created.task.version,
      });
      publishOutcomeChange(io, {
        roomId: created.roomId,
        sessionId: created.sessionId,
        part: "tasks",
      });
      sendJson(response, 201, { task: created.task });
      return;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  }
  const location = pathname.match(/^\/api\/channels\/([^/]+)\/media-location$/);
  if (location && request.method === "GET") {
    await requireChannelAccess(await getAuthUserId(request), location[1], true, true);
    const result = await query(
      `SELECT i.media_url FROM meeting_sessions s JOIN api_instances i ON i.id=s.media_instance_id AND i.expires_at>now() WHERE s.channel_id=$1 AND s.ended_at IS NULL`,
      [location[1]],
    );
    sendJson(response, 200, { url: result.rows[0]?.media_url ?? null });
    return;
  }
  if (request.method === "GET" && pathname === "/api/meetings/history") {
    const userId = await getAuthUserId(request);
    const result = await query(
      `SELECT p.id, c.name, c.id AS "roomId", p.joined_at AS "joinedAt", p.left_at AS "leftAt"
      FROM meeting_participations p JOIN channels c ON c.id=p.channel_id
      JOIN channel_access m ON m.channel_id=c.id AND m.user_id=$1
      WHERE p.user_id=$1 ORDER BY p.joined_at DESC LIMIT 50`,
      [userId],
    );
    sendJson(response, 200, { meetings: result.rows });
    return;
  }

  if (pathname === "/api/meetings/schedules") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      sendJson(response, 200, { schedules: await listMeetingSchedules(userId) });
      return;
    }
    if (request.method === "POST") {
      const schedule = await createMeetingSchedule(userId, await readJson(request));
      sendJson(response, 201, { schedule });
      return;
    }
  }

  const scheduleMatch = pathname.match(/^\/api\/meetings\/schedules\/([^/]+)$/);
  if (scheduleMatch && (request.method === "PATCH" || request.method === "DELETE")) {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "PATCH") {
      const schedule = await updateMeetingSchedule(
        userId,
        scheduleMatch[1],
        await readJson(request),
      );
      sendJson(response, 200, { schedule });
    } else {
      await cancelMeetingSchedule(userId, scheduleMatch[1]);
      sendJson(response, 200, { ok: true });
    }
    return;
  }
}
