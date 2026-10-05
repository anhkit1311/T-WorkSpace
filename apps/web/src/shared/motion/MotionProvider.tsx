import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { getMotionPreset } from "./tokens";

type Preview = "system" | "full" | "reduced";
export const motionDebugEnabled = import.meta.env.DEV && typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("motion-debug");
let preview: Preview = "system";
const subscribers = new Set<() => void>();
const media = () => typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");
const read = () => preview === "system" ? Boolean(media()?.matches) : preview === "reduced";
function subscribe(callback: () => void) {
  subscribers.add(callback);
  const query = media();
  query?.addEventListener("change", callback);
  return () => { subscribers.delete(callback); query?.removeEventListener("change", callback); };
}
export function setMotionPreview(value: Preview) {
  if (!import.meta.env.DEV) return;
  preview = value;
  if (value === "system") delete document.documentElement.dataset.motionPreview;
  else document.documentElement.dataset.motionPreview = value;
  subscribers.forEach(callback => callback());
}
const context = createContext(getMotionPreset(false));
export function MotionProvider({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(subscribe, read, () => true);
  const preset = useMemo(() => getMotionPreset(reduced), [reduced]);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  return <context.Provider value={preset}><MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig></context.Provider>;
}
export function useMotionSafe() { return useContext(context); }

// A covered decorative scene has no reason to draw. Leases handle nested dialogs independently.
const covers = new Set<symbol>();
const coverSubscribers = new Set<() => void>();
export function useSceneCovered() {
  return useSyncExternalStore(callback => { coverSubscribers.add(callback); return () => { coverSubscribers.delete(callback); }; }, () => covers.size > 0, () => false);
}
export function useSceneCover(covered: boolean) {
  useEffect(() => {
    if (!covered) return;
    const key = Symbol(); covers.add(key); coverSubscribers.forEach(fn => fn());
    return () => { covers.delete(key); coverSubscribers.forEach(fn => fn()); };
  }, [covered]);
}
