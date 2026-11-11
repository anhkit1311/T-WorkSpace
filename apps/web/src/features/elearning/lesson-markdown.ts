export type LessonBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph" | "quote" | "code"; text: string }
  | { type: "ul" | "ol"; items: string[] };

// shortcut: headings, lists, quotes, fenced code only (no tables, nesting or links);
// swap for a markdown library if lesson authors need more.
export function parseLessonBody(body: string): LessonBlock[] {
  const blocks: LessonBlock[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const end = lines.findIndex((item, index) => index > i && item.startsWith("```"));
      const stop = end < 0 ? lines.length : end;
      blocks.push({ type: "code", text: lines.slice(i + 1, stop).join("\n") });
      i = stop + 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const kinds = [
      ["ul", /^\s*[-*]\s+/],
      ["ol", /^\s*\d+[.)]\s+/],
      ["quote", /^>\s?/],
    ] as const;
    const kind = kinds.find(([, pattern]) => pattern.test(line));
    const same = (item: string | undefined) =>
      item !== undefined &&
      item.trim() !== "" &&
      (kind
        ? kind[1].test(item)
        : !/^(```|#{1,3}\s)/.test(item) && !kinds.some(([, pattern]) => pattern.test(item)));
    const run: string[] = [];
    for (; same(lines[i]); i++) run.push(kind ? lines[i].replace(kind[1], "") : lines[i]);
    if (!kind) blocks.push({ type: "paragraph", text: run.join("\n") });
    else if (kind[0] === "quote") blocks.push({ type: "quote", text: run.join("\n") });
    else blocks.push({ type: kind[0], items: run });
  }
  return blocks;
}
