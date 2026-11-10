import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAccountLines } from "../src/features/admin/labels.ts";

test("account lines: comma, semicolon and Excel tabs; header and blank lines skipped", () => {
  assert.deepEqual(
    parseAccountLines(
      "Email\tHọ tên\n52100001@student.tdtu.edu.vn\tNguyễn Văn A\n\n  b@tdtu.edu.vn, Trần B  \r\nc@tdtu.edu.vn;Lê C",
    ),
    [
      { email: "52100001@student.tdtu.edu.vn", displayName: "Nguyễn Văn A", userCode: undefined },
      { email: "b@tdtu.edu.vn", displayName: "Trần B", userCode: undefined },
      { email: "c@tdtu.edu.vn", displayName: "Lê C", userCode: undefined },
    ],
  );
  assert.deepEqual(parseAccountLines("x@tdtu.edu.vn"), [
    { email: "x@tdtu.edu.vn", displayName: "", userCode: undefined },
  ]);
  // A third column keeps a mã số the admin typed; blank leaves it for the server to issue.
  assert.deepEqual(
    parseAccountLines("gv@tdtu.edu.vn, Trần Lan, GV01007\ncb@tdtu.edu.vn, Lê Minh, "),
    [
      { email: "gv@tdtu.edu.vn", displayName: "Trần Lan", userCode: "GV01007" },
      { email: "cb@tdtu.edu.vn", displayName: "Lê Minh", userCode: undefined },
    ],
  );
});
