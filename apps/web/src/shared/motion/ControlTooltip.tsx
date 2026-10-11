import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useMotionSafe } from "./MotionProvider";
import { DURATION, EASE } from "./tokens";

export function useControlTooltip(ref: RefObject<HTMLButtonElement | null>, label: string, shortcut?: string) {
  const [position, setPosition] = useState<{x:number;y:number} | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const { reduced } = useMotionSafe();
  const close = () => { clearTimeout(timer.current); setPosition(null); };
  const show = () => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setPosition({ x: Math.max(125, Math.min(innerWidth - 125, box.x + box.width / 2)), y: box.bottom + 8 > innerHeight - 45 ? box.top - 36 : box.bottom + 8 });
  };
  const later = () => { clearTimeout(timer.current); timer.current = setTimeout(show, 400); };
  useEffect(() => {
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { clearTimeout(timer.current); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, []);
  return {
    id: position ? id : undefined,
    handlers: {
      onPointerEnter: later, onPointerLeave: close,
      onPointerDown: later, onPointerUp: close, onPointerCancel: close,
      onFocus: () => { if (ref.current?.matches(":focus-visible")) show(); else later(); },
      onBlur: close, onKeyDown: (event: {key:string}) => { if (event.key === "Escape") close(); },
    },
    tooltip: createPortal(<AnimatePresence>{position && <motion.span id={id} role="tooltip" className="motion-tooltip" style={{left:position.x,top:position.y,translate:"-50% 0"}} initial={reduced ? false : {opacity:0,y:3}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reduced?0:DURATION.micro,ease:EASE.out}}>{label}{shortcut && <kbd>{shortcut}</kbd>}</motion.span>}</AnimatePresence>, document.body),
  };
}
