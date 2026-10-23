import { useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { Icon } from "../../shared/ui/Icon";

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** UI-1: the current call in the live strip under the header, on every page but the switchboard (which has its own desk). */
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

  if (phone.phase === "none" || route.view === "call-center" || route.view === "call-directory") return null;
  const label = phone.phase === "incoming" ? "Cuộc gọi đến" : phone.phase === "outgoing" ? "Đang gọi" : "Đang đàm thoại";
  return (
    <div className={`live-strip__item is-${phone.phase}`} role={phone.phase === "incoming" ? "alertdialog" : "status"} aria-label={`${label}: ${phone.peer}`}>
      <span className="live-strip__dot" aria-hidden="true" />
      <strong>{label}</strong>
      <span className="live-strip__who">{phone.peer || "Không rõ số"}</span>
      {since !== null && <span className="live-strip__time">{clock(Math.floor((Date.now() - since) / 1000))}</span>}
      {phone.held && <span className="live-strip__chip">Đang giữ máy</span>}
      {phone.phase === "incoming" && (
        <button type="button" className="live-strip__btn is-answer" onClick={phone.answer} title="Alt+A">
          Trả lời
        </button>
      )}
      {phone.phase === "active" && (
        <button type="button" className="live-strip__btn" onClick={phone.toggleMute} title="Alt+M" aria-pressed={phone.muted}>
          <Icon name={phone.muted ? "mic-off" : "mic"} size={15} />
          {phone.muted ? "Bật micro" : "Tắt micro"}
        </button>
      )}
      <button type="button" className="live-strip__btn is-end" onClick={phone.hangup} title="Alt+H">
        Gác máy
      </button>
      <button type="button" className="live-strip__btn is-quiet" onClick={() => navigate({ view: "call-center" })}>
        Mở bàn làm việc
      </button>
    </div>
  );
}
