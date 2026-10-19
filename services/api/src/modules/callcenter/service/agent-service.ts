import type { AgentState, CcAgentProfile, CcCallerProfile, CcSipAccount, CcTransferDirectory, MonitorMode } from "@doan/shared";
import { HttpError } from "../../../shared/http/http-error.js";
import { addWorkspaceMember, createWorkspace, getWorkspaceChannels } from "../../workspaces/service.js";
import type { CallCenterRepository } from "../repository/callcenter-repository.js";
import type { AcdService } from "./acd-service.js";
import type { CallCenterAdminService } from "./admin-service.js";
import { bool, forbidden, id, integer, invalid, notFound, oneOf, optionalId, text, type Body } from "./input.js";

/** NV-CC2: why an agent pauses. */
export const PAUSE_REASONS = ["Ăn trưa", "Họp", "Khác"] as const;

const offline = () => new HttpError(503, "CALL_CENTER_OFFLINE", "Tổng đài chưa kết nối, vui lòng thử lại sau.");

/** CC-6 / CC-7: the agent's desk (state, softphone account, wrap-up) and call history. */
export class CallCenterAgentService {
  constructor(
    private readonly repo: CallCenterRepository,
    private readonly admin: CallCenterAdminService,
    private readonly acd: () => AcdService | null,
    private readonly recordings: () => ((name: string) => Promise<Response>) | null,
    private readonly sipWsUrl: string,
    private readonly invite: (userId: string, data: { workspaceId: string; roomId: string; from: string }) => void = () => {},
  ) {}

  async me(userId: string): Promise<CcAgentProfile> {
    const { isAdmin, roles } = await this.repo.access(userId);
    const departments = roles.size ? await this.repo.departments([...roles.keys()]) : [];
    const [extension, training] = await Promise.all([this.repo.ownExtension(userId), this.repo.pendingTraining(userId)]);
    const live = this.acd()?.agentView(userId) ?? null;
    return {
      userId,
      isAdmin,
      departments: departments.flatMap((department) =>
        [...roles.get(department.id)!].map((role) => ({ id: department.id, name: department.name, role })),
      ),
      state: live?.state ?? "offline",
      stateReason: live?.reason ?? "",
      stateSince: live?.since ?? null,
      extension: extension ? { number: extension.number, transport: extension.transport } : null,
      currentCall: live?.offer ?? null,
      training,
    };
  }

  async setState(userId: string, body: Body) {
    const acd = this.acd();
    if (!acd) throw offline();
    const state = oneOf<AgentState>(body, "state", ["ready", "not_ready", "offline"]);
    if (state === "ready") {
      const pending = await this.repo.pendingTraining(userId);
      if (pending.length)
        throw new HttpError(409, "TRAINING_REQUIRED", `Hoàn thành khóa ${pending.map((course) => `${course.code} — ${course.title}`).join(", ")} trước khi nhận cuộc gọi.`);
    }
    const reason = state === "not_ready" && body.reason !== undefined ? oneOf(body, "reason", PAUSE_REASONS) : "";
    await acd.requestState(userId, state, reason);
    return this.me(userId);
  }

  /** Puts the hotline caller on hold (music) or takes them back. */
  async hold(userId: string, body: Body) {
    const acd = this.acd();
    if (!acd) throw offline();
    await acd.hold(userId, bool(body, "on", true));
    return this.me(userId);
  }

  /** CC-10: to a department (blind, through its queue) or to an extension (blind or attended). */
  async transfer(userId: string, body: Body) {
    const acd = this.acd();
    if (!acd) throw offline();
    const departmentId = optionalId(body.departmentId);
    const extension = body.extension === undefined ? null : text(body, "extension", 6, { pattern: /^[0-9]{3,6}$/ });
    if (!departmentId === !extension) throw invalid("Chọn một phòng ban hoặc một máy lẻ để chuyển.");
    await acd.transfer(userId, departmentId ? { departmentId } : { extension: extension! }, bool(body, "attended", false));
    return this.me(userId);
  }

  async finishTransfer(userId: string, complete: boolean) {
    const acd = this.acd();
    if (!acd) throw offline();
    await (complete ? acd.completeTransfer(userId) : acd.cancelTransfer(userId));
    return this.me(userId);
  }

  /** Transfer targets: active departments and every active extension with its agent's live state. */
  async directory(userId: string): Promise<CcTransferDirectory> {
    if (!(await this.admin.access(userId)).isMember()) throw forbidden();
    const [departments, extensions] = await Promise.all([this.repo.departments(null), this.repo.extensions(null)]);
    const names = new Map(departments.map((department) => [department.id, department.name]));
    const acd = this.acd();
    return {
      departments: departments.filter((department) => department.active).map(({ id, name }) => ({ id, name })),
      extensions: extensions
        .filter((extension) => extension.active && extension.userId !== userId)
        .map((extension) => ({
          number: extension.number,
          name: extension.userName || extension.label || extension.number,
          departmentName: names.get(extension.departmentId) ?? "",
          state: extension.userId ? (acd?.agentView(extension.userId)?.state ?? null) : null,
          // Lets "Tin nhắn" offer a call to the person you are chatting with.
          userId: extension.userId ?? null,
        })),
    };
  }

