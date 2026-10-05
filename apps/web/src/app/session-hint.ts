/** Remembers that this browser had a session, so public pages skip a refresh that can only 401. */
const SESSION_HINT_KEY = "nexo:hadSession";

type HintStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const defaultStorage = (): HintStorage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

export function readSessionHint(storage: HintStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSessionHint(
  hadSession: boolean,
  storage: HintStorage | undefined = defaultStorage(),
): void {
  try {
    if (hadSession) storage?.setItem(SESSION_HINT_KEY, "1");
    else storage?.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage can be blocked (private mode); the /app/* fallback still restores sessions.
  }
}

/**
 * Restore only when a session is plausible: the hint is set, or the user opened an app
 * deep link (the refresh cookie may outlive a cleared hint).
 */
export function shouldTryRestore(pathname: string, hadSession: boolean): boolean {
  return hadSession || pathname.startsWith("/app/");
}
