// One timing vocabulary for Motion (React presence/layout) and GSAP (timelines, WebGL uniforms).
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const GSAP_EASE_OUT = "expo.out";
export const GSAP_EASE_INOUT = "power2.inOut";

export const DURATION = {
  exit: 0.14,
  enter: 0.22,
  reveal: 0.55,
  stagger: 0.05,
  scene: 1.1,
} as const;

export const viewTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.enter, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: DURATION.exit, ease: "easeOut" } },
} as const;

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
