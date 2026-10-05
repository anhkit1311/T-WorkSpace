import type { ViewId } from "./types";

export interface AppRoute {
  view: ViewId;
  workspaceId?: string;
  channelId?: string;
  messageId?: string;
  threadId?: string;
  taskId?: string;
  scheduleId?: string;
  query?: string;
  invitationToken?: string;
  invalid?: boolean;
}

const views = new Set([
  "overview",
  "chat",
  "meetings",
  "profile",
  "admin",
  "invitation",
  "notifications",
  "tasks",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  ] as const) {
    const value = url.searchParams.get(param);
    if (value) {
      if (!uuid.test(value)) return { ...route, invalid: true };
      route[key] = value;
    }
  }
  if (route.channelId && !route.workspaceId) route.invalid = true;
  route.query = url.searchParams.get("q") || undefined;
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
  if (route.query) params.set("q", route.query);
  return `/app/${route.view}${params.size ? `?${params}` : ""}${route.invitationToken ? `#token=${encodeURIComponent(route.invitationToken)}` : ""}`;
}
