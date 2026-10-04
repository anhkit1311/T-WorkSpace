// One timing vocabulary for Motion (React presence/layout) and GSAP (timelines, WebGL uniforms).
export const EASE = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  emphasized: [0.2, 0, 0, 1],
} as const;
export const EASE_OUT = EASE.out;
export const SPRING = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.7 },
  gentle: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
  bouncy: { type: "spring", stiffness: 420, damping: 24, mass: 0.7 },
} as const;
export const GSAP_EASE_OUT = "expo.out";
export const GSAP_EASE_INOUT = "power2.inOut";

export const DURATION = {
  micro: 0.12,
  overlay: 0.22,
  page: 0.3,
  story: 0.9,
  panel: 0.26,
  panelExit: 0.16,
  count: 0.6,
  exit: 0.14,
  enter: 0.22,
  reveal: 0.55,
  stagger: 0.05,
  scene: 1.1,
} as const;

export function getMotionPreset(reduced: boolean) {
  return {
    reduced,
    duration: (seconds: number) => reduced ? 0 : seconds,
    gesture: reduced ? {} : { whileHover: { y: -1 }, whileTap: { scale: 0.97 }, transition: SPRING.snappy },
    panel: {
      initial: reduced ? false as const : { opacity: 0, x: 24 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: reduced ? 1 : 0, x: reduced ? 0 : 16, transition: { duration: reduced ? 0 : DURATION.panelExit } },
      transition: { duration: reduced ? 0 : DURATION.panel, ease: EASE.out },
    },
    view: {
      initial: reduced ? false as const : { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : DURATION.page, ease: EASE.out } },
      exit: { opacity: reduced ? 1 : 0, y: reduced ? 0 : -6, transition: { duration: reduced ? 0 : DURATION.exit } },
    },
  };
}

export function tabDirection(previous: number, next: number): -1 | 0 | 1 {
  return next === previous ? 0 : next > previous ? 1 : -1;
}

export function interpolateCount(from: number, to: number, progress: number) {
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.round(from + (to - from) * (1 - (1 - clamped) ** 3));
}

export const viewTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.enter, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: DURATION.exit, ease: "easeOut" } },
} as const;

export function prefersReducedMotion() {
  // Only the DEV diagnostic can override a preference for comparison; production follows the OS.
  if (typeof document !== "undefined" && document.documentElement.dataset.motionPreview) {
    return document.documentElement.dataset.motionPreview === "reduced";
  }
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
