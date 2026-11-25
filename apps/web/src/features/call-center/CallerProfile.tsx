import { useEffect, useState } from "react";
import type { CcCallerProfile } from "@doan/shared";
import { Badge } from "../../shared/ui/Primitives";
import { TICKET_STATUS } from "./TicketsPanel";
import { MUTED } from "./ui";

const SECTION =
  "grid gap-1 [&_h3]:text-[11.5px] [&_h3]:font-semibold [&_h3]:tracking-[.05em] [&_h3]:text-muted-foreground [&_h3]:uppercase [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-2 [&_li]:py-1 [&_li]:text-[13px]";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const when = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

/** NV-CC1: who is calling — student code, faculty, tickets and courses; for outside numbers, their call history. */
export function CallerProfile({
  api,
  callId,
  outcomeLabel,
}: {
  api: Api;
  callId: string;
  outcomeLabel: Record<string, string>;
}) {
  const [profile, setProfile] = useState<CcCallerProfile | null>(null);
  useEffect(() => {
    let live = true;
    setProfile(null);
    api<CcCallerProfile>("me/caller").then(
      (data) => live && setProfile(data),
      () => undefined,
    );
    return () => void (live = false);
  }, [api, callId]);

  if (!profile) return null;
  const empty =
    !profile.student && !profile.tickets.length && !profile.courses.length && !profile.calls.length;
  if (empty) return <p className={`tw ${MUTED}`}>Lần đầu liên hệ — chưa có lịch sử.</p>;
  return (
    <div className="tw grid gap-2.5 text-sm" aria-label="Hồ sơ người gọi">
      {profile.student && (
        <p className="flex flex-wrap items-baseline gap-2 rounded-lg bg-secondary px-2.5 py-2">
          <strong className="font-semibold">MSSV {profile.student.code}</strong>
        </p>
      )}
      {profile.tickets.length > 0 && (
        <section className={SECTION}>
          <h3>Phiếu hỗ trợ</h3>
          <ul>
            {profile.tickets.map((ticket) => (
              <li key={ticket.id}>
                <span>
                  {ticket.code} · {ticket.subject}
                </span>
                <Badge
                  tone={
                    ticket.status === "resolved" || ticket.status === "closed" ? "green" : "amber"
                  }
                >
                  {TICKET_STATUS[ticket.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      {profile.courses.length > 0 && (
        <section className={SECTION}>
          <h3>Khóa học</h3>
          <ul>
            {profile.courses.map((course) => (
              <li key={course.code}>
                <span>
                  {course.code} · {course.title}
                </span>
                <Badge tone={course.completed ? "green" : "blue"}>
                  {course.completed ? "Hoàn thành" : "Đang học"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      {profile.calls.length > 0 && (
        <section className={SECTION}>
          <h3>Cuộc gọi trước</h3>
          <ul>
            {profile.calls.map((call) => (
              <li key={call.startedAt}>
                <span>
                  {when(call.startedAt)} · {call.departmentName ?? "—"}
                  {call.agentName ? ` · ${call.agentName}` : ""}
                  {call.notes && <em className="text-muted-foreground"> — {call.notes}</em>}
                </span>
                {call.outcome && (
                  <Badge tone={call.outcome === "answered" ? "green" : "amber"}>
                    {outcomeLabel[call.outcome]}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
