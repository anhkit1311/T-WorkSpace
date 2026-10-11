// Pure stream-selection policies shared by the meeting page and the media lab
// (unit-tested in test/speaker-policy.test.js).
//
// visible  - layer follows the rendered tile size; off-page tiles are paused (null).
// speaker  - Last-N style: the dominant speaker gets the full layer, every other visible
//            tile the lowest layer, regardless of tile size.
// combined - tile size first, then the dominant speaker is raised to at least the middle
//            layer and, in crowded grids, tiles that have been quiet for a while drop one layer.

export type LayerPolicy = "visible" | "speaker" | "combined";
export type LayerDemand = Record<string, number | null>;

export const LAYER_POLICIES: LayerPolicy[] = ["visible", "speaker", "combined"];
export const SPEAKER_MIN_LAYER = 1;
export const QUIET_AFTER_MS = 10_000;
export const CROWDED_TILES = 6;
export const SPOTLIGHT_HOLD_MS = 2_000;

export function isLayerPolicy(value: unknown): value is LayerPolicy {
  return typeof value === "string" && (LAYER_POLICIES as string[]).includes(value);
}

export function applyLayerPolicy(
  base: LayerDemand,
  policy: LayerPolicy,
  speakerId: string | null,
  lastSpokeAt: Record<string, number>,
  now: number,
): LayerDemand {
  if (policy === "visible") return { ...base };
  const result: LayerDemand = {};
  const visible = Object.values(base).filter((layer) => layer !== null).length;
  for (const [id, layer] of Object.entries(base)) {
    if (layer === null) result[id] = null;
    else if (policy === "speaker") result[id] = id === speakerId ? 2 : 0;
    else if (id === speakerId) result[id] = Math.max(layer, SPEAKER_MIN_LAYER);
    else if (visible > CROWDED_TILES && now - (lastSpokeAt[id] ?? -Infinity) > QUIET_AFTER_MS)
      result[id] = Math.max(0, layer - 1);
    else result[id] = layer;
  }
  return result;
}

/**
 * Auto spotlight with hysteresis: a new speaker takes the spotlight only after the current
 * one has held it for SPOTLIGHT_HOLD_MS, so cross-talk does not make the stage flicker.
 * Returns the delay in ms before the switch may happen (0 = switch now).
 */
export function spotlightDelay(
  current: string | null,
  candidate: string | null,
  lastSwitchAt: number,
  now: number,
  holdMs = SPOTLIGHT_HOLD_MS,
): number | null {
  if (!candidate || candidate === current) return null;
  if (!current) return 0;
  return Math.max(0, lastSwitchAt + holdMs - now);
}
