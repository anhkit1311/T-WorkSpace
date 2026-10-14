// Constraint-based defense scheduler. Pure and deterministic: the same input gives the same plan.
//
// Hard constraints
//   H1 a committee holds one defense at a time (sequential slots inside its sessions)
//   H2 a lecturer is never booked into two overlapping defenses, including bookings that already exist
//   H3 unless the term allows it, no committee member supervises the project
// Soft preferences (in order)
//   S1 the project's reviewer sits on the committee
//   S2 balance load across committees
//   S3 earliest available slot
// Projects with the fewest eligible committees are placed first (most-constrained-variable heuristic).

export interface ScheduleProject {
  id: string;
  supervisorIds: readonly string[];
  reviewerId: string | null;
}
export interface ScheduleSession {
  start: Date;
  end: Date;
}
export interface ScheduleCommittee {
  id: string;
  memberIds: readonly string[];
  sessions: readonly ScheduleSession[];
}
export interface BusyInterval {
  lecturerId: string;
  start: Date;
  end: Date;
}
export interface ScheduleInput {
  projects: readonly ScheduleProject[];
  committees: readonly ScheduleCommittee[];
  slotMinutes: number;
  allowSupervisorInCommittee: boolean;
  busy?: readonly BusyInterval[];
}
export interface ScheduledDefense {
  projectId: string;
  committeeId: string;
  start: Date;
  end: Date;
}
export interface UnscheduledProject {
  projectId: string;
  reason: "no_eligible_committee" | "no_free_slot";
}

interface Slot {
  start: number;
  end: number;
  taken: boolean;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

export function buildSchedule(input: ScheduleInput): {
  scheduled: ScheduledDefense[];
  unscheduled: UnscheduledProject[];
} {
  if (!(input.slotMinutes >= 15 && input.slotMinutes <= 180))
    throw new RangeError("slotMinutes must be between 15 and 180");
  const slotMs = input.slotMinutes * 60_000;
  const slots = new Map<string, Slot[]>();
  for (const committee of input.committees) {
    const list: Slot[] = [];
    for (const session of [...committee.sessions].sort((a, b) => +a.start - +b.start))
      for (let t = +session.start; t + slotMs <= +session.end; t += slotMs)
        list.push({ start: t, end: t + slotMs, taken: false });
    slots.set(committee.id, list);
  }
  const busy = new Map<string, { start: number; end: number }[]>();
  for (const interval of input.busy ?? [])
    (busy.get(interval.lecturerId) ?? busy.set(interval.lecturerId, []).get(interval.lecturerId)!).push({
      start: +interval.start,
      end: +interval.end,
    });
  const load = new Map(input.committees.map((committee) => [committee.id, 0]));

  const eligible = (project: ScheduleProject) =>
    input.committees.filter(
      (committee) =>
        input.allowSupervisorInCommittee ||
        !committee.memberIds.some((member) => project.supervisorIds.includes(member)),
    );
  const ordered = [...input.projects]
    .map((project) => ({ project, options: eligible(project) }))
    .sort((a, b) => a.options.length - b.options.length || a.project.id.localeCompare(b.project.id));

  const scheduled: ScheduledDefense[] = [];
  const unscheduled: UnscheduledProject[] = [];
  for (const { project, options } of ordered) {
    if (!options.length) {
      unscheduled.push({ projectId: project.id, reason: "no_eligible_committee" });
      continue;
    }
    let best: { committee: ScheduleCommittee; slot: Slot; rank: [number, number, number] } | null = null;
    for (const committee of options) {
      const slot = slots
        .get(committee.id)!
        .find(
          (candidate) =>
            !candidate.taken &&
            committee.memberIds.every(
              (member) => !(busy.get(member) ?? []).some((interval) => overlaps(interval, candidate)),
            ),
        );
      if (!slot) continue;
      const rank: [number, number, number] = [
        project.reviewerId && committee.memberIds.includes(project.reviewerId) ? 0 : 1,
        load.get(committee.id)!,
        slot.start,
      ];
      const order = best ? compare(rank, best.rank) : -1;
      if (order < 0 || (order === 0 && committee.id < best!.committee.id))
        best = { committee, slot, rank };
    }
    if (!best) {
      unscheduled.push({ projectId: project.id, reason: "no_free_slot" });
      continue;
    }
    best.slot.taken = true;
    load.set(best.committee.id, load.get(best.committee.id)! + 1);
    for (const member of best.committee.memberIds)
      (busy.get(member) ?? busy.set(member, []).get(member)!).push({
        start: best.slot.start,
        end: best.slot.end,
      });
    scheduled.push({
      projectId: project.id,
      committeeId: best.committee.id,
      start: new Date(best.slot.start),
      end: new Date(best.slot.end),
    });
  }
  return { scheduled, unscheduled };
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
