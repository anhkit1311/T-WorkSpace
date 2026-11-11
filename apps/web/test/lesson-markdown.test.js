import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLessonBody } from "../src/features/elearning/lesson-markdown.ts";

test("lesson body: headings, lists, quote, code fence and plain paragraphs", () => {
  assert.deepEqual(
    parseLessonBody(
      "# Tiêu đề\nDòng 1\nDòng 2\n\n- a\n- b\n1. một\n2. hai\n> ghi nhớ\n```ts\n# không phải tiêu đề\n- x\n```\n## Mục",
    ),
    [
      { type: "heading", level: 1, text: "Tiêu đề" },
      { type: "paragraph", text: "Dòng 1\nDòng 2" },
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["một", "hai"] },
      { type: "quote", text: "ghi nhớ" },
      { type: "code", text: "# không phải tiêu đề\n- x" },
      { type: "heading", level: 2, text: "Mục" },
    ],
  );
});

test("lesson body: unclosed fence keeps the rest as code; empty body has no blocks", () => {
  assert.deepEqual(parseLessonBody("```\na\nb"), [{ type: "code", text: "a\nb" }]);
  assert.deepEqual(parseLessonBody(""), []);
});
