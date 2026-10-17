import type { CourseItem } from "./types";
import { callCenterStore } from "../call-center/call-center-store";

export const INITIAL_COURSES: CourseItem[] = [
  {
    id: "c-qa-101",
    title: "Quy chuẩn Giao tiếp & Xử lý Cuộc gọi Tổng đài TDTU",
    category: "Nghiệp vụ Tổng đài",
    instructor: "ThS. Trần Trọng Đạo",
    instructorRole: "Trưởng ban Đảm bảo Chất lượng Đào tạo",
    duration: "45 phút",
    lessonsCount: 4,
    progress: 0,
    isMandatoryQA: true, // Auto marked when QA score is low
    gradient: "linear-gradient(135deg, #B91C1C 0%, #EA580C 100%)",
    badge: "Khóa học Bồi dưỡng QA",
    description:
      "Huấn luyện chuẩn mực chào hỏi, quy tắc xác minh MSSV sinh viên TDTU, tác phong lắng nghe và kỹ năng tư vấn hướng dẫn thủ tục học vụ chính xác.",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    lessons: [
      { id: "l1", title: "Bài 1: Văn hóa ứng xử & Quy chuẩn xưng hô tại Tổng đài TDTU", duration: "10:15", completed: true },
      { id: "l2", title: "Bài 2: Quy trình 3 bước xác minh danh tính và MSSV sinh viên", duration: "12:30", completed: true },
      { id: "l3", title: "Bài 3: Kỹ năng xử lý tình huống khiếu nại & tra cứu quy chế học vụ", duration: "15:00", completed: false },
      { id: "l4", title: "Bài 4: Hướng dẫn kết thúc cuộc gọi & ghi nhận ticket vào Bảng phân công", duration: "08:45", completed: false },
    ],
    finalQuiz: [
      {
        id: "q1",
        question: "Khi tiếp nhận cuộc gọi từ sinh viên, chuyên viên tổng đài cần thực hiện bước đầu tiên nào theo đúng chuẩn mực TDTU?",
        options: [
          "Hỏi ngay sinh viên cần gì mà không cần chào",
          "Chào đúng quy chuẩn TDTU, xưng danh lịch thiệp và đề nghị xác minh MSSV của người gọi",
          "Chuyển máy ngay sang số nội bộ của Phòng Đại học",
          "Yêu cầu sinh viên cúp máy và gửi email bằng tài khoản trường",
        ],
        correctIndex: 1,
        explanation: "Quy chuẩn văn hóa TDTU yêu cầu mở đầu cuộc gọi bằng lời chào lịch sự và xác minh MSSV để đảm bảo bảo mật thông tin học vụ.",
      },
      {
        id: "q2",
        question: "Để hướng dẫn sinh viên nộp đơn hoãn thi đúng thời hạn, chuyên viên cần căn cứ vào nguồn nào?",
        options: [
          "Thông tin truyền miệng từ sinh viên khóa trước",
          "Cổng thông tin đào tạo tín chỉ và biểu mẫu chính thức của Phòng Đại học TDTU",
          "Dự đoán cá nhân dựa trên kinh nghiệm",
          "Nhóm Facebook không chính thức của sinh viên",
        ],
        correctIndex: 1,
        explanation: "Mọi thông tin học vụ và biểu mẫu hoãn thi bắt buộc phải dựa trên thông báo chính thức của Phòng Đại học.",
      },
      {
        id: "q3",
        question: "Sau khi hỗ trợ cuộc gọi có khúc mắc chưa thể xử lý ngay trong ca trực, chuyên viên cần làm gì?",
        options: [
          "Gác máy và bỏ qua cuộc gọi",
          "Tạo phiếu công việc vào Bảng phân công (Task/Ticket) với đầy đủ MSSV và nội dung cần phối hợp",
          "Nhắn tin riêng qua mạng xã hội của sinh viên",
          "Yêu cầu sinh viên tự lên văn phòng khoa tìm giảng viên",
        ],
        correctIndex: 1,
        explanation: "Tạo ticket vào Bảng phân công giúp liên thông học vụ giữa tổng đài và các phòng ban chuyên trách.",
      },
    ],
  },
  {
    id: "c-elearn-102",
    title: "Quy chế Học vụ & Đào tạo Tín chỉ Đại học 2026",
    category: "Học vụ & Đào tạo",
    instructor: "Phòng Đại học TDTU",
    instructorRole: "Ban Quản trị Đào tạo",
    duration: "60 phút",
    lessonsCount: 5,
    progress: 65,
    isMandatoryQA: false,
    gradient: "linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)",
    badge: "Quy chế Học vụ",
    description:
      "Toàn tập quy chế đào tạo tín chỉ, đăng ký môn học, cảnh báo học vụ, chuẩn đầu ra ngoại ngữ và điều kiện xét tốt nghiệp.",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    lessons: [
      { id: "l10", title: "Tổng quan chương trình đào tạo & thang điểm tín chỉ", duration: "12:00", completed: true },
      { id: "l11", title: "Quy trình đăng ký môn học và rút học phần", duration: "14:20", completed: true },
      { id: "l12", title: "Xử lý học vụ: Cảnh báo kết quả học tập & buộc thôi học", duration: "11:50", completed: true },
      { id: "l13", title: "Điều kiện xét làm Khóa luận / Đồ án tốt nghiệp", duration: "15:00", completed: false },
      { id: "l14", title: "Chuẩn đầu ra ngoại ngữ (TOEIC/IELTS) và Tin học (MOS)", duration: "10:30", completed: false },
    ],
    finalQuiz: [
      {
        id: "q20",
        question: "Sinh viên tích lũy đủ tối thiểu bao nhiêu tín chỉ thì được đăng ký làm Đồ án tốt nghiệp?",
        options: ["100 tín chỉ", "110 tín chỉ", "Tối thiểu 85% tổng số tín chỉ của chương trình đào tạo", "Không giới hạn"],
        correctIndex: 2,
        explanation: "Quy chế TDTU quy định sinh viên phải hoàn thành tối thiểu 85% khối lượng tín chỉ và không nợ các môn tiên quyết.",
      },
    ],
  },
  {
    id: "c-elearn-103",
    title: "Kiến trúc Hệ thống Phân tán & WebRTC SFU",
    category: "Công nghệ Thông tin",
    instructor: "TS. Nguyễn Đăng Khoa",
    instructorRole: "Khoa Công nghệ Thông tin",
    duration: "90 phút",
    lessonsCount: 6,
    progress: 40,
    isMandatoryQA: false,
    gradient: "linear-gradient(135deg, #065F46 0%, #10B981 100%)",
    badge: "Công nghệ Chuyên sâu",
    description:
      "Tìm hiểu cơ chế Selective Forwarding Unit, Mediasoup C++ worker, giao thức RTP/RTCP, simulcast và tối ưu băng thông video đa điểm.",
    lessons: [
      { id: "l20", title: "Kiến trúc Mesh vs MCU vs SFU trong WebRTC", duration: "18:00", completed: true },
      { id: "l21", title: "Mediasoup Architecture: Worker, Router, Transport", duration: "22:00", completed: true },
      { id: "l22", title: "Quản lý Băng thông & Simulcast Layers thích ứng", duration: "20:00", completed: false },
    ],
    finalQuiz: [],
  },
  {
    id: "c-elearn-104",
    title: "Kỹ năng Tư vấn Học phí & Chế độ Chính sách Sinh viên",
    category: "Học vụ & Đào tạo",
    instructor: "Phòng Tài chính TDTU",
    instructorRole: "Chuyên viên Tài vụ",
    duration: "35 phút",
    lessonsCount: 3,
    progress: 100,
    isMandatoryQA: false,
    gradient: "linear-gradient(135deg, #6B21A8 0%, #A855F7 100%)",
    badge: "Tài chính Học đường",
    description:
      "Phương thức thanh toán học phí qua cổng ngân hàng liên kết, miễn giảm diện gia đình chính sách và học bổng khuyến khích.",
    lessons: [
      { id: "l30", title: "Cổng thanh toán học phí trực tuyến liên ngân hàng", duration: "10:00", completed: true },
      { id: "l31", title: "Hồ sơ xét miễn giảm học phí con thương binh liệt sĩ", duration: "12:00", completed: true },
    ],
    finalQuiz: [],
  },
  {
    id: "c-elearn-105",
    title: "Nội quy Ký túc xá & Kỹ năng Sống Tập thể",
    category: "Học vụ & Đào tạo",
    instructor: "Ban Quản lý Ký túc xá",
    instructorRole: "Cố vấn Quản sinh",
    duration: "30 phút",
    lessonsCount: 3,
    progress: 10,
    isMandatoryQA: false,
    gradient: "linear-gradient(135deg, #92400E 0%, #F59E0B 100%)",
    badge: "Đời sống Sinh viên",
    description:
      "Quy định giờ giấc, đăng ký tạm trú, bảo quản tài sản công và phương án phòng cháy chữa cháy tại các tòa nhà KTX Khu A & B.",
    lessons: [
      { id: "l40", title: "Giờ giới nghiêm và quy định tiếp khách tại KTX", duration: "08:00", completed: true },
      { id: "l41", title: "Quy chuẩn PCCC & bảo quản thiết bị điện cá nhân", duration: "12:00", completed: false },
    ],
    finalQuiz: [],
  },
  {
    id: "c-elearn-106",
    title: "Kỹ năng Truyền thông & Tư vấn Tuyển sinh Đại học",
    category: "Kỹ năng Mềm",
    instructor: "Phòng Truyền thông & PR",
    instructorRole: "Chuyên viên Tư vấn Tuyển sinh",
    duration: "45 phút",
    lessonsCount: 4,
    progress: 0,
    isMandatoryQA: false,
    gradient: "linear-gradient(135deg, #1D4ED8 0%, #60A5FA 100%)",
    badge: "Tư vấn Tuyển sinh",
    description:
      "Cung cấp thông tin ngành đào tạo chất lượng cao, học bổng tân sinh viên và quy trình xét tuyển học bạ THPT.",
    lessons: [
      { id: "l50", title: "Các phương thức xét tuyển đại học chính quy 2026", duration: "15:00", completed: false },
      { id: "l51", title: "Giải đáp thắc mắc về chương trình liên kết quốc tế", duration: "12:00", completed: false },
    ],
    finalQuiz: [],
  },
];

class ElearningStore {
  private courses: CourseItem[] = [...INITIAL_COURSES];
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tdtu_elearning_courses");
      if (saved) {
        try {
          this.courses = JSON.parse(saved);
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

  public getCourses(): CourseItem[] {
    const isQALocked = callCenterStore.getAgentStatus() === "qa_locked";
    return this.courses.map((c) =>
      c.id === "c-qa-101" ? { ...c, isMandatoryQA: isQALocked } : c,
    );
  }

  public getCourseById(courseId: string): CourseItem | undefined {
    return this.getCourses().find((c) => c.id === courseId);
  }

  public completeQuizAndUnlockQA(courseId: string, scorePercent: number): boolean {
    const passed = scorePercent >= 80;
    if (passed) {
      // Unlock the agent status back to ready!
      callCenterStore.setAgentStatus("ready");

      // Update course progress to 100%
      this.courses = this.courses.map((c) =>
        c.id === courseId ? { ...c, progress: 100, isMandatoryQA: false } : c,
      );

      if (typeof window !== "undefined") {
        localStorage.setItem("tdtu_elearning_courses", JSON.stringify(this.courses));
      }
      this.notify();
    }
    return passed;
  }
}

export const elearningStore = new ElearningStore();
