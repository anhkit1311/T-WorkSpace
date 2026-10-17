import { useEffect, useMemo, useState, useRef } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Icon } from "../../shared/ui/Icon";
import { Modal } from "../../shared/ui/Primitives";
import { callCenterStore } from "./call-center-store";
import type { ActiveCallItem, AgentStatus, BranchName, QueueCallItem } from "./types";
import "./call-center.css";

const BRANCH_PILLS: BranchName[] = [
  "Tất cả",
  "Phòng Đại học",
  "Phòng Tài chính",
  "Ký túc xá",
  "Tư vấn Tuyển sinh",
  "Tutor Học thuật",
];

export function CallCenterWorkspace() {
  const { notify, user, setActiveView } = useApp();
  const meeting = useMeeting();

  // Store subscription
  const [queueCalls, setQueueCalls] = useState<QueueCallItem[]>(() => callCenterStore.getQueueCalls());
  const [activeCalls, setActiveCalls] = useState<ActiveCallItem[]>(() => callCenterStore.getActiveCalls());
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(() => callCenterStore.getAgentStatus());

  useEffect(() => {
    return callCenterStore.subscribe(() => {
      setQueueCalls(callCenterStore.getQueueCalls());
      setActiveCalls(callCenterStore.getActiveCalls());
      setAgentStatus(callCenterStore.getAgentStatus());
    });
  }, []);

  // Filter state
  const [selectedBranch, setSelectedBranch] = useState<BranchName>("Tất cả");

  // Softphone state
  const [dialNumber, setDialNumber] = useState("");
  const [inCallWith, setInCallWith] = useState<{ name: string; mssv?: string; phone: string; branch?: string } | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Video element ref
  const videoRef = useRef<HTMLVideoElement>(null);

  // Modal ticket creation
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketStudentId, setTicketStudentId] = useState("");
  const [ticketDesc, setTicketDesc] = useState("");
  const [ticketPriority, setTicketPriority] = useState<"normal" | "high" | "urgent">("normal");

  // Call timer effect
  useEffect(() => {
    if (inCallWith) {
      setCallDuration(0);
      timerRef.current = window.setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallDuration(0);
      setIsVideoActive(false);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [inCallWith]);

  // Video track simulation or camera stream
  useEffect(() => {
    if (isVideoActive) {
      if (meeting.localStream && videoRef.current) {
        videoRef.current.srcObject = meeting.localStream;
      }
    }
  }, [isVideoActive, meeting.localStream]);

  // Format seconds to MM:SS
  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Filtered queue & active calls
  const filteredQueue = useMemo(() => {
    if (selectedBranch === "Tất cả") return queueCalls;
    return queueCalls.filter((c) => c.branch === selectedBranch);
  }, [queueCalls, selectedBranch]);

  const filteredActive = useMemo(() => {
    if (selectedBranch === "Tất cả") return activeCalls;
    return activeCalls.filter((c) => c.branch === selectedBranch);
  }, [activeCalls, selectedBranch]);

  // Handle Supervisor actions
  const handleSupervisorAction = (call: ActiveCallItem, action: "spy" | "whisper" | "barge") => {
    callCenterStore.setSpyMode(call.id, action);
    const modeLabels = {
      spy: "Nghe lén (Spy): Bạn đang lắng nghe cuộc gọi bảo mật. Cả hai bên không nghe thấy bạn.",
      whisper: "Nhắc bài (Whisper): Bạn đang nói chuyện trực tiếp với Chuyên viên. Sinh viên không nghe thấy.",
      barge: "Tham gia (Barge-in): Bạn đã tham gia vào cuộc đàm thoại 3 bên trực tiếp.",
    };
    notify("Giám sát cuộc gọi", modeLabels[action], "info");
  };

  // Pickup queue call
  const handlePickup = (item: QueueCallItem) => {
    if (agentStatus === "qa_locked") {
      notify("Không thể nhận cuộc gọi", "Tài khoản đang bị khóa do điểm QA < 60. Vui lòng hoàn thành khóa đào tạo.", "warning");
      return;
    }
    const accepted = callCenterStore.acceptQueueCall(item.id);
    if (accepted) {
      setInCallWith({
        name: accepted.callerName,
        mssv: accepted.studentId,
        phone: accepted.phoneNumber,
      });
      setDialNumber(accepted.studentId || accepted.phoneNumber);
      notify("Đã tiếp nhận cuộc gọi", `Đang kết nối với ${accepted.callerName} (${accepted.branch})`, "success");
    }
  };

  // Dial / Hangup from softphone
  const handleDial = () => {
    if (agentStatus === "qa_locked") {
      notify("Tài khoản bị khóa", "Bạn đang ở trạng thái Chờ đào tạo QA, không thể thực hiện cuộc gọi.", "warning");
      return;
    }
    if (!dialNumber.trim()) {
      notify("Chưa nhập số điện thoại", "Vui lòng nhập số điện thoại hoặc mã số sinh viên.", "warning");
      return;
    }
    setInCallWith({
      name: `Sinh viên (${dialNumber})`,
      phone: dialNumber,
    });
    notify("Đang kết nối", `Đang gọi đến số ${dialNumber}...`, "info");
  };

  const handleHangup = () => {
    if (inCallWith) {
      notify("Đã ngắt cuộc gọi", `Cuộc gọi với ${inCallWith.name} kết thúc. Thời lượng: ${formatTimer(callDuration)}`, "info");
      setInCallWith(null);
    }
  };

  // Keypad click
  const handleKeypadPress = (val: string) => {
    setDialNumber((prev) => prev + val);
  };

  // Upgrade Video / Screen
  const handleToggleVideo = async () => {
    if (!inCallWith) {
      notify("Chưa trong cuộc gọi", "Vui lòng kết nối cuộc gọi trước khi kích hoạt video.", "warning");
      return;
    }
    if (!isVideoActive) {
      try {
        await meeting.toggleCamera();
      } catch {}
      setIsVideoActive(true);
      notify("Nâng cấp Video SFU", "Đã bật truyền hình ảnh SFU và chia sẻ màn hình thời gian thực.", "success");
    } else {
      setIsVideoActive(false);
      notify("Tắt Video", "Đã quay trở lại chế độ cuộc gọi thoại chất lượng cao.", "info");
    }
  };

  // Ticket creation handler
  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketTitle.trim()) return;

    const newTicket = {
      id: `ticket-${Date.now()}`,
      title: `[Học vụ] ${ticketTitle}`,
      studentId: ticketStudentId || "52100845",
      description: ticketDesc || "Tiếp nhận từ Tổng đài trực tuyến TDTU",
      status: "todo",
      priority: "high",
      branch: inCallWith?.branch || "Phòng Đại học",
      createdAt: new Date().toISOString(),
    };
    try {
      const existing = JSON.parse(localStorage.getItem("tdtu_callcenter_tickets") || "[]");
      localStorage.setItem("tdtu_callcenter_tickets", JSON.stringify([newTicket, ...existing]));
    } catch {}

    notify(
      "Đã tạo phiếu vào Bảng phân công",
      `Phiếu "${ticketTitle}" (${ticketStudentId || "N/A"}) đã được đưa vào Bảng phân công công việc.`,
      "success",
      {
        label: "Mở Bảng phân công",
        onClick: () => setActiveView("tasks"),
      },
    );
    setTicketModalOpen(false);
    setTicketTitle("");
    setTicketStudentId("");
    setTicketDesc("");
  };

  return (
    <div className="callcenter-page">
      {/* Tiêu đề trang */}
      <div className="callcenter-header">
        <div>
          <h1 className="callcenter-header__title">Tổng đài Trực tuyến TDTU</h1>
          <p className="callcenter-header__subtitle">
            Hệ thống phân luồng cuộc gọi học vụ, tư vấn sinh viên &amp; giám sát chất lượng đào tạo
          </p>
        </div>
      </div>

      {/* 1. Hàng trên cùng: 3 thẻ KPI */}
      <div className="callcenter-kpi-grid">
        {/* Thẻ 1: Queue */}
        <div className="callcenter-kpi-card">
          <div className="callcenter-kpi-card__icon callcenter-kpi-card__icon--queue">
            <Icon name="phone-call" size={22} strokeWidth={1.8} />
          </div>
          <div>
            <div className="callcenter-kpi-card__number">{queueCalls.length}</div>
            <div className="callcenter-kpi-card__label">Cuộc gọi chờ trong hàng đợi</div>
          </div>
        </div>

        {/* Thẻ 2: Agents Ready */}
        <div className="callcenter-kpi-card">
          <div className="callcenter-kpi-card__icon callcenter-kpi-card__icon--agents">
            <Icon name="users" size={22} strokeWidth={1.8} />
          </div>
          <div>
            <div className="callcenter-kpi-card__number">12</div>
            <div className="callcenter-kpi-card__label">Chuyên viên / Tutor sẵn sàng</div>
          </div>
        </div>

        {/* Thẻ 3: SLA % */}
        <div className="callcenter-kpi-card">
          <div className="callcenter-kpi-card__icon callcenter-kpi-card__icon--sla">
            <Icon name="activity" size={22} strokeWidth={1.8} />
          </div>
          <div>
            <div className="callcenter-kpi-card__number">96.8%</div>
            <div className="callcenter-kpi-card__label">Tỷ lệ đáp ứng SLA</div>
          </div>
        </div>
      </div>

      {/* 2. Bố cục chính 2 cột (70% - 30%) */}
      <div className="callcenter-main-grid">
        {/* CỘT TRÁI (70%): Hàng đợi & Giám sát theo Khoa/Phòng ban */}
        <div className="callcenter-left-column">
          {/* Pill lọc nhánh */}
          <div className="callcenter-filter-row" role="tablist">
            {BRANCH_PILLS.map((branch) => (
              <button
                key={branch}
                type="button"
                className={`callcenter-pill ${selectedBranch === branch ? "is-active" : ""}`}
                onClick={() => setSelectedBranch(branch)}
              >
                {branch}
              </button>
            ))}
          </div>

          {/* Khung Video nếu kích hoạt */}
          {isVideoActive && (
            <div className="callcenter-video-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="callcenter-video-controls">
                <button
                  type="button"
                  className="button button--sm button--secondary"
                  onClick={() => meeting.toggleMic()}
                >
                  <Icon name={meeting.mic ? "mic" : "mic-off"} size={14} />
                  <span>{meeting.mic ? "Tắt mic" : "Bật mic"}</span>
                </button>
                <button
                  type="button"
                  className="button button--sm button--secondary"
                  onClick={() => meeting.toggleScreenShare()}
                >
                  <Icon name="monitor" size={14} />
                  <span>Chia sẻ màn hình</span>
                </button>
                <button
                  type="button"
                  className="button button--sm button--danger"
                  onClick={() => setIsVideoActive(false)}
                >
                  Đóng Video
                </button>
              </div>
            </div>
          )}

          {/* Danh sách cuộc gọi đang chờ (Waiting Queue) */}
          <div className="callcenter-panel">
            <div className="callcenter-panel__head">
              <h2 className="callcenter-panel__title">
                <Icon name="clock" size={18} />
                <span>Cuộc gọi đang chờ trong hàng đợi</span>
                <span className="callcenter-badge-count">{filteredQueue.length}</span>
              </h2>
            </div>

            {filteredQueue.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "#94A3B8", fontSize: 13.5 }}>
                Không có cuộc gọi nào đang chờ trong nhánh này.
              </div>
            ) : (
              filteredQueue.map((call) => (
                <div key={call.id} className="call-item-card">
                  <div className="call-item-info">
                    <div className="call-item-caller">
                      <span>{call.callerName}</span>
                      {call.studentId && <span className="call-item-mssv">MSSV: {call.studentId}</span>}
                    </div>
                    <div className="call-item-topic">
                      <strong>Chủ đề:</strong> {call.topic}
                    </div>
                    <div className="call-item-meta">
                      <span className="badge badge--blue">{call.branch}</span>
                      <span>·</span>
                      <span>SĐT: {call.phoneNumber}</span>
                      <span>·</span>
                      <span style={{ color: "#DC2626", fontWeight: 600 }}>Chờ: {call.waitTime}s</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="button button--sm button--primary"
                    disabled={agentStatus === "qa_locked"}
                    onClick={() => handlePickup(call)}
                  >
                    <Icon name="phone" size={14} />
                    <span>Tiếp nhận</span>
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Danh sách cuộc gọi đang đàm thoại (Active Calls Monitoring) */}
          <div className="callcenter-panel">
            <div className="callcenter-panel__head">
              <h2 className="callcenter-panel__title">
                <Icon name="activity" size={18} />
                <span>Cuộc gọi đang đàm thoại (Giám sát Supervisor)</span>
                <span className="callcenter-badge-count">{filteredActive.length}</span>
              </h2>
            </div>

            {filteredActive.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "#94A3B8", fontSize: 13.5 }}>
                Hiện không có cuộc gọi nào đang đàm thoại.
              </div>
            ) : (
              filteredActive.map((call) => (
                <div key={call.id} className="call-item-card">
                  <div className="call-item-info">
                    <div className="call-item-caller">
                      <span>{call.callerName}</span>
                      {call.studentId && <span className="call-item-mssv">MSSV: {call.studentId}</span>}
                      {call.spyMode !== "none" && (
                        <span className="badge badge--violet">
                          {call.spyMode === "spy" && "Đang nghe lén"}
                          {call.spyMode === "whisper" && "Đang nhắc bài"}
                          {call.spyMode === "barge" && "Đã tham gia 3 bên"}
                        </span>
                      )}
                    </div>
                    <div className="call-item-topic">
                      <strong>Tiếp nhận:</strong> {call.agentName} · <strong>Đơn vị:</strong> {call.branch}
                    </div>
                    <div className="call-item-meta">
                      <span>Thời lượng: {formatTimer(call.duration)}</span>
                      <span>·</span>
                      <span>SĐT: {call.phoneNumber}</span>
                      {call.hasVideo && <span className="badge badge--green">Video HD</span>}
                    </div>
                  </div>

                  {/* 3 nút hành động phẳng cho Supervisor */}
                  <div className="call-supervisor-actions">
                    <button
                      type="button"
                      className={`btn-spy ${call.spyMode === "spy" ? "is-active" : ""}`}
                      title="Supervisor lắng nghe bảo mật mà hai bên không nghe thấy"
                      onClick={() => handleSupervisorAction(call, "spy")}
                    >
                      <Icon name="eye" size={13} />
                      <span>Nghe lén</span>
                    </button>

                    <button
                      type="button"
                      className={`btn-whisper ${call.spyMode === "whisper" ? "is-active" : ""}`}
                      title="Supervisor nói chuyện chỉ với Chuyên viên, Sinh viên không nghe thấy"
                      onClick={() => handleSupervisorAction(call, "whisper")}
                    >
                      <Icon name="headset" size={13} />
                      <span>Nhắc bài</span>
                    </button>

                    <button
                      type="button"
                      className={`btn-barge ${call.spyMode === "barge" ? "is-active" : ""}`}
                      title="Supervisor tham gia trực tiếp vào cuộc đàm thoại 3 bên"
                      onClick={() => handleSupervisorAction(call, "barge")}
                    >
                      <Icon name="users" size={13} />
                      <span>Tham gia</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* CỘT PHẢI (30%): Bàn làm việc Web Softphone */}
        <div className="softphone-card">
          {/* Trạng thái trực */}
          <div className="softphone-status-wrap">
            <span style={{ fontSize: 13, fontWeight: 600, color: "#64748B" }}>Trạng thái trực:</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {agentStatus === "qa_locked" ? (
                <span className="softphone-status-badge status-qa_locked" title="Khóa do điểm QA < 60">
                  <Icon name="lock" size={12} />
                  <span>Chờ đào tạo QA</span>
                </span>
              ) : (
                <select
                  value={agentStatus}
                  onChange={(e) => callCenterStore.setAgentStatus(e.target.value as AgentStatus)}
                  style={{
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid #E2E8F0",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "0 8px",
                  }}
                >
                  <option value="ready">🟢 Sẵn sàng</option>
                  <option value="break">🟡 Nghỉ giải lao</option>
                </select>
              )}
            </div>
          </div>

          {/* Cảnh báo nếu Agent bị khóa QA */}
          {agentStatus === "qa_locked" && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 12,
                color: "#991B1B",
                lineHeight: 1.45,
              }}
            >
              <strong>Tài khoản bị khóa trực:</strong> Điểm đánh giá QA &lt; 60. Vui lòng vào mục{" "}
              <button
                type="button"
                onClick={() => setActiveView("thesis")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#2563EB",
                  textDecoration: "underline",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Đào tạo
              </button>{" "}
              để hoàn thành khóa học bắt buộc.
            </div>
          )}

          {/* Đồng hồ đếm thời gian gọi */}
          <div className="softphone-timer-box">
            <div className="softphone-timer-digits">{formatTimer(callDuration)}</div>
            <div className="softphone-timer-status">
              {inCallWith
                ? `Đang đàm thoại: ${inCallWith.name}`
                : agentStatus === "ready"
                  ? "Sẵn sàng nhận cuộc gọi"
                  : "Tạm dừng nhận cuộc gọi"}
            </div>
          </div>

          {/* Input số điện thoại / MSSV */}
          <div className="softphone-input-row">
            <input
              type="text"
              placeholder="Nhập số điện thoại / MSSV"
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              className="softphone-dial-input"
            />
            {dialNumber && (
              <button
                type="button"
                className="softphone-backspace-btn"
                onClick={() => setDialNumber((prev) => prev.slice(0, -1))}
                title="Xóa lùi"
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </div>

          {/* Keypad 3x4 */}
          <div className="softphone-keypad-grid">
            {[
              { num: "1", sub: "" },
              { num: "2", sub: "ABC" },
              { num: "3", sub: "DEF" },
              { num: "4", sub: "GHI" },
              { num: "5", sub: "JKL" },
              { num: "6", sub: "MNO" },
              { num: "7", sub: "PQRS" },
              { num: "8", sub: "TUV" },
              { num: "9", sub: "WXYZ" },
              { num: "*", sub: "" },
              { num: "0", sub: "+" },
              { num: "#", sub: "" },
            ].map((k) => (
              <button
                key={k.num}
                type="button"
                className="softphone-key-btn"
                onClick={() => handleKeypadPress(k.num)}
              >
                <span className="softphone-key-num">{k.num}</span>
                {k.sub && <span className="softphone-key-sub">{k.sub}</span>}
              </button>
            ))}
          </div>

          {/* Nút Gọi / Cúp máy */}
          <div className="softphone-actions-row">
            {inCallWith ? (
              <button
                type="button"
                className="softphone-call-btn btn-hangup"
                onClick={handleHangup}
              >
                <Icon name="phone" size={17} />
                <span>Kết thúc cuộc gọi</span>
              </button>
            ) : (
              <button
                type="button"
                className="softphone-call-btn btn-start"
                disabled={agentStatus === "qa_locked"}
                onClick={handleDial}
              >
                <Icon name="phone" size={17} />
                <span>Gọi đi (Dial)</span>
              </button>
            )}

            {/* Nâng cấp Video / Chia sẻ màn hình */}
            <button
              type="button"
              className="softphone-feature-btn"
              onClick={handleToggleVideo}
            >
              <Icon name={isVideoActive ? "camera-off" : "video"} size={16} />
              <span>{isVideoActive ? "Tắt Video Call" : "Nâng cấp Video / Chia sẻ màn hình"}</span>
            </button>

            {/* Tạo phiếu vào Bảng phân công */}
            <button
              type="button"
              className="softphone-feature-btn"
              onClick={() => {
                if (inCallWith) {
                  setTicketTitle(`Yêu cầu hỗ trợ: ${inCallWith.name}`);
                  setTicketStudentId(inCallWith.mssv || "");
                }
                setTicketModalOpen(true);
              }}
            >
              <Icon name="table" size={16} />
              <span>Tạo phiếu vào Bảng phân công</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Tạo Phiếu vào Bảng phân công */}
      {ticketModalOpen && (
        <Modal
          title="Tạo phiếu yêu cầu vào Bảng phân công"
          eyebrow="TỔNG ĐÀI HỌC VỤ TDTU"
          onClose={() => setTicketModalOpen(false)}
        >
          <form onSubmit={handleCreateTicket} className="ticket-form">
            <p style={{ margin: 0, fontSize: 13, color: "#64748B" }}>
              Phiếu yêu cầu sẽ được chuyển tiếp tức thì vào cột "Cần làm" trong Bảng phân công công việc của Khoa/Phòng ban.
            </p>

            <div className="field">
              <label>Tiêu đề công việc / Ticket *</label>
              <input
                type="text"
                required
                value={ticketTitle}
                placeholder="VD: Cấp lại mật khẩu cổng thông tin sinh viên"
                onChange={(e) => setTicketTitle(e.target.value)}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label>Mã số sinh viên (MSSV)</label>
                <input
                  type="text"
                  value={ticketStudentId}
                  placeholder="VD: 52100845"
                  onChange={(e) => setTicketStudentId(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Mức độ ưu tiên</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value as any)}
                >
                  <option value="normal">Bình thường</option>
                  <option value="high">Ưu tiên cao</option>
                  <option value="urgent">Khẩn cấp</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>Nội dung chi tiết yêu cầu</label>
              <textarea
                rows={3}
                value={ticketDesc}
                placeholder="Ghi chú nội dung sinh viên đã trình bày qua điện thoại..."
                onChange={(e) => setTicketDesc(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setTicketModalOpen(false)}
              >
                Hủy
              </button>
              <button type="submit" className="button button--primary">
                Tạo phiếu ngay
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
