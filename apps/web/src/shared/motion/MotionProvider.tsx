import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { getMotionPreset } from "./tokens";
import { nextQualitySample } from "./quality";

type Preview = "system" | "full" | "reduced";
export const motionDebugEnabled =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("motion-debug");
export function setMotionPreview(_value: Preview) {
  void _value;
  if (!import.meta.env.DEV) return;
  document.documentElement.dataset.motionPreview = "full";
}
const fullPreset = getMotionPreset(false);
const litePreset = getMotionPreset(true);
const context = createContext(fullPreset);
export function MotionProvider({ children }: { children: ReactNode }) {
  const [lite, setLite] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.motion = lite ? "lite" : "full";
    if (lite) return;
    // Watches frame times; two slow seconds in a row drop the blur for the rest of the visit.
    let frame = 0;
    let last = performance.now();
    let slowMs = 0;
    const tick = (now: number) => {
      const sample = nextQualitySample(slowMs, now - last);
      last = now;
      slowMs = sample.slowMs;
      if (sample.downgrade) setLite(true);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lite]);
  return (
    <context.Provider value={lite ? litePreset : fullPreset}>
      <MotionConfig reducedMotion="never">{children}</MotionConfig>
    </context.Provider>
  );
}
export function useMotionSafe() {
  return useContext(context);
}
