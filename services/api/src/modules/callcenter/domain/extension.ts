import { randomBytes } from "node:crypto";

/** The first free number of a department's range, or null when the range is full. */
export function nextExtensionNumber(range: { from: number; to: number }, taken: Iterable<string>): string | null {
  const used = new Set(taken);
  for (let number = range.from; number <= range.to; number++)
    if (!used.has(String(number))) return String(number);
  return null;
}

export function inRange(number: string, range: { from: number; to: number }): boolean {
  if (!/^[0-9]{3,6}$/.test(number)) return false;
  const value = Number(number);
  return value >= range.from && value <= range.to;
}

/** CC-12: 24 random characters, well above what online SIP brute-forcing can reach. */
export const generateSipSecret = () => randomBytes(18).toString("base64url");

/** Caller numbers arrive as +84…, 84… or 0…; compare them in the national 0… form. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+84")) return `0${digits.slice(3)}`;
  if (digits.startsWith("84") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits.replace(/^\+/, "");
}
