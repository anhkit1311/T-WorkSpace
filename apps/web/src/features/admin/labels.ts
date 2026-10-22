/** "email, Họ tên" per line (comma, semicolon or a tab pasted from Excel); a header row is skipped. */
export function parseAccountLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, ...name] = line.split(/[\t,;]/);
      return { email: email.trim(), displayName: name.join(" ").trim() };
    })
    .filter((row) => row.email.toLowerCase() !== "email");
}
