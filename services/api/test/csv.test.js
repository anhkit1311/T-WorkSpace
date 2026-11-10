import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "../../../dist/api/shared/http/csv.js";

test("CSV for Excel: quotes separators and defuses formulas", () => {
  assert.equal(
    toCsv([
      ["a", "b,c", 'say "hi"'],
      ["x;y", "line\nbreak", ""],
    ]),
    'a,"b,c","say ""hi"""\r\n"x;y","line\nbreak",',
  );
  assert.equal(
    toCsv([["=HYPERLINK(1)", "+84901", "-1", "@SUM(A1)", "ok=1"]]),
    "'=HYPERLINK(1),'+84901,'-1,'@SUM(A1),ok=1",
  );
  assert.equal(toCsv([['=1,"2"']]), `"'=1,""2"""`);
});

test("XLSX export: a valid zip whose sheet keeps text as text and numbers as numbers", async () => {
  const { toXlsx } = await import("../../../dist/api/shared/http/xlsx.js");
  const { inflateRawSync } = await import("node:zlib");
  const file = toXlsx(
    [
      ["Họ tên", "MSSV", "Điểm"],
      ["=cmd() <b>", "0523", "8.25"],
    ],
    "Bảng điểm",
  );
  assert.equal(file.readUInt32LE(0), 0x04034b50, "zip local header");
  // Walk the local headers and inflate the sheet.
  const parts = {};
  for (let at = 0; file.readUInt32LE(at) === 0x04034b50;) {
    const size = file.readUInt32LE(at + 18);
    const nameLength = file.readUInt16LE(at + 26);
    const name = file.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    parts[name] = inflateRawSync(
      file.subarray(at + 30 + nameLength, at + 30 + nameLength + size),
    ).toString("utf8");
    at += 30 + nameLength + size;
  }
  assert.ok(parts["[Content_Types].xml"] && parts["xl/workbook.xml"].includes('name="Bảng điểm"'));
  const sheet = parts["xl/worksheets/sheet1.xml"];
  assert.match(
    sheet,
    /<c r="A2" t="inlineStr"><is><t xml:space="preserve">=cmd\(\) &lt;b&gt;<\/t>/,
    "formula text is inert and escaped",
  );
  assert.match(sheet, /<c r="B2" t="inlineStr">.*0523/, "leading zero stays text");
  assert.match(sheet, /<c r="C2"><v>8.25<\/v><\/c>/);
  assert.match(sheet, /<c r="A1" s="1"/, "bold header");
});
