// NV-MT3 họp hội đồng: a scheduled meeting whose members score each presenter (BR-12).

export type CouncilRole = "chair" | "member";

export interface CouncilMember {
  userId: string;
  displayName: string;
  role: CouncilRole;
  absent: boolean;
}

export interface CouncilCriterion {
  id: string;
  label: string;
  /** Percent; the criteria of a council add up to 100. */
  weight: number;
}

export interface CouncilSheet {
  memberId: string;
  displayName: string;
  /** criterionId -> 0..10 */
  scores: Record<string, number>;
  comment: string;
  /** Weighted total on the 10-point scale. */
  total: number;
}

export interface CouncilPresenter {
  id: string;
  userId: string;
  displayName: string;
  studentCode: string;
  topic: string;
  status: "waiting" | "presenting" | "done";
  /** Members who have submitted a sheet (names only; scores stay private). */
  submittedBy: string[];
  mySheet: { scores: Record<string, number>; comment: string } | null;
  /** Every sheet: the chair any time, other members once the result is final; null otherwise. */
  sheets: CouncilSheet[] | null;
  /** Council members, the organizer and the presenter see the result; null for others or before it is final. */
  finalScore: number | null;
  conclusion: string | null;
  finalizedAt: string | null;
}

export interface CouncilView {
  scheduleId: string;
  roomId: string;
  title: string;
  myRole: CouncilRole | null;
  /** The organizer sets the council up. */
  canManage: boolean;
  /** Setup is frozen once a presentation started or a sheet was submitted. */
  locked: boolean;
  members: CouncilMember[];
  criteria: CouncilCriterion[];
  presenters: CouncilPresenter[];
}

export interface CouncilSetupInput {
  chairId: string;
  memberIds: string[];
  presenters: { userId: string; topic: string }[];
  criteria: { label: string; weight: number }[];
}
