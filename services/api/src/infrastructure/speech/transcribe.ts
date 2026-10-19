import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/config.js";
import { runFfmpeg } from "../../modules/meetings/recording/ffmpeg.js";

// M3: speech-to-text for recordings and video lessons. The service is any OpenAI-compatible
// /v1/audio/transcriptions endpoint: OpenAI Whisper, or a self-hosted faster-whisper / whisper.cpp
// server so recordings never leave the university. Output sits next to the HLS playlist:
// captions.vtt (the player's subtitle track) and transcript.json (searchable, click to seek).

export type Segment = { start: number; end: number; text: string };

export const transcriptionEnabled = () => Boolean(config.transcribeUrl);

const stamp = (seconds: number) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

/** WebVTT cues; "-->" inside the text would end the cue line, so it is defused. */
export const toVtt = (segments: Segment[]) =>
  ["WEBVTT", "", ...segments.flatMap((item, i) => [String(i + 1), `${stamp(item.start)} --> ${stamp(item.end)}`, item.text.replace(/-->/g, "→"), ""])].join("\n");

/** Keeps well-formed, non-empty segments from a verbose_json response. */
export function parseSegments(body: unknown): Segment[] {
  const segments = (body as { segments?: unknown })?.segments;
  if (!Array.isArray(segments)) throw new Error("Dịch vụ nhận dạng không trả về segments.");
  return segments
    .map((item: { start?: unknown; end?: unknown; text?: unknown }) => ({ start: Number(item.start), end: Number(item.end), text: String(item.text ?? "").trim() }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start && item.text);
}

/** Sends one audio file to the speech service. */
export async function requestTranscript(file: Buffer, name: string): Promise<Segment[]> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type: "audio/mpeg" }), name);
  form.append("model", config.transcribeModel);
  form.append("language", config.transcribeLanguage);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const response = await fetch(config.transcribeUrl, {
    method: "POST",
    headers: config.transcribeApiKey ? { Authorization: `Bearer ${config.transcribeApiKey}` } : {},
    body: form,
    signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok) throw new Error(`Dịch vụ nhận dạng trả lỗi ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return parseSegments(await response.json());
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Transcribes the HLS playlist in `dir` (relative to mediaDir) and writes the caption files.
 * Jobs run one at a time, apart from the transcode queue: they mostly wait on the network.
 */
export function transcribeDir(dir: string): Promise<number> {
  const run = queue.then(async () => {
    // 16 kHz mono at 32 kbit/s keeps about 1h40 under the 25 MB upload limit of hosted Whisper.
    const audio = `${dir}/speech.mp3`;
    try {
      await runFfmpeg(["-y", "-i", `${dir}/index.m3u8`, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", audio]);
      const segments = await requestTranscript(await readFile(path.join(config.mediaDir, audio)), "speech.mp3");
      await writeFile(path.join(config.mediaDir, dir, "captions.vtt"), toVtt(segments));
      await writeFile(path.join(config.mediaDir, dir, "transcript.json"), JSON.stringify({ language: config.transcribeLanguage, segments }));
      return segments.length;
    } finally {
      await rm(path.join(config.mediaDir, audio), { force: true });
    }
  });
  queue = run.catch(() => {});
  return run;
}
