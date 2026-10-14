import { createHash } from "node:crypto";

// Pure grading rules. Kept free of I/O so the rules can be unit-tested and cited in the report.

export interface WeightedScore {
  weight: number;
  score: number;
}

export const GENESIS_HASH = "0".repeat(64);

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** Weighted mean of rubric criteria on a 0–10 scale; weights must sum to 100. */
export function sheetTotal(items: readonly WeightedScore[]): number {
  const weights = items.reduce((sum, item) => sum + item.weight, 0);
  if (!items.length || Math.abs(weights - 100) > 0.001)
    throw new RangeError("Rubric weights must sum to 100");
  for (const item of items)
    if (!(item.score >= 0 && item.score <= 10) || item.score * 4 !== Math.trunc(item.score * 4))
      throw new RangeError("Scores are 0–10 in steps of 0.25");
  return round(items.reduce((sum, item) => sum + item.score * item.weight, 0) / 100, 2);
}

export interface CommitteeAggregate {
  mean: number;
  spread: number;
  deviates: boolean;
}

/** Committee score is the mean of member totals; a spread above the term limit needs a chair note. */
export function committeeAggregate(totals: readonly number[], maxDeviation: number): CommitteeAggregate {
  if (!totals.length) throw new RangeError("No committee score sheets");
  const spread = round(Math.max(...totals) - Math.min(...totals), 2);
  return {
    mean: round(totals.reduce((sum, value) => sum + value, 0) / totals.length, 2),
    spread,
    deviates: spread > maxDeviation,
  };
}

export interface FinalWeights {
  supervisor: number;
  reviewer: number;
  committee: number;
}

export function finalScore(
  scores: { supervisor: number; reviewer: number; committee: number },
  weights: FinalWeights,
): number {
  if (weights.supervisor + weights.reviewer + weights.committee !== 100)
    throw new RangeError("Component weights must sum to 100");
  return round(
    (scores.supervisor * weights.supervisor +
      scores.reviewer * weights.reviewer +
      scores.committee * weights.committee) /
      100,
    1,
  );
}

/** Conversion from the 10-point scale used by Vietnamese credit-based programmes. */
export function letterGrade(score: number): "A" | "B+" | "B" | "C+" | "C" | "D+" | "D" | "F" {
  if (score >= 8.5) return "A";
  if (score >= 8.0) return "B+";
  if (score >= 7.0) return "B";
  if (score >= 6.5) return "C+";
  if (score >= 5.5) return "C";
  if (score >= 5.0) return "D+";
  if (score >= 4.0) return "D";
  return "F";
}

/** Deterministic JSON: object keys are sorted so the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function chainHash(prevHash: string, payload: string): string {
  return createHash("sha256").update(prevHash).update(payload).digest("hex");
}

export interface LedgerEntry {
  seq: number | string;
  payload: string;
  prevHash: string;
  hash: string;
}

/** Returns the first entry whose link or hash does not verify, or null when the chain is intact. */
export function verifyChain(entries: readonly LedgerEntry[]): { seq: string; reason: string } | null {
  let expectedPrev = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) return { seq: String(entry.seq), reason: "broken_link" };
    if (chainHash(entry.prevHash, entry.payload) !== entry.hash)
      return { seq: String(entry.seq), reason: "hash_mismatch" };
    expectedPrev = entry.hash;
  }
  return null;
}
