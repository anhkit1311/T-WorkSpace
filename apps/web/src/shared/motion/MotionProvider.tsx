import { createContext, useContext, useEffect, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { getMotionPreset } from "./tokens";

type Preview = "system" | "full" | "reduced";
export const motionDebugEnabled = import.meta.env.DEV && typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("motion-debug");
export function setMotionPreview(_value: Preview) {
  void _value;
  if (!import.meta.env.DEV) return;
  document.documentElement.dataset.motionPreview = "full";
}
const fullPreset = getMotionPreset(false);
const context = createContext(fullPreset);
export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.motion = "full";
  }, []);
  return (
    <context.Provider value={fullPreset}>
      <MotionConfig reducedMotion="never">{children}</MotionConfig>
    </context.Provider>
  );
}
export function useMotionSafe() { return useContext(context); }

