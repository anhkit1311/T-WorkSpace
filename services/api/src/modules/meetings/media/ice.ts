import { createHmac } from "node:crypto";
export function getIceServers(
  userId: string,
): { urls: string[]; username?: string; credential?: string }[] {
  const urls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!urls.length) return [];
  if (urls.some((url) => !/^turns?:[^\s]+$/i.test(url)) || !process.env.TURN_SHARED_SECRET)
    throw new Error("TURN_URLS requires valid turn/turns URLs and TURN_SHARED_SECRET");
  const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
  return [
    {
      urls,
      username,
      credential: createHmac("sha1", process.env.TURN_SHARED_SECRET)
        .update(username)
        .digest("base64"),
    },
  ];
}
