import { useEffect } from "react";
import { animate } from "motion/react";
import { useMotionSafe } from "./MotionProvider";
import { DURATION, EASE } from "./tokens";

/** Presentation only: observe existing aria-pressed state, never intercept a business event. */
export function ControlFeedback() {
  const { reduced } = useMotionSafe();
  useEffect(() => {
    if (reduced) return;
    const animations = new Map<Element, ReturnType<typeof animate>>();
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.attributeName === "aria-label" && record.oldValue && record.target instanceof HTMLButtonElement && record.target.matches(".topbar-bell-btn")) {
          const bell = record.target.querySelector("svg");
          if (bell) {
            animations.get(bell)?.stop();
            const animation = animate(bell, {rotate:[0,-10,8,-4,0]}, {duration:.4,ease:EASE.out});
            animations.set(bell, animation);
            void animation.then(() => { if (animations.get(bell) === animation) animations.delete(bell); });
          }
          continue;
        }
        if (record.attributeName === "aria-invalid" && (record.target instanceof HTMLInputElement || record.target instanceof HTMLTextAreaElement)) {
          if (!record.target.closest(".field") && record.oldValue !== "true" && record.target.getAttribute("aria-invalid") === "true") {
            const input = record.target;
            animations.get(input)?.stop();
            const animation = animate(input, {x:[0,-4,4,-2,0]}, {duration:DURATION.page,ease:EASE.inOut});
            animations.set(input, animation);
            void animation.then(() => { if (animations.get(input) === animation) animations.delete(input); });
          }
          continue;
        }
        if (!(record.target instanceof HTMLButtonElement) || record.oldValue === null || record.oldValue === record.target.getAttribute("aria-pressed")) continue;
        const icon = record.target.querySelector("svg");
        if (!icon) continue;
        animations.get(icon)?.stop();
        const animation = animate(icon, {scale:[1,1.18,1]}, {duration:DURATION.page,ease:EASE.out});
        animations.set(icon, animation);
        void animation.then(() => { if (animations.get(icon) === animation) animations.delete(icon); });
      }
    });
    const root = document.getElementById("root");
    if (root) observer.observe(root, {subtree:true,attributes:true,attributeFilter:["aria-pressed", "aria-invalid", "aria-label"],attributeOldValue:true});
    return () => { observer.disconnect(); animations.forEach((animation, element) => { animation.stop(); void animate(element, {x:0,scale:1,rotate:0}, {duration:0}); }); animations.clear(); };
  }, [reduced]);
  return null;
}
