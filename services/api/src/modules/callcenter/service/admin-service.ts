import type { CcDepartment, CcExtension } from "@doan/shared";
import { CallCenterAccess } from "../domain/access.js";
import { generateSipSecret, inRange, nextExtensionNumber } from "../domain/extension.js";
import type { Pbx } from "../domain/ports.js";
import type { CallCenterRepository } from "../repository/callcenter-repository.js";
import { bool, conflict, forbidden, id, integer, invalid, notFound, oneOf, optionalId, text, type Body } from "./input.js";

const STRATEGIES = ["longest_idle", "round_robin"] as const;
const ROLES = ["agent", "supervisor"] as const;
const TRANSPORTS = ["webrtc", "sip"] as const;
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * NT-2 / CC-2: departments, members, extensions, hotlines and dispositions. The database is the
 * source of truth; Asterisk receives extensions through ARI and is re-filled on every reconnect.
 */
export class CallCenterAdminService {
  constructor(
    private readonly repo: CallCenterRepository,
    private readonly pbx: () => Pbx | null,
    private readonly rosterChanged: () => Promise<void>,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
  ) {}

  async access(userId: string): Promise<CallCenterAccess> {
    const { isAdmin, roles } = await this.repo.access(userId);
    return new CallCenterAccess(userId, isAdmin, roles);
  }

  private async admin(userId: string) {
    const access = await this.access(userId);
    if (!access.isAdmin) throw forbidden();
    return access;
  }

  // ---- departments -------------------------------------------------------------------------

  async listDepartments(userId: string): Promise<CcDepartment[]> {
    const access = await this.access(userId);
    if (!access.isMember()) throw forbidden();
    return this.repo.departments(access.memberDepartments());
  }

  private async department(departmentId: string) {
    const department = (await this.repo.departments([id(departmentId)]))[0];
    if (!department) throw notFound("Không tìm thấy phòng ban.");
    return department;
  }

  private settings(body: Body, current?: CcDepartment) {
    return {
      strategy: oneOf(body, "strategy", STRATEGIES, current?.strategy ?? "longest_idle"),
      ringSeconds: integer(body, "ringSeconds", 5, 120, current?.ringSeconds ?? 20),
      maxWaitSeconds: integer(body, "maxWaitSeconds", 30, 3600, current?.maxWaitSeconds ?? 300),
      wrapUpSeconds: integer(body, "wrapUpSeconds", 0, 600, current?.wrapUpSeconds ?? 15),
    };
  }

  async createDepartment(userId: string, body: Body) {
    await this.admin(userId);
    const extensionFrom = integer(body, "extensionFrom", 100, 999999);
    const extensionTo = integer(body, "extensionTo", extensionFrom, Math.min(999999, extensionFrom + 999));
    if (await this.repo.rangeOverlaps(extensionFrom, extensionTo, null))
      throw conflict("RANGE_OVERLAP", "Dải máy lẻ trùng với phòng ban khác.");
    const departmentId = await this.repo.createDepartment({
      code: text(body, "code", 20, { pattern: /^[A-Z0-9_-]{2,20}$/ }),
      name: text(body, "name", 160),
      extensionFrom,
      extensionTo,
      ...this.settings(body),
    });
    return this.department(departmentId);
  }

  async updateDepartment(userId: string, departmentId: string, body: Body) {
    await this.admin(userId);
    const current = await this.department(departmentId);
    const trainingCourseId = await this.course(body, "trainingCourseId", current.trainingCourseId);
    await this.repo.updateDepartment(current.id, {
      name: body.name === undefined ? current.name : text(body, "name", 160),
      active: bool(body, "active", current.active),
      ...this.settings(body, current),
      trainingCourseId,
      coachingCourseId: await this.course(body, "coachingCourseId", current.coachingCourseId),
      qaThreshold: integer(body, "qaThreshold", 0, 100, current.qaThreshold),
    });
    // LT-4: a newly required course is assigned to every agent of the department.
    if (trainingCourseId && trainingCourseId !== current.trainingCourseId) await this.repo.enrollAgents(current.id, trainingCourseId, userId);
    return this.department(current.id);
  }

