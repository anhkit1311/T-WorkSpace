import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../../../config/config.js";
import { HttpError } from "../../../shared/http/http-error.js";
import { query } from "../../../infrastructure/database/db.js";
import { enqueueMedia, playlistSeconds, transcodeToHls } from "../../meetings/recording/ffmpeg.js";
import { conflict, invalid, notFound } from "../../callcenter/service/input.js";
import { transcribeDir, transcriptionEnabled } from "../../../infrastructure/speech/transcribe.js";
import { enqueueJob, registerJob } from "../../../infrastructure/jobs/queue.js";
import { archiveQuietly } from "../../../infrastructure/media-storage.js";
import type { ElearningRepository } from "../repository/elearning-repository.js";
import type { CourseService } from "./course-service.js";

// EL-3: a video lesson is uploaded once and converted to HLS by the same FFmpeg pipeline as meeting
// recordings (MT-1); a document lesson may carry a PDF. Files live under config.mediaDir.
// shortcut: files are on this instance's disk, like recordings; move to object storage for several instances.

const LIMITS = { video: 2 * 1024 ** 3, document: 50 * 1024 ** 2 };
const dirOf = (lessonId: string) => `lessons/${lessonId}`;
// An audio-only upload (or a call recording, E2) is kept under its own name: it is encoded over a black frame.
const SOURCES = ["source", "source.audio"] as const;

/** A call recording a supervisor may use as lesson material (E2); provided by the call center module. */
export type TrainingRecording = (userId: string, callId: string) => Promise<Response>;

export class LessonMediaService {
  constructor(
    private readonly repo: ElearningRepository,
    private readonly courses: CourseService,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
    private readonly callRecording: TrainingRecording | null = null,
  ) {
    // Q3: the work runs from the PostgreSQL queue, on whichever instance claims it.
    registerJob("lesson_transcode", (lessonId, last) => this.runTranscode(lessonId, last));
    registerJob("lesson_transcript", (lessonId, last) => this.runTranscript(lessonId, last));
  }

