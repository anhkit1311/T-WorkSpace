import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ADAPTIVE, adaptToQos, cappedLayer } from '../src/features/meetings/webrtc/adaptive.ts';

const q = (packetLoss, rtt = 50) => ({ packetLoss, rtt, jitter: 5, bitrate: 500 });
const feed = (state, samples) => samples.reduce(adaptToQos, state);

test('steps down one layer after two bad samples, not after one', () => {
  assert.equal(feed(INITIAL_ADAPTIVE, [q(8)]).cap, 2);
  assert.equal(feed(INITIAL_ADAPTIVE, [q(8), q(8)]).cap, 1);
  assert.equal(feed(INITIAL_ADAPTIVE, [q(8), q(8), q(8), q(8)]).cap, 0);
  assert.equal(feed(INITIAL_ADAPTIVE, [q(0, 500), q(0, 500)]).cap, 1);
});

test('severe loss goes audio-only, recovery climbs one layer per four good samples', () => {
  const audioOnly = feed(INITIAL_ADAPTIVE, [q(20), q(20)]);
  assert.equal(audioOnly.cap, null);
  assert.equal(feed(audioOnly, [q(0), q(0), q(0)]).cap, null);
  const low = feed(audioOnly, [q(0), q(0), q(0), q(0)]);
  assert.equal(low.cap, 0);
  assert.equal(feed(low, Array(8).fill(q(0))).cap, 2);
});

test('a mid sample breaks the streak; unchanged input keeps the same object', () => {
  assert.equal(feed(INITIAL_ADAPTIVE, [q(8), q(3), q(8)]).cap, 2);
  assert.equal(adaptToQos(INITIAL_ADAPTIVE, q(3)), INITIAL_ADAPTIVE);
  assert.equal(feed(INITIAL_ADAPTIVE, [q(null, null), q(null, null)]).cap, 2);
});

test('cappedLayer never raises demand and pauses when audio-only', () => {
  assert.equal(cappedLayer(2, 1), 1);
  assert.equal(cappedLayer(0, 2), 0);
  assert.equal(cappedLayer(null, 2), null);
  assert.equal(cappedLayer(1, null), null);
});
