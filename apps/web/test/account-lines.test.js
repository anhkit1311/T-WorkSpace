import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAccountLines } from "../src/features/thesis/labels.ts";

test("account lines: comma, semicolon and Excel tabs; header and blank lines skipped", () => {
  assert.deepEqual(parseAccountLines("Email\tHọ tên\n52100001@student.tdtu.edu.vn\tNguyễn Văn A\n\n  b@tdtu.edu.vn, Trần B  \r\nc@tdtu.edu.vn;Lê C"), [
    { email: "52100001@student.tdtu.edu.vn", displayName: "Nguyễn Văn A" },
    { email: "b@tdtu.edu.vn", displayName: "Trần B" },
    { email: "c@tdtu.edu.vn", displayName: "Lê C" },
  ]);
  assert.deepEqual(parseAccountLines("x@tdtu.edu.vn"), [{ email: "x@tdtu.edu.vn", displayName: "" }]);
});
