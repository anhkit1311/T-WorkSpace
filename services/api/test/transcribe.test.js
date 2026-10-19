import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { test } from "node:test";

// The speech service URL is read from the environment when config loads.
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk.toString("latin1")));
  request.on("end", () => {
    server.lastRequest = { authorization: request.headers.authorization, body };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        text: "Xin chào",
        segments: [
          { start: 0, end: 1.5, text: " Xin chào các bạn " },
          { start: 1.5, end: 1.2, text: "lỗi thời gian" },
          { start: 2, end: 3725.25, text: "a --> b" },
          { start: 4, end: 5, text: "   " },
        ],
      }),
    );
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.TRANSCRIBE_URL = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;
process.env.TRANSCRIBE_API_KEY = "test-key";
const { parseSegments, requestTranscript, toVtt } = await import("../../../dist/api/infrastructure/speech/transcribe.js");

test("WebVTT cues have hh:mm:ss.mmm stamps and no stray arrows", () => {
  const vtt = toVtt([
    { start: 0, end: 1.5, text: "Xin chào" },
    { start: 2, end: 3725.25, text: "a --> b" },
  ]);
  assert.equal(vtt, "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nXin chào\n\n2\n00:00:02.000 --> 01:02:05.250\na → b\n");
});

test("bad segments are dropped and a missing list is an error", () => {
  assert.deepEqual(parseSegments({ segments: [{ start: "1", end: 2, text: " ok " }, { start: 3, end: 2, text: "x" }, { start: 0, end: 1 }] }), [
    { start: 1, end: 2, text: "ok" },
  ]);
  assert.throws(() => parseSegments({ text: "only text" }), /segments/);
});

test("the speech service gets the audio, model, language and key", async () => {
  try {
    const segments = await requestTranscript(Buffer.from("ID3-fake-mp3"), "speech.mp3");
    assert.deepEqual(segments.map((item) => item.text), ["Xin chào các bạn", "a --> b"]);
    assert.equal(server.lastRequest.authorization, "Bearer test-key");
    for (const part of ['name="model"', "whisper-1", 'name="language"', "vi", "verbose_json", 'filename="speech.mp3"', "ID3-fake-mp3"])
      assert.ok(server.lastRequest.body.includes(part), part);
  } finally {
    server.close();
  }
});
