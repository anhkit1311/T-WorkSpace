/** Rows as CSV for Excel (the route adds the UTF-8 BOM). A leading = + - @ is quoted so Excel never runs it as a formula. */
export function toCsv(rows: string[][]) {
  const cell = (value: string) => {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
