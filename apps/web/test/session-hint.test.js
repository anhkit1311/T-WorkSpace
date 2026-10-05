import assert from "node:assert/strict";
import test from "node:test";
import { readSessionHint, shouldTryRestore, writeSessionHint } from "../src/app/session-hint.ts";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
};

test("public pages skip the restore request until this browser had a session", () => {
  assert.equal(shouldTryRestore("/", false), false);
  assert.equal(shouldTryRestore("/login", false), false);
  assert.equal(shouldTryRestore("/register", false), false);
  assert.equal(shouldTryRestore("/", true), true);
  // The refresh cookie can outlive the hint: app deep links always try once.
  assert.equal(shouldTryRestore("/app/overview", false), true);
});

test("the hint is set on sign-in and cleared on logout or a failed refresh", () => {
  const storage = memoryStorage();
  assert.equal(readSessionHint(storage), false);
  writeSessionHint(true, storage);
  assert.equal(readSessionHint(storage), true);
  writeSessionHint(false, storage);
  assert.equal(readSessionHint(storage), false);
});

test("blocked storage never throws", () => {
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
    removeItem() { throw new Error("SecurityError"); },
  };
  assert.equal(readSessionHint(blocked), false);
  assert.doesNotThrow(() => writeSessionHint(true, blocked));
  assert.equal(readSessionHint(undefined), false);
});
