/**
 * Call tones made with WebAudio, so there are no sound files to ship:
 * - "ringback": what the caller hears while the other phone rings (Vietnam / ITU: 425 Hz, 1 s on, 4 s off);
 * - "ring": the incoming-call ringtone (two short 880/1320 Hz bursts every 3 s).
 * Browsers keep audio suspended until the page has had a click or key press; the first one unlocks it.
 */
export type ToneKind = "ring" | "ringback";

const PATTERNS: Record<
  ToneKind,
  { period: number; bursts: { at: number; length: number; freqs: number[]; gain: number }[] }
> = {
  ringback: { period: 5, bursts: [{ at: 0, length: 1, freqs: [425], gain: 0.12 }] },
  ring: {
    period: 3,
    bursts: [
      { at: 0, length: 0.4, freqs: [880, 1320], gain: 0.1 },
      { at: 0.6, length: 0.4, freqs: [880, 1320], gain: 0.1 },
    ],
  },
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!context) {
    context = new window.AudioContext();
    const unlock = () => void context?.resume();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }
  return context;
}

/** Starts the tone in a loop; the returned function stops it (safe to call more than once). */
export function startTone(kind: ToneKind): () => void {
  const ctx = audioContext();
  if (!ctx) return () => {};
  void ctx.resume().catch(() => {});
  const { period, bursts } = PATTERNS[kind];
  const output = ctx.createGain();
  output.connect(ctx.destination);
  let cycleStart = ctx.currentTime + 0.05;
  // Schedules one cycle ahead, so timer jitter never leaves a gap.
  const schedule = () => {
    for (const burst of bursts)
      for (const freq of burst.freqs) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = cycleStart + burst.at;
        const end = start + burst.length;
        oscillator.frequency.value = freq;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(burst.gain, start + 0.02);
        gain.gain.setValueAtTime(burst.gain, end - 0.02);
        gain.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(gain).connect(output);
        oscillator.start(start);
        oscillator.stop(end);
      }
    cycleStart += period;
  };
  schedule();
  schedule();
  const timer = window.setInterval(schedule, period * 1000);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    output.disconnect(); // silences the bursts already scheduled
  };
}
