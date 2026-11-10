/** "email, Họ tên, Mã số" per line (mã số optional) (comma, semicolon or a tab pasted from Excel); a header row is skipped. */
export function parseAccountLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, displayName = "", userCode = ""] = line
        .split(/[\t,;]/)
        .map((cell) => cell.trim());
      return { email, displayName, userCode: userCode || undefined };
    })
    .filter((row) => row.email.toLowerCase() !== "email");
}
