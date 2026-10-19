import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MeetingRecording, MeetingRecordings } from "@doan/shared";
import { query } from "../../../infrastructure/database/db.js";
import { HttpError } from "../../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../../workspaces/service.js";
import { config } from "../../../config/config.js";
import { roomManager } from "../media/room-manager.js";
import { enqueueMedia, joinPlaylists, transcodeToHls } from "./ffmpeg.js";
import { RoomRecorder, type Manifest } from "./recorder.js";
import { transcribeDir, transcriptionEnabled } from "../../../infrastructure/speech/transcribe.js";
import { enqueueJob, registerJob } from "../../../infrastructure/jobs/queue.js";
import { archiveQuietly } from "../../../infrastructure/media-storage.js";

// MT-1: who may record, who may watch, and the work after a recording stops.
// shortcut: recorders live in this process and files on its disk, so with several API instances
// the room's media instance records and serves its own files; move files to object storage then.

type Changed = (roomId: string, sessionId: string) => void;
const recorders = new Map<string, { recorder: RoomRecorder; roomId: string; sessionId: string }>();
const dirOf = (id: string) => `recordings/${id}`;

type Row = {
  id: string;
  session_id: string;
  channel_id: string;
  status: MeetingRecording["status"];
  shared: boolean;
  started_at: Date;
  stopped_at: Date | null;
  duration_seconds: number | null;
  error: string | null;
  started_by_name: string | null;
  transcript_status: MeetingRecording["transcriptStatus"];
};

const toRecording = (row: Row): MeetingRecording => ({
  id: row.id,
  sessionId: row.session_id,
  status: row.status,
  shared: row.shared,
  startedAt: row.started_at.toISOString(),
  stoppedAt: row.stopped_at?.toISOString() ?? null,
  durationSeconds: row.duration_seconds,
  startedByName: row.started_by_name,
  error: row.error,
  transcriptStatus: row.transcript_status,
});

/** The viewer's standing in a session: host/co-host manage, admitted attendees watch. */
async function standing(userId: string, sessionId: string) {
  const session = (
    await query<{ id: string; channel_id: string; host_id: string; ended_at: Date | null; role: string | null; state: string | null }>(
      `SELECT s.id,s.channel_id,s.host_id,s.ended_at,a.role,a.state FROM meeting_sessions s
       LEFT JOIN meeting_attendees a ON a.session_id=s.id AND a.user_id=$2 WHERE s.id=$1`,
      [sessionId, userId],
    )
  ).rows[0];
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Phiên họp không tồn tại.");
  await requireChannelAccess(userId, session.channel_id);
  const manages = session.host_id === userId || session.role === "host" || session.role === "cohost";
  return { session, manages, attended: manages || session.state === "admitted" };
}

const forbidden = () => new HttpError(403, "FORBIDDEN", "Bạn không có quyền với bản ghi này.");

export async function listRecordings(userId: string, sessionId: unknown): Promise<MeetingRecordings> {
  validateId(sessionId);
  const { session, manages, attended } = await standing(userId, sessionId);
  const rows = await query<Row>(
    `SELECT r.*,u.display_name AS started_by_name FROM meeting_recordings r LEFT JOIN users u ON u.id=r.started_by
     WHERE r.session_id=$1 AND ($2 OR r.shared) ORDER BY r.started_at`,
    [session.id, attended],
  );
  return { recordings: rows.rows.map(toRecording), canManage: manages };
}

export async function startRecording(userId: string, sessionId: unknown, changed: Changed) {
  validateId(sessionId);
  const { session, manages } = await standing(userId, sessionId);
  if (!manages) throw new HttpError(403, "FORBIDDEN", "Chỉ chủ trì hoặc đồng chủ trì được ghi hình.");
  if (session.ended_at) throw new HttpError(409, "SESSION_ENDED", "Phiên họp đã kết thúc.");
  if (!roomManager.recordingSource(session.channel_id))
    throw new HttpError(409, "ROOM_NOT_HERE", "Phòng họp chưa có ai kết nối trên máy chủ này.");
  const id = randomUUID();
  await query(`INSERT INTO meeting_recordings(id,session_id,channel_id,started_by) VALUES($1,$2,$3,$4)`, [
    id, session.id, session.channel_id, userId,
  ]).catch((error: { code?: string }) => {
    if (error.code === "23505") throw new HttpError(409, "ALREADY_RECORDING", "Phiên họp đang được ghi hình.");
    throw error;
  });
  const recorder = new RoomRecorder(dirOf(id), () => roomManager.recordingSource(session.channel_id));
  recorders.set(id, { recorder, roomId: session.channel_id, sessionId: session.id });
  // The recorder also ends by itself when the room empties.
  void recorder.done.then((manifest) => finishRecording(id, manifest, changed));
  try {
    await recorder.start();
  } catch (error) {
    await recorder.stop();
    throw error;
  }
  changed(session.channel_id, session.id);
  return { id };
}

