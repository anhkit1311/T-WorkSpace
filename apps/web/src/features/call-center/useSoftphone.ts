import { useEffect, useRef, useState } from "react";
import { UA, WebSocketInterface } from "jssip";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { RTCSessionEvent } from "jssip/lib/UA";
import type { CcSipAccount } from "@doan/shared";

export type PhoneStatus = "off" | "registering" | "registered" | "failed";
export type CallPhase = "none" | "incoming" | "outgoing" | "active";

const AUDIO_ONLY = { mediaConstraints: { audio: true, video: false } };

/**
 * CC-6 browser softphone: registers the agent's own extension over WSS (JsSIP) and exposes the
 * single current call. Hotline calls ring here because the ACD dials this extension.
 */
export function useSoftphone(account: CcSipAccount | null, onError: (message: string) => void) {
  const [status, setStatus] = useState<PhoneStatus>("off");
  const [phase, setPhase] = useState<CallPhase>("none");
  const [peer, setPeer] = useState<string>("");
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const ua = useRef<UA | null>(null);
  const session = useRef<RTCSession | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    if (!account) return;
    audio.current ??= Object.assign(new Audio(), { autoplay: true });
    const next = new UA({
      sockets: [new WebSocketInterface(account.wsUrl)],
      uri: `sip:${account.number}@${account.domain}`,
      password: account.secret,
      session_timers: false,
    });
    const attach = (call: RTCSession) => {
      session.current = call;
      setPeer(call.remote_identity.display_name || call.remote_identity.uri.user);
      const play = (connection: RTCPeerConnection) =>
        connection.addEventListener("track", (event) => {
          audio.current!.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        });
      if (call.connection) play(call.connection as unknown as RTCPeerConnection);
      else call.on("peerconnection", (event) => play(event.peerconnection as unknown as RTCPeerConnection));
      call.on("confirmed", () => setPhase("active"));
      const finish = () => {
        if (session.current !== call) return;
        session.current = null;
        audio.current!.srcObject = null;
        setPhase("none");
        setPeer("");
        setMuted(false);
        setHeld(false);
      };
      call.on("ended", finish);
      call.on("failed", (event) => {
        if (event.cause === "User Denied Media Access")
          report.current("Không mở được micro. Hãy cho phép trình duyệt dùng micro rồi thử lại.");
        finish();
      });
    };
    let alive = true; // a stopped UA still reports "unregistered" after its replacement registered
    const show = (value: PhoneStatus) => () => alive && setStatus(value);
    next.on("registered", show("registered"));
    next.on("unregistered", show("off"));
    next.on("registrationFailed", show("failed"));
    next.on("disconnected", show("registering"));
    next.on("newRTCSession", ({ session: call, originator }: RTCSessionEvent) => {
      if (session.current) return void call.terminate({ status_code: 486 }); // one call at a time
      setPhase(originator === "remote" ? "incoming" : "outgoing");
      attach(call);
    });
    setStatus("registering");
    next.start();
    ua.current = next;
    return () => {
      alive = false;
      session.current?.terminate();
      next.stop();
      ua.current = null;
      setStatus("off");
    };
  }, [account]);

  return {
    status,
    phase,
    peer,
    muted,
    held,
    answer: () => session.current?.answer(AUDIO_ONLY),
    hangup: () => session.current?.terminate(),
    call(target: string) {
      if (!ua.current || !account || session.current) return;
      ua.current.call(`sip:${target}@${account.domain}`, AUDIO_ONLY);
    },
    toggleMute() {
      const call = session.current;
      if (!call) return;
      if (call.isMuted().audio) call.unmute({ audio: true });
      else call.mute({ audio: true });
      setMuted(call.isMuted().audio ?? false);
    },
    sendDigit: (digit: string) => session.current?.sendDTMF(digit),
    /** SIP hold (re-INVITE sendonly): Asterisk plays music to the other side of a direct call. */
    toggleHold() {
      const call = session.current;
      if (!call) return;
      if (call.isOnHold().local) call.unhold();
      else call.hold();
      setHeld(call.isOnHold().local);
    },
  };
}
