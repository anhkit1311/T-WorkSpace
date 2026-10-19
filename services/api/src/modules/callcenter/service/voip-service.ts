import { randomBytes } from "node:crypto";
import type { CcContactDepartment, CcPersonalVoicemail, CcTicket, CcTicketEvent, CcWebCallAccount, TicketStatus } from "@doan/shared";
import { HttpError } from "../../../shared/http/http-error.js";
import { isOpen } from "../domain/business-hours.js";
import type { Pbx } from "../domain/ports.js";
import type { CallCenterRepository } from "../repository/callcenter-repository.js";
import type { VoipRepository } from "../repository/voip-repository.js";
import { forbidden, id, integer, notFound, text, type Body } from "./input.js";

const WEB_CALL_MINUTES = 15;
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Mới",
  in_progress: "Đang xử lý",
  waiting: "Chờ phản hồi",
  resolved: "Đã giải quyết",
  closed: "Đóng",
};

/** Delivers a notice to one user (socket now, e-mail when configured). */
export type UserNotice = (userId: string, event: string, data: Record<string, unknown>, email?: { subject: string; text: string }) => void;

/**
 * What every signed-in user does with the call center, agent or not: their extension's voicemail
 * (NV-CC5), calling a department from the browser ("Liên hệ phòng ban", LT1) and following the
 * tickets they opened (NV-CC3).
 */
export class CallCenterVoipService {
  constructor(
    private readonly repo: VoipRepository,
    private readonly cc: CallCenterRepository,
    private readonly pbx: () => Pbx | null,
    private readonly recordings: () => ((name: string) => Promise<Response>) | null,
    private readonly sipWsUrl: string,
    private readonly notice: UserNotice,
  ) {}

  // ---- personal voicemail ------------------------------------------------------------------

  voicemails(userId: string): Promise<CcPersonalVoicemail[]> {
    return this.repo.personalVoicemails(userId);
  }

  private async ownVoicemail(userId: string, voicemailId: string) {
    const voicemail = await this.repo.personalVoicemail(id(voicemailId));
    if (!voicemail) return null;
    if (voicemail.owner_id !== userId) throw forbidden();
    return voicemail;
  }

  /** The owner's own message; null when it is a department voicemail (the ticket service decides). */
  async voicemailRecording(userId: string, voicemailId: string): Promise<Response | null> {
    const voicemail = await this.ownVoicemail(userId, voicemailId);
    if (!voicemail) return null;
    const fetchRecording = this.recordings();
    if (!fetchRecording || !voicemail.recording_key) throw notFound("Không tải được thư thoại.");
    const audio = await fetchRecording(voicemail.recording_key).catch(() => {
      throw notFound("Không tải được thư thoại từ tổng đài.");
    });
    await this.cc.markVoicemailListened(voicemail.id, userId);
    return audio;
  }

  async deleteVoicemail(userId: string, voicemailId: string) {
    const voicemail = await this.ownVoicemail(userId, voicemailId);
    if (!voicemail) throw notFound("Không tìm thấy thư thoại.");
    await this.repo.deleteVoicemail(voicemail.id);
    if (voicemail.recording_key) await this.pbx()?.deleteRecording(voicemail.recording_key).catch(() => undefined);
    return { ok: true };
  }

  // ---- "Liên hệ phòng ban" -------------------------------------------------------------------

  async contacts(): Promise<CcContactDepartment[]> {
    const now = new Date();
    return (await this.repo.contactDepartments()).map(({ hours, ...department }) => ({
      ...department,
      open: isOpen(hours, now),
    }));
  }

