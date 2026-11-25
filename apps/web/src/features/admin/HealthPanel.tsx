import { useEffect, useState } from "react";
import type { AgentState } from "@doan/shared";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { CARD, CHIP, MUTED, TINT } from "./ui";

type Spread = { avg: number; max: number } | null;
interface Health {
  checkedAt: string;
  api: {
    uptimeSeconds: number;
    memoryMb: number;
    requests: number;
    errors: number;
    avgResponseMs: number;
    sockets: number;
  };
  db: { latencyMs: number; total: number; idle: number; waiting: number };
  media: {
    workers: number;
    rooms: number;
    peers: number;
    qos: { peers: number; rtt: Spread; jitter: Spread; packetLoss: Spread };
  };
  jobs: { queued: number; running: number; failed: number };
  callCenter: {
    asterisk: boolean | null;
    acdLeader: boolean;
    activeCalls: number;
    waiting: number;
    agents: Partial<Record<AgentState, number>>;
    last24h: { total: number; answered: number; avgWaitSeconds: number };
  };
}

const REFRESH_MS = 10_000;
const AGENT_STATE: Record<AgentState, string> = {
  ready: "Sẵn sàng",
  not_ready: "Tạm nghỉ",
  ringing: "Đổ chuông",
  on_call: "Đang gọi",
  wrap_up: "Hoàn tất",
  offline: "Ngoại tuyến",
};

const uptime = (seconds: number) => {
  const d = Math.floor(seconds / 86400),
    h = Math.floor((seconds % 86400) / 3600),
    m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} ngày ${h} giờ` : h ? `${h} giờ ${m} phút` : `${m} phút`;
};
const avg = (stats: Spread, unit: string) =>
  stats ? `${Math.round(stats.avg * 10) / 10} ${unit}` : "—";

/** Live status of the API, database, SFU and Asterisk; refreshed every 10 s while the page is open. */
export function HealthPanel({ token }: { token: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/operations/health`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      })
        .then((response) =>
          response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
        )
        .then(
          (data: Health) => alive && (setHealth(data), setFailed(false)),
          () => alive && setFailed(true),
        );
    void load();
    const timer = window.setInterval(
      () => document.visibilityState === "visible" && void load(),
      REFRESH_MS,
    );
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [token]);

  if (!health)
    return (
      <p className={MUTED} role="status">
        {failed ? "Không tải được trạng thái máy chủ." : "Đang kiểm tra…"}
      </p>
    );
  const { api, db, media, jobs, callCenter } = health;
  const loss = media.qos.packetLoss?.avg ?? 0;
  const cards = [
    {
      title: "Máy chủ API",
      icon: "monitor" as IconName,
      ok: !failed && api.errors * 100 <= Math.max(1, api.requests),
      rows: [
        ["Hoạt động", uptime(api.uptimeSeconds)],
        ["Phản hồi TB", `${api.avgResponseMs} ms`],
        ["Lỗi 5xx", `${api.errors} / ${api.requests}`],
        ["Kết nối realtime", api.sockets],
        ["Bộ nhớ", `${api.memoryMb} MB`],
      ],
    },
    {
      title: "Cơ sở dữ liệu",
      icon: "folder" as IconName,
      ok: db.latencyMs < 100 && db.waiting === 0,
      rows: [
        ["Độ trễ truy vấn", `${db.latencyMs} ms`],
        ["Kết nối", `${db.total - db.idle} bận / ${db.total}`],
        ["Đang chờ", db.waiting],
      ],
    },
    {
      title: "Họp video (SFU)",
      icon: "video" as IconName,
      ok: (media.workers > 0 || media.rooms === 0) && loss < 5, // workers start with the first room
      rows: [
        ["Worker", media.workers],
        ["Phòng / người", `${media.rooms} / ${media.peers}`],
        ["RTT TB", avg(media.qos.rtt, "ms")],
        ["Jitter TB", avg(media.qos.jitter, "ms")],
        ["Mất gói TB", avg(media.qos.packetLoss, "%")],
      ],
    },
    {
      title: "Tổng đài",
      icon: "phone" as IconName,
      ok: callCenter.asterisk !== false && callCenter.waiting < 5,
      rows: [
        [
          "Asterisk",
          callCenter.asterisk === null
            ? "Chưa cấu hình"
            : callCenter.asterisk
              ? "Đã kết nối"
              : "Mất kết nối",
        ],
        ["Đang gọi / chờ", `${callCenter.activeCalls} / ${callCenter.waiting}`],
        [
          "Tổng đài viên",
          Object.entries(callCenter.agents)
            .map(([state, count]) => `${AGENT_STATE[state as AgentState] ?? state} ${count}`)
            .join(", ") || "—",
        ],
        ["24 giờ qua", `${callCenter.last24h.answered}/${callCenter.last24h.total} cuộc được nghe`],
        ["Chờ TB", `${callCenter.last24h.avgWaitSeconds} giây`],
      ],
    },
    {
      title: "Xử lý nền",
      icon: "settings" as IconName,
      ok: jobs.failed === 0,
      rows: [
        ["Đang chờ", jobs.queued],
        ["Đang chạy", jobs.running],
        ["Lỗi", jobs.failed],
      ],
    },
  ];
  const warn = cards.filter((card) => !card.ok);
  return (
    <section className="grid min-w-0 gap-3.5" aria-label="Sức khỏe hệ thống">
      <div className={cn(CARD, "flex flex-wrap items-center gap-3.5 p-4")}>
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full",
            warn.length || failed ? TINT.amber : TINT.green,
          )}
        >
          <Icon name={warn.length || failed ? "warning" : "check"} size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold">
            {failed
              ? "Mất kết nối, đang thử lại…"
              : warn.length
                ? "Có thành phần cần chú ý"
                : "Hệ thống đang hoạt động ổn định"}
          </h2>
          <p className={MUTED}>
            {cards.length - warn.length} / {cards.length} thành phần ổn định
            {warn.length > 0 && ` · Cần chú ý: ${warn.map((card) => card.title).join(", ")}`}
          </p>
        </div>
        <p className="ml-auto text-right text-xs text-muted-foreground max-md:ml-0 max-md:text-left">
          Cập nhật {new Date(health.checkedAt).toLocaleTimeString("vi-VN")}
          <br />
          Tự làm mới mỗi {REFRESH_MS / 1000} giây
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {cards.map((card) => (
          <article
            key={card.title}
            className={cn(CARD, "overflow-hidden", !card.ok && "border-[var(--tint-amber-fg)]")}
          >
            <header className="flex items-center gap-2.5 border-b px-3.5 py-3">
              <span className="grid size-[30px] place-items-center rounded-lg bg-secondary text-muted-foreground">
                <Icon name={card.icon} size={16} />
              </span>
              <h3 className="flex-1 text-sm font-semibold">{card.title}</h3>
              <span className={cn(CHIP, card.ok ? TINT.green : TINT.amber)}>
                {card.ok ? "Ổn định" : "Cần chú ý"}
              </span>
            </header>
            <dl className="grid gap-1.5 px-3.5 pt-2 pb-3 text-[13px]">
              {card.rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
