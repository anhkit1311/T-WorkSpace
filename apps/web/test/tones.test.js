import { test } from "node:test";
import assert from "node:assert/strict";

// A recording stand-in for WebAudio: which frequencies start when, and whether the output is cut.
const started = [];
let disconnected = 0;
const node = () => ({ connect: (next) => next ?? node(), disconnect: () => void disconnected++ });
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = async () => {};
  createGain = () => ({ ...node(), gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } });
  createOscillator() {
    const oscillator = {
      ...node(),
      frequency: { value: 0 },
      start: (at) => started.push({ freq: oscillator.frequency.value, at }),
      stop() {},
    };
    return oscillator;
  }
}
const timers = [];
globalThis.window = {
  AudioContext: FakeAudioContext,
  addEventListener() {},
  setInterval: (fn) => timers.push(fn),
  clearInterval() {},
};
const { startTone } = await import("../src/features/call-center/tones.ts");

test("tones: ringback is 425 Hz once per 5 s cycle; stopping cuts the output", () => {
  started.length = 0;
  const stop = startTone("ringback");
  assert.deepEqual(
    started.map((item) => item.freq),
    [425, 425],
    "two cycles scheduled ahead",
  );
  assert.equal(started[1].at - started[0].at, 5);
  stop();
  stop(); // a second stop is harmless
  assert.equal(disconnected, 1);
});

test("tones: ringtone is two dual-frequency bursts per 3 s cycle", () => {
  started.length = 0;
  startTone("ring")();
  assert.deepEqual(
    started.slice(0, 4).map((item) => item.freq),
    [880, 1320, 880, 1320],
  );
  assert.ok(
    Math.abs(started[2].at - started[0].at - 0.6) < 1e-9,
    "second burst 0.6 s after the first",
  );
});