  /**
   * A temporary WebRTC endpoint that can dial one thing: this department's queue. It expires after
   * 15 minutes and is removed when the call ends. Outside business hours the caller reaches the
   * department's voicemail, as from the hotline (BR-01).
   */
  async startWebCall(userId: string, body: Body): Promise<CcWebCallAccount> {
    const pbx = this.pbx();
    if (!pbx) throw new HttpError(503, "CALL_CENTER_OFFLINE", "Tổng đài chưa kết nối, vui lòng thử lại sau.");
    const departmentId = id(body.departmentId);
    const department = (await this.contacts()).find((item) => item.id === departmentId);
    if (!department) throw notFound("Phòng ban không nhận cuộc gọi.");
    const context = text(body, "context", 500, { optional: true });
    const endpoint = `web${randomBytes(6).toString("hex")}`;
    const secret = randomBytes(18).toString("base64url");
    const callerName = (await this.repo.displayName(userId)) ?? "Người gọi";
    await pbx.pushExtension({ number: endpoint, secret, transport: "webrtc", callerName, context: "from-web" });
    const expiresAt = new Date(Date.now() + WEB_CALL_MINUTES * 60_000);
    await this.repo.createWebCall({ endpoint, userId, departmentId, context, expiresAt });
    return {
      number: endpoint,
      secret,
      wsUrl: this.sipWsUrl,
      domain: new URL(this.sipWsUrl).hostname,
      target: "hotline",
      departmentName: department.name,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async endWebCall(userId: string, endpoint: string) {
    const session = await this.repo.webCall(text({ endpoint }, "endpoint", 40, { pattern: /^web[0-9a-f]{12}$/ }));
    if (session && session.user_id !== userId) throw forbidden();
    for (const name of await this.repo.takeWebCalls([endpoint])) await this.pbx()?.removeExtension(name).catch(() => undefined);
    return { ok: true };
  }

  /** Removes expired browser endpoints from Asterisk (sessions the browser never closed). */
  async sweepWebCalls() {
    const pbx = this.pbx();
    for (const name of await this.repo.takeWebCalls()) await pbx?.removeExtension(name).catch(() => undefined);
  }

  // ---- the requester's tickets ---------------------------------------------------------------

  myTickets(userId: string): Promise<CcTicket[]> {
    return this.repo.myTickets(userId);
  }

  private async ownTicket(userId: string, ticketId: string) {
    const owner = await this.repo.ticketOwner(id(ticketId));
    if (!owner) throw notFound("Không tìm thấy phiếu.");
    if (owner.caller_user_id !== userId) throw forbidden();
    return owner;
  }

  async myTicket(userId: string, ticketId: string): Promise<{ ticket: CcTicket; events: CcTicketEvent[] }> {
    const owner = await this.ownTicket(userId, ticketId);
    const ticket = (await this.cc.ticket(owner.id))!;
    // The requester sees the conversation and the status history, not internal call-back notes.
    const events = (await this.cc.ticketEvents(owner.id)).filter((event) => event.kind === "comment" || event.kind === "status");
    return { ticket: { ...ticket, satisfaction: owner.satisfaction, callerNumber: null }, events };
  }

  async createMyTicket(userId: string, body: Body) {
    const departmentId = id(body.departmentId);
    if (!(await this.contacts()).some((item) => item.id === departmentId)) throw notFound("Phòng ban không nhận yêu cầu.");
    const ticketId = await this.repo.createOwnTicket({
      userId,
      departmentId,
      subject: text(body, "subject", 200),
      description: text(body, "description", 8000, { optional: true }),
    });
    return this.myTicket(userId, ticketId);
  }

  async reply(userId: string, ticketId: string, body: Body) {
    const owner = await this.ownTicket(userId, ticketId);
    if (owner.status === "closed") throw new HttpError(409, "TICKET_CLOSED", "Phiếu đã đóng, hãy tạo phiếu mới.");
    await this.repo.reply(owner.id, userId, text(body, "body", 4000));
    return this.myTicket(userId, owner.id);
  }

  /** NV-CC3: 1–5 stars once the department resolved the request. */
  async rate(userId: string, ticketId: string, body: Body) {
    const owner = await this.ownTicket(userId, ticketId);
    if (owner.status !== "resolved" && owner.status !== "closed")
      throw new HttpError(409, "NOT_RESOLVED", "Chỉ đánh giá được phiếu đã giải quyết.");
    await this.repo.rate(owner.id, integer(body, "score", 1, 5));
    return this.myTicket(userId, owner.id);
  }

  /** Called after an agent changes a ticket's status: the requester hears about it. */
  async statusChanged(ticketId: string, status: TicketStatus) {
    const owner = await this.repo.ticketOwner(ticketId);
    if (!owner?.caller_user_id) return;
    const ticket = await this.cc.ticket(ticketId);
    if (!ticket) return;
    const line = `Phiếu ${ticket.code} "${ticket.subject}" chuyển sang trạng thái: ${STATUS_LABEL[status]}.`;
    this.notice(
      owner.caller_user_id,
      "callcenter_ticket",
      { ticketId, code: ticket.code, status, message: line },
      { subject: `[TDTU] ${ticket.code}: ${STATUS_LABEL[status]}`, text: `${line}\nXem và trả lời trong mục "Phiếu hỗ trợ của tôi".` },
    );
  }
}
