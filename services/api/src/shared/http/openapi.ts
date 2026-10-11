// REST catalog; detailed policies are in docs/14–17, socket types in @doan/shared.
const uuid = { type: "string", format: "uuid" },
  text = { type: "string" },
  object = { type: "object", additionalProperties: true };
const paths: Record<string, Record<string, unknown>> = {};
function add(
  path: string,
  methods: string[],
  tag: string,
  summary: string,
  body?: object,
  publicRoute = false,
) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: uuid,
  }));
  paths[path] = Object.fromEntries(
    methods.map((method) => [
      method,
      {
        tags: [tag],
        summary,
        parameters,
        security: publicRoute ? [] : [{ bearerAuth: [] }],
        ...(body && method !== "get"
          ? { requestBody: { required: true, content: { "application/json": { schema: body } } } }
          : {}),
        responses: {
          "200": {
            description: "Success; see module contract for wrapper",
            content: { "application/json": { schema: object } },
          },
          ...(method === "post" ? { "201": { description: "Created" } } : {}),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "413": { $ref: "#/components/responses/Error" },
          "429": { $ref: "#/components/responses/Error" },
        },
      },
    ]),
  );
}
for (const name of [
  "register",
  "verify-otp",
  "resend-otp",
  "google",
  "login",
  "password-reset/request",
  "password-reset/confirm",
])
  add(`/auth/${name}`, ["post"], "Auth", name, object, true);
for (const name of ["refresh", "logout"])
  add(
    `/auth/${name}`,
    ["post"],
    "Auth",
    `${name}; workspace_refresh HttpOnly cookie`,
    object,
    true,
  );
add("/auth/me", ["get"], "Auth", "Current user");
add("/auth/profile", ["post"], "Profiles", "Own personalization", object);
add(
  "/auth/password/change",
  ["post"],
  "Auth",
  "Verify old password and revoke other sessions",
  object,
);
add(
  "/api/users/{userId}/profile",
  ["get"],
  "Profiles",
  "Shared-workspace public profile; activity preference respected",
);
add(
  "/api/home",
  ["get"],
  "Workspace",
  "Six assigned unfinished tasks, four upcoming meetings and unread notification count; current channel access",
);
add("/api/workspaces", ["get", "post"], "Workspace", "Current memberships / create", {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string", minLength: 2, maxLength: 100 } },
});
add(
  "/api/workspaces/{workspaceId}/administration",
  ["get"],
  "Workspace",
  "Roles, invitations, audit and usage; owner/admin",
);
for (const name of ["leave", "transfer", "roles", "channels/order", "channel-members"])
  add(`/api/workspaces/{workspaceId}/${name}`, ["post"], "Workspace", name, object);
add(
  "/api/workspaces/{workspaceId}/settings",
  ["patch"],
  "Workspace",
  "Rename/archive/restore",
  object,
);
add("/api/workspaces/{workspaceId}/channels/manage", ["post"], "Channel", "Create channel", object);
add(
  "/api/workspaces/{workspaceId}/channels/manage/{channelId}",
  ["patch"],
  "Channel",
  "Rename/type/private/archive",
  object,
);
add(
  "/api/workspaces/{workspaceId}/invitations",
  ["post"],
  "Invitation",
  "Create hashed token; optional recipient",
  object,
);
add(
  "/api/workspaces/{workspaceId}/invitations/{invitationId}",
  ["post", "delete"],
  "Invitation",
  "Resend invalidates old token / revoke",
  object,
);
add(
  "/api/invitations/accept",
  ["post"],
  "Invitation",
  "Valid token and verified email; idempotent",
  { type: "object", required: ["token"], properties: { token: text } },
);
for (const name of ["members", "channels"])
  add(`/api/workspaces/{workspaceId}/${name}`, ["get"], "Workspace", `Accessible ${name}`);
for (const name of ["add", "approve", "reject"])
  add(`/api/workspaces/{workspaceId}/members/${name}`, ["post"], "Workspace", name, object);
add(
  "/api/channels/{channelId}/messages",
  ["get"],
  "Chat",
  "Latest 100; before/after cursor; no thread replies",
);
add("/api/channels/{channelId}/preferences", ["get", "post"], "Chat", "Mute/favorite/read", object);
for (const name of ["pins", "bookmarks", "members"])
  add(`/api/channels/{channelId}/${name}`, ["get"], "Chat", name);
add(
  "/api/messages/{messageId}/context",
  ["get"],
  "Chat",
  "Target and surrounding messages / reply root",
);
for (const name of ["pin", "bookmark"])
  add(
    `/api/messages/{messageId}/${name}`,
    ["post"],
    "Chat",
    `Toggle ${name}; retry can toggle again`,
    object,
  );
