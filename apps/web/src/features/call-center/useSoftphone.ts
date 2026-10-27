import { useEffect, useRef, useState } from "react";
import type { UA } from "jssip";
import type { OutgoingEvent, RTCSession } from "jssip/lib/RTCSession";
import type { RTCSessionEvent } from "jssip/lib/UA";
import type { CcSipAccount } from "@doan/shared";
import { startTone } from "./tones";

export type PhoneStatus = "off" | "registering" | "registered" | "failed";
export type CallPhase = "none" | "incoming" | "outgoing" | "active";

const AUDIO_ONLY = { mediaConstraints: { audio: true, video: false } };
/** TURN relays audio when both sides sit behind NAT (school wifi ↔ 4G); without it they ring but stay silent. */
const media = (account: CcSipAccount | null) =>
  account?.iceServers?.length ? { ...AUDIO_ONLY, pcConfig: { iceServers: account.iceServers } } : AUDIO_ONLY;

/** Why an outgoing call ended before it was answered, from JsSIP's failure cause. */
export function failReason(target: string, cause: string): string {
  if (cause === "Busy") return `Máy lẻ ${target} đang bận.`;
  if (cause === "No Answer" || cause === "Request Timeout") return `Máy lẻ ${target} không trả lời.`;
  if (cause === "Connection Error") return "Mất kết nối tới tổng đài, hãy thử lại.";
  return `Không gọi được máy lẻ ${target}: số không tồn tại hoặc người dùng chưa mở T-WorkSpace.`;
}

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
  const mic = useRef<MediaStream | null>(null);
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    if (!account) return;
    let alive = true; // a stopped UA still reports "unregistered" after its replacement registered
    let stop: (() => void) | undefined;
    setStatus("registering");
    // JsSIP loads only for users with an extension, not with the app's first page.
    void import("jssip").then(({ UA, WebSocketInterface }) => {
      if (!alive) return;
      audio.current ??= Object.assign(new Audio(), { autoplay: true });
      const next = new UA({
        sockets: [new WebSocketInterface(account.wsUrl)],
        uri: `sip:${account.number}@${account.domain}`,
        password: account.secret,
        session_timers: false,
      });
      const attach = (call: RTCSession) => {
        session.current = call;
        // Ringtone while an incoming call waits; ringback once the callee's phone rings (180). A 183 with
        // SDP carries the PBX's own early media (e.g. music on hold), so no local tone then.
        let stopTone = call.direction === "incoming" ? startTone("ring") : () => {};
        const silence = () => {
          stopTone();
          stopTone = () => {};
        };
        // Typed as outgoing: on an incoming call `response` is absent, which the `?.` below handles.
        call.on("progress", (event: OutgoingEvent) => {
          if (call.direction === "outgoing" && event.response?.status_code === 180 && !event.response.body) {
            silence();
            stopTone = startTone("ringback");
          } else if (event.response?.body) silence();
        });
        call.on("accepted", silence);
        setPeer(call.remote_identity.display_name || call.remote_identity.uri.user);
        const play = (connection: RTCPeerConnection) =>
          connection.addEventListener("track", (event) => {
            audio.current!.srcObject = event.streams[0] ?? new MediaStream([event.track]);
          });
        if (call.connection) play(call.connection as unknown as RTCPeerConnection);
        else call.on("peerconnection", (event) => play(event.peerconnection as unknown as RTCPeerConnection));
        call.on("confirmed", () => setPhase("active"));
        const finish = () => {
          silence();
          if (session.current !== call) return;
          session.current = null;
          // JsSIP only stops a stream it opened itself; ours (openMic) is stopped here.
          mic.current?.getTracks().forEach((track) => track.stop());
          mic.current = null;
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
          else if (call.direction === "outgoing" && event.originator !== "local")
            report.current(failReason(call.remote_identity.uri.user, String(event.cause)));
          finish();
        });
      };
      const show = (value: PhoneStatus) => () => alive && setStatus(value);
      // JsSIP reconnects the WebSocket itself but gives up on a failed REGISTER: retry with backoff.
      let failures = 0;
      let retry: number | undefined;
      const reRegister = () => {
        window.clearTimeout(retry);
        if (alive && next.isConnected() && !next.isRegistered()) next.register();
      };
      next.on("registered", () => {
        failures = 0;
        show("registered")();
      });
      next.on("unregistered", show("off"));
      next.on("registrationFailed", () => {
        show("failed")();
        retry = window.setTimeout(reRegister, Math.min(30_000, 2_000 * 2 ** failures++));
      });
      next.on("disconnected", show("registering"));
      window.addEventListener("online", reRegister);
      next.on("newRTCSession", ({ session: call, originator }: RTCSessionEvent) => {
        if (session.current) return void call.terminate({ status_code: 486 }); // one call at a time
        setPhase(originator === "remote" ? "incoming" : "outgoing");
        attach(call);
      });
      next.start();
      ua.current = next;
      stop = () => {
        window.clearTimeout(retry);
        window.removeEventListener("online", reRegister);
        session.current?.terminate();
        next.stop();
        ua.current = null;
      };
    }, () => {
      if (alive) setStatus("failed");
    });
    return () => {
      alive = false;
      stop?.();
      setStatus("off");
    };
  }, [account]);

  /**
   * The microphone is opened before JsSIP creates the peer connection. Otherwise Chrome hides the local
   * IPs of the first call after loading the page (mDNS, `c=IN IP4 0.0.0.0`), Asterisk takes 0.0.0.0 as
   * hold and both sides hear music on hold instead of each other.
   */
  const openMic = () => navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  const release = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());
  const micDenied = () => report.current("Không mở được micro. Hãy cho phép trình duyệt dùng micro rồi thử lại.");

  return {
    status,
    phase,
    peer,
    muted,
    held,
    async answer() {
      const call = session.current;
      if (!call) return;
      const stream = await openMic();
      if (!stream) return void (micDenied(), call.terminate());
      // The caller hung up meanwhile, or a second click already answered.
      if (session.current !== call || mic.current) return release(stream);
      mic.current = stream;
      call.answer({ ...media(account), mediaStream: stream });
    },
    hangup: () => session.current?.terminate(),
    async call(target: string) {
      if (session.current) return;
      if (!ua.current || !account || !ua.current.isRegistered())
        return report.current(account ? "Tổng đài chưa kết nối xong, thử lại sau vài giây." : "Tài khoản của bạn chưa được cấp máy lẻ nên chưa gọi được.");
      const stream = await openMic();
      if (!stream) return micDenied();
      // A call came in, or a second click already dialled, while the browser asked for the microphone.
      if (session.current || mic.current || !ua.current?.isRegistered()) return release(stream);
      mic.current = stream;
      try {
        ua.current.call(`sip:${target}@${account.domain}`, { ...media(account), mediaStream: stream });
      } catch {
        mic.current = null;
        release(stream);
      }
    },
    toggleMute() {
      const call = session.current;
      if (!call) return;
      if (call.isMuted().audio) call.unmute({ audio: true });
      else call.mute({ audio: true });
      setMuted(call.isMuted().audio ?? false);
    },
    sendDigit: (digit: string) => session.current?.sendDTMF(digit),
    /** Blind transfer of a direct call (SIP REFER): Asterisk dials the target from our context and drops our leg. */
    transfer(target: string) {
      const call = session.current;
      if (!call || !account || !call.isEstablished()) return;
      // 202 Accepted: Asterisk already took the other party out of our bridge, so our leg is left talking to nobody.
      call.refer(`sip:${target}@${account.domain}`, {
        eventHandlers: {
          requestSucceeded: () => call.terminate(),
          requestFailed: () => report.current(`Không chuyển được cuộc gọi tới ${target}.`),
        },
      });
    },
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
