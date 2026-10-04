import { useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { DURATION, GSAP_EASE_OUT } from "./tokens";
import { useMotionSafe } from "./MotionProvider";

const MAX_TARGETS = 8;

/**
 * Staggers the first-level blocks of a page in after Motion's cross-fade has mounted it.
 * Mounted inside Suspense, so it runs once the lazy page has actually rendered. Only transform and
 * opacity are touched, and inline styles are cleared afterwards so fixed popovers inside the page
 * are not trapped by a lingering transform.
 */
export function ViewReveal({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionSafe();

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host?.firstElementChild || reduced) return;
    const blocks = (parent: Element) =>
      Array.from(parent.children).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && !node.matches("[data-reveal-skip], [hidden]"),
      );
    // Pages that wrap everything in a single container reveal that container's sections instead.
    let targets = blocks(host.firstElementChild);
    for (let depth = 0; targets.length === 1 && depth < 2; depth += 1) {
      const inner = blocks(targets[0]);
      if (inner.length < 2) break;
      targets = inner;
    }
    targets = targets.slice(0, MAX_TARGETS);
    if (!targets.length) return;

    const media = gsap.matchMedia();
    media.add({ full: "(prefers-reduced-motion: no-preference)", reduced: "(prefers-reduced-motion: reduce)" }, () => {
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: DURATION.reveal,
          ease: GSAP_EASE_OUT,
          stagger: DURATION.stagger,
          clearProps: "transform,opacity,visibility",
        },
      );
    }, host);
    return () => media.revert();
  }, [reduced]);

  return (
    <div ref={hostRef} className="view-reveal">
      {children}
    </div>
  );
}
