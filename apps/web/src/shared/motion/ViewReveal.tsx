import type { ReactNode } from "react";

/**
 * TDTU Clean Enterprise Portal: Zero heavy animations.
 * Returns children directly without GSAP stagger delay.
 */
export function ViewReveal({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
