import type { PoolClient } from "pg";
import type { RouteContext } from "../../shared/http/context.js";
import { pool } from "../../infrastructure/database/db.js";
import { callCenterRoutes } from "./controller/routes.js";
import { systemClock, type CallCenterNotifier, type PbxEvent } from "./domain/ports.js";
import { AriPbx } from "./infrastructure/ari-pbx.js";
import { CallCenterRepository } from "./repository/callcenter-repository.js";
import { QaRepository } from "./repository/qa-repository.js";
import { AcdService } from "./service/acd-service.js";
import { CallCenterAdminService } from "./service/admin-service.js";
import { CallCenterAgentService } from "./service/agent-service.js";
import { CallCenterQaService } from "./service/qa-service.js";
import { CallCenterReportService } from "./service/report-service.js";
import { CallCenterTicketService } from "./service/ticket-service.js";
import { MeetingDialInService } from "./service/meeting-dialin-service.js";
import { PersonalVoicemailService } from "./service/voicemail-service.js";
import { CallTranscriptService } from "./service/call-transcript-service.js";
import { CallCenterVoipService, type UserNotice } from "./service/voip-service.js";
import { VoipRepository } from "./repository/voip-repository.js";
import { sendNoticeEmail } from "../../infrastructure/email/service.js";
import type { MeetingDialInPort } from "./domain/dial-in.js";
import { config } from "../../config/config.js";
import { PhoneLeg } from "../meetings/media/phone-bridge.js";
import { roomByDialCode } from "../meetings/dial-in.js";

// Composition root of the call center module: the only place that knows the concrete classes.

type Io = RouteContext["io"];
const log = (event: string, details: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: event.endsWith("failed") || event.endsWith("error") ? "warn" : "info", event, ...details }));

const repo = new CallCenterRepository();
const pbx = process.env.ASTERISK_ARI_PASSWORD
  ? new AriPbx({
      url: process.env.ASTERISK_ARI_URL ?? "http://localhost:8088",
      user: process.env.ASTERISK_ARI_USER ?? "nexo",
      password: process.env.ASTERISK_ARI_PASSWORD,
      app: process.env.ASTERISK_ARI_APP ?? "nexo",
    })
  : null;
let acd: AcdService | null = null;

const admin = new CallCenterAdminService(repo, () => pbx, () => acd?.refreshRoster() ?? Promise.resolve(), log);
const recordings = () => (pbx ? (name: string) => pbx.recording(name) : null);
let socketServer: Io | null = null;
const agents = new CallCenterAgentService(repo, admin, () => acd, recordings, process.env.VITE_SIP_WS_URL ?? "ws://localhost:8088/ws", (userId, data) =>
  socketServer?.to(`user:${userId}`).emit("meeting_invite", data),
);
const voipRepo = new VoipRepository();
const sipWsUrl = process.env.VITE_SIP_WS_URL ?? "ws://localhost:8088/ws";
/** Socket event to the user's room, plus an e-mail when one is given and mail is configured. */
const userNotice: UserNotice = (userId, event, data, email) => {
  // The event names are declared in ServerToClientEvents; the payload is built by the caller.
  (socketServer?.to(`user:${userId}`) as { emit(name: string, payload: unknown): boolean } | undefined)?.emit(event, data);
  if (!email) return;
  void voipRepo
    .ownerEmail(userId)
    .then((to) => (to ? sendNoticeEmail(to, email.subject, email.text) : false))
    .catch((error: Error) => log("cc_notice_email_failed", { message: error.message }));
};
const voip = new CallCenterVoipService(voipRepo, repo, () => pbx, recordings, sipWsUrl, userNotice);
const tickets = new CallCenterTicketService(repo, admin, recordings, (ticketId, status) => voip.statusChanged(ticketId, status));
const reports = new CallCenterReportService(repo, admin);

const qa = new CallCenterQaService(repo, new QaRepository());

/** E2 port for the e-learning module: a call recording a supervisor turns into a lesson. */
export const trainingRecording = (userId: string, callId: string) => agents.trainingRecording(userId, callId);

/** Q5: ACD gauges; null on instances that are not the ACD leader. */
export const callCenterMetrics = () => acd?.metrics() ?? null;

export const callcenterRoutes = callCenterRoutes(admin, agents, tickets, reports, qa, voip);

/** M1 adapter: the meetings module seen from the dial-in service. */
const meetingDialIn = (io: Io): MeetingDialInPort => ({
  room: roomByDialCode,
  open: ({ roomId, socketId, userId, displayName }) => new PhoneLeg(roomId, socketId, userId, displayName),
  mediaHost: (port) => `${config.phoneMediaHost}:${port}`,
  announce: (roomId, event, data) => io.to(`meeting:${roomId}`).emit(event, data as never),
});

/** Observer: agent events go to the agent's user room; live boards are coalesced per department. */
function socketNotifier(io: Io): CallCenterNotifier {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    timer = null;
    const departments = [...pending];
    pending.clear();
    for (const departmentId of departments) {
      const audience = await repo.liveAudience(departmentId).catch(() => []);
      if (audience.length) io.to(audience.map((userId) => `user:${userId}`)).emit("callcenter_live", { departmentId });
    }
  };
  return {
    agent: (userId, data) => io.to(`user:${userId}`).emit("callcenter_agent", data),
    live(departmentId) {
      pending.add(departmentId);
      timer ??= setTimeout(() => void flush(), 300);
    },
  };
}

