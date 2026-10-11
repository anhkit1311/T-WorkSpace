import { useEffect, useMemo, useReducer } from "react";
import { useApp } from "../../app/providers/AppContext";
import { getMemberProfileApi } from "./api";

// Messages and member lists only carry names; avatars (Google URLs or data URLs up to ~3 MB) are
// resolved once per user through the profile endpoint, which also enforces private profiles.
const avatars = new Map<string, string | null>();
const pending = new Map<string, Promise<void>>();
let cacheOwner: string | null = null;

/** Returns a lookup from user id to avatar URL; the signed-in user always uses their own. */
export function useUserAvatars(userIds: readonly string[]) {
  const { accessToken, user } = useApp();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const key = useMemo(() => [...new Set(userIds)].sort().join(","), [userIds]);

  useEffect(() => {
    if (!accessToken || !user) return;
    // A different account must not reuse what the previous one was allowed to see.
    if (cacheOwner !== user.id) {
      avatars.clear();
      pending.clear();
      cacheOwner = user.id;
    }
    let active = true;
    for (const id of key.split(",")) {
      if (!id || id === user.id || avatars.has(id)) continue;
      let request = pending.get(id);
      if (!request) {
        request = getMemberProfileApi(accessToken, id)
          .then((profile) => void avatars.set(id, profile.avatarUrl || null))
          .catch(() => void avatars.set(id, null))
          .finally(() => pending.delete(id));
        pending.set(id, request);
      }
      void request.then(() => {
        if (active) refresh();
      });
    }
    return () => {
      active = false;
    };
  }, [key, accessToken, user]);

  return (userId: string): string | undefined =>
    userId === user?.id ? user.avatarUrl || undefined : avatars.get(userId) || undefined;
}
