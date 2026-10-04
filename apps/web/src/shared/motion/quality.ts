/** Downgrade once after two continuous seconds below 50Hz; transient frames do not count. */
export function nextQualitySample(slowMs: number, deltaMs: number) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 250) return {slowMs:0, downgrade:false};
  const next = deltaMs > 20 ? slowMs + deltaMs : 0;
  return {slowMs: next >= 2000 ? 0 : next, downgrade: next >= 2000};
}
