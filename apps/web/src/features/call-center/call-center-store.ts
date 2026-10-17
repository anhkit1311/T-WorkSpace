import type { ActiveCallItem, AgentStatus, CallRecord, QueueCallItem, RubricCriterion } from "./types";

export const QA_RUBRIC_CRITERIA: RubricCriterion[] = [
  {
    id: "c1",
    code: "C01",
    name: "Kỹ năng chào hỏi & Xác minh thông tin",
    weight: 20,
    description: "Chào đúng quy chuẩn TDTU, xưng hô chuẩn mực, xác minh MSSV và danh tính người gọi.",
  },
  {
    id: "c2",
    code: "C02",
    name: "Thái độ lắng nghe & Thấu hiểu khúc mắc",
    weight: 25,
    description: "Không ngắt lời người học, nắm bắt trọng tâm thắc mắc học vụ hoặc tài chính.",
  },
  {
    id: "c3",
    code: "C03",
    name: "Tính chính xác & Đầy đủ của hướng dẫn học vụ",
    weight: 35,
    description: "Cung cấp đúng biểu mẫu, thời hạn nộp, quy chế đào tạo tín chỉ và thủ tục tại cơ sở TDTU.",
  },
  {
    id: "c4",
    code: "C04",
    name: "Kỹ năng kết thúc & Hướng dẫn các bước tiếp theo",
    weight: 20,
    description: "Xác nhận sinh viên đã hiểu rõ cách xử lý, chúc học tốt và cảm ơn đã gọi tổng đài TDTU.",
  },
];

const INITIAL_QUEUE_CALLS: QueueCallItem[] = [
  {
    id: "q-101",
    callerName: "Trần Minh Quân",
    studentId: "52100845",
    phoneNumber: "0903124567",
    branch: "Phòng Đại học",
    waitTime: 74,
    priority: "urgent",
    topic: "Đăng ký hoãn thi học kỳ 1 năm học 2026",
  },
  {
    id: "q-102",
    callerName: "Phạm Thảo Vy",
    studentId: "52200192",
    phoneNumber: "0918765432",
    branch: "Phòng Tài chính",
    waitTime: 42,
    priority: "high",
    topic: "Xác nhận miễn giảm học phí diện chính sách",
  },
  {
    id: "q-103",
    callerName: "Lê Quốc Bảo",
    studentId: "52000311",
    phoneNumber: "0982334455",
    branch: "Ký túc xá",
    waitTime: 28,
    priority: "normal",
    topic: "Thủ tục gia hạn phòng KTX Khu A năm 2026",
  },
  {
    id: "q-104",
    callerName: "Nguyễn Hải Đăng",
    studentId: "52300764",
    phoneNumber: "0934567890",
    branch: "Tutor Học thuật",
    waitTime: 15,
    priority: "normal",
    topic: "Hỏi đáp đồ án môn học Kiến trúc Máy tính",
  },
];

const INITIAL_ACTIVE_CALLS: ActiveCallItem[] = [
  {
    id: "act-201",
    callerName: "Võ Thị Bích Ngọc",
    studentId: "52100918",
    phoneNumber: "0909112233",
    branch: "Phòng Đại học",
    agentName: "Nguyễn Đăng Khoa",
    agentId: "agent-01",
    duration: 185,
    hasVideo: false,
    spyMode: "none",
  },
  {
    id: "act-202",
    callerName: "Đặng Hoàng Nam",
    studentId: "52200451",
    phoneNumber: "0977889900",
    branch: "Tư vấn Tuyển sinh",
    agentName: "Lê Thu Hằng",
    agentId: "agent-02",
    duration: 312,
    hasVideo: false,
    spyMode: "none",
  },
  {
    id: "act-203",
    callerName: "Huỳnh Thanh Tâm",
    studentId: "52000889",
    phoneNumber: "0944556677",
    branch: "Tutor Học thuật",
    agentName: "Trần Tuấn Kiệt",
    agentId: "agent-03",
    duration: 98,
    hasVideo: true,
    spyMode: "none",
  },
];