add("/api/threads/{rootId}", ["get"], "Chat", "Root and 50 replies; before cursor");
add("/api/threads/{rootId}/read", ["post"], "Chat", "Persist cursor", object);
add("/api/notifications", ["get"], "Notifications", "30 results; before cursor; current rights");
add(
  "/api/notifications/read",
  ["post"],
  "Notifications",
  "ID or all read; synchronize tabs",
  object,
);
add(
  "/api/workspaces/{workspaceId}/notifications",
  ["get", "post"],
  "Notifications",
  "Workspace mute",
  object,
);
add(
  "/api/search/messages",
  ["get"],
  "Search",
  "q (2–100), workspace, channel, author, from, to, file, before; 30 results",
);
add(
  "/api/channels/{channelId}/tasks",
  ["get", "post"],
  "Tasks",
  "Filtered board / idempotent create",
  {
    type: "object",
    required: ["title", "clientTaskId"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", maxLength: 8000 },
      clientTaskId: uuid,
      assigneeId: uuid,
      sourceMessageId: uuid,
    },
  },
);
add(
  "/api/tasks/{taskId}",
  ["get", "patch"],
  "Tasks",
  "Detail / mutation; TASK_CONFLICT requires reload",
  {
    type: "object",
    required: ["version"],
    properties: {
      version: { type: "integer", minimum: 1 },
      title: text,
      status: { enum: ["todo", "doing", "done"] },
      priority: { enum: ["low", "normal", "high", "urgent"] },
      beforeTaskId: uuid,
      action: {
        enum: [
          "checklist-add",
          "checklist-toggle",
          "checklist-remove",
          "comment",
          "attachment-add",
          "attachment-remove",
        ],
      },
    },
  },
);
add(
  "/api/channels/{channelId}/media-location",
  ["get"],
  "Meetings",
  "Current SFU owner public endpoint; null without owner",
);
add("/api/meetings/history", ["get"], "Meetings", "Own recent 50 participations");
add(
  "/api/meetings/schedules",
  ["get", "post"],
  "Meetings",
  "Accessible schedules / create",
  object,
);
add(
  "/api/meetings/schedules/{scheduleId}",
  ["patch", "delete"],
  "Meetings",
  "Update / cancel",
  object,
);
add(
  "/api/meetings/sessions/{sessionId}/outcomes",
  ["get"],
  "Meetings",
  "Agenda, shared notes, meeting tasks and summary of one session",
);
add(
  "/api/meetings/sessions/{sessionId}/notes",
  ["patch"],
  "Meetings",
  "Save shared notes with baseVersion; 409 NOTES_CONFLICT when stale",
  object,
);
add("/api/meetings/sessions/{sessionId}/agenda", ["post"], "Meetings", "Add agenda item", object);
add(
  "/api/meetings/sessions/{sessionId}/agenda/{itemId}",
  ["patch", "delete"],
  "Meetings",
  "Tick / rename or remove an ad-hoc agenda item",
  object,
);
add(
  "/api/meetings/sessions/{sessionId}/outcome-channel",
  ["patch"],
  "Meetings",
  "Host/co-host picks the text channel for tasks and summary",
  object,
);
add(
  "/api/meetings/sessions/{sessionId}/tasks",
  ["post"],
  "Meetings",
  "Create a Kanban task linked to the session",
  object,
);
add(
  "/api/channels/{channelId}/attachments",
  ["post"],
  "Files",
  "Raw file <=8MB; Content-Type, X-File-Name; signature/quota",
);
(paths["/api/channels/{channelId}/attachments"].post as Record<string, unknown>).requestBody = {
  required: true,
  content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
};
add(
  "/api/attachments/{attachmentId}",
  ["get"],
  "Files",
  "Binary; active message/task and current rights",
);
add("/health", ["get"], "Operations", "Liveness", undefined, true);
add("/ready", ["get"], "Operations", "DB and migration readiness", undefined, true);
add(
  "/api/operations/metrics",
  ["get"],
  "Operations",
  "Request, pool, sockets and SFU resource counters; OPERATIONS_TOKEN bearer credential",
);
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "nexo REST API",
    version: "0.2.0",
    description:
      "Policies/payload details: docs/14–17. Generic response objects are intentional; this catalog is not a generated SDK.",
  },
  servers: [{ url: "/" }],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    responses: {
      Error: {
        description: "Structured application error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["error"],
              properties: {
                error: {
                  type: "object",
                  required: ["code", "message"],
                  properties: { code: text, message: text },
                },
              },
            },
          },
        },
      },
    },
  },
};
