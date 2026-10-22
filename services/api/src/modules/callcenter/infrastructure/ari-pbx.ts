import type { ExtensionTransport } from "@doan/shared";
import type { Pbx, PbxEvent } from "../domain/ports.js";

export interface AriOptions {
  url: string; // http://asterisk:8088
  user: string;
  password: string;
  app: string;
}

/** Adapter pattern: the Pbx port implemented over Asterisk REST Interface (REST + events socket). */
export class AriPbx implements Pbx {
  private readonly base: string;
  private readonly authorization: string;
  private socket: WebSocket | null = null;
  private stopped = false;
  private retryMs = 1000;

  /** True while the ARI event socket is open (health page). */
  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  constructor(private readonly options: AriOptions) {
    this.base = `${options.url.replace(/\/$/, "")}/ari`;
    this.authorization = `Basic ${Buffer.from(`${options.user}:${options.password}`).toString("base64")}`;
  }

  /**
   * Opens the event socket and keeps it open; every (re)connect emits `connected` first.
   * Behind Docker's port proxy a restarting Asterisk can leave a socket that never opens or never
   * reports closing, so a connect timeout and a watchdog (ARI must still know our app) force a retry.
   */
  listen(onEvent: (event: PbxEvent) => void, log: (event: string, details?: Record<string, unknown>) => void) {
    this.stopped = false; // listening again after stop(): this instance became the leader again
    let generation = 0;
    let current: { generation: number; open: boolean; retry: (reason: string) => void } | null = null;
    const connect = () => {
      if (this.stopped) return;
      const mine = ++generation;
      const url = new URL(`${this.base.replace(/^http/, "ws")}/events`);
      url.searchParams.set("app", this.options.app);
      url.searchParams.set("subscribeAll", "true");
      url.searchParams.set("api_key", `${this.options.user}:${this.options.password}`);
      const socket = new WebSocket(url);
      this.socket = socket;
      const retry = (reason: string) => {
        if (mine !== generation || this.stopped) return; // already replaced
        generation++;
        clearTimeout(openTimer);
        try {
          socket.close();
        } catch {
          // a socket that never opened may refuse close(); it is abandoned either way
        }
        log("ari_disconnected", { retryMs: this.retryMs, reason });
        setTimeout(connect, this.retryMs).unref();
        this.retryMs = Math.min(this.retryMs * 2, 10000);
      };
      const state = { generation: mine, open: false, retry };
      current = state;
      const openTimer = setTimeout(() => !state.open && retry("connect timeout"), 10000);
      openTimer.unref();
      socket.addEventListener("open", () => {
        if (mine !== generation) return;
        clearTimeout(openTimer);
        state.open = true;
        this.retryMs = 1000;
        log("ari_connected", { url: this.options.url });
        onEvent({ type: "connected" });
      });
      socket.addEventListener("message", ({ data }) => {
        if (mine !== generation) return;
        try {
          const event = translate(JSON.parse(String(data)) as AriEvent);
          if (event) onEvent(event);
        } catch (error) {
          log("ari_bad_event", { message: error instanceof Error ? error.message : String(error) });
        }
      });
      socket.addEventListener("close", () => retry("closed"));
      socket.addEventListener("error", () => undefined); // "close" follows and schedules the retry
    };
    connect();
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      const watched = current;
      if (this.stopped || !watched?.open) return;
      this.request("GET", `/applications/${encodeURIComponent(this.options.app)}`).catch(() => {
        if (watched === current) watched.retry("watchdog");
      });
    }, 15000);
    this.watchdog.unref();
  }

  private watchdog: ReturnType<typeof setInterval> | undefined;

  stop(): void {
    this.stopped = true;
    clearInterval(this.watchdog);
    this.socket?.close();
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: this.authorization, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`ARI ${method} ${path.split("?")[0]} → ${response.status}`);
    return (response.status === 204 ? undefined : await response.json().catch(() => undefined)) as T;
  }

  answer = async (channelId: string) => void (await this.request("POST", `/channels/${channelId}/answer`));
  hangup = async (channelId: string) => void (await this.request("DELETE", `/channels/${channelId}`));

  async play(channelId: string, media: string[]): Promise<string> {
    // ARI takes a list as one comma-separated value; repeated `media=` keeps only the last item.
    const query = `media=${media.map(encodeURIComponent).join(",")}`;
    return (await this.request<{ id: string }>("POST", `/channels/${channelId}/play?${query}`)).id;
  }

  stopPlayback = async (playbackId: string) => void (await this.request("DELETE", `/playbacks/${playbackId}`));
  startMusicOnHold = async (channelId: string) =>
    void (await this.request("POST", `/channels/${channelId}/moh?mohClass=default`));
  stopMusicOnHold = async (channelId: string) => void (await this.request("DELETE", `/channels/${channelId}/moh`));

  async callExtension(input: { extension: string; callerId: string; callId: string; timeoutSeconds: number; purpose?: string }) {
    const params = new URLSearchParams({
      endpoint: `PJSIP/${input.extension}`,
      app: this.options.app,
      appArgs: `${input.purpose ?? "agent"},${input.callId}`,
    });
    const channel = await this.request<{ id: string }>("POST", `/channels/create?${params}`);
    // PJSIP builds the From header of an outgoing call from the connected line, not CALLERID.
    await this.request(
      "POST",
      `/channels/${channel.id}/variable?${new URLSearchParams({ variable: "CONNECTEDLINE(all)", value: input.callerId })}`,
    );
    await this.request("POST", `/channels/${channel.id}/dial?timeout=${input.timeoutSeconds}`);
    return channel.id;
  }

  async bridge(channelIds: string[]): Promise<string> {
    const bridge = await this.request<{ id: string }>("POST", `/bridges?type=mixing`);
    await this.request("POST", `/bridges/${bridge.id}/addChannel?channel=${channelIds.join(",")}`);
    return bridge.id;
  }

  addToBridge = async (bridgeId: string, channelIds: string[]) =>
    void (await this.request("POST", `/bridges/${bridgeId}/addChannel?channel=${channelIds.join(",")}`));
  removeFromBridge = async (bridgeId: string, channelId: string) =>
    void (await this.request("POST", `/bridges/${bridgeId}/removeChannel?channel=${channelId}`));

  async snoop(channelId: string, input: { whisper: boolean; callId: string }): Promise<string> {
    const params = new URLSearchParams({
      spy: "both",
      whisper: input.whisper ? "out" : "none",
      app: this.options.app,
      appArgs: `snoop,${input.callId}`,
    });
    return (await this.request<{ id: string }>("POST", `/channels/${channelId}/snoop?${params}`)).id;
  }

  destroyBridge = async (bridgeId: string) => void (await this.request("DELETE", `/bridges/${bridgeId}`));

  async externalMedia(host: string) {
    const params = new URLSearchParams({ app: this.options.app, external_host: host, format: "ulaw", encapsulation: "rtp", transport: "udp", data: "phone-leg" });
    const channel = await this.request<{ id: string; channelvars?: Record<string, string> }>("POST", `/channels/externalMedia?${params}`);
    const vars = channel.channelvars ?? {};
    return { channelId: channel.id, address: vars.UNICASTRTP_LOCAL_ADDRESS ?? "", port: Number(vars.UNICASTRTP_LOCAL_PORT) };
  }

  recordBridge = async (bridgeId: string, name: string) =>
    void (await this.request(
      "POST",
      `/bridges/${bridgeId}/record?${new URLSearchParams({ name, format: "wav", ifExists: "overwrite" })}`,
    ));

  recordVoicemail = async (channelId: string, name: string, maxSeconds: number) =>
    void (await this.request(
      "POST",
      `/channels/${channelId}/record?${new URLSearchParams({
        name,
        format: "wav",
        maxDurationSeconds: String(maxSeconds),
        maxSilenceSeconds: "10",
        beep: "true",
        terminateOn: "#",
        ifExists: "overwrite",
      })}`,
    ));

  async isExtensionOnline(extension: string): Promise<boolean> {
    const endpoint = await this.request<{ state: string }>("GET", `/endpoints/PJSIP/${extension}`);
    return endpoint.state === "online";
  }

  async linkedId(channelId: string): Promise<string> {
    const variable = encodeURIComponent("CHANNEL(linkedid)");
    return (await this.request<{ value: string }>("GET", `/channels/${channelId}/variable?variable=${variable}`)).value;
  }

  async releaseOrphans(): Promise<number> {
    const prefix = `${this.options.app},`;
    const channels = (await this.request<{ id: string; dialplan?: { app_name?: string; app_data?: string } }[]>("GET", "/channels"))
      .filter((channel) => channel.dialplan?.app_name === "Stasis" && channel.dialplan.app_data?.startsWith(prefix));
    const bridges = (await this.request<{ id: string; bridge_class?: string }[]>("GET", "/bridges"))
      .filter((bridge) => bridge.bridge_class === "stasis");
    for (const channel of channels) await this.hangup(channel.id).catch(() => undefined);
    for (const bridge of bridges) await this.destroyBridge(bridge.id).catch(() => undefined);
    return channels.length + bridges.length;
  }

  /** CC-2: extensions live in Asterisk's memory wizard; auth and aor first, then the endpoint. */
  async pushExtension(input: { number: string; secret: string; transport: ExtensionTransport; callerName: string; context?: string }) {
    const fields = (values: Record<string, string>) => ({
      fields: Object.entries(values).map(([attribute, value]) => ({ attribute, value })),
    });
    const dynamic = `/asterisk/config/dynamic/res_pjsip`;
    await this.request("PUT", `${dynamic}/auth/${input.number}`, fields({
      auth_type: "userpass",
      username: input.number,
      password: input.secret,
    }));
    await this.request("PUT", `${dynamic}/aor/${input.number}`, fields({
      max_contacts: "1",
      remove_existing: "yes",
      qualify_frequency: "30",
    }));
    const media: Record<string, string> =
      input.transport === "webrtc"
        ? { transport: "transport-ws", webrtc: "yes" }
        : { transport: "transport-udp", rtp_symmetric: "yes", force_rport: "yes", rewrite_contact: "yes", acl: "internal-only" };
    await this.request("PUT", `${dynamic}/endpoint/${input.number}`, fields({
      ...media,
      // Internal only (no SIP trunk): extensions call each other, browser sessions the hotline.
      context: input.context ?? "from-internal",
      disallow: "all",
      allow: "ulaw,alaw",
      direct_media: "no",
      aors: input.number,
      auth: input.number,
      callerid: `"${input.callerName.replace(/"/g, "")}" <${input.number}>`,
    }));
  }

  async removeExtension(number: string): Promise<void> {
    const dynamic = `/asterisk/config/dynamic/res_pjsip`;
    for (const type of ["endpoint", "aor", "auth"])
      await this.request("DELETE", `${dynamic}/${type}/${number}`).catch((error: Error) => {
        if (!error.message.endsWith("404")) throw error;
      });
  }

  async deleteRecording(name: string): Promise<void> {
    await this.request("DELETE", `/recordings/stored/${encodeURIComponent(name)}`).catch((error: Error) => {
      if (!error.message.endsWith("404")) throw error;
    });
  }

  /** Streams a stored recording (call or voicemail) for playback in the browser (CC-7). */
  async recording(name: string): Promise<Response> {
    const response = await fetch(`${this.base}/recordings/stored/${encodeURIComponent(name)}/file`, {
      headers: { Authorization: this.authorization },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`ARI recording ${response.status}`);
    return response;
  }
}

