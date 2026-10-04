/** Behaviour only: these helpers deliberately do not change the approved UI. */
export function toastDuration(tone?: string) {
  return tone === "warning" || tone === "error" ? 8000 : tone === "info" ? 5000 : 4000;
}

export function shouldResetProfile(previousId: string | undefined, nextId: string | undefined, dirty: boolean) {
  return previousId !== nextId || !dirty;
}

export function meetingShortcut(event: {key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; repeat?: boolean; defaultPrevented?: boolean}, typing: boolean, dialogOpen: boolean) {
  if (typing || dialogOpen || event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.defaultPrevented) return null;
  const key = event.key.toLowerCase();
  return ["m", "v", "s", "h", "c", "escape"].includes(key) ? key : null;
}

export function beforeTaskAt(items: {id: string; top: number; height: number}[], pointerY: number, draggedId: string | null) {
  return items.find(item => item.id !== draggedId && pointerY < item.top + item.height / 2)?.id ?? null;
}

export function focusFirstInvalid(form: Element | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

export async function withPending(operation: () => Promise<void>, setPending: (value: boolean) => void) {
  setPending(true);
  try { await operation(); } finally { setPending(false); }
}
