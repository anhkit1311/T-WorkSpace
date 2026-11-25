/** "Phòng Đại học" → "PH": first letters of the first and last word. Words like "(test)" or "-"
 *  would give "L(" or "P-", so only letters and digits start initials. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return (words.length > 1 ? [words[0], words[words.length - 1]] : words)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
