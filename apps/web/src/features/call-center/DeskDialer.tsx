import { useEffect, useMemo, useState } from "react";
import type { CcRecentCall, CcTransferDirectory } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { callCenterApi } from "./api";

type Lamp = CcTransferDirectory["extensions"][number]["deviceState"];
interface Contact {
  id: string;
  name: string;
  department: string;
  extension: string;
  /** Busy lamp; null for a unit's shared number or while the PBX is unreachable. */
  state: Lamp;
}

const LAMP: Record<NonNullable<Lamp>, string> = { free: "Rảnh", ringing: "Đang đổ chuông", busy: "Đang gọi", offline: "Không trực tuyến" };
const LAMP_TONE: Record<NonNullable<Lamp>, string> = { free: "green", ringing: "red", busy: "red", offline: "neutral" };
const OUTCOME: Record<CcRecentCall["outcome"], string> = {
  answered: "Đã nghe",
  abandoned: "Gác trước khi nghe",
  missed: "Nhỡ",
  busy: "Máy bận",
  transferred: "Đã chuyển",
};
const KEYPAD = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]] as const;
const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};
const talkTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function playTone(digit: string) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    gain.connect(ctx.destination);
    for (const frequency of DTMF[digit]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
  } catch {
    // Audio blocked until the first user gesture: the key still works.
  }
}

/**
 * Right column of the desk: dial an extension (DTMF during a call) and every máy lẻ in the school
 * with its busy lamp. A hotline call is transferred through the ACD (TransferPanel), not from here.
 */
