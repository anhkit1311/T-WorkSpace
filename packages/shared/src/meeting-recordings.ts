export type MeetingRecordingStatus = "recording" | "processing" | "ready" | "failed";

export interface MeetingRecording {
  id: string;
  sessionId: string;
  status: MeetingRecordingStatus;
  shared: boolean;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  startedByName: string | null;
  error: string | null;
  /** M3: speech-to-text captions (null: never requested). */
  transcriptStatus: "processing" | "ready" | "failed" | null;
}

/** M3: transcript.json beside a recording or video lesson. */
export interface MediaTranscript {
  language: string;
  segments: { start: number; end: number; text: string }[];
}

export interface MeetingRecordings {
  recordings: MeetingRecording[];
  /** Host or co-host of the session: may start/stop recording (while live) and share recordings. */
  canManage: boolean;
}