interface AriEvent {
  type: string;
  args?: string[];
  digit?: string;
  channel?: { id: string; state: string; caller?: { number?: string; name?: string }; dialplan?: { exten?: string } };
  playback?: { id: string };
  recording?: { name: string; duration?: number };
}

function translate(event: AriEvent): PbxEvent | null {
  const channel = event.channel;
  switch (event.type) {
    case "StasisStart":
      return {
        type: "call_started",
        channelId: channel!.id,
        args: event.args ?? [],
        callerNumber: channel!.caller?.number ?? "",
        callerName: channel!.caller?.name ?? "",
        exten: channel!.dialplan?.exten ?? "",
      };
    case "StasisEnd":
    case "ChannelDestroyed":
      return { type: "channel_ended", channelId: channel!.id };
    case "ChannelStateChange":
      return channel!.state === "Up" ? { type: "channel_up", channelId: channel!.id } : null;
    case "ChannelDtmfReceived":
      return { type: "dtmf", channelId: channel!.id, digit: event.digit ?? "" };
    case "PlaybackFinished":
      return { type: "playback_finished", playbackId: event.playback!.id };
    case "RecordingFinished":
      return { type: "recording_finished", name: event.recording!.name, durationSeconds: event.recording!.duration ?? 0 };
    case "RecordingFailed":
      return { type: "recording_failed", name: event.recording!.name };
    default:
      return null;
  }
}
