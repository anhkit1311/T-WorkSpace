import { useEffect, useMemo, useState, useRef } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { callCenterStore, QA_RUBRIC_CRITERIA } from "./call-center-store";
import type { CallRecord } from "./types";
import "./call-center.css";

type FilterTab = "all" | "inbound" | "missed" | "need_qa" | "low_score";

export function CallDirectoryPage() {
  const { notify, setActiveView } = useApp();

  const [records, setRecords] = useState<CallRecord[]>(() => callCenterStore.getRecords());
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  useEffect(() => {
    return callCenterStore.subscribe(() => {
      setRecords(callCenterStore.getRecords());
    });
  }, []);

  // QA Drawer state
  const [selectedRecord, setSelectedRecord] = useState<CallRecord | null>(null);
  const [rubricScores, setRubricScores] = useState<Record<string, number>>({});
  const [qaComment, setQaComment] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioIntervalRef = useRef<number | null>(null);

  // Open QA Drawer
  const handleOpenQA = (record: CallRecord) => {
    setSelectedRecord(record);
    setRubricScores(record.rubricScores || { c1: 85, c2: 80, c3: 85, c4: 80 });
    setQaComment(record.qaComment || "");
    setIsPlaying(false);
    setAudioProgress(0);
  };

  const handleCloseQA = () => {
    setSelectedRecord(null);
    setIsPlaying(false);
    if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
  };

  // Simulated audio playback
  const togglePlayAudio = () => {
    if (!isPlaying) {
      setIsPlaying(true);
      audioIntervalRef.current = window.setInterval(() => {
        setAudioProgress((prev) => {
          if (prev >= 100) {
            clearInterval(audioIntervalRef.current!);
            setIsPlaying(false);
            return 0;
          }
          return prev + 2;
        });
      }, 300);
    } else {
      setIsPlaying(false);
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
    }
  };

  // Compute calculated QA Score (Weighted average formula)
  const previewTotalScore = useMemo(() => {
    let total = 0;
    QA_RUBRIC_CRITERIA.forEach((c) => {
      const score = rubricScores[c.id] ?? 0;
      total += (score * c.weight) / 100;
    });
    return Math.round(total);
  }, [rubricScores]);

  // Save QA Score
  const handleSaveQA = () => {
    if (!selectedRecord) return;
    const { isLowScore, lockedAgentName } = callCenterStore.updateQAScore(
      selectedRecord.id,
      rubricScores,
      previewTotalScore,
      qaComment,
      "Trần Trọng Đạo (Supervisor)",
    );

    if (isLowScore) {
      notify(
        "Khóa trạng thái trực & Ghi danh đào tạo",
        `Điểm QA: ${previewTotalScore}/100 (<60). Chuyên viên "${lockedAgentName || selectedRecord.agentName}" đã tự động bị khóa quyền nhận cuộc gọi và ghi danh bắt buộc vào khóa học bồi dưỡng tại mục Đào tạo.`,
        "warning",
        {
          label: "Xem mục Đào tạo",
          onClick: () => setActiveView("thesis"),
        },
      );
    } else {
      notify("Đã lưu đánh giá QA", `Điểm số ${previewTotalScore}/100 đã được ghi nhận cho cuộc gọi của ${selectedRecord.callerName}.`, "success");
    }

    handleCloseQA();
  };

  // Filter records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (activeFilter === "inbound") return r.direction === "inbound";
      if (activeFilter === "missed") return r.direction === "missed";
      if (activeFilter === "need_qa") return r.qaScore === null && r.direction !== "missed";
      if (activeFilter === "low_score") return r.qaScore !== null && r.qaScore < 60;
      return true;
    });
  }, [records, activeFilter]);

  // Format seconds to MM:SS
  const formatDuration = (seconds: number) => {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · ${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="callcenter-page">
      {/* Page Header */}
      <div className="callcenter-header">
        <div>
          <h1 className="callcenter-header__title">Danh sách cuộc gọi &amp; Đánh giá QA</h1>
          <p className="callcenter-header__subtitle">
            Nhật ký lịch sử cuộc gọi (CDR), nghe lại file ghi âm và kiểm định chất lượng tư vấn học vụ
          </p>
        </div>
      </div>

      {/* Bộ lọc pill phía trên */}
      <div className="callcenter-filter-row" style={{ marginBottom: 20 }} role="tablist">
        {[
          { key: "all", label: "Tất cả" },
          { key: "inbound", label: "Cuộc gọi đến" },
          { key: "missed", label: "Cuộc gọi nhỡ" },
          { key: "need_qa", label: "Cần chấm điểm QA" },
          { key: "low_score", label: "Điểm QA thấp (<60)" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`callcenter-pill ${activeFilter === tab.key ? "is-active" : ""}`}
            onClick={() => setActiveFilter(tab.key as FilterTab)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bảng danh sách cuộc gọi (CDR) */}
      <div className="cdr-table-card">
        <div className="cdr-table-wrapper">
          <table className="cdr-table">
            <thead>
              <tr>
                <th>Người gọi / Sinh viên</th>
                <th>Đơn vị tiếp nhận</th>
                <th>Chuyên viên / Tutor</th>
                <th>Thời lượng</th>
                <th>Thời gian</th>
                <th>Ghi âm</th>
                <th>Điểm QA</th>
                <th style={{ textAlign: "right" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "36px 0", color: "#94A3B8" }}>
                    Không có cuộc gọi nào phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => (
                  <tr key={r.id}>
                    {/* Người gọi */}
                    <td>
                      <div style={{ fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{r.callerName}</span>
                        {r.studentId && <span className="call-item-mssv">{r.studentId}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>{r.phoneNumber}</div>
                    </td>

                    {/* Đơn vị */}
                    <td>
                      <span className="badge badge--blue">{r.branch}</span>
                    </td>

                    {/* Chuyên viên */}
                    <td>
                      <span style={{ fontWeight: 600 }}>{r.agentName}</span>
                    </td>

                    {/* Thời lượng */}
                    <td>
                      {r.direction === "missed" ? (
                        <span style={{ color: "#EF4444", fontWeight: 600 }}>Nhỡ</span>
                      ) : (
                        formatDuration(r.duration)
                      )}
                    </td>

                    {/* Thời gian */}
                    <td style={{ color: "#64748B", fontSize: 12 }}>{formatDate(r.timestamp)}</td>

                    {/* File ghi âm */}
                    <td>
                      {r.direction !== "missed" && r.recordingUrl ? (
                        <button
                          type="button"
                          className="audio-player-pill"
                          onClick={() => handleOpenQA(r)}
                          title="Nghe file ghi âm"
                        >
                          <Icon name="play" size={12} />
                          <span>Nghe</span>
                        </button>
                      ) : (
                        <span style={{ color: "#CBD5E1", fontSize: 12 }}>—</span>
                      )}
                    </td>

                    {/* Điểm QA */}
                    <td>
                      {r.qaScore !== null ? (
                        <span
                          className={`qa-score-badge ${
                            r.qaScore >= 80
                              ? "score-high"
                              : r.qaScore >= 60
                                ? "score-mid"
                                : "score-low"
                          }`}
                        >
                          {r.qaScore >= 80 ? "⭐ " : r.qaScore < 60 ? "⚠️ " : ""}
                          {r.qaScore}/100
                        </span>
                      ) : r.direction === "missed" ? (
                        <span style={{ color: "#94A3B8", fontSize: 11.5 }}>Không áp dụng</span>
                      ) : (
                        <span className="qa-score-badge score-none">Chưa chấm</span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td style={{ textAlign: "right" }}>
                      {r.direction !== "missed" && (
                        <button
                          type="button"
                          className="button button--sm button--secondary"
                          onClick={() => handleOpenQA(r)}
                        >
                          {r.qaScore !== null ? "Chấm lại" : "Chấm điểm QA"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer Chấm điểm QA bên phải */}
      {selectedRecord && (
        <div className="qa-drawer-backdrop" onClick={handleCloseQA}>
          <div className="qa-drawer" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="qa-drawer__head">
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0F172A" }}>
                  Chấm điểm QA cuộc gọi
                </h3>
                <span style={{ fontSize: 12, color: "#64748B" }}>
                  Chuyên viên: <strong>{selectedRecord.agentName}</strong> · Người gọi: {selectedRecord.callerName} ({selectedRecord.studentId || "N/A"})
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={handleCloseQA}
                title="Đóng"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="qa-drawer__body">
              {/* Audio Box */}
              <div className="qa-audio-box">
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748B" }}>
                  <span>File ghi âm cuộc gọi ({formatDuration(selectedRecord.duration)})</span>
                  <span>{isPlaying ? "Đang phát..." : "Tạm dừng"}</span>
                </div>
                <div className="qa-audio-controls">
                  <button
                    type="button"
                    className="qa-play-btn"
                    onClick={togglePlayAudio}
                  >
                    <Icon name={isPlaying ? "minus" : "play"} size={16} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        height: 6,
                        background: "#E2E8F0",
                        borderRadius: 3,
                        overflow: "hidden",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: `${audioProgress}%`,
                          height: "100%",
                          background: "#2563EB",
                          transition: "width 0.2s linear",
                        }}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "#64748B" }}>
                    {formatDuration(Math.round((selectedRecord.duration * audioProgress) / 100))}
                  </span>
                </div>
              </div>

              {/* Rubric Table */}
              <div>
                <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                  Bảng tiêu chí Rubric đánh giá (Thang điểm 100)
                </h4>
                <table className="qa-rubric-table">
                  <thead>
                    <tr>
                      <th>Tiêu chí</th>
                      <th>Trọng số</th>
                      <th style={{ width: 85, textAlign: "center" }}>Điểm (0-100)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {QA_RUBRIC_CRITERIA.map((criterion) => (
                      <tr key={criterion.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: "#0F172A" }}>
                            {criterion.code} · {criterion.name}
                          </div>
                          <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>
                            {criterion.description}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge--blue">{criterion.weight}%</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className="qa-score-input"
                            value={rubricScores[criterion.id] ?? ""}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                              setRubricScores({ ...rubricScores, [criterion.id]: val });
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                    <tr className="qa-total-row">
                      <td colSpan={2}>Tổng điểm tạm tính (Quy đổi trọng số)</td>
                      <td style={{ textAlign: "center", fontSize: 16 }}>
                        <span
                          style={{
                            color: previewTotalScore < 60 ? "#DC2626" : previewTotalScore >= 80 ? "#059669" : "#D97706",
                          }}
                        >
                          {previewTotalScore}/100
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Alert nếu điểm < 60 */}
              {previewTotalScore < 60 && (
                <div className="qa-lock-alert">
                  <Icon name="warning" size={20} style={{ flexShrink: 0, color: "#DC2626" }} />
                  <div>
                    <strong>Cảnh báo vi phạm chuẩn chất lượng (Điểm &lt; 60):</strong>
                    <div style={{ marginTop: 2 }}>
                      Nếu lưu kết quả này, Chuyên viên <strong>{selectedRecord.agentName}</strong> sẽ tự động bị{" "}
                      <strong>khóa quyền tiếp nhận cuộc gọi</strong> và được ghi danh bắt buộc vào khóa học bổ trợ nghiệp vụ tại mục <strong>Đào tạo</strong>.
                    </div>
                  </div>
                </div>
              )}

              {/* Nhận xét của Supervisor */}
              <div className="field">
                <label>Nhận xét chi tiết của Supervisor</label>
                <textarea
                  rows={3}
                  value={qaComment}
                  placeholder="Ghi chú đánh giá về thái độ, nội dung cung cấp và điểm cần cải thiện..."
                  onChange={(e) => setQaComment(e.target.value)}
                  style={{
                    width: "100%",
                    border: "1px solid #E2E8F0",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 13,
                  }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="qa-drawer__footer">
              <button
                type="button"
                className="button button--ghost"
                onClick={handleCloseQA}
              >
                Hủy
              </button>
              <button
                type="button"
                className={`button ${previewTotalScore < 60 ? "button--danger" : "button--primary"}`}
                onClick={handleSaveQA}
              >
                {previewTotalScore < 60 ? "Lưu & Khóa Agent để đào tạo" : "Lưu đánh giá QA"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
