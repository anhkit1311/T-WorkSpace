import type { ServerResponse } from "node:http";
import { toCsv } from "./csv.js";
import { toXlsx } from "./xlsx.js";

/** An export: file name without extension, header row first. */
export type Table = { name: string; rows: string[][] };

/** Sends the table as .xlsx (Excel) or .csv (UTF-8 BOM so Excel reads Vietnamese), by the URL's extension. */
export function sendTable(response: ServerResponse, table: Table, extension: string) {
  const xlsx = extension === ".xlsx";
  const body = xlsx ? toXlsx(table.rows, table.name) : Buffer.from(`\uFEFF${toCsv(table.rows)}`, "utf8");
  response.writeHead(200, {
    "Content-Type": xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${table.name}${xlsx ? ".xlsx" : ".csv"}"`,
    "Content-Length": body.length,
    "Cache-Control": "private, no-store",
  });
  response.end(body);
}
