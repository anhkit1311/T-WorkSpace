import { useEffect, useMemo, useState } from "react";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";
import type { CcRecentCall, CcTransferDirectory } from "@doan/shared";
import { callCenterApi } from "./api";
import "./softphone-dialer.css";

type Lamp = CcTransferDirectory["extensions"][number]["deviceState"];
interface ContactItem {
  id: string;
  name: string;
  department: string;
  extension: string;
  /** Busy lamp; null for a unit's shared number or while the PBX is unreachable. */
  state: Lamp;
}

const LAMP: Record<NonNullable<Lamp>, string> = { free: "Rảnh", ringing: "Đang đổ chuông", busy: "Đang gọi", offline: "Không trực tuyến" };

const KEYPAD_BUTTONS: { key: string; sub?: string }[] = [
  { key: "1" },
  { key: "2", sub: "ABC" },
  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },
  { key: "5", sub: "JKL" },
  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS" },
  { key: "8", sub: "TUV" },
  { key: "9", sub: "WXYZ" },
  { key: "*" },
  { key: "0" },
  { key: "#" },
];

// DTMF Frequencies (Row x Col)
const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

function playDtmfTone(digit: string) {
  try {
    const freqs = DTMF_FREQS[digit];
    if (!freqs) return;
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.frequency.value = freqs[0];
    osc2.frequency.value = freqs[1];

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.12);
  } catch {
    // Ignore audio context blocked
  }
}

