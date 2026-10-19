// MT-2 attendance of one meeting session (also the source of EL-6 live-class attendance).

export interface MeetingAttendanceRow {
  userId: string;
  displayName: string;
  email: string;
  firstJoinedAt: string;
  lastLeftAt: string | null;
  /** Time actually in the room, overlapping tabs counted once. */
  presentSeconds: number;
  /** presentSeconds / session duration, 0..1. */
  ratio: number;
}

export interface MeetingAttendance {
  sessionId: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  rows: MeetingAttendanceRow[];
}
