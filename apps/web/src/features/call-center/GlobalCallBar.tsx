import { useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { STRIP_BTN, STRIP_DOT, STRIP_ITEM, TINT } from "./ui";

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

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

  if (phone.phase === "none" || route.view === "call-center" || route.view === "call-directory")
    return null;
  const label =
    phone.phase === "incoming"
      ? "Cuộc gọi đến"
      : phone.phase === "outgoing"
        ? "Đang gọi"
        : "Đang đàm thoại";
  return (
    <div
      className={cn(STRIP_ITEM, TINT[phone.phase === "active" ? "green" : "blue"])}
      role={phone.phase === "incoming" ? "alertdialog" : "status"}
      aria-label={`${label}: ${phone.peer}`}
    >
      <span
        className={cn(STRIP_DOT, phone.phase === "incoming" && "animate-pulse")}
        aria-hidden="true"
      />
      <strong className="font-semibold">{label}</strong>
      <span className="min-w-0 truncate font-medium text-foreground">
        {phone.peer || "Không rõ số"}
      </span>
      {since !== null && (
        <span className="font-semibold tabular-nums">
          {clock(Math.floor((Date.now() - since) / 1000))}
        </span>
      )}
      {phone.held && (
        <span className={cn("rounded-full px-2 py-px text-[11.5px] font-semibold", TINT.amber)}>
          Đang giữ máy
        </span>
      )}
      {phone.phase === "incoming" && (
        <button
          type="button"
          className={cn(
            STRIP_BTN,
            "ml-auto border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
          )}
          onClick={phone.answer}
          title="Alt+A"
        >
          Trả lời
        </button>
      )}
      {phone.phase === "active" && (
        <button
          type="button"
          className={cn(STRIP_BTN, phone.phase === "active" && "ml-auto")}
          onClick={phone.toggleMute}
          title="Alt+M"
          aria-pressed={phone.muted}
        >
          <Icon name={phone.muted ? "mic-off" : "mic"} size={15} />
          {phone.muted ? "Bật micro" : "Tắt micro"}
        </button>
      )}
      {phone.phase === "active" && (
        <button
          type="button"
          className={STRIP_BTN}
          onClick={phone.toggleHold}
          aria-pressed={phone.held}
        >
          <Icon name={phone.held ? "play" : "pause"} size={15} />
          {phone.held ? "Tiếp tục" : "Giữ máy"}
        </button>
      )}
      <button
        type="button"
        className={cn(STRIP_BTN, "border-transparent bg-red-600 text-white hover:bg-red-600/90")}
        onClick={phone.hangup}
        title="Alt+H"
      >
        Gác máy
      </button>
      <button
        type="button"
        className={cn(STRIP_BTN, "border-transparent bg-transparent text-current hover:bg-card/60")}
        onClick={() => navigate({ view: "call-center" })}
      >
        Mở bàn làm việc
      </button>
    </div>
  );
}
