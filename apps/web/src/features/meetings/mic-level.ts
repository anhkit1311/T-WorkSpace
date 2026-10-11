/** Map RMS amplitude to 0..1 on a -60..0 dBFS scale, which tracks perceived loudness. */
export function levelFromRms(rms: number) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}
