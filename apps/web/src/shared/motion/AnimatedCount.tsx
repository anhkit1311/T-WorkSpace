import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { motion } from "motion/react";
import { DURATION, EASE, interpolateCount } from "./tokens";
import { useMotionSafe } from "./MotionProvider";

export function CountUp({ value, ...props }: HTMLAttributes<HTMLElement> & {value: number}) {
  const { reduced } = useMotionSafe();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const previous = useRef(reduced ? value : 0);
  useEffect(() => {
    if (reduced || !Number.isFinite(value)) { setDisplay(value); previous.current = value; return; }
    const from = previous.current;
    let start = 0, frame = 0;
    const tick = (now: number) => {
      start ||= now;
      const progress = (now - start) / (DURATION.count * 1000);
      setDisplay(interpolateCount(from, value, progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    previous.current = value;
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <strong {...props} aria-label={String(value)}>{display}</strong>;
}

// Same <b> and final text dimensions as the original reaction count; no duplicate measuring text.
export function ReactionCount({ value }: {value:number}) {
  const { reduced } = useMotionSafe();
  return <motion.b key={value} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : DURATION.micro, ease: EASE.out }}>{value}</motion.b>;
}
