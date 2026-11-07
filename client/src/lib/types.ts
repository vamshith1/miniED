// Shapes returned by the API. Dates arrive as ISO strings.

export type Role = "ADMIN" | "MENTOR" | "STUDENT";
export type LeadStage = "NEW" | "CONTACTED" | "INTERESTED" | "ENROLLED" | "LOST";
export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";
export type EmailStatus = "QUEUED" | "SENT" | "FAILED";

export const STAGES: LeadStage[] = ["NEW", "CONTACTED", "INTERESTED", "ENROLLED", "LOST"];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  batchId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserBrief {
  id: string;
  name: string;
  email: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: string | null;
  courseInterest: string | null;
  stage: LeadStage;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedToId: string | null;
  assignedTo: UserBrief | null;
  createdBy: UserBrief;
  convertedUserId: string | null;
  _count: { notes: number };
}

export interface LeadNote {
  id: string;
  body: string;
  createdAt: string;
  author: UserBrief;
}

export interface LeadActivity {
  id: string;
  type: "CREATED" | "IMPORTED" | "STAGE_CHANGED" | "NOTE_ADDED" | "ASSIGNED" | "CONVERTED" | "REMINDER_SENT";
  meta: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface Batch {
  id: string;
  name: string;
  course: string;
  startDate: string;
  endDate: string | null;
  mentorId: string | null;
  mentor: UserBrief | null;
  _count: { students: number };
}

export interface Student {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AttendanceDay {
  date: string;
  unmarked: number;
  items: { student: UserBrief; status: AttendanceStatus | null }[];
}

export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  total: number;
  percentage: number | null;
}

export interface BatchAttendanceSummary {
  batchId: string;
  averagePercentage: number | null;
  items: (AttendanceCounts & { student: UserBrief })[];
}

export interface MyAttendance extends AttendanceCounts {
  batchId: string | null;
  recent: { date: string; status: AttendanceStatus }[];
}

export interface Option {
  id: string;
  text: string;
  isCorrect?: boolean;
}

export interface Question {
  id: string;
  text: string;
  points: number;
  options: Option[];
}

export interface QuizSummary {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  isPublished: boolean;
  createdAt: string;
  batch: { id: string; name: string };
  _count: { questions: number; attempts: number };
}

export interface StudentQuiz {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  createdAt: string;
  _count: { questions: number };
  myAttempt: { status: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED"; score: number; maxScore: number } | null;
}

export interface FullQuiz extends QuizSummary {
  questions: Question[];
  createdBy: { id: string; name: string };
}

export interface Attempt {
  id: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
  score: number;
  maxScore: number;
  timeTakenMs: number | null;
  startedAt: string;
  submittedAt: string | null;
  student: UserBrief;
}

export interface StartedAttempt {
  attemptId: string;
  startedAt: string;
  expiresAt: string;
  quiz: { id: string; title: string; description: string | null; durationSeconds: number };
  questions: Question[];
}

export interface QuizResult {
  status: "SUBMITTED" | "EXPIRED";
  score: number;
  maxScore: number;
  percentage: number;
  timeTakenMs: number | null;
  submittedAt: string | null;
  review: {
    questionId: string;
    text: string;
    points: number;
    options: Required<Option>[];
    yourOptionId: string | null;
    correct: boolean;
  }[];
}

export interface QuizLeaderboard {
  quizId: string;
  title: string;
  generatedAt: string;
  entries: { rank: number; studentId: string; name: string; score: number; maxScore: number; percentage: number; timeTakenMs: number }[];
}

export interface BatchLeaderboard {
  batchId: string;
  batchName: string;
  generatedAt: string;
  entries: {
    rank: number;
    studentId: string;
    name: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    quizzesTaken: number;
    totalTimeMs: number;
  }[];
}

export interface EmailLog {
  id: string;
  to: string;
  template: "welcome" | "quiz-result" | "lead-follow-up";
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface DocumentInfo {
  id: string;
  kind: "RESUME" | "OTHER";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  ownerId: string;
}

export interface DashboardStats {
  generatedAt: string;
  leads: {
    total: number;
    byStage: Record<LeadStage, number>;
    bySource: { source: string; count: number }[];
    followUpsDue: number;
    conversionRate: number | null;
    perWeek: { weekStart: string; created: number; converted: number }[];
  };
  students: number;
  mentors: number;
  batches: { total: number; active: number };
  attendance: {
    last30Days: { percentage: number | null; recordsMarked: number };
    byBatch: { batchId: string; name: string; percentage: number | null }[];
  };
  quizzes: { published: number; attemptsLast30Days: number; averageScoreLast30Days: number | null };
  emails: { last7Days: { sent: number; queued: number; failed: number } };
}
