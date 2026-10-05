import { useEffect, useRef, type PointerEvent, type KeyboardEvent, type MutableRefObject } from "react";
import { useAnimate } from "motion/react";
import { SPRING, DURATION, EASE } from "./tokens";
import { useMotionSafe } from "./MotionProvider";

/** Motion owns only this control's transform. CSS owns its color, border and focus ring. */
export function useControlMotion(disabled = false) {
  const [ref, animate] = useAnimate<HTMLButtonElement>();
  const { reduced } = useMotionSafe();
  const hovered = useRef(false);
  const reset = () => { if (ref.current) void animate(ref.current, { scale: 1, y: hovered.current && !disabled && !reduced ? -1 : 0 }, SPRING.snappy); };
  useEffect(() => {
    if (ref.current && (disabled || reduced)) void animate(ref.current, { scale: 1, y: 0 }, { duration: 0 });
  }, [disabled, reduced, animate, ref]);
  const press = () => { if (ref.current && !disabled && !reduced) void animate(ref.current, { scale: 0.97, y: 0 }, SPRING.snappy); };
  return { ref, setRef: (node: HTMLButtonElement | null) => { (ref as MutableRefObject<HTMLButtonElement | null>).current = node; }, handlers: {
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => { hovered.current = event.pointerType !== "touch"; if (hovered.current) reset(); },
    onPointerLeave: () => { hovered.current = false; reset(); },
    onPointerDown: press,
    onPointerUp: reset,
    onPointerCancel: reset,
    onBlur: () => { hovered.current = false; reset(); },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === " " || event.key === "Enter") press(); },
    onKeyUp: reset,
  }};
}

/** Pop only a changed state, never the initial value or a remounted message history. */
export function useStatePop(value: unknown) {
  const [ref, animate] = useAnimate<HTMLElement>();
  const previous = useRef(value);
  const { reduced } = useMotionSafe();
  useEffect(() => {
    if (previous.current !== value && ref.current && !reduced) {
      void animate(ref.current, { scale: [1, 1.18, 1] }, { duration: DURATION.page, ease: EASE.out });
    }
    previous.current = value;
  }, [value, reduced, animate, ref]);
  return ref;
}

/** The current send glyph moves; its button and composer retain their existing geometry. */
export function useSendFeedback(sending: boolean) {
  const [ref, animate] = useAnimate<HTMLButtonElement>();
  const previous = useRef(sending);
  const { reduced } = useMotionSafe();
  useEffect(() => {
    if (ref.current && reduced) void animate("svg", {x:0,y:0,opacity:1}, {duration:0});
    if (sending && !previous.current && ref.current && !reduced) {
      const animation = animate("svg", {x:[0,5,0],y:[0,-5,0],opacity:[1,0,1]}, {duration:DURATION.page,ease:EASE.out});
      previous.current = sending;
      return () => { animation.stop(); if(ref.current) void animate("svg", {x:0,y:0,opacity:1}, {duration:0}); };
    }
    previous.current = sending;
  }, [sending, reduced, ref, animate]);
  return ref;
}
