import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { MediaTranscript } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import "./hls-player.css";

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** M3: captions.vtt and transcript.json sit beside index.m3u8 and need the token too. */
function useTranscript(src: string, enabled: boolean, token: string | null) {
  const [state, setState] = useState<{ vtt: string | null; transcript: MediaTranscript | null }>({ vtt: null, transcript: null });
  useEffect(() => {
    if (!enabled || !token) return;
    let vtt: string | null = null;
    let alive = true;
    const get = (name: string) =>
      fetch(src.replace(/index\.m3u8$/, name), { credentials: "include", headers: { Authorization: `Bearer ${token}` } }).then((response) =>
        response.ok ? response : Promise.reject(new Error(String(response.status))),
      );
    Promise.all([get("captions.vtt").then((response) => response.blob()), get("transcript.json").then((response) => response.json())]).then(
      ([blob, transcript]: [Blob, MediaTranscript]) => {
        if (!alive) return;
        vtt = URL.createObjectURL(blob);
        setState({ vtt, transcript });
      },
      () => alive && setState({ vtt: null, transcript: null }),
    );
    return () => {
      alive = false;
      if (vtt) URL.revokeObjectURL(vtt);
    };
    // The token refreshes on its own; refetching captions for that is not needed.
  }, [src, enabled]);
  return state;
}

/** How often a stretch still playing is reported (EL-5 watch time). */
const REPORT_MS = 15_000;

/**
 * Plays an HLS stream from the API (meeting recordings, video lessons). Playlists and segments
 * need the access token, so requests go through hls.js with the latest token on each one.
 * `onPlayed` receives each stretch actually played (not skipped) with the current position;
 * `startAt` resumes there once the video is loaded.
 */
export function HlsPlayer({
  src,
  label,
  onEnded,
  captions = false,
  startAt = 0,
  onPlayed,
}: {
  src: string;
  label: string;
  onEnded?: () => void;
  captions?: boolean;
  startAt?: number;
  onPlayed?: (from: number, to: number, position: number) => void;
}) {
  const { accessToken } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const played = useRef<{ from: number; to: number } | null>(null);
  const lastElement = useRef<HTMLVideoElement | null>(null);
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  const startRef = useRef(startAt);
  startRef.current = startAt;
  /** Reports the stretch played so far; a stretch still playing continues from where it was cut. */
  const flush = () => {
    // On unmount React has already detached the ref; the last element still has its position.
    const element = video.current ?? lastElement.current;
    const span = played.current;
    if (!element || !span) return;
    if (span.to > span.from) onPlayedRef.current?.(span.from, span.to, element.currentTime);
    played.current = element.paused || element.seeking ? null : { from: span.to, to: span.to };
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const timer = window.setInterval(() => flushRef.current(), REPORT_MS);
    return () => {
      window.clearInterval(timer);
      flushRef.current();
    };
  }, []);
  const token = useRef(accessToken);
  token.current = accessToken;
  const [error, setError] = useState("");
  const { vtt, transcript } = useTranscript(src, captions, accessToken);
  const [now, setNow] = useState(0);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return (transcript?.segments ?? []).filter((item) => !needle || item.text.toLocaleLowerCase("vi").includes(needle));
  }, [transcript, search]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    lastElement.current = element;
    if (!Hls.isSupported()) {
      setError("Trình duyệt này không phát được HLS.");
      return;
    }
    setError("");
    const hls = new Hls({
      xhrSetup: (xhr) => {
        xhr.withCredentials = true;
        xhr.setRequestHeader("Authorization", `Bearer ${token.current}`);
      },
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError("Không phát được video.");
    });
    hls.loadSource(src);
    hls.attachMedia(element);
    // Resume where the learner stopped, unless that was the very start or the end.
    const resume = () => {
      if (startRef.current > 5 && startRef.current < element.duration - 10) element.currentTime = startRef.current;
    };
    element.addEventListener("loadedmetadata", resume, { once: true });
    return () => {
      element.removeEventListener("loadedmetadata", resume);
      hls.destroy();
    };
  }, [src]);

  return (
    <div className="hls-player">
      <video
        ref={video}
        controls
        playsInline
        aria-label={label}
        onEnded={() => {
          flush();
          onEnded?.();
        }}
        onPause={flush}
        onSeeking={flush}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          const time = element.currentTime;
          setNow(time);
          if (element.paused || element.seeking) return;
          const span = played.current;
          // A jump (seek, buffering skip) ends the stretch; normal playback extends it.
          if (span && time >= span.to && time - span.to < 3) span.to = time;
          else {
            flush();
            played.current = { from: time, to: time };
          }
        }}
      >
        {vtt && <track kind="captions" src={vtt} srcLang={transcript?.language ?? "vi"} label="Phụ đề tự động" default />}
      </video>
      {error && <p role="alert">{error}</p>}
      {transcript && (
        <details className="hls-transcript">
          <summary>Bản chép lời ({transcript.segments.length} đoạn)</summary>
          <input type="search" placeholder="Tìm trong lời nói…" aria-label="Tìm trong bản chép lời" value={search} onChange={(event) => setSearch(event.target.value)} />
          <ol>
            {shown.map((item) => (
              <li key={item.start}>
                <button
                  type="button"
                  aria-current={now >= item.start && now < item.end ? "true" : undefined}
                  onClick={() => {
                    if (!video.current) return;
                    video.current.currentTime = item.start;
                    void video.current.play().catch(() => {});
                  }}
                >
                  <time>{mmss(item.start)}</time> {item.text}
                </button>
              </li>
            ))}
            {!shown.length && <li className="hls-transcript__empty">Không có đoạn nào khớp.</li>}
          </ol>
        </details>
      )}
    </div>
  );
}
