// Week-1 spike (plan CC-5): proves the API can drive calls through ARI.
// Dial 9000 from any extension (or call the hotline): the call enters Stasis(nexo), this script
// prints StasisStart, answers, plays a greeting and hangs up.
//
//   npm run callcenter:up
//   npm run callcenter:ari-spike
try {
  process.loadEnvFile(".env");
} catch {
  // No .env: rely on variables already in the environment.
}

const base = (process.env.ASTERISK_ARI_URL ?? "http://localhost:8088").replace(/\/$/, "");
const user = process.env.ASTERISK_ARI_USER ?? "nexo";
const password = process.env.ASTERISK_ARI_PASSWORD;
if (!password) {
  console.error("Set ASTERISK_ARI_PASSWORD in .env (same value the Asterisk container uses).");
  process.exit(1);
}
const app = "nexo";
const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

async function ari(method, path) {
  const response = await fetch(`${base}/ari${path}`, { method, headers: { Authorization: auth } });
  if (!response.ok && response.status !== 404)
    throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}

const info = await ari("GET", "/asterisk/info");
console.log(`Connected to Asterisk ${info.system.version} (${info.system.entity_id})`);

const events = new URL(`${base.replace(/^http/, "ws")}/ari/events`);
events.searchParams.set("app", app);
events.searchParams.set("api_key", `${user}:${password}`);
const socket = new WebSocket(events);
const playbacks = new Map(); // playback id → channel id

socket.addEventListener("open", () => console.log(`Listening for Stasis(${app}). Dial 9000 from an extension.`));
socket.addEventListener("close", (event) => {
  console.log(`Event socket closed (${event.code}).`);
  process.exit(event.code === 1000 ? 0 : 1);
});
socket.addEventListener("error", () => console.error("Event socket error; is Asterisk running on", base, "?"));
socket.addEventListener("message", async ({ data }) => {
  const event = JSON.parse(String(data));
  const channel = event.channel;
  try {
    if (event.type === "StasisStart") {
      // ARI's channel model has no linkedid; cc_calls keys on it, so read it as a channel variable.
      const linked = await ari("GET", `/channels/${channel.id}/variable?variable=${encodeURIComponent("CHANNEL(linkedid)")}`);
      console.log(
        `StasisStart  channel=${channel.id} caller=${channel.caller.number || "?"} ` +
          `exten=${channel.dialplan.exten} args=${JSON.stringify(event.args)} linkedid=${linked?.value ?? "?"}`,
      );
      await ari("POST", `/channels/${channel.id}/answer`);
      const playback = await ari("POST", `/channels/${channel.id}/play?media=sound:hello-world`);
      if (playback) playbacks.set(playback.id, channel.id);
    } else if (event.type === "PlaybackFinished") {
      const channelId = playbacks.get(event.playback.id);
      playbacks.delete(event.playback.id);
      if (channelId) await ari("DELETE", `/channels/${channelId}`);
    } else if (event.type === "StasisEnd") {
      console.log(`StasisEnd    channel=${channel.id}`);
    } else if (event.type === "ChannelStateChange") {
      console.log(`State        channel=${channel.id} → ${channel.state}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
});

process.on("SIGINT", () => socket.close(1000));