/** BR-08 closes quiet resolved tickets, BR-17 drops recordings past retention, and expired browser endpoints go. */
async function runHousekeeping() {
  try {
    const closed = await voipRepo.closeQuietTickets(Number(process.env.TICKET_AUTO_CLOSE_DAYS ?? 3));
    if (closed) log("cc_tickets_auto_closed", { closed });
    const expired = await voipRepo.expireRecordings(Number(process.env.RECORDING_RETENTION_DAYS ?? 90));
    for (const name of expired) await pbx?.deleteRecording(name).catch(() => undefined);
    if (expired.length) log("cc_recordings_expired", { count: expired.length });
    await voip.sweepWebCalls();
  } catch (error) {
    log("cc_housekeeping_failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Starts the ACD when ARI is configured. In-memory queues need a single owner, so only the API
 * process holding the PostgreSQL advisory lock runs it; the others retry every 30 seconds.
 */
export function startCallCenter(io: Io): () => void {
  socketServer = io;
  // Housekeeping on whichever instance runs this: one statement each, safe to run twice.
  const housekeeping = setInterval(() => void runHousekeeping(), 10 * 60_000);
  housekeeping.unref();
  void runHousekeeping();
  if (!pbx) return () => clearInterval(housekeeping);
  let lock: PoolClient | null = null;
  let retry: NodeJS.Timeout | null = null;
  let stopHeartbeat = () => {};
  const attempt = async () => {
    const client = await pool.connect().catch(() => null);
    const locked = await client
      ?.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('nexo:callcenter-acd')) AS ok`)
      .then((result) => result.rows[0].ok)
      .catch(() => false);
    if (!client || !locked) {
      client?.release();
      retry = setTimeout(() => void attempt(), 30000);
      retry.unref();
      return;
    }
    lock = client;
    // Leader election: the lock lives as long as this connection. A heartbeat notices a dropped
    // connection, stops this ACD and competes again, so another instance can take over.
    const resign = (reason: string) => {
      if (lock !== client) return;
      log("acd_lock_lost", { message: reason });
      stopHeartbeat();
      pbx.stop();
      acd = null;
      lock = null;
      try {
        client.release(true);
      } catch {
        // already released by the pool after the error
      }
      retry = setTimeout(() => void attempt(), 5000);
      retry.unref();
    };
    const heartbeat = setInterval(
      () => void client.query("SELECT 1").catch((error: Error) => resign(error.message)),
      15000,
    );
    heartbeat.unref();
    client.on("error", (error) => resign(error.message));
    const connections = setInterval(() => void acd?.checkConnections(), 10_000);
    connections.unref();
    stopHeartbeat = () => (clearInterval(heartbeat), clearInterval(connections));
    acd = new AcdService(pbx, repo, socketNotifier(io), systemClock, log, async (endpoint) => {
      const session = await voipRepo.webCall(endpoint);
      return session && { userId: session.user_id, departmentId: session.department_id, context: session.context, displayName: session.display_name, phone: session.phone };
    });
    const dialIn = new MeetingDialInService(pbx, meetingDialIn(io), systemClock, log);
    const voicemail = new PersonalVoicemailService(pbx, voipRepo, async (message) => {
      const who = message.callerName ? `${message.callerName} (${message.callerNumber})` : message.callerNumber;
      userNotice(
        message.ownerId,
        "callcenter_voicemail",
        { voicemailId: message.voicemailId, from: who, durationSeconds: message.durationSeconds },
        {
          subject: `[TDTU] Thư thoại mới từ ${who}`,
          text: `Bạn có thư thoại ${message.durationSeconds} giây từ ${who} gửi tới máy lẻ ${message.extension}.
Nghe trong mục Tổng đài → Bàn làm việc → Hộp thư thoại.`,
        },
      );
    }, log);
    const transcripts = new CallTranscriptService(repo, (name) => pbx.recording(name), log);
    let chain: Promise<unknown> = Promise.resolve();
    pbx.listen((event: PbxEvent) => {
      void transcripts.handle(event);
      // Asterisk keeps extensions in memory only: refill them before the ACD reloads the roster.
      chain = chain
        .then(() => (event.type === "connected" ? admin.sync(null) : undefined))
        .catch((error: Error) => log("cc_extension_sync_failed", { message: error.message }))
        .then(() => dialIn.handle(event))
        .catch((error: Error) => (log("meeting_dialin_error", { message: error.message }), false))
        .then((handled) => handled || voicemail.handle(event))
        .catch((error: Error) => (log("cc_voicemail_error", { message: error.message }), false))
        .then((handled) => (handled ? undefined : acd?.handle(event)));
    }, log);
    log("acd_started");
  };
  void attempt();
  return () => {
    clearInterval(housekeeping);
    if (retry) clearTimeout(retry);
    stopHeartbeat();
    pbx.stop();
    lock?.release(true); // destroy the connection so the session-level lock goes with it
  };
}
