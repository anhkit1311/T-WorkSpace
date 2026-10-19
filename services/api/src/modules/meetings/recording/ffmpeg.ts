import { spawn, type ChildProcess } from "node:child_process";
import { config } from "../../../config/config.js";

// Shared FFmpeg pipeline for MT-1 (meeting recordings) and EL-3 (uploaded video lessons).
// Paths are always relative to config.mediaDir, which is also FFmpeg's working directory.

const [command, ...prefix] = config.ffmpegCommand.split(" ").filter(Boolean);

/** `interactive` keeps stdin open so a live recording can be stopped cleanly with "q". */
export function spawnFfmpeg(args: string[], interactive = false): ChildProcess {
  return spawn(command, [...prefix, "-hide_banner", "-loglevel", "error", ...(interactive ? [] : ["-nostdin"]), ...args], {
    cwd: config.mediaDir,
    stdio: [interactive ? "pipe" : "ignore", "ignore", "pipe"],
    windowsHide: true,
  });
}

/** Runs FFmpeg to completion; rejects with the tail of its error output. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnFfmpeg(args);
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-400)}`)),
    );
  });
}

const FRAME = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25";
const ENCODE = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-g", "50",
  "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
];

export type HlsSource = {
  input: string;
  /** Output prefix: writes `${out}.m3u8` and segments `${out}_00000.ts`. */
  out: string;
  video: boolean;
  /** Audio streams to mix (a recording keeps one per speaker); "auto" = first one, if any. */
  audio: number | "auto";
  /** Cut the output at this many seconds (recording parts overlap at a switch). */
  duration?: number;
};

/**
 * Every output is 1280x720 H.264 + AAC so parts with different sources play as one stream.
 * A part without video gets a black picture; without audio, silence.
 */
export function hlsArgs({ input, out, video, audio, duration }: HlsSource): string[] {
  const inputs = ["-i", input];
  const filters: string[] = [];
  let next = 1;
  if (video) filters.push(`[0:v:0]${FRAME}[v]`);
  else {
    inputs.push("-f", "lavfi", "-i", "color=c=black:s=1280x720:r=25");
    filters.push(`[${next++}:v]null[v]`);
  }
  const maps = ["-map", "[v]"];
  if (audio === "auto") maps.push("-map", "0:a:0?");
  else if (audio === 0) {
    inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    maps.push("-map", `${next++}:a`);
  } else {
    // Gaps (a muted mic sends nothing) are filled with silence so the speakers stay in sync.
    const labels = Array.from({ length: audio }, (_, i) => `[a${i}]`);
    labels.forEach((label, i) => filters.push(`[0:a:${i}]aresample=async=1:first_pts=0${label}`));
    filters.push(audio === 1 ? `[a0]anull[a]` : `${labels.join("")}amix=inputs=${audio}:duration=longest:normalize=0[a]`);
    maps.push("-map", "[a]");
  }
  return [
    "-y", ...inputs, "-filter_complex", filters.join(";"), ...maps, ...ENCODE,
    ...(duration ? ["-t", duration.toFixed(3)] : []),
    // Generated black/silence inputs never end; the recorded input decides the length.
    ...(!video || audio === 0 ? ["-shortest"] : []),
    "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
    "-hls_segment_filename", `${out}_%05d.ts`, `${out}.m3u8`,
  ];
}

export const transcodeToHls = (source: HlsSource) => runFfmpeg(hlsArgs(source));

let queue: Promise<unknown> = Promise.resolve();
/** Transcodes run one at a time (recordings and video lessons alike), so they never take every core. */
export function enqueueMedia<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/** Length of a VOD playlist, from its segment durations. */
export const playlistSeconds = (playlist: string) =>
  [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);

/** Joins VOD playlists into one, with a discontinuity between parts (timestamps restart). */
export function joinPlaylists(playlists: string[]): string {
  let target = 1;
  const body: string[] = [];
  for (const playlist of playlists) {
    const lines = playlist.split(/\r?\n/).map((line) => line.trim());
    const segments = lines.filter((line) => line.startsWith("#EXTINF") || (line && !line.startsWith("#")));
    if (!segments.length) continue;
    for (const line of lines)
      if (line.startsWith("#EXT-X-TARGETDURATION:")) target = Math.max(target, Number(line.split(":")[1]) || 0);
    if (body.length) body.push("#EXT-X-DISCONTINUITY");
    body.push(...segments);
  }
  return [
    "#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${target}`, "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD", ...body, "#EXT-X-ENDLIST", "",
  ].join("\n");
}
