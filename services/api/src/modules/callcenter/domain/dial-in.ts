import type { ProducerInfo } from "@doan/shared";

/** M1: meeting rooms are dialled with a 6-digit code typed on the keypad. */
export const DIAL_CODE_LENGTH = 6;
export const DIAL_ATTEMPTS = 3;

/** One key press: "*" starts over, "#" ends early, the 6th digit ends the code. */
export function pressKey(buffer: string, key: string): { buffer: string; code: string | null } {
  if (key === "*") return { buffer: "", code: null };
  if (key === "#") return { buffer: "", code: buffer };
  if (!/^[0-9]$/.test(key)) return { buffer, code: null };
  const next = buffer + key;
  return next.length >= DIAL_CODE_LENGTH ? { buffer: "", code: next } : { buffer: next, code: null };
}

export const isDialCode = (code: string) => new RegExp(`^[0-9]{${DIAL_CODE_LENGTH}}$`).test(code);

/** The caller's audio in a meeting room (implemented by the meetings module). */
export interface PhoneLegPort {
  readonly listenPort: number;
  connect(asterisk: { address: string; port: number }): Promise<ProducerInfo>;
  others(): number;
  close(): Promise<string[]>;
}

/** Port to the meetings module: find a room by its code, put a caller in it, tell the room. */
export interface MeetingDialInPort {
  room(code: string): Promise<{ roomId: string; name: string } | null>;
  open(input: { roomId: string; socketId: string; userId: string; displayName: string }): PhoneLegPort;
  /** Host:port at which Asterisk reaches the FFmpeg that listens on `port`. */
  mediaHost(port: number): string;
  announce(roomId: string, event: "new_producer" | "producer_closed" | "peer_left" | "meeting_state_changed", data: unknown): void;
}
