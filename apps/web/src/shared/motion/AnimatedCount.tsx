import { motion } from "motion/react";
import { DURATION, EASE } from "./tokens";
import { useMotionSafe } from "./MotionProvider";

// Same <b> and final text dimensions as the original reaction count; no duplicate measuring text.
export function ReactionCount({ value }: {value:number}) {
  const { reduced } = useMotionSafe();
  return <motion.b key={value} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : DURATION.micro, ease: EASE.out }}>{value}</motion.b>;
}