export async function stopRecording(userId: string, recordingId: unknown) {
  validateId(recordingId);
  const row = (await query<{ session_id: string }>(`SELECT session_id FROM meeting_recordings WHERE id=$1`, [recordingId])).rows[0];
  if (!row) throw new HttpError(404, "RECORDING_NOT_FOUND", "Không tìm thấy bản ghi.");
  if (!(await standing(userId, row.session_id)).manages) throw forbidden();
  const live = recorders.get(recordingId);
  if (!live) throw new HttpError(409, "NOT_RECORDING", "Bản ghi này không còn đang ghi.");
  await live.recorder.stop();
  return { ok: true };
}

export async function shareRecording(userId: string, recordingId: unknown, shared: unknown) {
  validateId(recordingId);
  if (typeof shared !== "boolean") throw new HttpError(400, "INVALID_INPUT", "shared phải là true hoặc false.");
  const row = (await query<{ session_id: string; channel_id: string }>(`SELECT session_id,channel_id FROM meeting_recordings WHERE id=$1`, [recordingId])).rows[0];
  if (!row) throw new HttpError(404, "RECORDING_NOT_FOUND", "Không tìm thấy bản ghi.");
  if (!(await standing(userId, row.session_id)).manages) throw forbidden();
  await query(`UPDATE meeting_recordings SET shared=$2 WHERE id=$1`, [recordingId, shared]);
  return { ...row, ok: true };
}

/** Playlist or segment of a ready recording, for someone allowed to watch it. */
export async function recordingFile(userId: string, recordingId: unknown, name: string) {
  validateId(recordingId);
  const caption = name === "captions.vtt" || name === "transcript.json";
  if (name !== "index.m3u8" && !caption && !/^p\d{4}_\d{5}\.ts$/.test(name)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
  const row = (await query<{ session_id: string; status: string; shared: boolean; transcript_status: string | null }>(
    `SELECT session_id,status,shared,transcript_status FROM meeting_recordings WHERE id=$1`, [recordingId],
  )).rows[0];
  if (!row || row.status !== "ready") throw new HttpError(404, "RECORDING_NOT_FOUND", "Bản ghi chưa sẵn sàng.");
  if (caption && row.transcript_status !== "ready") throw new HttpError(404, "NOT_FOUND", "Bản ghi chưa có phụ đề.");
  const { attended } = await standing(userId, row.session_id);
  if (!attended && !row.shared) throw forbidden();
  return path.join(config.mediaDir, dirOf(recordingId as string), name);
}

/** Transcodes one recording at a time, so post-processing never takes more than one core-set. */
function finishRecording(id: string, manifest: Manifest, changed: Changed) {
  const live = recorders.get(id);
  recorders.delete(id);
  void enqueueMedia(async () => {
    const ends = manifest.parts.map((part) => part.endedAt ?? 0).filter(Boolean);
    await query(
      `UPDATE meeting_recordings SET status='processing',stopped_at=GREATEST(started_at,COALESCE($2,now())) WHERE id=$1 AND status='recording'`,
      [id, ends.length ? new Date(Math.max(...ends)) : null],
    );
    if (live) changed(live.roomId, live.sessionId);
    try {
      const seconds = await processRecording(dirOf(id), manifest);
      await archiveQuietly(dirOf(id));
      await query(`UPDATE meeting_recordings SET status='ready',duration_seconds=$2,error=NULL WHERE id=$1`, [id, Math.round(seconds)]);
      if (transcriptionEnabled()) await transcribe(id, changed);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "recording_processing_failed", id, message: String(error) }));
      await query(`UPDATE meeting_recordings SET status='failed',error=$2 WHERE id=$1`, [id, String(error).slice(0, 500)]);
    }
    const row = (await query<{ channel_id: string; session_id: string }>(`SELECT channel_id,session_id FROM meeting_recordings WHERE id=$1`, [id])).rows[0];
    if (row) changed(row.channel_id, row.session_id);
  });
}

// Set by the first caller that has the socket server; the queue's handler has no request context.
let announce: Changed = () => {};
const notify = async (id: string) => {
  const row = (await query<{ channel_id: string; session_id: string }>(`SELECT channel_id,session_id FROM meeting_recordings WHERE id=$1`, [id])).rows[0];
  if (row) announce(row.channel_id, row.session_id);
};

