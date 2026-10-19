import { DIAL_ATTEMPTS, isDialCode, pressKey, type MeetingDialInPort, type PhoneLegPort } from "../domain/dial-in.js";
import type { Clock, Pbx, PbxEvent } from "../domain/ports.js";

/** Hang up a caller who has not finished typing the code by then. */
const CODE_TIMEOUT_MS = 20000;
/** Hang up a caller left alone in a room for this long (the meeting has ended). */
const ALONE_LIMIT_MS = 120000;
const ALONE_CHECK_MS = 15000;

interface DialIn {
  channelId: string;
  callerNumber: string;
  callerName: string;
  buffer: string;
  attempts: number;
  playbackId: string | null;
  timer: unknown;
  joining: boolean;
  roomId?: string;
  leg?: PhoneLegPort;
  mediaChannelId?: string;
  bridgeId?: string;
  aloneSince?: number | null;
}

/**
 * M1: phone dial-in to a meeting room. An extension dials the meeting number (Stasis "meeting"),
 * types the room's code, and is bridged to an ExternalMedia channel whose audio the meetings
 * module carries into the SFU as one more participant.
 */
export class MeetingDialInService {
  private readonly calls = new Map<string, DialIn>();
  private readonly byMedia = new Map<string, string>();

  constructor(
    private readonly pbx: Pbx,
    private readonly meetings: MeetingDialInPort,
    private readonly clock: Clock,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
  ) {}

  /** True when the event belonged to a dial-in call (the ACD can skip it). */
  async handle(event: PbxEvent): Promise<boolean> {
    if (event.type === "call_started") {
      if (event.args[0] !== "meeting") return event.args[0] === "phone-leg";
      await this.start(event);
      return true;
    }
    if (event.type === "dtmf" && this.calls.has(event.channelId)) {
      await this.key(this.calls.get(event.channelId)!, event.digit);
      return true;
    }
    if (event.type === "channel_ended") {
      const callerId = this.calls.has(event.channelId) ? event.channelId : this.byMedia.get(event.channelId);
      if (!callerId) return false;
      await this.end(callerId);
      return true;
    }
    return false;
  }

  private async start(event: Extract<PbxEvent, { type: "call_started" }>) {
    const call: DialIn = {
      channelId: event.channelId,
      callerNumber: event.callerNumber,
      callerName: event.callerName,
      buffer: "",
      attempts: 0,
      playbackId: null,
      timer: null,
      joining: false,
    };
    this.calls.set(call.channelId, call);
    try {
      await this.pbx.answer(call.channelId);
      await this.ask(call, ["sound:conf-getconfno"]);
    } catch (error) {
      this.fail(call, error);
    }
  }

  private async ask(call: DialIn, media: string[]) {
    this.clock.clearTimeout(call.timer);
    call.timer = this.clock.setTimeout(() => void this.goodbye(call), CODE_TIMEOUT_MS);
    call.playbackId = await this.pbx.play(call.channelId, media);
  }

  private async key(call: DialIn, digit: string) {
    if (call.roomId || call.joining) return;
    if (call.playbackId) {
      const playback = call.playbackId;
      call.playbackId = null;
      await this.pbx.stopPlayback(playback).catch(() => undefined); // barge-in: typing cuts the prompt
    }
    const press = pressKey(call.buffer, digit);
    call.buffer = press.buffer;
    if (press.code === null) return;
    call.joining = true;
    const room = isDialCode(press.code) ? await this.meetings.room(press.code).catch(() => null) : null;
    if (!room) {
      call.joining = false;
      call.attempts++;
      this.log("meeting_dialin_bad_code", { channelId: call.channelId, attempts: call.attempts });
      if (call.attempts >= DIAL_ATTEMPTS) return this.goodbye(call, ["sound:conf-invalid"]);
      return this.ask(call, ["sound:conf-invalid", "sound:conf-getconfno"]).catch((error) => this.fail(call, error));
    }
    this.clock.clearTimeout(call.timer);
    await this.join(call, room).catch((error) => this.fail(call, error));
  }

  private async join(call: DialIn, room: { roomId: string; name: string }) {
    const socketId = `phone:${call.channelId}`;
    const label = call.callerName && call.callerName !== call.callerNumber ? `${call.callerName} (điện thoại)` : `Điện thoại ${call.callerNumber || "ẩn số"}`;
    call.roomId = room.roomId;
    call.leg = this.meetings.open({ roomId: room.roomId, socketId, userId: "", displayName: label });
    await this.pbx.play(call.channelId, ["sound:conf-placeintoconf"]).catch(() => undefined);
    const media = await this.pbx.externalMedia(this.meetings.mediaHost(call.leg.listenPort));
    call.mediaChannelId = media.channelId;
    this.byMedia.set(media.channelId, call.channelId);
    if (!media.address || !media.port) throw new Error("ExternalMedia did not report its RTP address");
    call.bridgeId = await this.pbx.bridge([call.channelId, media.channelId]);
    const producer = await call.leg.connect(media);
    this.meetings.announce(room.roomId, "new_producer", producer);
    this.meetings.announce(room.roomId, "meeting_state_changed", { roomId: room.roomId });
    this.log("meeting_dialin_joined", { channelId: call.channelId, roomId: room.roomId });
    if (!call.leg.others()) await this.pbx.play(call.channelId, ["sound:conf-onlyperson"]).catch(() => undefined);
    call.aloneSince = null;
    call.timer = this.clock.setTimeout(() => this.watchAlone(call), ALONE_CHECK_MS);
  }

  private watchAlone(call: DialIn) {
    if (!this.calls.has(call.channelId) || !call.leg) return;
    const now = this.clock.now();
    call.aloneSince = call.leg.others() ? null : (call.aloneSince ?? now);
    if (call.aloneSince !== null && now - call.aloneSince >= ALONE_LIMIT_MS) return void this.goodbye(call);
    call.timer = this.clock.setTimeout(() => this.watchAlone(call), ALONE_CHECK_MS);
  }

  private async goodbye(call: DialIn, before: string[] = []) {
    this.clock.clearTimeout(call.timer);
    await this.pbx.play(call.channelId, [...before, "sound:vm-goodbye"]).catch(() => undefined);
    // Give the prompt time to play; channel_ended then cleans up.
    call.timer = this.clock.setTimeout(() => void this.pbx.hangup(call.channelId).catch(() => this.end(call.channelId)), 3000);
  }

  private fail(call: DialIn, error: unknown) {
    this.log("meeting_dialin_failed", { channelId: call.channelId, message: error instanceof Error ? error.message : String(error) });
    void this.pbx.hangup(call.channelId).catch(() => undefined);
    void this.end(call.channelId);
  }

  private async end(channelId: string) {
    const call = this.calls.get(channelId);
    if (!call) return;
    this.calls.delete(channelId);
    this.clock.clearTimeout(call.timer);
    if (call.mediaChannelId) {
      this.byMedia.delete(call.mediaChannelId);
      await this.pbx.hangup(call.mediaChannelId).catch(() => undefined);
    }
    await this.pbx.hangup(channelId).catch(() => undefined);
    if (call.bridgeId) await this.pbx.destroyBridge(call.bridgeId).catch(() => undefined);
    if (call.leg && call.roomId) {
      const closed = await call.leg.close().catch(() => [] as string[]);
      for (const producerId of closed) this.meetings.announce(call.roomId, "producer_closed", { producerId });
      this.meetings.announce(call.roomId, "peer_left", { socketId: `phone:${channelId}`, userId: "" });
      this.meetings.announce(call.roomId, "meeting_state_changed", { roomId: call.roomId });
    }
  }
}
