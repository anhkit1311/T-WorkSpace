import { useCallback, useEffect, useState } from "react";
import type { CcPersonalVoicemail } from "@doan/shared";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { cn } from "../../shared/lib/utils";
import { voicemailUrl } from "./api";
import { CARD, H2, MUTED } from "./ui";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** NV-CC5: messages left on the user's own extension when they did not answer, were busy or offline. */
export function VoicemailInbox({
  api,
  token,
  fail,
  onCall,
}: {
  api: Api;
  token: string;
  fail: (error: unknown) => void;
  onCall: ((number: string) => void) | null;
}) {
  const { socket } = useSocket();
  const [items, setItems] = useState<CcPersonalVoicemail[] | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(
    () => void api<CcPersonalVoicemail[]>("me/voicemails").then(setItems, () => setItems([])),
    [api],
  );
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket) return;
    socket.on("callcenter_voicemail", load);
    return () => void socket.off("callcenter_voicemail", load);
  }, [socket, load]);
  useEffect(() => () => void (playing && URL.revokeObjectURL(playing.url)), [playing]);

  const play = (item: CcPersonalVoicemail) =>
    voicemailUrl(token, item.id).then((url) => {
      setPlaying({ id: item.id, url });
      setItems(
        (list) =>
          list?.map((entry) => (entry.id === item.id ? { ...entry, listened: true } : entry)) ??
          null,
      );
    }, fail);
  const remove = (item: CcPersonalVoicemail) =>
    api(`me/voicemails/${item.id}`, "DELETE").then(
      () => setItems((list) => list?.filter((entry) => entry.id !== item.id) ?? null),
      fail,
    );

  const unheard = items?.filter((item) => !item.listened).length ?? 0;
  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <h2 className={H2}>Hộp thư thoại</h2>
        {unheard > 0 && (
          <span className="ml-auto">
            <Badge tone="red">{unheard} chưa nghe</Badge>
          </span>
        )}
      </div>
      {items === null ? (
        <p className={MUTED}>Đang tải thư thoại…</p>
      ) : !items.length ? (
        <p className={MUTED}>
          Chưa có tin nhắn. Khi bạn không nghe máy, bận hoặc ngoại tuyến, người gọi có thể để lại
          lời nhắn tại đây.
        </p>
      ) : (
        <ul className="grid" aria-label="Thư thoại">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start gap-1.5 rounded-lg px-1.5 py-2 hover:bg-secondary"
            >
              <div className="min-w-[140px] flex-1">
                <strong className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold">
                  {!item.listened && (
                    <i
                      className="size-[7px] shrink-0 rounded-full bg-[#2f6bff]"
                      aria-label="Chưa nghe"
                    />
                  )}
                  {item.callerName ?? item.callerNumber}
                </strong>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.callerName ? `${item.callerNumber} · ` : ""}
                  {new Date(item.receivedAt).toLocaleString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "2-digit",
                  })}{" "}
                  · {duration(item.durationSeconds)}
                </span>
                {playing?.id === item.id && (
                  <audio className="mt-1.5 h-8 w-full" src={playing.url} controls autoPlay />
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon="play"
                onClick={() => void play(item)}
                aria-label={`Nghe tin nhắn của ${item.callerName ?? item.callerNumber}`}
              >
                Nghe
              </Button>
              {onCall && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="phone"
                  onClick={() => onCall(item.callerNumber)}
                  aria-label={`Gọi lại ${item.callerNumber}`}
                >
                  Gọi lại
                </Button>
              )}
              <Button
                size="sm"
                variant="icon"
                className={cn("size-[30px] px-0")}
                icon="trash"
                onClick={() => void remove(item)}
                aria-label="Xóa tin nhắn"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
