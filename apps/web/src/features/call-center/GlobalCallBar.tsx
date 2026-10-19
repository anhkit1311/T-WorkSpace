import { useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { Icon } from "../../shared/ui/Icon";
import "./global-call-bar.css";

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** UI-1: the current call, on every page but the switchboard (which has its own full desk). */
export function GlobalCallBar() {
  const { route, navigate } = useApp();
  const phone = useGlobalSoftphone();
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => setSince(phone.phase === "active" ? Date.now() : null), [phone.phase]);
  useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  if (phone.phase === "none" || route.view === "call-center") return null;
  const label = phone.phase === "incoming" ? "Cuộc gọi đến" : phone.phase === "outgoing" ? "Đang gọi" : "Đang đàm thoại";
  return (
    <aside className={`global-call-bar is-${phone.phase}`} role={phone.phase === "incoming" ? "alertdialog" : "status"} aria-label={`${label}: ${phone.peer}`}>
      <Icon name="phone-call" size={18} />
      <div className="global-call-bar__who">
        <strong>{phone.peer || "Không rõ số"}</strong>
        <span>{label}{since !== null ? ` · ${clock(Math.floor((Date.now() - since) / 1000))}` : ""}</span>
      </div>
      {phone.phase === "incoming" && (
        <button type="button" className="global-call-bar__answer" onClick={phone.answer} title="Alt+A">
          Trả lời
        </button>
      )}
      {phone.phase === "active" && (
        <button type="button" onClick={phone.toggleMute} title="Alt+M" aria-pressed={phone.muted}>
          <Icon name={phone.muted ? "mic-off" : "mic"} size={16} />
          <span className="sr-only">{phone.muted ? "Bật micro" : "Tắt micro"}</span>
        </button>
      )}
      <button type="button" onClick={() => navigate({ view: "call-center" })} title="Mở bàn làm việc tổng đài">
        <Icon name="headset" size={16} />
        <span className="sr-only">Mở tổng đài</span>
      </button>
      <button type="button" className="global-call-bar__hangup" onClick={phone.hangup} title="Alt+H">
        Kết thúc
      </button>
    </aside>
  );
}
