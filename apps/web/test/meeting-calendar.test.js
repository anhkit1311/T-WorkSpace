import assert from "node:assert/strict";
import test from "node:test";
import { calendarEvents, layoutDay, weekStart } from "../src/features/meetings/calendar.ts";

const iso = (date) => date.toISOString();
const schedule = (id, startsAt, endsAt, extra = {}) => ({
  id,
  roomId: "room-1",
  workspaceId: "ws-1",
  roomName: "Phòng họp",
  workspaceName: "Nhóm A",
  createdBy: "u1",
  organizerName: "An",
  title: `Lịch ${id}`,
  description: "",
  startsAt,
  endsAt,
  canManage: true,
  ...extra,
});
const session = (id, startedAt, endedAt, extra = {}) => ({
  id,
  roomId: "room-1",
  roomName: "Phòng họp",
  workspaceId: "ws-1",
  workspaceName: "Nhóm A",
  scheduleId: null,
  title: null,
  startedAt,
  endedAt,
  people: ["An"],
  ...extra,
});
const event = (key, start, end) => ({
  key,
  title: key,
  workspaceName: "Nhóm A",
  workspaceId: "ws-1",
  roomId: "room-1",
  start: new Date(start),
  end: new Date(end),
  status: "upcoming",
  scheduleId: key,
  sessionId: null,
  people: [],
  canManage: false,
});

test("a week starts on Monday 00:00 Vietnam time", () => {
  // Sunday 23:30 in Vietnam still belongs to the week that began on Monday 19/10.
  assert.equal(iso(weekStart(new Date("2026-10-25T16:30:00Z"))), "2026-10-18T17:00:00.000Z");
  // Monday 00:30 in Vietnam starts a new week.
  assert.equal(iso(weekStart(new Date("2026-10-25T17:30:00Z"))), "2026-10-25T17:00:00.000Z");
});

test("a schedule with a running session is live and carries that session", () => {
  const data = {
    schedules: [schedule("s1", "2026-10-21T03:00:00Z", "2026-10-21T04:00:00Z")],
    sessions: [session("m1", "2026-10-21T03:02:00Z", null, { scheduleId: "s1", title: "Lịch s1" })],
  };
  const [only, ...rest] = calendarEvents(data, new Date("2026-10-21T03:30:00Z"));
  assert.equal(rest.length, 0);
  assert.equal(only.status, "live");
  assert.equal(only.sessionId, "m1");
  assert.equal(only.scheduleId, "s1");
  assert.deepEqual(only.people, ["An"]);
});

test("schedules are past once their slot ends; a session that ended early keeps the slot joinable", () => {
  const data = {
    schedules: [
      schedule("later", "2026-10-21T05:00:00Z", "2026-10-21T06:00:00Z"),
      schedule("done", "2026-10-21T01:00:00Z", "2026-10-21T02:00:00Z"),
      schedule("early", "2026-10-21T03:00:00Z", "2026-10-21T04:00:00Z"),
    ],
    sessions: [session("m2", "2026-10-21T03:00:00Z", "2026-10-21T03:10:00Z", { scheduleId: "early" })],
  };
  const byKey = Object.fromEntries(calendarEvents(data, new Date("2026-10-21T03:30:00Z")).map((item) => [item.scheduleId, item]));
  assert.equal(byKey.later.status, "upcoming");
  assert.equal(byKey.done.status, "past");
  assert.equal(byKey.early.status, "upcoming");
  assert.equal(byKey.early.sessionId, "m2");
});

test("a meeting started without a schedule is its own event named after the room", () => {
  const data = { schedules: [], sessions: [session("m3", "2026-10-21T02:00:00Z", "2026-10-21T02:40:00Z")] };
  const [only] = calendarEvents(data, new Date("2026-10-21T05:00:00Z"));
  assert.equal(only.title, "Phòng họp");
  assert.equal(only.sessionId, "m3");
  assert.equal(only.scheduleId, null);
  assert.equal(only.status, "past");
  assert.equal(iso(only.end), "2026-10-21T02:40:00.000Z");
});

// Wednesday 21/10/2026, 00:00 in Vietnam.
const wednesday = new Date("2026-10-20T17:00:00Z");

test("overlapping meetings share the hour side by side", () => {
  const laid = layoutDay(
    [event("a", "2026-10-21T02:00:00Z", "2026-10-21T03:00:00Z"), event("b", "2026-10-21T02:30:00Z", "2026-10-21T03:30:00Z")],
    wednesday,
  );
  assert.equal(laid.length, 2);
  assert.deepEqual(laid.map((item) => item.columns), [2, 2]);
  assert.notEqual(laid[0].column, laid[1].column);
});

test("a meeting before 7:00 is clipped to the top of the day", () => {
  const [only] = layoutDay([event("early", "2026-10-20T23:00:00Z", "2026-10-21T01:00:00Z")], wednesday);
  assert.equal(only.top, 0);
  assert.ok(Math.abs(only.height - (100 / 14)) < 1e-9, `8:00 is one hour into the 7h–21h frame, got ${only.height}`);
});

test("a meeting across midnight shows on both days, clipped to each day's edge", () => {
  const sunday = new Date("2026-10-24T17:00:00Z");
  const monday = new Date("2026-10-25T17:00:00Z");
  const late = event("late", "2026-10-25T16:00:00Z", "2026-10-25T18:00:00Z");
  for (const day of [sunday, monday]) {
    const [only] = layoutDay([late], day);
    assert.ok(only, `missing on ${iso(day)}`);
    assert.ok(only.top >= 0 && only.height > 0 && only.top + only.height <= 100 + 1e-9, JSON.stringify(only));
  }
  assert.equal(layoutDay([late], sunday)[0].top + layoutDay([late], sunday)[0].height, 100);
  assert.equal(layoutDay([late], monday)[0].top, 0);
  assert.equal(layoutDay([late], new Date("2026-10-26T17:00:00Z")).length, 0);
});
