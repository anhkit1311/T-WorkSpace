import { cn } from "../lib/utils";

/** Emoji drawn from public/emoji (Twemoji 15.1, CC BY 4.0: see public/emoji/LICENSE). */
const DRAWN = new Set([
  "1f389",
  "1f970",
  "1f64c",
  "1f923",
  "1f4aa",
  "1f64f",
  "1f44d",
  "2764",
  "1f602",
  "1f62e",
  "1f622",
  "1f525",
  "2705",
  "1f60d",
  "1f44f",
  "1f914",
  "1f634",
]);

/** File name of an emoji: its code points in hex, without the variation selector (U+FE0F). */
export const emojiCode = (emoji: string) =>
  [...emoji]
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== "fe0f")
    .join("-");

/** One look on every device for the emoji we ship; any other emoji stays as text. */
export function Emoji({ emoji, className }: { emoji: string; className?: string }) {
  const code = emojiCode(emoji);
  if (!DRAWN.has(code)) return <span className={className}>{emoji}</span>;
  return (
    <img
      src={`/emoji/${code}.svg`}
      alt={emoji}
      className={cn("inline-block size-[1.15em] align-[-0.2em]", className)}
      draggable={false}
      decoding="async"
    />
  );
}
