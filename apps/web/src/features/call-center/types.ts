export type BranchName =
  | "Tất cả"
  | "Phòng Đại học"
  | "Phòng Tài chính"
  | "Ký túc xá"
  | "Tư vấn Tuyển sinh"
  | "Tutor Học thuật";

export type AgentStatus = "ready" | "break" | "qa_locked";

export interface QueueCallItem {
  id: string;
  callerName: string;
  studentId?: string;
  phoneNumber: string;
  branch: BranchName;
  waitTime: number; // in seconds
  priority: "normal" | "high" | "urgent";
  topic: string;
}

export interface ActiveCallItem {
  id: string;
  callerName: string;
  studentId?: string;
  phoneNumber: string;
  branch: BranchName;
  agentName: string;
  agentId: string;
  duration: number; // in seconds
  hasVideo: boolean;
  spyMode: "none" | "spy" | "whisper" | "barge";
}

export interface CallRecord {
  id: string;
  callerName: string;
  studentId?: string;
  phoneNumber: string;
  branch: BranchName;
  agentName: string;
  agentId: string;
  duration: number; // in seconds
  timestamp: string;
  direction: "inbound" | "outbound" | "missed";
  recordingUrl: string;
  qaScore: number | null;
  qaEvaluator?: string;
  qaEvaluatedAt?: string;
  qaComment?: string;
  rubricScores?: Record<string, number>;
}

export interface RubricCriterion {
  id: string;
  code: string;
  name: string;
  weight: number; // e.g. 20, 25, 35, 20
  description: string;
}

export interface TicketPayload {
  title: string;
  studentId: string;
  studentName: string;
  phoneNumber: string;
  branch: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent";
}
