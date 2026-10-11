import { useEffect, useRef } from "react";
import { isSelectPickerEvent } from "../lib/select-picker";
import { useIsPresent } from "motion/react";
// Panels behave as dialogs: trap focus, Escape closes, restore prior inert/focus state.
export function usePanelDialog(onClose: () => void, enabled = true, excludeSibling?: string) {
  const present = useIsPresent();
  const ref = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const panel = ref.current;
    if (!enabled || !present || !panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    let current: HTMLElement = panel;
    while (current.parentElement && current.parentElement !== document.body) {
      for (const sibling of current.parentElement.children)
        if (
          sibling !== current &&
          sibling instanceof HTMLElement &&
          !(excludeSibling && sibling.matches(excludeSibling))
        ) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      current = current.parentElement;
    }
    const items = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
        ),
      ].filter((item) => item.offsetParent !== null);
    (items()[0] ?? panel).focus({preventScroll: true});
    const key = (event: KeyboardEvent) => {
      // A nested confirmation owns focus/Tab/Escape until it closes.
      if (event.target instanceof Element && event.target.closest(".modal")) return;
      if (event.key === "Escape") {
        if (isSelectPickerEvent(event)) return;
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const targets = items(),
        first = targets[0],
        last = targets[targets.length - 1];
      if (!first) {
        event.preventDefault();
        panel.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      for (const item of siblings) item.element.inert = item.inert;
      if (previous?.isConnected) previous.focus({preventScroll: true});
    };
  }, [enabled, present, excludeSibling]);
  return ref;
}
