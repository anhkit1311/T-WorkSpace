// E-learning (EL-1..EL-6, LT-1, LT-2).

export type CourseStatus = "draft" | "published" | "archived";
export type CourseEnrollmentMode = "open" | "assigned";
export type LessonKind = "video" | "document" | "quiz" | "live";
export type LessonStatus = "draft" | "published";
export type LessonMediaStatus = "none" | "processing" | "ready" | "failed";
export type QuestionKind = "single" | "multiple" | "true_false";

export interface CourseSummary {
  id: string;
  code: string;
  title: string;
  description: string;
  unitId: string;
  unitName: string;
  ownerName: string;
  status: CourseStatus;
  enrollment: CourseEnrollmentMode;
  lessonCount: number;
  learnerCount: number;
  enrolled: boolean;
  /** Completion of the current user, when enrolled. */
  progress: number | null;
  canManage: boolean;
  canEnroll: boolean;
}

export interface LessonSummary {
  id: string;
  chapterId: string;
  title: string;
  kind: LessonKind;
  status: LessonStatus;
  position: number;
  durationSeconds: number | null;
  mediaStatus: LessonMediaStatus;
  completed: boolean;
}

export interface CourseChapter {
  id: string;
  title: string;
  position: number;
  lessons: LessonSummary[];
}

/** EL-8: a completion certificate; `code` is looked up publicly at /verify/<code>. */
export interface CourseCertificate {
  code: string;
  learnerName: string;
  courseCode: string;
  courseTitle: string;
  unitName: string;
  instructors: string[];
  lessonCount: number;
  issuedAt: string;
}

export interface CourseDetail extends CourseSummary {
  chapters: CourseChapter[];
  instructors: { userId: string; displayName: string }[];
  /** LT-1: the unit runs a call-center department with this hotline. */
  supportHotline: string | null;
}

export interface QuizInfo {
  timeLimitSeconds: number | null;
  passPercent: number;
  questionIds: string[];
  /** Questions drawn at random per attempt (null: all of them). */
  drawCount: number | null;
  /** Question and option order shuffled per attempt. */
  shuffle: boolean;
  /** Best percentage of the current user, if attempted. */
  bestPercent: number | null;
  passed: boolean;
  openAttemptId: string | null;
}

export interface LiveInfo {
  scheduleId: string | null;
  roomId: string | null;
  workspaceId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  attendanceClosed: boolean;
  /** The current user's attendance once the class is closed. */
  attended: boolean | null;
  ratio: number | null;
}

export interface LessonDetail extends LessonSummary {
  courseId: string;
  body: string;
  mediaName: string | null;
  mediaError: string | null;
  recordingId: string | null;
  /** M3: captions.vtt / transcript.json are available when "ready". */
  transcriptStatus: "processing" | "ready" | "failed" | null;
  canManage: boolean;
  quiz: QuizInfo | null;
  live: LiveInfo | null;
  /** EL-5: the learner's watch time of a video of known length; null for others and for staff. */
  watch: { watchedSeconds: number; positionSeconds: number } | null;
}

export interface CourseQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: { id: string; text: string }[];
  /** Option ids, or [true]/[false]. */
  answer: (string | boolean)[];
  explanation: string;
  points: number;
}

export interface QuizAttempt {
  id: string;
  lessonId: string;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  questions: { id: string; kind: QuestionKind; prompt: string; options: { id: string; text: string }[]; points: number }[];
  /** The learner's answers so far (autosaved draft before submission). */
  answers: Record<string, (string | boolean)[]>;
  savedAt: string | null;
  /** After submission: score and, per question, whether it was right and why. */
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  review: { questionId: string; correct: boolean; answer: (string | boolean)[]; explanation: string }[] | null;
}

export interface CourseProgressReport {
  lessons: { id: string; title: string; kind: LessonKind }[];
  learners: {
    userId: string;
    displayName: string;
    email: string;
    source: "self" | "assigned";
    percent: number;
    completedLessonIds: string[];
    /** Best quiz percentage per quiz lesson. */
    quizPercents: Record<string, number>;
    completedAt: string | null;
  }[];
}

export interface LiveAttendanceRow {
  userId: string;
  displayName: string;
  presentSeconds: number;
  ratio: number;
  attended: boolean;
}

export interface CourseAssignmentResult {
  added: number;
  alreadyEnrolled: number;
  notFound: string[];
}
