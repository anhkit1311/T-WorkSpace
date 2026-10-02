import { useEffect, useState, useRef, type SetStateAction } from "react";
import { cachedDraft, loadDraft, storeDraft, draftGeneration } from "../lib/drafts";
export function useDraft<T>(key: string, initial: T) {
  const activeRef = useRef(true),
    keyRef = useRef(key);
  keyRef.current = key;
  const sessionRef = useRef({ key, generation: draftGeneration(key) });
  if (sessionRef.current.key !== key)
    sessionRef.current = { key, generation: draftGeneration(key) };
  const generation = sessionRef.current.generation;
  const [state, setState] = useState(() => ({
    key,
    value: cachedDraft<T>(key) ?? initial,
    ready: cachedDraft<T>(key) !== undefined,
  }));
  const value = state.key === key ? state.value : (cachedDraft<T>(key) ?? initial);
  const ready = state.key === key && state.ready;
  useEffect(() => {
    activeRef.current = true;
    let active = true;
    void loadDraft<T>(key).then((value) => {
      if (active) setState({ key, value: value ?? initial, ready: true });
    });
    return () => {
      active = false;
      activeRef.current = false;
    };
  }, [key]);
  const set = (action: SetStateAction<T>) => {
    const commit = (loaded?: T) => {
      const previous = cachedDraft<T>(key) ?? loaded ?? value;
      const next = typeof action === "function" ? (action as (old: T) => T)(previous) : action;
      if (storeDraft(key, next, generation) && activeRef.current && keyRef.current === key)
        setState({ key, value: next, ready: true });
    };
    if (!ready && cachedDraft<T>(key) === undefined) void loadDraft<T>(key).then(commit);
    else commit();
  };
  return [value, set, ready] as const;
}
