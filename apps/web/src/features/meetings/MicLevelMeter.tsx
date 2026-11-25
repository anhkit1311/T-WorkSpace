import { useEffect, useRef, useState } from "react";
import { levelFromRms } from "./mic-level";

const SILENT_HINT_MS = 4000;
const SPEECH_LEVEL = 0.25;

/**
 * Live input level for the lobby mic check. The bar is written straight to the DOM each frame
 * so the (large) meeting page does not re-render at animation rate.
 */
export function MicLevelMeter({
  stream,
  enabled,
}: {
  stream: MediaStream | null;
  enabled: boolean;
}) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const [silent, setSilent] = useState(false);
  const track = stream?.getAudioTracks()[0] ?? null;

  useEffect(() => {
    setSilent(false);
    const fill = fillRef.current;
    if (fill) fill.style.transform = "scaleX(0)";
    if (!track || !enabled || typeof AudioContext === "undefined") return;

    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let smoothed = 0;
    let lastSpeech = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      const level = levelFromRms(Math.sqrt(sum / samples.length));
      // Fast attack, slow release keeps the bar readable.
      smoothed = level > smoothed ? level : smoothed * 0.9 + level * 0.1;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${smoothed.toFixed(3)})`;
      if (level >= SPEECH_LEVEL) lastSpeech = now;
      setSilent(now - lastSpeech > SILENT_HINT_MS);
      frame = requestAnimationFrame(tick);
    };
    // Autoplay policy may start the context suspended; the lobby check is a user gesture.
    void context.resume().catch(() => {});
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => {});
    };
  }, [track, enabled]);

  if (!track) return null;
  return (
    <div
      className="tw flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <span>{enabled ? "Mức âm micro" : "Micro đang tắt"}</span>
      <span
        className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-secondary"
        aria-hidden="true"
      >
        <span
          ref={fillRef}
          className="block size-full origin-left scale-x-0 rounded-full bg-emerald-500"
        />
      </span>
      {enabled && silent && (
        <span className="basis-full">
          Chưa nghe thấy tiếng. Hãy thử nói, hoặc chọn micro khác bên dưới.
        </span>
      )}
    </div>
  );
}