const INITIAL_CDR_RECORDS: CallRecord[] = [
  {
    id: "cdr-301",
    callerName: "Hoàng Gia Bảo",
    studentId: "52100723",
    phoneNumber: "0938123456",
    branch: "Phòng Đại học",
    agentName: "Nguyễn Đăng Khoa",
    agentId: "agent-01",
    duration: 215,
    timestamp: "2026-10-14T09:15:00.000Z",
    direction: "inbound",
    recordingUrl: "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
    qaScore: 88,
    qaEvaluator: "Trần Trọng Đạo (Supervisor)",
    qaEvaluatedAt: "2026-10-14T09:40:00.000Z",
    qaComment: "Tác phong chuyên nghiệp, trả lời đúng hạn xét tốt nghiệp đợt 2.",
    rubricScores: { c1: 90, c2: 85, c3: 90, c4: 85 },
  },
  {
    id: "cdr-302",
    callerName: "Lâm Uyên Nhi",
    studentId: "52200634",
    phoneNumber: "0908765987",
    branch: "Phòng Tài chính",
    agentName: "Lê Thu Hằng",
    agentId: "agent-02",
    duration: 142,
    timestamp: "2026-10-14T08:50:00.000Z",
    direction: "inbound",
    recordingUrl: "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
    qaScore: 72,
    qaEvaluator: "Trần Trọng Đạo (Supervisor)",
    qaEvaluatedAt: "2026-10-14T09:10:00.000Z",
    qaComment: "Giải thích hóa đơn học phí còn hơi nhanh, cần kiên nhẫn hơn.",
    rubricScores: { c1: 80, c2: 70, c3: 70, c4: 70 },
  },
  {
    id: "cdr-303",
    callerName: "Trương Vĩnh Kỳ",
    studentId: "52300112",
    phoneNumber: "0971234888",
    branch: "Ký túc xá",
    agentName: "Phạm Văn Long",
    agentId: "agent-04",
    duration: 98,
    timestamp: "2026-10-14T08:30:00.000Z",
    direction: "inbound",
    recordingUrl: "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
    qaScore: 48,
    qaEvaluator: "Trần Trọng Đạo (Supervisor)",
    qaEvaluatedAt: "2026-10-14T08:55:00.000Z",
    qaComment: "Chưa xác minh MSSV sinh viên, cung cấp sai quy chế giờ giới nghiêm KTX.",
    rubricScores: { c1: 50, c2: 50, c3: 40, c4: 55 },
  },
  {
    id: "cdr-304",
    callerName: "Đỗ Hải Yến",
    studentId: "52100344",
    phoneNumber: "0933445566",
    branch: "Tutor Học thuật",
    agentName: "Trần Tuấn Kiệt",
    agentId: "agent-03",
    duration: 380,
    timestamp: "2026-10-14T08:10:00.000Z",
    direction: "inbound",
    recordingUrl: "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
    qaScore: null, // Cần chấm điểm QA
  },
  {
    id: "cdr-305",
    callerName: "Mai Quốc Anh",
    studentId: "52200877",
    phoneNumber: "0912334499",
    branch: "Phòng Đại học",
    agentName: "Nguyễn Đăng Khoa",
    agentId: "agent-01",
    duration: 0,
    timestamp: "2026-10-14T07:45:00.000Z",
    direction: "missed",
    recordingUrl: "",
    qaScore: null,
  },
  {
    id: "cdr-306",
    callerName: "Nguyễn Hoàng Nam",
    studentId: "52000551",
    phoneNumber: "0988776655",
    branch: "Tư vấn Tuyển sinh",
    agentName: "Lê Thu Hằng",
    agentId: "agent-02",
    duration: 290,
    timestamp: "2026-10-13T16:20:00.000Z",
    direction: "inbound",
    recordingUrl: "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
    qaScore: null, // Cần chấm điểm QA
  },
];

class CallCenterStore {
  private queueCalls: QueueCallItem[] = [...INITIAL_QUEUE_CALLS];
  private activeCalls: ActiveCallItem[] = [...INITIAL_ACTIVE_CALLS];
  private records: CallRecord[] = [...INITIAL_CDR_RECORDS];
  private agentStatus: AgentStatus = "ready";
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      const savedStatus = localStorage.getItem("tdtu_agent_status") as AgentStatus | null;
      if (savedStatus) {
        this.agentStatus = savedStatus;
      }
      const savedRecords = localStorage.getItem("tdtu_cdr_records");
      if (savedRecords) {
        try {
          this.records = JSON.parse(savedRecords);
        } catch {}
      }
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public getQueueCalls(): QueueCallItem[] {
    return [...this.queueCalls];
  }

