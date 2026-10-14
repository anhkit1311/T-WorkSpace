// In-house near-duplicate detection for Vietnamese text: diacritic folding, word shingles,
// MinHash signatures and Jaccard similarity. No external search service is involved.

const STOP_WORDS = new Set(
  "va cua cho voi trong tren duoi cac nhung mot la de tai he thong xay dung phat trien ung dung nghien cuu tim hieu ve theo tu bang su dung".split(" "),
);

/** Lower-case, strip Vietnamese diacritics (including đ), keep letters and digits only. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokens(input: string): string[] {
  return normalize(input)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** Word n-gram shingles; Vietnamese syllables carry little meaning alone, so bigrams are the default. */
export function shingles(input: string, size = 2): Set<string> {
  const words = tokens(input);
  const result = new Set<string>();
  if (words.length < size) {
    if (words.length) result.add(words.join(" "));
    return result;
  }
  for (let i = 0; i + size <= words.length; i++) result.add(words.slice(i, i + size).join(" "));
  return result;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// 32-bit FNV-1a, seeded per hash function.
function fnv1a(text: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** MinHash signature: the fraction of equal positions estimates Jaccard similarity. */
export function minhash(set: ReadonlySet<string>, functions = 128): Uint32Array {
  const signature = new Uint32Array(functions).fill(0xffffffff);
  for (const item of set)
    for (let i = 0; i < functions; i++) {
      const value = fnv1a(item, Math.imul(i + 1, 0x9e3779b1));
      if (value < signature[i]) signature[i] = value;
    }
  return signature;
}

export function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  if (a.length !== b.length) throw new RangeError("Signatures must have equal length");
  let equal = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) equal++;
  return equal / a.length;
}

export interface SimilarityCandidate {
  id: string;
  code: string;
  title: string;
  summary: string;
  termCode: string;
}

/**
 * Ranks candidates by similarity to the subject. Title similarity weighs more than summary similarity
 * because two theses with near-identical titles are the case a faculty most needs to catch.
 * MinHash prunes the candidate set; survivors are scored with exact Jaccard.
 */
export function similarTopics(
  subject: { title: string; summary: string },
  candidates: readonly SimilarityCandidate[],
  options: { limit: number; threshold: number },
) {
  const titleSet = shingles(subject.title),
    summarySet = shingles(subject.summary, 3);
  const signature = minhash(new Set([...titleSet, ...summarySet]));
  return candidates
    .map((candidate) => {
      const candidateTitle = shingles(candidate.title),
        candidateSummary = shingles(candidate.summary, 3);
      const estimate = estimateJaccard(signature, minhash(new Set([...candidateTitle, ...candidateSummary])));
      return { candidate, candidateTitle, candidateSummary, estimate };
    })
    .filter((entry) => entry.estimate > 0 || jaccard(titleSet, entry.candidateTitle) > 0)
    .map(({ candidate, candidateTitle, candidateSummary }) => {
      const title = jaccard(titleSet, candidateTitle),
        summary = jaccard(summarySet, candidateSummary);
      return {
        id: candidate.id,
        code: candidate.code,
        termCode: candidate.termCode,
        title: candidate.title,
        titleSimilarity: Math.round(title * 1000) / 1000,
        summarySimilarity: Math.round(summary * 1000) / 1000,
        score: Math.round((0.6 * title + 0.4 * summary) * 1000) / 1000,
      };
    })
    .filter((match) => match.score >= options.threshold)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, options.limit);
}
