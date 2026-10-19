// Who may do what with a course. Built once per request from the user's academic grants.

export interface CourseRef {
  id: string;
  unitId: string;
  ownerId: string;
  instructorIds: string[];
  status: "draft" | "published" | "archived";
  enrollment: "open" | "assigned";
}

export class CourseAccess {
  constructor(
    readonly userId: string,
    private readonly systemAdmin: boolean,
    private readonly adminUnits: ReadonlySet<string>,
    private readonly staffUnits: ReadonlySet<string>,
  ) {}

  /** Lecturers of a unit and its admins create courses for it. */
  canCreateIn(unitId: string) {
    return this.systemAdmin || this.adminUnits.has(unitId) || this.staffUnits.has(unitId);
  }

  /** Owner, co-teachers and the unit's admins edit the course and see every learner. */
  manages(course: CourseRef) {
    return (
      this.systemAdmin ||
      this.adminUnits.has(course.unitId) ||
      course.ownerId === this.userId ||
      course.instructorIds.includes(this.userId)
    );
  }

  /** Learners see published courses; drafts and archived ones only their staff. */
  canSee(course: CourseRef, enrolled: boolean) {
    return this.manages(course) || course.status === "published" || (enrolled && course.status === "archived");
  }

  canSelfEnroll(course: CourseRef) {
    return course.status === "published" && course.enrollment === "open";
  }
}
