import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { CcSipAccount } from "@doan/shared";
import { useApp } from "./AppContext";
import { useSocket } from "./SocketContext";
import { callCenterApi } from "../../features/call-center/api";
import { useSoftphone } from "../../features/call-center/useSoftphone";

type Softphone = ReturnType<typeof useSoftphone> & {
  /** Re-reads the user's extension (after an admin assigns or changes it). */
  refresh: () => void;
  hasExtension: boolean;
};

const SoftphoneContext = createContext<Softphone | null>(null);

/**
 * UI-1: one softphone for the whole app, so a call survives moving between pages. Users without
 * an extension never register (me/sip answers 404 and the phone stays off).
 */
export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const { accessToken, notify } = useApp();
  const [account, setAccount] = useState<CcSipAccount | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const token = useRef(accessToken);
  token.current = accessToken;
  const signedIn = Boolean(accessToken);
  const refresh = useCallback(() => {
    if (!token.current) return setAccount(null);
    callCenterApi<CcSipAccount>(token.current, "me/sip").then(
      (next) => setAccount((current) => (current && current.number === next.number && current.secret === next.secret ? current : next)),
      () => setAccount(null),
    );
  }, []);
  // Only on sign-in/out: the token itself refreshes without changing the extension.
  useEffect(refresh, [refresh, signedIn]);
  const phone = useSoftphone(account, (message) => notifyRef.current("Tổng đài", message, "warning"));

  // NV-CC5 / NV-CC3: a new voicemail or a change on one of the user's tickets, wherever they are.
  const { socket } = useSocket();
  const { navigate } = useApp();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (!socket) return;
    const onVoicemail = (data: { from: string; durationSeconds: number }) =>
      notifyRef.current("Thư thoại mới", `${data.from} để lại lời nhắn ${data.durationSeconds} giây.`, "info", {
        label: "Nghe",
        onClick: () => navigateRef.current({ view: "call-center" }),
      });
    const onTicket = (data: { message: string }) => notifyRef.current("Phiếu hỗ trợ", data.message, "info");
    socket.on("callcenter_voicemail", onVoicemail);
    socket.on("callcenter_ticket", onTicket);
    return () => {
      socket.off("callcenter_voicemail", onVoicemail);
      socket.off("callcenter_ticket", onTicket);
    };
  }, [socket]);

  // Keyboard: Alt+A answer, Alt+H hang up, Alt+M mute — anywhere in the app while a call exists.
  const { phase, answer, hangup, toggleMute } = phone;
  useEffect(() => {
    if (phase === "none") return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const action = key === "a" && phase === "incoming" ? answer : key === "h" ? hangup : key === "m" && phase === "active" ? toggleMute : null;
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, answer, hangup, toggleMute]);

  return <SoftphoneContext.Provider value={{ ...phone, refresh, hasExtension: Boolean(account) }}>{children}</SoftphoneContext.Provider>;
}

export function useGlobalSoftphone() {
  const value = useContext(SoftphoneContext);
  if (!value) throw new Error("useGlobalSoftphone must be used inside SoftphoneProvider");
  return value;
}
