import type { ViewId } from "./types";

export interface AppRoute {
  view: ViewId;
  workspaceId?: string;
  channelId?: string;
  messageId?: string;
  threadId?: string;
  taskId?: string;
  scheduleId?: string;
  termId?: string;
  projectId?: string;
  query?: string;
  invitationToken?: string;
  invalid?: boolean;
}

const views = new Set([
  "overview",
  "workspace",
  "chat",
  "meetings",
  "files",
  "profile",
  "admin",
  "invitation",
  "notifications",
  "tasks",
  "thesis",
  "call-center",
  "call-directory",
  "elearning",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceTabId = "workspace" | "tasks" | "chat" | "meetings" | "files";

export function isWorkspaceTabView(view: ViewId): view is WorkspaceTabId {
  return (
    view === "workspace" ||
    view === "tasks" ||
    view === "chat" ||
    view === "meetings" ||
    view === "files"
  );
}

export function selectWorkspaceRoute(
  workspaceId: string,
  tab: WorkspaceTabId = "workspace",
): AppRoute {
  return {
    view: tab,
    workspaceId,
  };
}

export function switchWorkspaceTabRoute(
  currentRoute: AppRoute,
  targetTab: WorkspaceTabId,
  fallbackWorkspaceId?: string,
): AppRoute {
  const workspaceId = currentRoute.workspaceId ?? fallbackWorkspaceId;
  return {
    view: targetTab,
    workspaceId,
  };
}

const publicAuthPath = /^\/(login|register)\/?$/;

export function readAppRoute(url: URL): AppRoute {
  // Public screens are not app routes; they must never mark the app route invalid.
  if (url.pathname === "/" || publicAuthPath.test(url.pathname)) return { view: "overview" };
  const view = url.pathname.replace(/^\/app\//, "");
  if (!url.pathname.startsWith("/app/") || !views.has(view))
    return { view: "overview", invalid: true };
  const route: AppRoute = { view: view as ViewId };
  for (const [key, param] of [
    ["workspaceId", "workspace"],
    ["channelId", "channel"],
    ["messageId", "message"],
    ["threadId", "thread"],
    ["taskId", "task"],
    ["scheduleId", "schedule"],
    ["termId", "term"],
    ["projectId", "project"],
  ] as const) {
    const value = url.searchParams.get(param);
    if (value) {
      if (!uuid.test(value)) return { ...route, invalid: true };
      route[key] = value;
    }
  }
  // Direct conversations live outside any workspace, so a chat link may carry only the channel.
  if (route.channelId && !route.workspaceId && route.view !== "chat") route.invalid = true;
  if (route.view === "chat" && route.workspaceId) route.view = "workspace";
  const query = url.searchParams.get("q");
  if (query) route.query = query;
  if (route.view === "invitation")
    route.invitationToken = new URLSearchParams(url.hash.slice(1)).get("token") ?? undefined;
  return route;
}

/** Route to show when entering the app: keep an /app/ deep link, otherwise start at overview. */
export function appEntryRoute(url: URL): AppRoute {
  return url.pathname.startsWith("/app/") ? readAppRoute(url) : { view: "overview" };
}

export function appRouteUrl(route: AppRoute): string {
  const params = new URLSearchParams();
  if (route.workspaceId) params.set("workspace", route.workspaceId);
  if (route.channelId) params.set("channel", route.channelId);
  if (route.messageId) params.set("message", route.messageId);
  if (route.threadId) params.set("thread", route.threadId);
  if (route.taskId) params.set("task", route.taskId);
  if (route.scheduleId) params.set("schedule", route.scheduleId);
  if (route.termId) params.set("term", route.termId);
  if (route.projectId) params.set("project", route.projectId);
  if (route.query) params.set("q", route.query);
  return `/app/${route.view}${params.size ? `?${params}` : ""}${route.invitationToken ? `#token=${encodeURIComponent(route.invitationToken)}` : ""}`;
}