/** M3: speech-to-text of a ready recording, run from the job queue (Q3). */
async function transcribe(id: string, changed: Changed) {
  announce = changed;
  await query(`UPDATE meeting_recordings SET transcript_status='processing' WHERE id=$1`, [id]);
  await enqueueJob("recording_transcript", id);
  await notify(id);
}

registerJob("recording_transcript", async (id, last) => {
  try {
    await transcribeDir(dirOf(id));
    await archiveQuietly(dirOf(id), ["captions.vtt", "transcript.json"]);
    await query(`UPDATE meeting_recordings SET transcript_status='ready' WHERE id=$1`, [id]);
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "recording_transcript_failed", id, message: String(error), last }));
    if (!last) throw error;
    await query(`UPDATE meeting_recordings SET transcript_status='failed' WHERE id=$1`, [id]);
  }
  await notify(id);
});

/** Host/co-host asks for captions again (first time for older recordings, or after a failure). */
export async function requestRecordingTranscript(userId: string, recordingId: unknown, changed: Changed) {
  validateId(recordingId);
  if (!transcriptionEnabled()) throw new HttpError(409, "TRANSCRIPTION_OFF", "Chưa cấu hình dịch vụ nhận dạng giọng nói (TRANSCRIBE_URL).");
  const row = (await query<{ session_id: string; status: string; transcript_status: string | null }>(
    `SELECT session_id,status,transcript_status FROM meeting_recordings WHERE id=$1`, [recordingId],
  )).rows[0];
  if (!row) throw new HttpError(404, "RECORDING_NOT_FOUND", "Không tìm thấy bản ghi.");
  if (!(await standing(userId, row.session_id)).manages) throw forbidden();
  if (row.status !== "ready") throw new HttpError(409, "NOT_READY", "Bản ghi chưa sẵn sàng.");
  if (row.transcript_status === "processing") throw new HttpError(409, "PROCESSING", "Phụ đề đang được tạo.");
  await transcribe(recordingId as string, changed);
  return { transcriptStatus: "processing" as const };
}

/** Parts → one HLS playlist; each part is cut where the next one starts. Returns the length. */
export async function processRecording(dir: string, manifest: Manifest) {
  const parts = manifest.parts.filter((part) => part.audio || part.video);
  if (!parts.length) throw new Error("Không có âm thanh hay hình ảnh nào được ghi.");
  const playlists: string[] = [];
  let seconds = 0;
  for (const [index, part] of parts.entries()) {
    const end = parts[index + 1]?.startedAt ?? part.endedAt;
    const duration = end ? Math.max(0.5, (end - part.startedAt) / 1000) : undefined;
    const out = `p${String(index + 1).padStart(4, "0")}`;
    try {
      await transcodeToHls({ input: `${dir}/${part.file}`, out: `${dir}/${out}`, video: part.video, audio: part.audio, duration });
    } catch (error) {
      // A part cut off by a crash may be unreadable; the rest of the meeting is still worth keeping.
      console.error(JSON.stringify({ level: "warn", event: "recording_part_skipped", file: part.file, message: String(error) }));
      continue;
    }
    playlists.push(await readFile(path.join(config.mediaDir, dir, `${out}.m3u8`), "utf8"));
    seconds += duration ?? 0;
  }
  if (!playlists.length) throw new Error("Không chuyển được phần nào của bản ghi sang HLS.");
  // Each part playlist names its segments relative to itself, which is the same folder.
  await writeFile(path.join(config.mediaDir, dir, "index.m3u8"), joinPlaylists(playlists));
  for (const part of manifest.parts)
    for (const file of [part.file, part.file.replace(/\.mkv$/, ".sdp")]) await rm(path.join(config.mediaDir, dir, file), { force: true });
  return seconds;
}

/** After a restart: recordings cut off mid-way are processed from what reached the disk. */
export async function recoverRecordings(changed: Changed) {
  announce = changed; // pending caption jobs live in the queue and resume on their own
  const rows = await query<{ id: string }>(`SELECT id FROM meeting_recordings WHERE status IN ('recording','processing')`);
  for (const { id } of rows.rows) {
    if (recorders.has(id)) continue;
    const manifest: Manifest = await readFile(path.join(config.mediaDir, dirOf(id), "manifest.json"), "utf8")
      .then((text) => JSON.parse(text) as Manifest)
      .catch(() => ({ parts: [] }));
    finishRecording(id, manifest, changed);
  }
}

/** Shutdown: close the live parts so their files are complete. */
export async function stopAllRecordings() {
  await Promise.all([...recorders.values()].map(({ recorder }) => recorder.stop()));
}
