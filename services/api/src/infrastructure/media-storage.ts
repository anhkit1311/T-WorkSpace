import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "../config/config.js";
import { putObject, readObject } from "../modules/files/storage.js";

// Q2: finished media (HLS playlists, segments, captions) is copied to S3/MinIO when
// MEDIA_STORAGE=s3, under media/<dir>/<file>. Files are served from the local disk when this
// instance has them and from the bucket otherwise, so any API instance serves any recording.
// shortcut: local copies are kept (FFmpeg and captions read them); prune MEDIA_DIR by age if disk is short.

export const mediaInBucket = () => process.env.MEDIA_STORAGE === "s3";
const keyOf = (dir: string, name: string) => `media/${dir}/${name}`;

const TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".vtt": "text/vtt; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};
/** Only what viewers fetch goes to the bucket (not sources, SDP files or manifests). */
const SHARED = /^(index\.m3u8|index_\d{5}\.ts|p\d{4}_\d{5}\.ts|captions\.vtt|transcript\.json|document\.pdf)$/;

/** Copies the servable files of `dir` (relative to MEDIA_DIR) to the bucket; `only` limits the names. */
export async function archiveMedia(dir: string, only?: string[]) {
  if (!mediaInBucket()) return 0;
  const names = (only ?? (await readdir(path.join(config.mediaDir, dir)))).filter((name) => SHARED.test(name));
  for (const name of names)
    await putObject(keyOf(dir, name), await readFile(path.join(config.mediaDir, dir, name)), TYPES[path.extname(name)] ?? "application/octet-stream");
  return names.length;
}

/** A media file from this disk, else from the bucket; null when neither has it. */
export async function openMedia(dir: string, name: string): Promise<{ size: number; stream: Readable } | null> {
  const local = path.join(config.mediaDir, dir, name);
  const size = (await stat(local).catch(() => null))?.size;
  if (size !== undefined) return { size, stream: createReadStream(local) };
  if (!mediaInBucket() || !SHARED.test(name)) return null;
  const bytes = await readObject(keyOf(dir, name)).catch(() => null);
  return bytes ? { size: bytes.length, stream: Readable.from(bytes) } : null;
}

/** Same, from a path under MEDIA_DIR as the modules' access checks return it. */
export function openMediaPath(file: string) {
  const dir = path.relative(config.mediaDir, path.dirname(file)).split(path.sep).join("/");
  return openMedia(dir, path.basename(file));
}

/** Archiving is a copy: a failure is logged and the local file keeps being served. */
export const archiveQuietly = (dir: string, only?: string[]) =>
  archiveMedia(dir, only).catch((error) =>
    console.error(JSON.stringify({ level: "warn", event: "media_archive_failed", dir, message: String(error) })),
  );