  public getActiveCalls(): ActiveCallItem[] {
    return [...this.activeCalls];
  }

  public getRecords(): CallRecord[] {
    return [...this.records];
  }

  public getAgentStatus(): AgentStatus {
    return this.agentStatus;
  }

  public setAgentStatus(status: AgentStatus) {
    this.agentStatus = status;
    if (typeof window !== "undefined") {
      localStorage.setItem("tdtu_agent_status", status);
    }
    this.notify();
  }

  public setSpyMode(callId: string, spyMode: ActiveCallItem["spyMode"]) {
    this.activeCalls = this.activeCalls.map((c) =>
      c.id === callId ? { ...c, spyMode: c.spyMode === spyMode ? "none" : spyMode } : c,
    );
    this.notify();
  }

  public acceptQueueCall(queueId: string): QueueCallItem | null {
    const item = this.queueCalls.find((q) => q.id === queueId);
    if (!item) return null;
    this.queueCalls = this.queueCalls.filter((q) => q.id !== queueId);
    this.activeCalls = [
      {
        id: `act-${Date.now()}`,
        callerName: item.callerName,
        studentId: item.studentId,
        phoneNumber: item.phoneNumber,
        branch: item.branch,
        agentName: "Nguyễn Đăng Khoa",
        agentId: "agent-01",
        duration: 0,
        hasVideo: false,
        spyMode: "none",
      },
      ...this.activeCalls,
    ];
    this.notify();
    return item;
  }

  public endActiveCall(callId: string) {
    const active = this.activeCalls.find((c) => c.id === callId);
    if (active) {
      this.activeCalls = this.activeCalls.filter((c) => c.id !== callId);
      const newRecord: CallRecord = {
        id: `cdr-${Date.now()}`,
        callerName: active.callerName,
        studentId: active.studentId,
        phoneNumber: active.phoneNumber,
        branch: active.branch,
        agentName: active.agentName,
        agentId: active.agentId,
        duration: active.duration || 120,
        timestamp: new Date().toISOString(),
        direction: "inbound",
        recordingUrl: "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
        qaScore: null,
      };
      this.records = [newRecord, ...this.records];
      if (typeof window !== "undefined") {
        localStorage.setItem("tdtu_cdr_records", JSON.stringify(this.records));
      }
    }
    this.notify();
  }

  public addTutorCall(callerName: string, studentId: string, topic: string): QueueCallItem {
    const newQueue: QueueCallItem = {
      id: `q-tutor-${Date.now()}`,
      callerName,
      studentId,
      phoneNumber: "0909" + Math.floor(100000 + Math.random() * 900000),
      branch: "Tutor Học thuật",
      waitTime: 1,
      priority: "high",
      topic,
    };
    this.queueCalls = [newQueue, ...this.queueCalls];
    this.notify();
    return newQueue;
  }

  public updateQAScore(
    recordId: string,
    scores: Record<string, number>,
    totalScore: number,
    comment: string,
    evaluator: string,
  ): { isLowScore: boolean; lockedAgentName?: string } {
    let affectedAgentName: string | undefined;
    let isLowScore = false;

    this.records = this.records.map((r) => {
      if (r.id === recordId) {
        affectedAgentName = r.agentName;
        if (totalScore < 60) {
          isLowScore = true;
        }
        return {
          ...r,
          qaScore: totalScore,
          qaComment: comment,
          qaEvaluator: evaluator,
          qaEvaluatedAt: new Date().toISOString(),
          rubricScores: scores,
        };
      }
      return r;
    });

    if (isLowScore) {
      // Auto-lock agent status into QA Training mode
      this.agentStatus = "qa_locked";
      if (typeof window !== "undefined") {
        localStorage.setItem("tdtu_agent_status", "qa_locked");
      }
    }

    if (typeof window !== "undefined") {
      localStorage.setItem("tdtu_cdr_records", JSON.stringify(this.records));
    }

    this.notify();
    return { isLowScore, lockedAgentName: affectedAgentName };
  }
}

export const callCenterStore = new CallCenterStore();
