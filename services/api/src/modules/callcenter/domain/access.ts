import type { CallCenterRole } from "@doan/shared";

/**
 * Who may do what in the call center (NT-2): a system admin configures everything; a supervisor
 * sees and reviews their departments; an agent sees only the calls they handled.
 */
export class CallCenterAccess {
  constructor(
    readonly userId: string,
    readonly isAdmin: boolean,
    private readonly roles: ReadonlyMap<string, ReadonlySet<CallCenterRole>>,
  ) {}

  supervises(departmentId: string | null): boolean {
    return this.isAdmin || (departmentId !== null && Boolean(this.roles.get(departmentId)?.has("supervisor")));
  }

  /** Departments whose data this user may read; null means every department. */
  supervisedDepartments(): string[] | null {
    if (this.isAdmin) return null;
    return [...this.roles].filter(([, roles]) => roles.has("supervisor")).map(([id]) => id);
  }

  memberDepartments(): string[] | null {
    return this.isAdmin ? null : [...this.roles.keys()];
  }

  belongsTo(departmentId: string): boolean {
    return this.isAdmin || this.roles.has(departmentId);
  }

  isMember(): boolean {
    return this.isAdmin || this.roles.size > 0;
  }

  /** CC-7: a recording or wrap-up is open to the agent who took the call and the department's supervisors. */
  canReviewCall(call: { department_id: string | null; agent_user_id: string | null }): boolean {
    return call.agent_user_id === this.userId || this.supervises(call.department_id);
  }
}
