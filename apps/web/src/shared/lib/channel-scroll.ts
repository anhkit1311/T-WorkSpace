// Store positions only, never message content, and bound memory across channel switches.
const positions = new Map<string, number>();
export function rememberChannelScroll(key: string, top: number) {
  positions.set(key, top);
  if (positions.size > 100) positions.delete(positions.keys().next().value!);
}
export function channelScroll(key: string) { return positions.get(key); }
