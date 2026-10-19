import { randomUUID } from "node:crypto";
import type { Pbx, PbxEvent } from "../domain/ports.js";

export interface MailboxStore {
  mailbox(number: string): Promise<{ id: string; user_id: string | null; display_name: string | null; email: string | null } | null>;
  callerName(number: string): Promise<string | null>;
  savePersonalVoicemail(input: {
    extensionId: string;
    callerNumber: string;
    callerName: string | null;
    durationSeconds: number;
    recordingKey: string;
  }): Promise<string>;
}

/** Tells the owner a message arrived (socket and e-mail); failures must not lose the message. */
export type VoicemailNotice = (input: {
  voicemailId: string;
  ownerId: string;
  ownerEmail: string | null;
  extension: string;
  callerNumber: string;
  callerName: string | null;
  durationSeconds: number;
}) => Promise<void>;

interface Box {
  channelId: string;
  extension: string;
  extensionId: string;
  ownerId: string | null;
  ownerEmail: string | null;
  callerNumber: string;
  callerName: string | null;
  playbackId: string | null;
  recording: string | null;
  gone: boolean;
}

const MAX_SECONDS = 120;

/** "The person at extension 1201 is on the phone / unavailable", then "leave your message after the tone". */
export const greeting = (extension: string, status: string) => [
  "sound:vm-theperson",
  `digits:${extension}`,
  status === "BUSY" ? "sound:vm-isonphone" : "sound:vm-isunavail",
  "sound:vm-intro",
];

/**
 * NV-CC5: an extension's own voicemail. The dialplan hands a call here when the extension did not
 * answer, was busy or is not registered; the message is kept for its owner, who gets it on the web
 * and by e-mail. Runs on the ACD leader, before the ACD in the event chain.
 */
export class PersonalVoicemailService {
  private readonly byChannel = new Map<string, Box>();
  private readonly byPlayback = new Map<string, Box>();
  private readonly byRecording = new Map<string, Box>();

  constructor(
    private readonly pbx: Pbx,
    private readonly store: MailboxStore,
    private readonly notice: VoicemailNotice,
    private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {},
  ) {}

  /** True when the event belonged to a voicemail call (so the ACD does not see it). */
  async handle(event: PbxEvent): Promise<boolean> {
    switch (event.type) {
      case "call_started":
        if (event.args[0] !== "voicemail") return false;
        await this.start(event.channelId, event.args[1] ?? "", event.args[2] ?? "", event.callerNumber, event.callerName);
        return true;
      case "playback_finished":
        return this.recordAfterGreeting(event.playbackId);
      case "recording_finished":
        return this.saved(event.name, event.durationSeconds);
      case "recording_failed":
        return this.saved(event.name, 0);
      case "channel_ended": {
        const box = this.byChannel.get(event.channelId);
        if (!box) return false;
        box.gone = true;
        this.byChannel.delete(event.channelId);
        if (box.playbackId) this.byPlayback.delete(box.playbackId);
        // A caller who hangs up while recording still leaves the message: RecordingFinished follows.
        return true;
      }
      default:
        return this.byChannel.has("channelId" in event ? event.channelId : "");
    }
  }

  private async start(channelId: string, extension: string, status: string, callerNumber: string, callerName: string) {
    const mailbox = /^[0-9]{3,6}$/.test(extension) ? await this.store.mailbox(extension) : null;
    if (!mailbox?.user_id) {
      // Nobody owns the number: nothing to leave a message for.
      await this.pbx.hangup(channelId).catch(() => undefined);
      return;
    }
    const box: Box = {
      channelId,
      extension,
      extensionId: mailbox.id,
      ownerId: mailbox.user_id,
      ownerEmail: mailbox.email,
      callerNumber: callerNumber || "anonymous",
      callerName: callerName || (callerNumber ? await this.store.callerName(callerNumber).catch(() => null) : null),
      playbackId: null,
      recording: null,
      gone: false,
    };
    this.byChannel.set(channelId, box);
    await this.pbx.answer(channelId);
    box.playbackId = await this.pbx.play(channelId, greeting(extension, status));
    this.byPlayback.set(box.playbackId, box);
  }

  private async recordAfterGreeting(playbackId: string): Promise<boolean> {
    const box = this.byPlayback.get(playbackId);
    if (!box) return false;
    this.byPlayback.delete(playbackId);
    box.playbackId = null;
    if (box.gone) return true;
    box.recording = `pvm-${randomUUID()}`;
    this.byRecording.set(box.recording, box);
    await this.pbx.recordVoicemail(box.channelId, box.recording, MAX_SECONDS);
    return true;
  }

  private async saved(name: string, durationSeconds: number): Promise<boolean> {
    const box = this.byRecording.get(name);
    if (!box) return false;
    this.byRecording.delete(name);
    this.byChannel.delete(box.channelId);
    if (!box.gone) await this.pbx.hangup(box.channelId).catch(() => undefined);
    if (durationSeconds < 1) return true; // hung up at the tone: nothing to keep
    const voicemailId = await this.store.savePersonalVoicemail({
      extensionId: box.extensionId,
      callerNumber: box.callerNumber,
      callerName: box.callerName,
      durationSeconds,
      recordingKey: name,
    });
    this.log("cc_personal_voicemail", { extension: box.extension, durationSeconds });
    await this.notice({
      voicemailId,
      ownerId: box.ownerId!,
      ownerEmail: box.ownerEmail,
      extension: box.extension,
      callerNumber: box.callerNumber,
      callerName: box.callerName,
      durationSeconds,
    }).catch((error: Error) => this.log("cc_voicemail_notice_failed", { message: error.message }));
    return true;
  }
}
