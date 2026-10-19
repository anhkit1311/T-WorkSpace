import type { TicketPriority, TicketStatus } from "@doan/shared";
import type { CallCenterRepository } from "../repository/callcenter-repository.js";
import type { CallCenterAdminService } from "./admin-service.js";
import { forbidden, id, integer, invalid, notFound, oneOf, optionalId, text, type Body } from "./input.js";

const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function dueAt(value: unknown): Date | null {
  if (value === null || value === "") return null;
  const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw invalid("Hạn xử lý không hợp lệ.");
  return date;
}

/**
 * CC-8: follow-up tickets. Missed calls and voicemails open them automatically (see the ACD);
 * agents open them from a call or by hand, work them through statuses and log call-backs.
 * Every member of the ticket's department may work it.
 */
export class CallCenterTicketService {
  constructor(
    private readonly repo: CallCenterRepository,
    private readonly admin: CallCenterAdminService,
    private readonly recordings: () => ((name: string) => Promise<Response>) | null,
    /** NV-CC3: the requester is told about every status change. */
    private readonly onStatus: (ticketId: string, status: TicketStatus) => Promise<void> = async () => {},
  ) {}

  private async workable(userId: string, ticketId: string) {
    const ticket = await this.repo.ticket(id(ticketId));
    if (!ticket) throw notFound("Không tìm thấy phiếu.");
    if (!(await this.admin.access(userId)).belongsTo(ticket.departmentId)) throw forbidden();
    return ticket;
  }

  private async assignee(departmentId: string, value: unknown) {
    const userId = optionalId(value);
    if (!userId) return { id: null, name: "Bỏ phân công" };
    const department = (await this.repo.departments([departmentId]))[0];
    const member = department?.members.find((item) => item.userId === userId);
    if (!member) throw invalid("Chỉ phân công cho thành viên của phòng ban.");
    return { id: userId, name: member.displayName };
  }

  async list(userId: string, params: URLSearchParams) {
    const access = await this.admin.access(userId);
    if (!access.isMember()) throw forbidden();
    const departmentId = params.get("departmentId");
    if (departmentId && !access.belongsTo(id(departmentId))) throw forbidden();
    const status = params.get("status");
    return this.repo.tickets({
      departmentIds: departmentId ? [departmentId] : access.memberDepartments(),
      status: status ? oneOf({ status }, "status", STATUSES) : null,
      assigneeId: params.get("mine") === "1" ? userId : null,
      limit: integer({ limit: Number(params.get("limit") ?? 100) }, "limit", 1, 300),
    });
  }

  async get(userId: string, ticketId: string) {
    const ticket = await this.workable(userId, ticketId);
    return { ticket, events: await this.repo.ticketEvents(ticket.id) };
  }

  async create(userId: string, body: Body) {
    const access = await this.admin.access(userId);
    const departmentId = id(body.departmentId);
    if (!access.belongsTo(departmentId)) throw forbidden();
    const callId = optionalId(body.callId);
    let callerNumber = body.callerNumber ? text(body, "callerNumber", 16, { pattern: /^\+?[0-9]{3,15}$/ }) : null;
    if (callId) {
      const call = await this.repo.call(callId);
      if (!call || !access.canReviewCall(call)) throw notFound("Không tìm thấy cuộc gọi.");
      callerNumber = call.caller_number;
    }
    const assignee = body.assigneeId ? await this.assignee(departmentId, body.assigneeId) : null;
    const ticketId = await this.repo.createTicket({
      departmentId,
      source: callId ? "call" : "manual",
      callId,
      callerNumber,
      subject: text(body, "subject", 200),
      description: text(body, "description", 8000, { optional: true }),
      priority: oneOf<TicketPriority>(body, "priority", PRIORITIES, "normal"),
      assigneeId: assignee?.id ?? null,
      dueAt: body.dueAt === undefined ? null : dueAt(body.dueAt),
      createdBy: userId,
    });
    return this.get(userId, ticketId);
  }

  async update(userId: string, ticketId: string, body: Body) {
    const ticket = await this.workable(userId, ticketId);
    const status = body.status === undefined ? undefined : oneOf<TicketStatus>(body, "status", STATUSES);
    await this.repo.updateTicket(ticket, userId, {
      status,
      priority: body.priority === undefined ? undefined : oneOf<TicketPriority>(body, "priority", PRIORITIES),
      assignee: body.assigneeId === undefined ? undefined : await this.assignee(ticket.departmentId, body.assigneeId),
      dueAt: body.dueAt === undefined ? undefined : dueAt(body.dueAt),
    });
    if (status && status !== ticket.status) await this.onStatus(ticket.id, status).catch(() => undefined);
    return this.get(userId, ticket.id);
  }

  /** A comment, or the record of a call-back attempt made from the agent's softphone. */
  async addEvent(userId: string, ticketId: string, body: Body) {
    const ticket = await this.workable(userId, ticketId);
    const kind = oneOf(body, "kind", ["comment", "callback"] as const);
    await this.repo.addTicketEvent(ticket.id, userId, kind, text(body, "body", 4000, { optional: kind === "callback" }));
    return this.get(userId, ticket.id);
  }

  async voicemailRecording(userId: string, voicemailId: string): Promise<Response> {
    const voicemail = await this.repo.voicemail(id(voicemailId));
    if (!voicemail) throw notFound("Không tìm thấy thư thoại.");
    if (!voicemail.department_id || !(await this.admin.access(userId)).belongsTo(voicemail.department_id)) throw forbidden();
    const fetchRecording = this.recordings();
    if (!fetchRecording) throw notFound("Tổng đài chưa kết nối.");
    const audio = await fetchRecording(voicemail.recording_key).catch(() => {
      throw notFound("Không tải được thư thoại từ tổng đài.");
    });
    await this.repo.markVoicemailListened(voicemail.id, userId);
    return audio;
  }
}
