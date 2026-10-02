import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createApiServer } from "../../../dist/api/server.js";

let server;
let address;
const limitHeaders = {
  "content-type": "application/json",
  "x-forwarded-for": `test-${randomUUID()}`,
};

before(async () => {
  process.env.TRUST_PROXY = "true";
  server = createApiServer().listen(0);
  await once(server, "listening");
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress !== "string");
  address = `http://localhost:${serverAddress.port}`;
});

after(() => server.close());

test("GET /health returns an API health response", async () => {
  const response = await fetch(`${address}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.service, "api");
  assert.equal(body.status, "ok");
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("OPTIONS returns CORS metadata", async () => {
  const response = await fetch(`${address}/auth/login`, { method: "OPTIONS" });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /PATCH/);
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /DELETE/);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-File-Name/i);
});

test("invalid JSON returns a structured client error", async () => {
  const response = await fetch(`${address}/auth/login`, {
    method: "POST",
    headers: limitHeaders,
    body: "{invalid",
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_JSON");
});

test("invalid bearer token returns 401 rather than 500", async () => {
  const response = await fetch(`${address}/api/workspaces`, {
    headers: { Authorization: "Bearer invalid" },
  });
  assert.equal(response.status, 401);
});

test("malformed cookie does not crash logout", async () => {
  const response = await fetch(`${address}/auth/logout`, {
    method: "POST",
    headers: { Cookie: "unrelated=%ZZ" },
  });
  assert.equal(response.status, 204);
});

test("POST /auth/verify-otp without valid payload returns 400", async () => {
  const response = await fetch(`${address}/auth/verify-otp`, {
    method: "POST",
    headers: limitHeaders,
    body: JSON.stringify({ email: "invalid", otp: "123" }),
  });
  assert.equal(response.status, 400);
});

test("POST /auth/resend-otp without valid email returns 400", async () => {
  const response = await fetch(`${address}/auth/resend-otp`, {
    method: "POST",
    headers: limitHeaders,
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(response.status, 400);
});

test("POST /auth/google without credentials returns 400", async () => {
  const response = await fetch(`${address}/auth/google`, {
    method: "POST",
    headers: limitHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
});
