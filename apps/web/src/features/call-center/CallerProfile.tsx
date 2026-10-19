import { useEffect, useState } from "react";
import type { CcCallerProfile } from "@doan/shared";
import { Badge } from "../../shared/ui/Primitives";
import { TICKET_STATUS } from "./TicketsPanel";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const when = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

/** NV-CC1: who is calling — student code, faculty, tickets and courses; for outside numbers, their call history. */
export function CallerProfile({ api, callId, outcomeLabel }: { api: Api; callId: string; outcomeLabel: Record<string, string> }) {
  const [profile, setProfile] = useState<CcCallerProfile | null>(null);
  useEffect(() => {
    let live = true;
    setProfile(null);
    api<CcCallerProfile>("me/caller").then((data) => live && setProfile(data), () => undefined);
    return () => void (live = false);
  }, [api, callId]);

  if (!profile) return null;
  const empty = !profile.student && !profile.tickets.length && !profile.courses.length && !profile.calls.length;
  if (empty) return <p className="desk-muted">Lần đầu liên hệ — chưa có lịch sử.</p>;
  return (
    <div className="desk-profile" aria-label="Hồ sơ người gọi">
      {profile.student && (
        <p className="desk-profile__student">
          <strong>MSSV {profile.student.code}</strong>
          <span>{[profile.student.className, profile.student.faculty].filter(Boolean).join(" · ")}</span>
        </p>
      )}
      {profile.tickets.length > 0 && (
        <section>
          <h3>Phiếu hỗ trợ</h3>
          <ul>
            {profile.tickets.map((ticket) => (
              <li key={ticket.id}>
                <span>{ticket.code} · {ticket.subject}</span>
                <Badge tone={ticket.status === "resolved" || ticket.status === "closed" ? "green" : "amber"}>{TICKET_STATUS[ticket.status]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      {profile.courses.length > 0 && (
        <section>
          <h3>Khóa học</h3>
          <ul>
            {profile.courses.map((course) => (
              <li key={course.code}>
                <span>{course.code} · {course.title}</span>
                <Badge tone={course.completed ? "green" : "blue"}>{course.completed ? "Hoàn thành" : "Đang học"}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      {profile.calls.length > 0 && (
        <section>
          <h3>Cuộc gọi trước</h3>
          <ul>
            {profile.calls.map((call) => (
              <li key={call.startedAt}>
                <span>
                  {when(call.startedAt)} · {call.departmentName ?? "—"}
                  {call.agentName ? ` · ${call.agentName}` : ""}
                  {call.notes && <em> — {call.notes}</em>}
                </span>
                {call.outcome && <Badge tone={call.outcome === "answered" ? "green" : "amber"}>{outcomeLabel[call.outcome]}</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