  /** CC-11: the supervisor's own extension rings, then joins the call as listener, coach or third party. */
  async monitor(userId: string, callKey: string, body: Body) {
    const acd = this.acd();
    if (!acd) throw offline();
    const departmentId = acd.departmentOfCall(id(callKey));
    if (!departmentId) throw notFound("Cuộc gọi đã kết thúc.");
    if (!(await this.admin.access(userId)).supervises(departmentId)) throw forbidden();
    const extension = await this.repo.ownExtension(userId);
    if (!extension) throw new HttpError(409, "NO_EXTENSION", "Bạn cần một máy lẻ để giám sát cuộc gọi.");
    await acd.monitor(userId, extension.number, callKey, oneOf<MonitorMode>(body, "mode", ["listen", "whisper", "barge"]));
    return { ok: true };
  }

  /** The agent's own SIP account for the browser softphone. Only ever sent to its owner. */
  async sipAccount(userId: string): Promise<CcSipAccount> {
    const extension = await this.repo.ownExtension(userId);
    if (!extension) throw notFound("Bạn chưa được cấp máy lẻ.");
    return {
      number: extension.number,
      secret: extension.sip_secret,
      wsUrl: this.sipWsUrl,
      domain: new URL(this.sipWsUrl).hostname,
    };
  }

  async live(userId: string, departmentId: string) {
    const access = await this.admin.access(userId);
    if (!access.supervises(id(departmentId))) throw forbidden();
    const acd = this.acd();
    if (!acd) throw offline();
    return acd.snapshot(departmentId);
  }

  async calls(userId: string, params: URLSearchParams) {
    const access = await this.admin.access(userId);
    if (!access.isMember()) throw forbidden();
    return this.repo.calls({
      departmentIds: access.supervisedDepartments(),
      agentUserId: userId,
      limit: integer({ limit: Number(params.get("limit") ?? 50) }, "limit", 1, 200),
    });
  }

  private async reviewable(userId: string, callId: string) {
    const call = await this.repo.call(id(callId));
    if (!call) throw notFound("Không tìm thấy cuộc gọi.");
    if (!(await this.admin.access(userId)).canReviewCall(call)) throw forbidden();
    return call;
  }

  async wrapUp(userId: string, callId: string, body: Body) {
    const call = await this.reviewable(userId, callId);
    const dispositionId = optionalId(body.dispositionId);
    if (dispositionId) {
      const disposition = await this.repo.disposition(dispositionId);
      if (!disposition || (disposition.department_id && disposition.department_id !== call.department_id))
        throw notFound("Kết quả cuộc gọi không áp dụng cho phòng ban này.");
    }
    const notes = body.notes === undefined ? "" : String(body.notes);
    if (notes.length > 4000) throw new HttpError(400, "INVALID_INPUT", "Ghi chú tối đa 4000 ký tự.");
    await this.repo.saveWrapUp(call.id, dispositionId, notes);
    return { ok: true };
  }

  /**
   * M2: the agent who took the call moves it to video. The caller must have an account (identified
   * by phone); a private workspace per call holds the room, so nothing else of the agent is shared.
   */
  async videoRoom(userId: string, callId: string) {
    const call = await this.repo.call(id(callId));
    if (!call) throw notFound("Không tìm thấy cuộc gọi.");
    if (call.agent_user_id !== userId) throw forbidden();
    if (!call.caller_user_id)
      throw new HttpError(409, "CALLER_UNKNOWN", "Người gọi chưa có tài khoản trong hệ thống nên chưa thể mời vào họp video.");
    let workspaceId = call.video_workspace_id;
    if (!workspaceId) {
      workspaceId = (await createWorkspace(userId, `Hỗ trợ video · ${call.caller_name ?? call.caller_number}`.slice(0, 80))).id;
      await addWorkspaceMember(workspaceId, call.caller_user_id);
      await this.repo.setCallVideo(call.id, workspaceId);
    }
    const roomId = (await getWorkspaceChannels(userId, workspaceId)).find((channel) => channel.type === "video")?.id;
    if (!roomId) throw new HttpError(500, "NO_ROOM", "Không tạo được phòng họp.");
    const me = await this.me(userId);
    this.invite(call.caller_user_id, { workspaceId, roomId, from: me.departments[0]?.name ?? "Tổng đài TDTU" });
    return { workspaceId, roomId };
  }

  /** NV-CC1: the profile of whoever is on the agent's line, and nobody else's. */
  async callerProfile(userId: string): Promise<CcCallerProfile> {
    const offer = this.acd()?.agentView(userId)?.offer;
    if (!offer) throw new HttpError(404, "NO_ACTIVE_CALL", "Bạn không có cuộc gọi nào.");
    return this.repo.callerProfile(offer.caller.number, offer.caller.userId);
  }

  /** E2: only a supervisor of the department may turn a call recording into training material. */
  async trainingRecording(userId: string, callId: string): Promise<Response> {
    const call = await this.repo.call(id(callId));
    if (!call) throw notFound("Không tìm thấy cuộc gọi.");
    if (!(await this.admin.access(userId)).supervises(call.department_id)) throw forbidden();
    return this.recording(userId, call.id);
  }

  /** CC-7: playback is limited to the agent who took the call and the department's supervisors. */
  async recording(userId: string, callId: string): Promise<Response> {
    const call = await this.reviewable(userId, callId);
    if (!call.recording_key) throw notFound("Cuộc gọi không có ghi âm.");
    const fetchRecording = this.recordings();
    if (!fetchRecording) throw offline();
    return fetchRecording(call.recording_key).catch(() => {
      throw notFound("Không tải được ghi âm từ tổng đài.");
    });
  }
}