  async upload(userId: string, lessonId: string, request: IncomingMessage) {
    const { lesson } = await this.courses.lessonCourse(userId, lessonId, "manage");
    if (lesson.kind !== "video" && lesson.kind !== "document") throw invalid("Chỉ bài video hoặc tài liệu có tệp đính kèm.");
    if (lesson.recordingId) throw conflict("RECORDING_LESSON", "Bài xem lại dùng bản ghi của buổi live.");
    if (lesson.mediaStatus === "processing") throw conflict("PROCESSING", "Video trước vẫn đang được xử lý.");
    const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (lesson.kind === "video" ? !type.startsWith("video/") && !type.startsWith("audio/") : type !== "application/pdf")
      throw new HttpError(415, "UNSUPPORTED_TYPE", lesson.kind === "video" ? "Hãy tải lên một tệp video hoặc âm thanh." : "Tài liệu phải là tệp PDF.");
    const limit = LIMITS[lesson.kind];
    if (Number(request.headers["content-length"] ?? 0) > limit) throw new HttpError(413, "FILE_TOO_LARGE", "Tệp quá lớn.");
    const name = decodeURIComponent(String(request.headers["x-file-name"] ?? "")).replace(/[\\/\r\n]/g, "").slice(0, 200) || null;

    const dir = path.join(config.mediaDir, dirOf(lesson.id));
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const file = lesson.kind === "document" ? "document.pdf" : type.startsWith("audio/") ? "source.audio" : "source";
    let size = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > limit ? new HttpError(413, "FILE_TOO_LARGE", "Tệp quá lớn.") : null, chunk);
      },
    });
    try {
      await pipeline(request, limiter, createWriteStream(path.join(dir, file)));
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    if (!size) throw invalid("Tệp rỗng.");
    if (lesson.kind === "document") {
      await archiveQuietly(dirOf(lesson.id), ["document.pdf"]);
      await this.repo.setMedia(lesson.id, { status: "ready", name });
      return { status: "ready" };
    }
    await this.repo.setMedia(lesson.id, { status: "processing", name });
    await this.transcode(lesson.id);
    return { status: "processing" };
  }

  private transcode(lessonId: string) {
    return enqueueJob("lesson_transcode", lessonId);
  }

  private runTranscode(lessonId: string, last: boolean) {
    return enqueueMedia(async () => {
      const dir = dirOf(lessonId);
      try {
        const source = await this.sourceOf(lessonId);
        if (!source) throw new Error("source missing");
        await transcodeToHls({ input: `${dir}/${source}`, out: `${dir}/index`, video: source === "source", audio: "auto" });
        const seconds = playlistSeconds(await readFile(path.join(config.mediaDir, dir, "index.m3u8"), "utf8"));
        await rm(path.join(config.mediaDir, dir, source), { force: true });
        await archiveQuietly(dir);
        await this.repo.setMedia(lessonId, { status: "ready", durationSeconds: Math.round(seconds) });
        this.log("lesson_video_ready", { lessonId, seconds: Math.round(seconds) });
        if (transcriptionEnabled()) await this.transcribe(lessonId);
      } catch (error) {
        this.log("lesson_video_failed", { lessonId, message: String(error), last });
        if (last || !(await this.sourceOf(lessonId)))
          await this.repo.setMedia(lessonId, { status: "failed", error: "Không chuyển được video sang HLS; hãy thử tệp khác." });
        else throw error; // retried from the queue
      }
    });
  }

  /** M3: captions for an uploaded video; a replay lesson uses its recording's (meetings module). */
  private async transcribe(lessonId: string) {
    await this.repo.setTranscript(lessonId, "processing");
    await enqueueJob("lesson_transcript", lessonId);
  }

  private async runTranscript(lessonId: string, last: boolean) {
    try {
      const count = await transcribeDir(dirOf(lessonId));
      await archiveQuietly(dirOf(lessonId), ["captions.vtt", "transcript.json"]);
      await this.repo.setTranscript(lessonId, "ready");
      this.log("lesson_transcript_ready", { lessonId, segments: count });
    } catch (error) {
      this.log("lesson_transcript_failed", { lessonId, message: String(error), last });
      if (!last) throw error;
      await this.repo.setTranscript(lessonId, "failed");
    }
  }

  /** An instructor asks for captions (older videos, or after a failure). */
  async requestTranscript(userId: string, lessonId: string) {
    const { lesson } = await this.courses.lessonCourse(userId, lessonId, "manage");
    if (!transcriptionEnabled()) throw conflict("TRANSCRIPTION_OFF", "Chưa cấu hình dịch vụ nhận dạng giọng nói (TRANSCRIBE_URL).");
    if (lesson.kind !== "video" || lesson.mediaStatus !== "ready") throw conflict("NOT_READY", "Video chưa sẵn sàng.");
    if (lesson.recordingId) throw conflict("RECORDING_LESSON", "Bài xem lại lấy phụ đề từ bản ghi buổi họp.");
    if (lesson.transcriptStatus === "processing") throw conflict("PROCESSING", "Phụ đề đang được tạo.");
    await this.transcribe(lesson.id);
    return { transcriptStatus: "processing" as const };
  }

  private async sourceOf(lessonId: string) {
    for (const name of SOURCES)
      if (await stat(path.join(config.mediaDir, dirOf(lessonId), name)).then(() => true, () => false)) return name;
    return null;
  }

  /**
   * E2: a call recording becomes a draft audio lesson of a chapter the user manages. The supervisor
   * confirms the caller agreed or the call holds no personal data; the lesson stays a draft to review.
   */
  async importCallRecording(userId: string, chapterId: string, body: Record<string, unknown>) {
    if (!this.callRecording) throw conflict("CALL_CENTER_OFFLINE", "Tổng đài chưa kết nối.");
    if (body.consent !== true) throw invalid("Cần xác nhận người gọi đã đồng ý hoặc ghi âm không chứa thông tin cá nhân.");
    const { id: lessonId } = await this.courses.addLesson(userId, chapterId, { kind: "video", title: body.title });
    try {
      const audio = await this.callRecording(userId, String(body.callId ?? ""));
      if (!audio.body) throw invalid("Ghi âm rỗng.");
      const dir = path.join(config.mediaDir, dirOf(lessonId));
      await mkdir(dir, { recursive: true });
      await pipeline(Readable.fromWeb(audio.body as ReadableStream), createWriteStream(path.join(dir, "source.audio")));
    } catch (error) {
      await this.repo.deleteLesson(lessonId);
      throw error;
    }
    await this.repo.setMedia(lessonId, { status: "processing", name: "Ghi âm cuộc gọi" });
    await this.transcode(lessonId);
    return { id: lessonId };
  }

  /** Lessons left "processing" by a version without the job queue get a job (no-op when one exists). */
  async recover() {
    const rows = await query<{ id: string }>(`SELECT id FROM course_lessons WHERE kind='video' AND media_status='processing' AND recording_id IS NULL`);
    for (const { id } of rows.rows) {
      if (await this.sourceOf(id)) await this.transcode(id);
      else await this.repo.setMedia(id, { status: "failed", error: "Tệp tải lên bị mất khi máy chủ khởi động lại." });
    }
  }

  /** The PDF of a document lesson, or a playlist/segment of a video lesson (uploaded or a replay). */
  async file(userId: string, lessonId: string, name: string) {
    const { lesson } = await this.courses.lessonCourse(userId, lessonId, "see");
    if (lesson.mediaStatus !== "ready") throw notFound("Bài học chưa có tệp.");
    if (lesson.kind === "document" && name === "document.pdf") return { file: path.join(config.mediaDir, dirOf(lesson.id), name), type: "application/pdf" };
    if (lesson.kind !== "video") throw notFound("Không tìm thấy tệp.");
    const dir = lesson.recordingId ? `recordings/${lesson.recordingId}` : dirOf(lesson.id);
    const segment = lesson.recordingId ? /^p\d{4}_\d{5}\.ts$/ : /^index_\d{5}\.ts$/;
    if (name === "captions.vtt" || name === "transcript.json") {
      if (lesson.transcriptStatus !== "ready") throw notFound("Bài học chưa có phụ đề.");
      return { file: path.join(config.mediaDir, dir, name), type: name.endsWith(".vtt") ? "text/vtt; charset=utf-8" : "application/json; charset=utf-8" };
    }
    if (name !== "index.m3u8" && !segment.test(name)) throw notFound("Không tìm thấy tệp.");
    return { file: path.join(config.mediaDir, dir, name), type: name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t" };
  }
}