  /** A required/coaching course must exist and be published; null clears it. */
  private async course(body: Body, field: string, current: string | null) {
    if (body[field] === undefined) return current;
    if (body[field] === null) return null;
    const courseId = id(body[field]);
    if (!(await this.repo.publishedCourses()).some((course) => course.id === courseId))
      throw invalid("Khóa học không tồn tại hoặc chưa xuất bản.");
    return courseId;
  }

  async trainingCourses(userId: string) {
    await this.admin(userId);
    return this.repo.publishedCourses();
  }

  async setHours(userId: string, departmentId: string, body: Body) {
    await this.admin(userId);
    const department = await this.department(departmentId);
    if (!Array.isArray(body.hours) || body.hours.length > 21) throw invalid("Giờ làm việc không hợp lệ.");
    const hours = body.hours.map((item: Body) => {
      const window = {
        weekday: integer(item, "weekday", 0, 6),
        opens: text(item, "opens", 5, { pattern: CLOCK }),
        closes: text(item, "closes", 5, { pattern: CLOCK }),
      };
      if (window.opens >= window.closes) throw invalid("Giờ mở cửa phải trước giờ đóng cửa.");
      return window;
    });
    await this.repo.replaceHours(department.id, hours);
    return this.department(department.id);
  }

  async addMember(userId: string, departmentId: string, body: Body) {
    await this.admin(userId);
    const department = await this.department(departmentId);
    const user = await this.repo.userByEmail(text(body, "email", 254));
    if (!user) throw notFound("Không tìm thấy người dùng với email này.");
    const role = oneOf(body, "role", ROLES);
    await this.repo.addMember(department.id, user.id, role, userId);
    if (role === "agent" && department.trainingCourseId) await this.repo.enrollAgents(department.id, department.trainingCourseId, userId, user.id);
    await this.rosterChanged();
    return this.department(department.id);
  }

  async removeMember(userId: string, departmentId: string, memberId: string, role: string) {
    await this.admin(userId);
    const department = await this.department(departmentId);
    if (!(await this.repo.removeMember(department.id, id(memberId), oneOf({ role }, "role", ROLES))))
      throw notFound("Thành viên không thuộc phòng ban.");
    await this.rosterChanged();
    return this.department(department.id);
  }

  // ---- extensions --------------------------------------------------------------------------

  async listExtensions(userId: string): Promise<CcExtension[]> {
    const access = await this.access(userId);
    if (!access.isAdmin && !access.supervisedDepartments()!.length) throw forbidden();
    return this.repo.extensions(access.supervisedDepartments());
  }

  private async assignee(department: CcDepartment, value: unknown) {
    const userId = optionalId(value);
    if (userId && !department.members.some((member) => member.userId === userId))
      throw invalid("Chỉ gán máy lẻ cho thành viên của phòng ban.");
    return userId;
  }

  /** Creates the extension and returns its SIP secret once; later reads never include it (CC-12). */
  async createExtension(userId: string, body: Body) {
    await this.admin(userId);
    const department = await this.department(String(body.departmentId));
    const range = { from: department.extensionFrom, to: department.extensionTo };
    const number =
      body.number === undefined || body.number === ""
        ? nextExtensionNumber(range, await this.repo.extensionNumbers())
        : text(body, "number", 6);
    if (!number) throw conflict("RANGE_FULL", "Dải máy lẻ của phòng ban đã hết số.");
    if (!inRange(number, range))
      throw invalid(`Số máy lẻ phải nằm trong dải ${department.extensionFrom}–${department.extensionTo}.`);
    const secret = generateSipSecret();
    const extensionId = await this.repo.createExtension({
      number,
      departmentId: department.id,
      userId: await this.assignee(department, body.userId),
      label: text(body, "label", 80, { optional: true }),
      transport: oneOf(body, "transport", TRANSPORTS, "webrtc"),
      secret,
    });
    await this.sync([extensionId]);
    await this.rosterChanged();
    return { extension: await this.extension(extensionId), secret };
  }

