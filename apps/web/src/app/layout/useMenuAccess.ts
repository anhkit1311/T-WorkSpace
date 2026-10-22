import { useEffect, useState } from "react";
import type { CcAgentProfile, WorkspaceItem } from "@doan/shared";
import { callCenterApi } from "../../features/call-center/api";
import { getWorkspacesApi } from "../../features/chat/api";
import { academicApi, type AcademicProfile } from "../../features/admin/api";

/** Sidebar entries that only some users can use. */
export type MenuAccess = { callCenter: boolean; workspaceAdmin: boolean; systemAdmin: boolean };

/**
 * What the signed-in user takes part in, from the APIs that enforce it. Until it is known (or if a
 * request fails) the restricted entries stay hidden; the pages still check access on their own.
 */
export function useMenuAccess(accessToken: string | null): MenuAccess | null {
  const [access, setAccess] = useState<MenuAccess | null>(null);
  const signedIn = Boolean(accessToken);
  useEffect(() => {
    if (!accessToken) return setAccess(null);
    let alive = true;
    void Promise.all([
      callCenterApi<CcAgentProfile>(accessToken, "me").catch(() => null),
      getWorkspacesApi(accessToken).catch(() => [] as WorkspaceItem[]),
      academicApi<AcademicProfile>(accessToken, "me").catch(() => null),
    ]).then(([callCenter, workspaces, academic]) => {
      if (!alive) return;
      setAccess({
        callCenter: Boolean(callCenter && (callCenter.isAdmin || callCenter.departments.length || callCenter.extension)),
        workspaceAdmin: workspaces.some((item) => item.role === "owner" || item.role === "admin"),
        systemAdmin: Boolean(academic?.systemAdmin),
      });
    });
    return () => {
      alive = false;
    };
    // Roles change rarely: load once per sign-in, not on every token refresh.
  }, [signedIn]);
  return access;
}