export function DeskDialer({ hotlineCall }: { hotlineCall: boolean }) {
  const { accessToken } = useApp();
  const phone = useGlobalSoftphone();
  const [dial, setDial] = useState("");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [tab, setTab] = useState<"contacts" | "recent">("contacts");
  const [recent, setRecent] = useState<CcRecentCall[] | null>(null);

  // Unit shared numbers first, then people; refreshed every 15 s so the busy lamps stay current.
  useEffect(() => {
    if (!accessToken) return;
    const load = () =>
      void callCenterApi<CcTransferDirectory>(accessToken, "transfer-directory").then(
        (directory) =>
          setContacts([
            ...directory.departments.flatMap((unit) =>
              unit.groupNumber
                ? [{ id: `group-${unit.id}`, name: `Số chung · ${unit.name}`, department: "Đổ chuông cả đơn vị", extension: unit.groupNumber, state: null }]
                : [],
            ),
            ...directory.extensions.map((ext) => ({ id: ext.number, name: ext.name, department: ext.departmentName, extension: ext.number, state: ext.deviceState })),
          ]),
        () => setContacts((current) => current ?? []),
      );
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [accessToken]);

  // Reloaded after each call; the API writes the record once Asterisk reports the hang-up, hence the delay.
  const loaded = recent !== null;
  useEffect(() => {
    if (!accessToken || tab !== "recent" || phone.phase !== "none") return;
    const timer = window.setTimeout(
      () => void callCenterApi<CcRecentCall[]>(accessToken, "me/recent-calls").then(setRecent, () => setRecent([])),
      loaded ? 1000 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [accessToken, tab, phone.phase]); // `loaded` only picks the delay, so it is left out

  const ready = phone.status === "registered";
  const busy = phone.phase !== "none";
  const inCall = phone.phase === "active";
  const canTransfer = inCall && !hotlineCall;
  const press = (key: string) => {
    playTone(key);
    if (inCall) phone.sendDigit(key);
    else setDial((value) => (value + key).slice(0, 16));
  };
  const transfer = (target: string) => {
    phone.transfer(target);
    setDial("");
  };
  // The field then holds a transfer target or DTMF, not the number just dialled.
  const dialOut = () => {
    phone.call(dial);
    setDial("");
  };
  // One button per row: transfer during a direct call, otherwise call the number.
  const act = (number: string) => (canTransfer ? transfer(number) : phone.call(number));
  const actDisabled = canTransfer ? false : busy || !ready;
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!contacts || !needle) return contacts ?? [];
    return contacts.filter((item) => [item.name, item.extension, item.department].some((value) => value.toLowerCase().includes(needle)));
  }, [contacts, search]);
  const status =
    busy || ready
      ? null
      : !phone.hasExtension
        ? "Tài khoản chưa được cấp máy lẻ — liên hệ quản trị tổng đài."
        : phone.status === "registering"
          ? "Đang kết nối tổng đài…"
          : "Chưa kết nối tổng đài.";

  return (
    <>
      <section className="callcenter-panel cc-dialer" aria-label="Gọi nhanh">
        <div className="callcenter-panel__head">
          <h2 className="callcenter-panel__title">{inCall ? "Bàn phím DTMF" : "Gọi nhanh"}</h2>
          <button type="button" className="cc-icon-btn" title="Kiểm tra âm thanh" aria-label="Kiểm tra âm thanh" onClick={() => playTone("5")}>
            <Icon name="volume" size={16} />
          </button>
        </div>
        <form
          className="cc-dialer__display"
          onSubmit={(event) => {
            event.preventDefault();
            if (canTransfer && /^[0-9]{4,5}$/.test(dial)) transfer(dial);
            else if (!busy && ready && dial) dialOut();
          }}
        >
          <input
            className="cc-dialer__input"
            aria-label={canTransfer ? "Số máy lẻ nhận chuyển" : "Số cần gọi"}
            value={dial}
            inputMode="tel"
            placeholder={inCall ? "Phím bấm gửi DTMF" : "Số máy lẻ"}
            onChange={(event) => setDial(event.target.value.replace(/[^0-9*#]/g, "").slice(0, 16))}
          />
          {dial && (
            <button type="button" className="cc-icon-btn" aria-label="Xóa một số" onClick={() => setDial((value) => value.slice(0, -1))}>
              <Icon name="chevron-left" size={16} />
            </button>
          )}
        </form>
        <div className="cc-keys" role="group" aria-label={inCall ? "Bàn phím DTMF" : "Bàn phím số"}>
          {KEYPAD.map(([key, sub]) => (
            <button key={key} type="button" className="cc-key" aria-label={key} onClick={() => press(key)}>
              <b>{key}</b>
              {sub && <small>{sub}</small>}
            </button>
          ))}
        </div>
        {canTransfer ? (
          <Button className="cc-dialer__go" variant="secondary" icon="share" disabled={!/^[0-9]{4,5}$/.test(dial)} onClick={() => transfer(dial)}>
            Chuyển tới số này
          </Button>
        ) : (
          <Button className="cc-dialer__go" icon="phone" disabled={!dial || busy || !ready} onClick={dialOut}>
            Gọi
          </Button>
        )}
        {status && <p className="desk-muted cc-dialer__status">{status}</p>}
      </section>

      <section className="callcenter-panel cc-directory" aria-label="Danh bạ">
        <div className="cc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "contacts"} onClick={() => setTab("contacts")}>Danh bạ máy lẻ</button>
          <button type="button" role="tab" aria-selected={tab === "recent"} onClick={() => setTab("recent")}>Gần đây</button>
        </div>
        {tab === "contacts" ? (
          <>
            <label className="cc-search">
              <Icon name="search" size={14} />
              <input type="search" aria-label="Tìm máy lẻ" placeholder="Tìm tên, số, đơn vị" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {!shown.length ? (
              <p className="desk-muted">
                {contacts === null ? "Đang tải danh bạ…" : contacts.length ? "Không tìm thấy máy lẻ nào." : "Chưa có máy lẻ nào, hoặc tài khoản của bạn chưa được cấp máy lẻ."}
              </p>
            ) : (
              <ul className="cc-dir">
                {shown.map((item) => (
                  <li key={item.id}>
                    <span className={`cc-led tone-${item.state ? LAMP_TONE[item.state] : "group"}`} aria-hidden="true" />
                    <button type="button" className="cc-dir__who" title="Điền số vào bàn phím" onClick={() => setDial(item.extension)}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.extension} · {item.department}
                        {item.state && ` · ${LAMP[item.state]}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="cc-round"
                      aria-label={canTransfer ? `Chuyển cuộc gọi tới ${item.name}` : `Gọi ${item.name}`}
                      title={canTransfer ? `Chuyển cuộc gọi tới ${item.name}` : `Gọi ${item.name}`}
                      disabled={actDisabled}
                      onClick={() => act(item.extension)}
                    >
                      <Icon name={canTransfer ? "share" : "phone"} size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : !recent?.length ? (
          <p className="desk-muted">{recent === null ? "Đang tải lịch sử…" : "Chưa có cuộc gọi nội bộ nào."}</p>
        ) : (
          <ul className="cc-dir">
            {recent.map((call) => (
              <li key={call.id} className={call.way === "in" && call.outcome !== "answered" && call.outcome !== "transferred" ? "is-missed" : ""}>
                <span className="cc-dir__way" aria-label={call.way === "out" ? "Gọi đi" : "Gọi đến"}>{call.way === "out" ? "↗" : "↙"}</span>
                <div className="cc-dir__who">
                  <strong>{call.name ?? call.number}</strong>
                  <span>
                    {call.number} · {new Date(call.startedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })} ·{" "}
                    {call.outcome === "answered" ? talkTime(call.durationSeconds) : OUTCOME[call.outcome]}
                  </span>
                </div>
                <button
                  type="button"
                  className="cc-round"
                  aria-label={canTransfer ? `Chuyển cuộc gọi tới ${call.number}` : `Gọi lại ${call.number}`}
                  title={canTransfer ? `Chuyển cuộc gọi tới ${call.number}` : `Gọi lại ${call.number}`}
                  disabled={actDisabled}
                  onClick={() => act(call.number)}
                >
                  <Icon name={canTransfer ? "share" : "phone"} size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
