import { randomUUID } from "node:crypto";
import type { PbxEvent } from "../domain/ports.js";

export type InternalOutcome = "answered" | "abandoned" | "missed" | "busy" | "transferred";

export interface InternalCallRecord {
  id: string;
  linkedId: string;
  callerNumber: string;
  calleeNumber: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date;
  outcome: InternalOutcome;
  transferredFrom: string | null;
}

export interface InternalCallStore {
  saveInternalCall(record: InternalCallRecord): Promise<void>;
}

interface Leg {
  id: string;
  linkedId: string;
  callerNumber: string;
  calleeNumber: string;
  startedAt: Date;
  answeredAt: Date | null;
  status: string;
  transferredFrom: string | null;
}

/** Dial() status (or the one the dialplan hands to voicemail) as a call outcome. */
export function internalOutcome(answered: boolean, status: string): InternalOutcome {
  if (answered) return "answered";
  if (status === "BUSY") return "busy";
  if (status === "CANCEL") return "abandoned";
  return "missed"; // NOANSWER, CHANUNAVAIL (not registered), CONGESTION
}

/**
 * Call history of extension-to-extension calls. They never enter the ARI app (the dialplan bridges
 * them with Dial()), so they are followed from the dialplan events every channel reports. A channel
 * that dials again was blind-transferred (SIP REFER): its previous leg ends as "transferred".
 */
export class InternalCallLog {
  private readonly legs = new Map<string, Leg>();
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly store: InternalCallStore,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {},
  ) {}

  handle(event: PbxEvent): Promise<void> | null {
    if (event.type === "dialplan") {
      if (event.context !== "from-internal" || !/^[0-9]{4,5}$/.test(event.exten)) return null;
      const leg = this.legs.get(event.channelId);
      // A unit's group number 1PP00 dials all its extensions at once ("PJSIP/10101&PJSIP/10102,30").
      const groupDial = /^1[0-9]{2}00$/.test(event.exten) && event.appData.startsWith("PJSIP/");
      if (event.app === "Dial" && (groupDial || event.appData.startsWith(`PJSIP/${event.exten},`))) {
        const count = this.counts.get(event.linkedId) ?? 0; // read before finish() forgets the call
        const previous = leg ? this.finish(event.channelId, "transferred") : null;
        this.counts.set(event.linkedId, count + 1);
        this.legs.set(event.channelId, {
          id: randomUUID(),
          linkedId: count ? `${event.linkedId}#${count}` : event.linkedId, // cc_calls.linkedid is unique
          callerNumber: event.callerNumber || "anonymous",
          calleeNumber: event.exten,
          startedAt: this.now(),
          answeredAt: null,
          status: "",
          transferredFrom: leg?.id ?? null,
        });
        return previous;
      }
      // Stasis(nexo,voicemail,<exten>,<DIALSTATUS>): the status of a dial that never rang (offline).
      if (leg && event.app === "Stasis" && event.appData.includes(",voicemail,")) leg.status ||= event.appData.split(",")[3] ?? "";
      return null;
    }
    if (event.type === "dial") {
      const leg = this.legs.get(event.callerChannelId);
      if (!leg) return null;
      leg.status = event.status;
      if (event.status === "ANSWER") leg.answeredAt ??= this.now();
      return null;
    }
    if (event.type === "channel_ended" && this.legs.has(event.channelId)) {
      const leg = this.legs.get(event.channelId)!;
      return this.finish(event.channelId, internalOutcome(leg.answeredAt !== null, leg.status));
    }
    return null;
  }

  private finish(channelId: string, outcome: InternalOutcome): Promise<void> {
    const leg = this.legs.get(channelId)!;
    this.legs.delete(channelId);
    if (![...this.legs.values()].some((other) => other.linkedId.split("#")[0] === leg.linkedId.split("#")[0]))
      this.counts.delete(leg.linkedId.split("#")[0]);
    return this.store
      .saveInternalCall({ ...leg, endedAt: this.now(), outcome: outcome === "transferred" && !leg.answeredAt ? "missed" : outcome })
      .catch((error: Error) => this.log("cc_internal_call_save_failed", { message: error.message }));
  }
}
