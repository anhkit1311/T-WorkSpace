// Dev-only page for the week-1 Asterisk spike (open /softphone-test.html on the Vite dev server).
// The real agent softphone (CC-6) will reuse this flow inside the call center workspace.
import { UA, WebSocketInterface } from "jssip";
import type { RTCSessionEvent } from "jssip/lib/UA";
import type { RTCSession } from "jssip/lib/RTCSession";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const wsInput = $<HTMLInputElement>("ws");
const extInput = $<HTMLInputElement>("ext");
const passwordInput = $<HTMLInputElement>("password");
const targetInput = $<HTMLInputElement>("target");
const buttons = {
  connect: $<HTMLButtonElement>("connect"),
  disconnect: $<HTMLButtonElement>("disconnect"),
  call: $<HTMLButtonElement>("call"),
  answer: $<HTMLButtonElement>("answer"),
  hangup: $<HTMLButtonElement>("hangup"),
};
const remoteAudio = $<HTMLAudioElement>("remote");
const status = $("status");
const log = $("log");

wsInput.value = import.meta.env.VITE_SIP_WS_URL ?? "ws://localhost:8088/ws";

let ua: UA | null = null;
let session: RTCSession | null = null;

function write(line: string) {
  log.textContent = `${new Date().toLocaleTimeString("vi-VN")}  ${line}\n${log.textContent ?? ""}`;
}

function refresh(text?: string) {
  if (text) status.textContent = text;
  const registered = Boolean(ua?.isRegistered());
  buttons.connect.disabled = Boolean(ua);
  buttons.disconnect.disabled = !ua;
  buttons.call.disabled = !registered || Boolean(session);
  buttons.hangup.disabled = !session;
}

function attach(next: RTCSession) {
  session = next;
  const playRemote = (connection: RTCPeerConnection) =>
    connection.addEventListener("track", (event) => {
      remoteAudio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    });
  if (next.connection) playRemote(next.connection as unknown as RTCPeerConnection);
  else next.on("peerconnection", (event) => playRemote(event.peerconnection as unknown as RTCPeerConnection));
  next.on("progress", () => refresh("Đang đổ chuông…"));
  next.on("confirmed", () => {
    buttons.answer.disabled = true;
    refresh("Đang trong cuộc gọi");
  });
  const finish = (cause: string) => {
    session = null;
    buttons.answer.disabled = true;
    remoteAudio.srcObject = null;
    write(`Kết thúc: ${cause}`);
    refresh("Đã đăng ký · sẵn sàng");
  };
  next.on("ended", (event) => finish(event.cause));
  next.on("failed", (event) => finish(event.cause));
  refresh();
}

$<HTMLFormElement>("register").addEventListener("submit", (event) => {
  event.preventDefault();
  const host = new URL(wsInput.value).hostname;
  ua = new UA({
    sockets: [new WebSocketInterface(wsInput.value)],
    uri: `sip:${extInput.value}@${host}`,
    password: passwordInput.value,
    display_name: `Web ${extInput.value}`,
    session_timers: false,
  });
  ua.on("connected", () => write("WebSocket đã kết nối"));
  ua.on("disconnected", () => write("WebSocket mất kết nối"));
  ua.on("registered", () => {
    write(`Đã đăng ký máy lẻ ${extInput.value}`);
    refresh("Đã đăng ký · sẵn sàng");
  });
  ua.on("registrationFailed", (failure) => {
    write(`Đăng ký thất bại: ${failure.cause}`);
    refresh("Đăng ký thất bại");
  });
  ua.on("newRTCSession", (data: RTCSessionEvent) => {
    if (session) {
      data.session.terminate({ status_code: 486 });
      return;
    }
    const caller = data.session.remote_identity.uri.user;
    if (data.originator === "remote") {
      write(`Cuộc gọi đến từ ${caller}`);
      buttons.answer.disabled = false;
      refresh(`Cuộc gọi đến từ ${caller}`);
    }
    attach(data.session);
  });
  ua.start();
  refresh("Đang đăng ký…");
});

buttons.disconnect.addEventListener("click", () => {
  session?.terminate();
  ua?.stop();
  ua = null;
  write("Đã hủy đăng ký");
  refresh("Chưa đăng ký");
});

$<HTMLFormElement>("dial").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ua || session) return;
  const host = new URL(wsInput.value).hostname;
  write(`Gọi ${targetInput.value}`);
  ua.call(`sip:${targetInput.value}@${host}`, { mediaConstraints: { audio: true, video: false } });
});

buttons.answer.addEventListener("click", () => {
  session?.answer({ mediaConstraints: { audio: true, video: false } });
});

buttons.hangup.addEventListener("click", () => session?.terminate());