const OUTCOME: Record<CcRecentCall["outcome"], string> = {
  answered: "Đã nghe",
  abandoned: "Gác trước khi nghe",
  missed: "Nhỡ",
  busy: "Máy bận",
  transferred: "Đã chuyển",
};
const PHASE = { incoming: "Cuộc gọi đến", outgoing: "Đang gọi", active: "Đang đàm thoại" } as const;
const talkTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function SoftphoneDialerPage() {
  const { accessToken } = useApp();
  const phone = useGlobalSoftphone();

  const [dialNumber, setDialNumber] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<ContactItem[] | null>(null);
  const [tab, setTab] = useState<"contacts" | "recent">("contacts");
  const [recent, setRecent] = useState<CcRecentCall[] | null>(null);

  // Every máy lẻ in the school (name, unit, number); readable by anyone with a máy lẻ.
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
            ...directory.extensions.map((ext) => ({
              id: ext.number,
              name: ext.name,
              department: ext.departmentName,
              extension: ext.number,
              state: ext.deviceState,
            })),
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

  const handleKeyPress = (key: string) => {
    playDtmfTone(key);
    if (phone.phase === "active") {
      phone.sendDigit(key);
    } else {
      setDialNumber((prev) => (prev + key).slice(0, 16));
    }
  };

  const handleCall = (targetNum?: string) => {
    const number = (targetNum ?? dialNumber).trim();
    if (number) phone.call(number);
  };

  const isCalling = phone.phase !== "none";
  const inCall = phone.phase === "active";
  const transferTo = (target: string) => {
    phone.transfer(target);
    setDialNumber("");
  };

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!contacts || !q) return contacts ?? [];
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.extension.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q),
    );
  }, [contacts, searchQuery]);

  return (
    <div className="softphone-page-container">
      {/* Header */}
      <div className="softphone-page-header">
        <h1 className="softphone-page-title">Tổng đài</h1>
        <p className="softphone-page-desc">
          Gọi máy lẻ nội bộ của các khoa, phòng ban ngay trên trình duyệt.
        </p>
      </div>

      {/* Main 2-column Layout */}
      <div className="softphone-main-layout">
        {/* Left Column: Bàn phím */}
        <div className="softphone-card">
          <div className="softphone-card__head">
            <h2 className="softphone-card__title">Bàn phím</h2>
            <button
              type="button"
              className="softphone-audio-icon-btn"
              title="Kiểm tra âm thanh"
              onClick={() => playDtmfTone("5")}
            >
              <Icon name="volume" size={18} />
            </button>
          </div>

          {/* Dial display */}
          <div className="softphone-dial-box">
            <div className="softphone-dial-box__label">Nhập số máy lẻ</div>
            <div className="softphone-dial-display-row">
              <input
                type="text"
                className="softphone-dial-display-input"
                placeholder={isCalling ? "Đang gọi..." : "10101"}
                value={dialNumber}
                onChange={(e) =>
                  setDialNumber(e.target.value.replace(/[^0-9*#]/g, "").slice(0, 16))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dialNumber) {
                    handleCall();
                  }
                }}
              />
              {dialNumber && !isCalling && (
                <button
                  type="button"
                  className="softphone-dial-clear-btn"
                  title="Xóa"
                  onClick={() => setDialNumber((prev) => prev.slice(0, -1))}
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
            <p className="softphone-dial-box__hint">
              {inCall
                ? "Phím bên dưới gửi tín hiệu DTMF. Gõ số máy lẻ vào ô rồi bấm Chuyển để chuyển cuộc gọi."
                : "Gõ số bằng bàn phím máy tính hoặc bấm các phím bên dưới"}
            </p>
          </div>

          {/* Keypad Grid 3x4 */}
          <div className="softphone-keys-grid">
            {KEYPAD_BUTTONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="softphone-num-btn"
                onClick={() => handleKeyPress(item.key)}
              >
                <span className="softphone-num-main">{item.key}</span>
                {item.sub && <span className="softphone-num-sub">{item.sub}</span>}
              </button>
            ))}
          </div>

          {/* Big Call Button & Status */}
          {isCalling && (
            <div className="softphone-in-call" role={phone.phase === "incoming" ? "alert" : "status"}>
              <strong>{PHASE[phone.phase as keyof typeof PHASE]}</strong>
              <span>{phone.peer || "Không rõ số"}</span>
              {phone.held && <span className="softphone-in-call__chip">Đang giữ máy</span>}
            </div>
          )}
          <div className="softphone-call-action-area">
            <div className="softphone-call-buttons">
              {phone.phase === "incoming" && (
                <button type="button" className="softphone-call-btn" title="Trả lời (Alt+A)" aria-label="Trả lời" onClick={phone.answer}>
                  <Icon name="phone" size={26} />
                </button>
              )}
              {isCalling ? (
                <button
                  type="button"
                  className="softphone-call-btn is-active-call"
                  title="Gác máy"
                  aria-label="Gác máy"
                  onClick={phone.hangup}
                >
                  <Icon name="phone" size={26} />
                </button>
              ) : (
                <button
                  type="button"
                  className="softphone-call-btn"
                  title="Gọi ngay"
                  disabled={!dialNumber}
                  onClick={() => handleCall()}
                >
                  <Icon name="phone" size={26} />
                </button>
              )}
            </div>

            {inCall && (
              <div className="softphone-call-controls">
                <button type="button" onClick={phone.toggleMute} aria-pressed={phone.muted}>
                  <Icon name={phone.muted ? "mic-off" : "mic"} size={16} />
                  {phone.muted ? "Bật micro" : "Tắt micro"}
                </button>
                <button type="button" onClick={phone.toggleHold} aria-pressed={phone.held}>
                  <Icon name={phone.held ? "play" : "pause"} size={16} />
                  {phone.held ? "Tiếp tục" : "Giữ máy"}
                </button>
                <button
                  type="button"
                  disabled={!/^[0-9]{4,5}$/.test(dialNumber)}
                  onClick={() => transferTo(dialNumber)}
                  title="Chuyển thẳng tới số máy lẻ đã nhập"
                >
                  <Icon name="share" size={16} />
                  Chuyển
                </button>
              </div>
            )}

            <div className="softphone-status-pill">
              <span className="softphone-status-dot" />
              <span>
                {isCalling
                  ? "Đang trong cuộc gọi"
                  : phone.status === "registered"
                    ? "Sẵn sàng gọi"
                    : !phone.hasExtension
                      ? "Tài khoản chưa được cấp máy lẻ — liên hệ quản trị tổng đài"
                      : phone.status === "registering"
                      ? "Đang kết nối tổng đài…"
                      : "Chưa kết nối tổng đài"}
              </span>
            </div>
          </div>

        </div>

        {/* Right Column: Gần đây & Danh bạ */}
        <div className="softphone-card softphone-right-card">
          <div className="softphone-right-head">
            <div className="softphone-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "contacts"} onClick={() => setTab("contacts")}>
                Danh bạ máy lẻ
              </button>
              <button type="button" role="tab" aria-selected={tab === "recent"} onClick={() => setTab("recent")}>
                Gần đây
              </button>
            </div>

            {/* Search Input */}
            {tab === "contacts" && <div className="softphone-search-input-wrapper">
              <Icon name="search" size={15} className="softphone-search-icon" />
              <input
                type="text"
                className="softphone-search-input"
                placeholder="Tìm kiếm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>}
          </div>

          {tab === "recent" && (
            <div className="softphone-contacts-list">
              {!recent?.length && (
                <p style={{ textAlign: "center", color: "var(--nexo-text-muted)", padding: 32 }}>
                  {recent === null ? "Đang tải lịch sử…" : "Chưa có cuộc gọi nội bộ nào."}
                </p>
              )}
              {recent?.map((call) => (
                <div key={call.id} className={`softphone-contact-row${call.way === "in" && call.outcome !== "answered" && call.outcome !== "transferred" ? " is-missed" : ""}`}>
                  <div className="softphone-contact-info">
                    <div className="softphone-contact-info__name">
                      <span aria-label={call.way === "out" ? "Gọi đi" : "Gọi đến"}>{call.way === "out" ? "↗" : "↙"}</span> {call.name ?? call.number}
                    </div>
                    <div className="softphone-contact-info__meta">
                      {call.number} ·{" "}
                      {new Date(call.startedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })} ·{" "}
                      {call.outcome === "answered" ? talkTime(call.durationSeconds) : OUTCOME[call.outcome]}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="softphone-quick-call-btn"
                    title={inCall ? `Chuyển cuộc gọi tới ${call.number}` : `Gọi lại ${call.number}`}
                    disabled={isCalling && !inCall}
                    onClick={() => (inCall ? transferTo(call.number) : handleCall(call.number))}
                  >
                    <Icon name={inCall ? "share" : "phone"} size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Contact List */}
          {tab === "contacts" && <div className="softphone-contacts-list">
              {filteredContacts.length === 0 && (
                <p style={{ textAlign: "center", color: "var(--nexo-text-muted)", padding: 32 }}>
                  {contacts === null ? "Đang tải danh bạ…" : contacts.length ? "Không tìm thấy liên hệ nào." : "Chưa có máy lẻ nào, hoặc tài khoản của bạn chưa được cấp máy lẻ."}
                </p>
              )}
              {filteredContacts.map((contact) => {
                const initials = contact.name
                  .split(" ")
                  .filter(Boolean)
                  .slice(-2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase();
                return (
                  <div
                    key={contact.id}
                    className="softphone-contact-row"
                    onClick={() => {
                      setDialNumber(contact.extension);
                    }}
                  >
                    <div className="softphone-contact-left">
                      <div
                        className="softphone-contact-avatar"
                        style={{ backgroundColor: "#581c87" }}
                      >
                        {initials}
                      </div>
                      <div className="softphone-contact-info">
                        <div className="softphone-contact-info__name">{contact.name}</div>
                        <div className="softphone-contact-info__meta">
                          {contact.department} · {contact.extension}
                          {contact.state && (
                            <>
                              {" · "}
                              <span className={`softphone-lamp is-${contact.state}`}>{LAMP[contact.state]}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="softphone-quick-call-btn"
                      title={inCall ? `Chuyển cuộc gọi tới ${contact.name}` : `Gọi cho ${contact.name}`}
                      disabled={isCalling && !inCall}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (inCall) return transferTo(contact.extension);
                        setDialNumber(contact.extension);
                        handleCall(contact.extension);
                      }}
                    >
                      <Icon name={inCall ? "share" : "phone"} size={16} />
                    </button>
                  </div>
                );
              })}
          </div>}
        </div>
      </div>
    </div>
  );
}
