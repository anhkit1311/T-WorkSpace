// One timing vocabulary for Motion (React presence/layout).
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
  /** Opening overlays: settles in ~0.4s with a small overshoot. */
  pop: { type: "spring", stiffness: 380, damping: 26, mass: 0.8 },
} as const;

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

/** `lite`: the device could not hold 50fps, so entering and leaving elements skip the blur. */
export function getMotionPreset(lite = false) {
  const blur = (px: number) => (lite ? "blur(0px)" : `blur(${px}px)`);
  return {
    reduced: false,
    lite,
    blur,
    duration: (seconds: number) => seconds,
    gesture: { whileHover: { y: -1 }, whileTap: { scale: 0.97 }, transition: SPRING.snappy },
    panel: {
      initial: { opacity: 0, x: 40, filter: blur(8) },
      animate: { opacity: 1, x: 0, filter: blur(0) },
      exit: { opacity: 0, x: 24, filter: blur(6), transition: { duration: DURATION.panelExit } },
      transition: { duration: 0.38, ease: EASE.out },
    },
    view: {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0, transition: { duration: DURATION.page, ease: EASE.out } },
      exit: { opacity: 0, y: -6, transition: { duration: DURATION.exit } },
    },
  };
}

export function tabDirection(previous: number, next: number): -1 | 0 | 1 {
  return next === previous ? 0 : next > previous ? 1 : -1;
}

export function prefersReducedMotion() {
  return false;
}