  async updateExtension(userId: string, extensionId: string, body: Body) {
    await this.admin(userId);
    const current = await this.repo.extension(id(extensionId));
    if (!current) throw notFound("Không tìm thấy máy lẻ.");
    const department = await this.department(current.department_id);
    const active = bool(body, "active", true);
    await this.repo.updateExtension(current.id, {
      userId: body.userId === undefined ? current.user_id : await this.assignee(department, body.userId),
      label: body.label === undefined ? undefined : text(body, "label", 80, { optional: true }),
      active,
    });
    if (active) await this.sync([current.id]);
    else await this.unpublish(current.number);
    await this.rosterChanged();
    return this.extension(current.id);
  }

  async resetSecret(userId: string, extensionId: string) {
    await this.admin(userId);
    const current = await this.repo.extension(id(extensionId));
    if (!current) throw notFound("Không tìm thấy máy lẻ.");
    const secret = generateSipSecret();
    await this.repo.setExtensionSecret(current.id, secret);
    await this.sync([current.id]);
    return { extension: await this.extension(current.id), secret };
  }

  async deleteExtension(userId: string, extensionId: string) {
    await this.admin(userId);
    const current = await this.repo.extension(id(extensionId));
    if (!current) throw notFound("Không tìm thấy máy lẻ.");
    await this.unpublish(current.number);
    await this.repo.deleteExtension(current.id);
    await this.rosterChanged();
    return { ok: true };
  }

  private async extension(extensionId: string) {
    return (await this.repo.extensions(null)).find((item) => item.id === extensionId)!;
  }

  /**
   * Pushes extensions to Asterisk. A PBX that is down only leaves `syncedAt` empty: the database
   * stays authoritative and everything is pushed again when ARI reconnects.
   */
  async sync(ids: string[] | null): Promise<void> {
    const pbx = this.pbx();
    if (!pbx) return;
    const synced: string[] = [];
    for (const row of await this.repo.extensionSecrets(ids)) {
      try {
        await pbx.pushExtension({
          number: row.number,
          secret: row.sip_secret,
          transport: row.transport,
          callerName: row.display_name ?? (row.label || row.number),
        });
        synced.push(row.id);
      } catch (error) {
        this.log("cc_extension_sync_failed", { number: row.number, message: (error as Error).message });
      }
    }
    if (synced.length) await this.repo.markSynced(synced);
  }

  private async unpublish(number: string) {
    await this.pbx()
      ?.removeExtension(number)
      .catch((error: Error) => this.log("cc_extension_remove_failed", { number, message: error.message }));
  }

  // ---- hotlines and dispositions -----------------------------------------------------------

  async listHotlines(userId: string) {
    await this.admin(userId);
    return this.repo.hotlines();
  }

  async saveHotline(userId: string, hotlineId: string | null, body: Body) {
    await this.admin(userId);
    if (!Array.isArray(body.options) || body.options.length > 10) throw invalid("Danh sách phím IVR không hợp lệ.");
    const options = body.options.map((option: Body) => ({
      digit: text(option, "digit", 1, { pattern: /^[0-9]$/ }),
      departmentId: id(option.departmentId),
    }));
    if (new Set(options.map((option) => option.digit)).size !== options.length) throw invalid("Mỗi phím chỉ dùng một lần.");
    if (hotlineId && !(await this.repo.hotlines()).some((hotline) => hotline.id === id(hotlineId)))
      throw notFound("Không tìm thấy đường dây nóng.");
    const savedId = await this.repo.saveHotline({
      id: hotlineId,
      number: text(body, "number", 16, { pattern: /^\+?[0-9]{3,15}$/ }),
      name: text(body, "name", 120),
      fallbackDepartmentId: optionalId(body.fallbackDepartmentId),
      active: bool(body, "active", true),
      options,
    });
    return (await this.repo.hotlines()).find((hotline) => hotline.id === savedId)!;
  }

  async listDispositions(userId: string) {
    const access = await this.access(userId);
    if (!access.isMember()) throw forbidden();
    return this.repo.dispositions(access.memberDepartments());
  }

  async createDisposition(userId: string, body: Body) {
    const access = await this.access(userId);
    const departmentId = optionalId(body.departmentId);
    if (departmentId ? !access.supervises(departmentId) : !access.isAdmin) throw forbidden();
    const dispositionId = await this.repo.createDisposition(
      departmentId,
      text(body, "code", 20, { pattern: /^[A-Z0-9_]{2,20}$/ }),
      text(body, "label", 120),
    );
    return { id: dispositionId };
  }
}
