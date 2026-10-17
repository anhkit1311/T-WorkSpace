import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { Badge, Button } from "../../shared/ui/Primitives";
import { callCenterStore } from "../call-center/call-center-store";
import { elearningStore } from "./elearning-store";
import type { CourseItem, ElearningFilter } from "./types";
import "./elearning.css";

const FILTER_PILLS: ElearningFilter[] = [
  "Tất cả",
  "Bắt buộc từ QA",
  "Nghiệp vụ Tổng đài",
  "Học vụ & Đào tạo",
  "Công nghệ Thông tin",
];

export function ELearningPage() {
  const { user, setActiveView, notify } = useApp();
  const [courses, setCourses] = useState<CourseItem[]>(() => elearningStore.getCourses());
  const [selectedFilter, setSelectedFilter] = useState<ElearningFilter>("Tất cả");
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);

  // Agent status subscription from Call Center
  const [agentStatus, setAgentStatus] = useState(() => callCenterStore.getAgentStatus());

  useEffect(() => {
    const unsubElearn = elearningStore.subscribe(() => {
      setCourses(elearningStore.getCourses());
    });
    const unsubCallCenter = callCenterStore.subscribe(() => {
      setAgentStatus(callCenterStore.getAgentStatus());
      setCourses(elearningStore.getCourses());
    });
    return () => {
      unsubElearn();
      unsubCallCenter();
    };
  }, []);

  const activeCourse = useMemo(() => {
    return courses.find((c) => c.id === activeCourseId);
  }, [courses, activeCourseId]);

  // Quiz state in viewer
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizPassed, setQuizPassed] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  const isQALocked = agentStatus === "qa_locked";

  // Filtered courses
  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      if (selectedFilter === "Tất cả") return true;
      if (selectedFilter === "Bắt buộc từ QA") return course.isMandatoryQA;
      return course.category === selectedFilter;
    });
  }, [courses, selectedFilter]);

  // Handle Tutor WebRTC Softphone Call
  const handleCallTutor = () => {
    if (!activeCourse) return;
    const studentName = user?.displayName || "Sinh viên TDTU";
    const studentId = "52100845";

    callCenterStore.addTutorCall(
      studentName,
      studentId,
      `Hỏi đáp học phần: ${activeCourse.title}`,
    );

    notify(
      "Đã kết nối Tutor Học thuật",
      `Yêu cầu hỗ trợ bài giảng "${activeCourse.title}" đã được đưa vào hàng đợi Tutor của Tổng đài.`,
      "success",
      {
        label: "Mở Tổng đài",
        onClick: () => setActiveView("call-center"),
      },
    );
  };

  // Submit Final Quiz
  const handleSubmitQuiz = () => {
    if (!activeCourse || !activeCourse.finalQuiz.length) return;

    let correctCount = 0;
    activeCourse.finalQuiz.forEach((q) => {
      if (quizAnswers[q.id] === q.correctIndex) {
        correctCount++;
      }
    });

    const scorePercent = Math.round((correctCount / activeCourse.finalQuiz.length) * 100);
    setQuizScore(scorePercent);
    setQuizSubmitted(true);

    const passed = elearningStore.completeQuizAndUnlockQA(activeCourse.id, scorePercent);
    setQuizPassed(passed);

    if (passed) {
      notify(
        "Đạt chuẩn bài kiểm tra cuối khóa!",
        `Chúc mừng bạn đã hoàn thành bài thi với điểm số ${scorePercent}%. Trạng thái trực tổng đài đã được MỞ KHÓA tự động!`,
        "success",
      );
    } else {
      notify(
        "Chưa đạt điểm chuẩn",
        `Điểm số của bạn là ${scorePercent}% (yêu cầu tối thiểu 80%). Vui lòng xem lại bài giảng và thử lại.`,
        "warning",
      );
    }
  };

  return (
    <div className="elearning-page">
      {!activeCourse ? (
        /* ------------------------------------------------------------------
           CATALOG VIEW (Danh sách khóa học E-Learning)
           ------------------------------------------------------------------ */
        <>
          <div className="elearning-header">
            <h1 className="elearning-header__title">Đào tạo Trực tuyến (E-Learning)</h1>
            <p className="elearning-header__subtitle">
              Cổng bồi dưỡng nghiệp vụ học vụ, văn hóa tổng đài và phát triển kỹ năng nội bộ TDTU
            </p>
          </div>

          {/* Cảnh báo Bắt buộc Đào tạo từ QA nếu Agent bị khóa */}
          {isQALocked && (
            <div className="elearning-qa-alert" role="alert">
              <div className="elearning-qa-alert__left">
                <Icon name="warning" size={24} style={{ color: "#DC2626" }} />
                <div>
                  <div className="elearning-qa-alert__title">
                    Trạng thái trực của bạn đang bị KHÓA do điểm đánh giá QA &lt; 60
                  </div>
                  <p className="elearning-qa-alert__desc">
                    Bạn được chỉ định hoàn thành khóa học bồi dưỡng bắt buộc bên dưới và vượt qua bài
                    kiểm tra (≥ 80%) để kích hoạt lại quyền nhận cuộc gọi tại Tổng đài.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setActiveCourseId("c-qa-101");
                  setQuizAnswers({});
                  setQuizSubmitted(false);
                }}
              >
                Vào học ngay
              </Button>
            </div>
          )}

          {/* 3 Thẻ KPI Thống kê Khóa học */}
          <div className="elearning-kpi-grid">
            <div className="elearning-kpi-card">
              <div className="elearning-kpi-card__icon elearning-kpi-card__icon--enrolled">
                <Icon name="book" size={22} strokeWidth={1.8} />
              </div>
              <div>
                <div className="elearning-kpi-card__number">{courses.length}</div>
                <div className="elearning-kpi-card__label">Khóa học khả dụng</div>
              </div>
            </div>

            <div className="elearning-kpi-card">
              <div className="elearning-kpi-card__icon elearning-kpi-card__icon--qa">
                <Icon name="shield" size={22} strokeWidth={1.8} />
              </div>
              <div>
                <div className="elearning-kpi-card__number">
                  {courses.filter((c) => c.isMandatoryQA).length}
                </div>
                <div className="elearning-kpi-card__label">Khóa học bắt buộc từ QA</div>
              </div>
            </div>

            <div className="elearning-kpi-card">
              <div className="elearning-kpi-card__icon elearning-kpi-card__icon--score">
                <Icon name="check-square" size={22} strokeWidth={1.8} />
              </div>
              <div>
                <div className="elearning-kpi-card__number">88.5%</div>
                <div className="elearning-kpi-card__label">Điểm trung bình hoàn thành</div>
              </div>
            </div>
          </div>

          {/* Pill Bộ lọc Phân loại */}
          <div className="elearning-filter-row" role="tablist" aria-label="Bộ lọc khóa học">
            {FILTER_PILLS.map((pill) => (
              <button
                key={pill}
                type="button"
                className={`elearning-filter-pill ${selectedFilter === pill ? "is-active" : ""}`}
                onClick={() => setSelectedFilter(pill)}
              >
                {pill}
              </button>
            ))}
          </div>

          {/* Lưới Thẻ Khóa học */}
          <div className="elearning-course-grid">
            {filteredCourses.map((course) => (
              <div
                key={course.id}
                className={`elearning-card ${course.isMandatoryQA ? "is-mandatory" : ""}`}
                onClick={() => {
                  setActiveCourseId(course.id);
                  setQuizAnswers({});
                  setQuizSubmitted(false);
                }}
              >
                {/* Nửa trên: Gradient Banner */}
                <div className="elearning-card__banner" style={{ background: course.gradient }}>
                  <div className="elearning-card__badges">
                    <span className="elearning-card__cat-badge">{course.category}</span>
                    {course.isMandatoryQA && (
                      <span className="elearning-card__qa-badge">
                        <Icon name="warning" size={12} /> Bắt buộc từ QA
                      </span>
                    )}
                  </div>
                  <div className="elearning-card__banner-title">{course.title}</div>
                </div>

                {/* Nửa dưới: Nội dung, Giảng viên & Tiến độ */}
                <div className="elearning-card__body">
                  <p className="elearning-card__desc">{course.description}</p>

                  <div className="elearning-card__meta">
                    <div className="elearning-card__instructor">
                      <Icon name="user-plus" size={14} style={{ color: "#2563EB" }} />
                      <span>{course.instructor}</span>
                    </div>
                    <span>{course.duration}</span>
                  </div>

                  {/* Thanh tiến độ */}
                  <div className="elearning-card__progress-wrap">
                    <div className="elearning-card__progress-head">
                      <span>Tiến độ hoàn thành</span>
                      <span>{course.progress}%</span>
                    </div>
                    <div className="elearning-card__progress-bar">
                      <div
                        className={`elearning-card__progress-fill ${course.progress === 100 ? "is-complete" : ""}`}
                        style={{ width: `${course.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="elearning-card__action">
                    <button type="button" className="elearning-card__btn">
                      <Icon name="play" size={14} />
                      <span>{course.progress > 0 ? "Tiếp tục học" : "Bắt đầu học"}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* ------------------------------------------------------------------
           COURSE VIEWER & TUTOR CALL SCREEN (Chi tiết bài học & Kiểm tra)
           ------------------------------------------------------------------ */
        <div className="elearning-viewer">
          {/* Thanh tác vụ trên cùng */}
          <div className="elearning-viewer__topbar">
            <div className="elearning-viewer__topbar-left">
              <Button
                variant="secondary"
                size="sm"
                icon="arrow-right"
                style={{ transform: "rotate(180deg)" }}
                onClick={() => setActiveCourseId(null)}
              >
                Danh mục
              </Button>
              <h2 className="elearning-viewer__title">{activeCourse.title}</h2>
              {activeCourse.isMandatoryQA && (
                <Badge tone="red">
                  <Icon name="warning" size={12} /> Bắt buộc từ QA
                </Badge>
              )}
            </div>

            {/* NÚT GỌI TUTOR HỖ TRỢ (Màu xanh #2563EB) */}
            <button
              type="button"
              className="elearning-btn-tutor"
              onClick={handleCallTutor}
              title="Mở kết nối WebRTC tới hàng đợi Tutor Học thuật bên mục Tổng đài"
            >
              <Icon name="phone-call" size={16} />
              <span>Gọi Tutor Hỗ trợ</span>
            </button>
          </div>

          {/* Bố cục 2 cột (70% - 30%) */}
          <div className="elearning-viewer__grid">
            {/* Cột trái: Khung phát Video & Bài kiểm tra cuối khóa */}
            <div className="elearning-player-card">
              <div className="elearning-player-screen">
                {activeCourse.videoUrl ? (
                  <video
                    src={activeCourse.videoUrl}
                    controls
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ textAlign: "center", padding: "40px" }}>
                    <Icon name="book" size={48} style={{ color: "#3B82F6", marginBottom: "12px" }} />
                    <div style={{ fontSize: "16px", fontWeight: 600 }}>Tài liệu Bài giảng Điện tử</div>
                    <p style={{ fontSize: "13px", color: "#94A3B8" }}>
                      Xem tài liệu chuẩn hóa và hoàn thành các bài học trước khi làm bài thi.
                    </p>
                  </div>
                )}
              </div>

              <div className="elearning-player-content">
                <h3 style={{ fontSize: "17px", fontWeight: 700, margin: "0 0 8px", color: "#0F172A" }}>
                  Mô tả bài học &amp; Yêu cầu chuẩn đầu ra
                </h3>
                <p style={{ fontSize: "13.5px", color: "#475569", lineHeight: 1.6, margin: "0 0 20px" }}>
                  {activeCourse.description}
                </p>

                {/* BÀI KIỂM TRA TRẮC NGHIỆM CUỐI KHÓA */}
                {activeCourse.finalQuiz.length > 0 && (
                  <div className="elearning-quiz-box">
                    <div className="elearning-quiz-box__head">
                      <div>
                        <h4
                          style={{
                            fontSize: "15px",
                            fontWeight: 700,
                            margin: 0,
                            color: "#0F172A",
                          }}
                        >
                          Bài kiểm tra trắc nghiệm cuối khóa
                        </h4>
                        <span style={{ fontSize: "12px", color: "#64748B" }}>
                          Yêu cầu đạt tối thiểu 80% để hoàn tất khóa học &amp; mở khóa Tổng đài
                        </span>
                      </div>
                      <Badge tone={quizSubmitted ? (quizPassed ? "green" : "red") : "blue"}>
                        {quizSubmitted
                          ? `${quizScore}% · ${quizPassed ? "Đạt" : "Chưa đạt"}`
                          : `${activeCourse.finalQuiz.length} câu hỏi`}
                      </Badge>
                    </div>

                    {/* Danh sách câu hỏi */}
                    {activeCourse.finalQuiz.map((q, qIndex) => (
                      <div key={q.id} className="elearning-quiz-question-item">
                        <div className="elearning-quiz-q-title">
                          Câu {qIndex + 1}: {q.question}
                        </div>
                        <div>
                          {q.options.map((opt, optIndex) => {
                            const isChecked = quizAnswers[q.id] === optIndex;
                            return (
                              <div
                                key={optIndex}
                                className={`elearning-quiz-opt ${isChecked ? "is-checked" : ""}`}
                                onClick={() => {
                                  if (!quizSubmitted || !quizPassed) {
                                    setQuizAnswers((prev) => ({ ...prev, [q.id]: optIndex }));
                                  }
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`question-${q.id}`}
                                  checked={isChecked}
                                  onChange={() => {}}
                                />
                                <span>
                                  <strong>{String.fromCharCode(65 + optIndex)}.</strong> {opt}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {quizSubmitted && (
                          <div
                            style={{
                              marginTop: "8px",
                              fontSize: "12px",
                              color:
                                quizAnswers[q.id] === q.correctIndex ? "#16A34A" : "#DC2626",
                            }}
                          >
                            <strong>
                              {quizAnswers[q.id] === q.correctIndex
                                ? "✓ Chính xác"
                                : `✗ Sai (Đáp án đúng: ${String.fromCharCode(65 + q.correctIndex)})`}
                              :
                            </strong>{" "}
                            {q.explanation}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Kết quả đậu & Mở khóa Tổng đài */}
                    {quizSubmitted && quizPassed && (
                      <div className="elearning-quiz-passed">
                        <Icon name="check-square" size={28} style={{ color: "#16A34A" }} />
                        <div style={{ flex: 1 }}>
                          <div className="elearning-quiz-passed__title">
                            Chúc mừng! Bạn đã hoàn thành khóa học đạt chuẩn ({quizScore}%)
                          </div>
                          <div style={{ fontSize: "12.5px" }}>
                            Trạng thái tiếp nhận cuộc gọi của bạn tại Tổng đài đã được{" "}
                            <strong>MỞ KHÓA TỰ ĐỘNG</strong>. Bạn có thể quay lại làm việc bình thường.
                          </div>
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setActiveView("call-center")}
                        >
                          Vào Tổng đài
                        </Button>
                      </div>
                    )}

                    {/* Nút nộp bài */}
                    {(!quizSubmitted || !quizPassed) && (
                      <Button
                        variant="primary"
                        onClick={handleSubmitQuiz}
                        disabled={
                          Object.keys(quizAnswers).length < activeCourse.finalQuiz.length
                        }
                      >
                        Nộp bài kiểm tra cuối khóa
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Cột phải: Giáo trình các bài học & Thông tin Giảng viên */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="elearning-syllabus-card">
                <div className="elearning-syllabus-head">
                  Danh sách bài học ({activeCourse.lessons.length})
                </div>
                <div>
                  {activeCourse.lessons.map((lesson, idx) => (
                    <div
                      key={lesson.id}
                      className={`elearning-lesson-item ${idx === 0 ? "is-active" : ""}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Icon
                          name={lesson.completed ? "check" : "play"}
                          size={14}
                          style={{ color: lesson.completed ? "#16A34A" : "#64748B" }}
                        />
                        <span>{lesson.title}</span>
                      </div>
                      <span style={{ fontSize: "11.5px", color: "#94A3B8" }}>
                        {lesson.duration}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Thông tin Giảng viên */}
              <div className="elearning-syllabus-card">
                <div className="elearning-syllabus-head">Thông tin Giảng viên</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "10px",
                      background: "#EFF6FF",
                      color: "#2563EB",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                    }}
                  >
                    {activeCourse.instructor.slice(0, 1)}
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#0F172A" }}>
                      {activeCourse.instructor}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748B" }}>
                      {activeCourse.instructorRole}
                    </div>
                  </div>
                </div>
              </div>

              {/* Box Hỗ trợ Tutor nhanh */}
              <div
                style={{
                  padding: "16px",
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: "14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <Icon name="phone-call" size={16} style={{ color: "#2563EB" }} />
                  <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#1D4ED8" }}>
                    Cần giải đáp thắc mắc?
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "#3B82F6", margin: "0 0 12px" }}>
                  Bấm nút bên dưới để kết nối trực tiếp với Tutor chuyên trách hỗ trợ giải đáp bài học này.
                </p>
                <button
                  type="button"
                  className="elearning-btn-tutor"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={handleCallTutor}
                >
                  <Icon name="phone-call" size={14} />
                  <span>Gọi Tutor Hỗ trợ ngay</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
