export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LessonItem {
  id: string;
  title: string;
  duration: string;
  completed: boolean;
}

export interface CourseItem {
  id: string;
  title: string;
  category: "Nghiệp vụ Tổng đài" | "Học vụ & Đào tạo" | "Công nghệ Thông tin" | "Kỹ năng Mềm";
  instructor: string;
  instructorRole: string;
  duration: string;
  lessonsCount: number;
  progress: number; // 0 - 100
  isMandatoryQA: boolean; // True if assigned automatically due to QA score < 60
  gradient: string;
  badge: string;
  description: string;
  videoUrl?: string;
  lessons: LessonItem[];
  finalQuiz: QuizQuestion[];
}

export type ElearningFilter =
  | "Tất cả"
  | "Bắt buộc từ QA"
  | "Nghiệp vụ Tổng đài"
  | "Học vụ & Đào tạo"
  | "Công nghệ Thông tin";
