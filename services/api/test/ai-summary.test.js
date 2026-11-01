import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonReply, transcriptText } from "../../../dist/api/infrastructure/ai/summarize.js";

test("the JSON object is found inside a fenced or chatty model reply", () => {
  assert.deepEqual(parseJsonReply('```json\n{"summary":"Họp","actions":["A"]}\n```'), { summary: "Họp", actions: ["A"] });
  assert.deepEqual(parseJsonReply('Đây là kết quả: {"code": 2} xin cảm ơn'), { code: 2 });
  assert.throws(() => parseJsonReply("không có JSON"));
  assert.throws(() => parseJsonReply("[1,2]"));
});

test("transcript text carries minute marks and is cut when too long", () => {
  assert.equal(transcriptText([{ start: 75, end: 80, text: "Chào" }]), "[1:15] Chào");
  const long = transcriptText(Array.from({ length: 5000 }, (_, i) => ({ start: i, end: i + 1, text: "x".repeat(20) })));
  assert.ok(long.length <= 40_004 && long.endsWith("[…]"));
});
