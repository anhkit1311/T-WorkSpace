import type { CcQaCriterion, CcQaReview } from "@doan/shared";
import { CallCenterAccess } from "../domain/access.js";
import { needsCoaching, scoreReview } from "../domain/qa.js";
import type { CallCenterRepository } from "../repository/callcenter-repository.js";
import type { QaRepository } from "../repository/qa-repository.js";
import { conflict, forbidden, id, integer, invalid, notFound, optionalId, text, type Body } from "./input.js";

/** V7 / E2: supervisors score calls against the department's sheet; low scores assign coaching. */
export class CallCenterQaService {
  constructor(
    private readonly repo: CallCenterRepository,
    private readonly qa: QaRepository,
  ) {}

  private async access(userId: string) {
    const { isAdmin, roles } = await this.repo.access(userId);
    return new CallCenterAccess(userId, isAdmin, roles);
  }

  async criteria(userId: string, departmentId: string): Promise<CcQaCriterion[]> {
    if (!(await this.access(userId)).belongsTo(id(departmentId))) throw forbidden();
    return this.qa.criteria(departmentId);
  }

  async saveCriteria(userId: string, departmentId: string, body: Body): Promise<CcQaCriterion[]> {
    if (!(await this.access(userId)).supervises(id(departmentId))) throw forbidden();
    if (!Array.isArray(body.criteria) || !body.criteria.length || body.criteria.length > 20) throw invalid("Phiếu chấm cần từ 1 đến 20 tiêu chí.");
    const criteria = body.criteria.map((item: Body) => ({
      id: optionalId(item.id),
      label: text(item, "label", 160),
      weight: integer(item, "weight", 1, 10, 1),
    }));
    await this.qa.saveCriteria(departmentId, criteria);
    return this.qa.criteria(departmentId);
  }

  async review(userId: string, callId: string): Promise<CcQaReview | null> {
    const call = await this.qa.callForReview(id(callId));
    if (!call) throw notFound("Không tìm thấy cuộc gọi.");
    const access = await this.access(userId);
    if (call.agentId !== userId && !access.supervises(call.departmentId)) throw forbidden();
    return this.qa.review(call.id);
  }

  /** Supervisors see their departments' reviews; an agent sees their own. */
  async reviews(userId: string, params: URLSearchParams): Promise<CcQaReview[]> {
    const access = await this.access(userId);
    const departmentId = optionalId(params.get("departmentId"));
    if (departmentId && access.supervises(departmentId)) return this.qa.reviews({ departmentIds: [departmentId], agentId: optionalId(params.get("agentId")), limit: 200 });
    const supervised = access.supervisedDepartments();
    if (supervised === null || supervised.length)
      return this.qa.reviews({ departmentIds: supervised, agentId: optionalId(params.get("agentId")), limit: 200 });
    return this.qa.reviews({ departmentIds: null, agentId: userId, limit: 200 });
  }

  async saveReview(userId: string, callId: string, body: Body): Promise<CcQaReview> {
    const call = await this.qa.callForReview(id(callId));
    if (!call) throw notFound("Không tìm thấy cuộc gọi.");
    if (!call.departmentId || !call.agentId || !call.answeredAt) throw conflict("NOT_REVIEWABLE", "Chỉ chấm được cuộc gọi đã có tổng đài viên nghe máy.");
    if (!call.endedAt) throw conflict("CALL_IN_PROGRESS", "Cuộc gọi chưa kết thúc.");
    const access = await this.access(userId);
    if (!access.supervises(call.departmentId)) throw forbidden();
    if (call.agentId === userId) throw forbidden();
    const department = (await this.repo.departments([call.departmentId]))[0];
    const scored = scoreReview(await this.qa.criteria(call.departmentId), body.scores);
    if (typeof scored === "string") throw invalid(scored);
    const comment = body.comment === undefined ? "" : text(body, "comment", 2000, { optional: true });
    const previous = await this.qa.review(call.id);
    await this.qa.saveReview({
      callId: call.id,
      departmentId: call.departmentId,
      agentId: call.agentId,
      reviewerId: userId,
      items: scored.items,
      percent: scored.percent,
      comment,
      coachingCourseId: needsCoaching(scored.percent, department.qaThreshold, department.coachingCourseId, previous?.coachingAssigned ?? false)
        ? department.coachingCourseId
        : null,
    });
    return (await this.qa.review(call.id))!;
  }
}
