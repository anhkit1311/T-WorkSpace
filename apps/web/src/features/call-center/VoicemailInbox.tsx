import { useCallback, useEffect, useState } from "react";
import type { CcPersonalVoicemail } from "@doan/shared";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { voicemailUrl } from "./api";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** NV-CC5: messages left on the user's own extension when they did not answer, were busy or offline. */
export function VoicemailInbox({ api, token, fail, onCall }: { api: Api; token: string; fail: (error: unknown) => void; onCall: ((number: string) => void) | null }) {
  const { socket } = useSocket();
  const [items, setItems] = useState<CcPersonalVoicemail[] | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(() => void api<CcPersonalVoicemail[]>("me/voicemails").then(setItems, () => setItems([])), [api]);
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
      setItems((list) => list?.map((entry) => (entry.id === item.id ? { ...entry, listened: true } : entry)) ?? null);
    }, fail);
  const remove = (item: CcPersonalVoicemail) =>
    api(`me/voicemails/${item.id}`, "DELETE").then(() => setItems((list) => list?.filter((entry) => entry.id !== item.id) ?? null), fail);

  const unheard = items?.filter((item) => !item.listened).length ?? 0;
  return (
    <div className="callcenter-panel">
      <div className="callcenter-panel__head">
        <h2 className="callcenter-panel__title">
          <Icon name="message" size={18} />
          <span>Hộp thư thoại</span>
        </h2>
        {unheard > 0 && <Badge tone="red">{unheard} chưa nghe</Badge>}
      </div>
      {items === null ? (
        <p className="desk-muted">Đang tải thư thoại…</p>
      ) : !items.length ? (
        <p className="desk-muted">Chưa có tin nhắn. Khi bạn không nghe máy, bận hoặc ngoại tuyến, người gọi có thể để lại lời nhắn tại đây.</p>
      ) : (
        <ul className="desk-recent" aria-label="Thư thoại">
          {items.map((item) => (
            <li key={item.id} className={item.listened ? "" : "is-unheard"}>
              <div className="desk-recent__who">
                <strong>{item.callerName ?? item.callerNumber}</strong>
                <span>
                  {item.callerName ? `${item.callerNumber} · ` : ""}
                  {new Date(item.receivedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })} · {duration(item.durationSeconds)}
                </span>
                {playing?.id === item.id && <audio src={playing.url} controls autoPlay />}
              </div>
              <Button size="sm" variant="ghost" icon="play" onClick={() => void play(item)} aria-label={`Nghe tin nhắn của ${item.callerName ?? item.callerNumber}`}>
                Nghe
              </Button>
              {onCall && (
                <Button size="sm" variant="ghost" icon="phone" onClick={() => onCall(item.callerNumber)} aria-label={`Gọi lại ${item.callerNumber}`}>
                  Gọi lại
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="trash" onClick={() => void remove(item)} aria-label="Xóa tin nhắn" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
